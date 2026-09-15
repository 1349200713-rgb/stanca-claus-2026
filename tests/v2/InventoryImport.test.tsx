// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { ImportPanel } from "../../src/components/ImportPanel";
import type { InventorySnapshot } from "../../src/domain/planning";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const plan = { sizeBySku: { "SKU-L": "L" }, sizeByAsin: {} } as const;

function reportFile(name: string, csv: string): File {
  const report = new File([csv], name, { type: "text/csv" });
  Object.defineProperty(report, "arrayBuffer", { value: async () => new TextEncoder().encode(csv).buffer });
  return report;
}

function workbookFile(name: string, rows: Record<string, string>[]): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Sheet1");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const report = new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(report, "arrayBuffer", { value: async () => bytes });
  return report;
}

afterEach(async () => {
  cleanup();
  await resetOpsDbForTests();
});

describe("inventory import", () => {
  test("recognizes shipment cadence workbooks as inbound and saves shipment lines", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<ImportPanel plan={plan} inventorySnapshotDate="2026-11-30" />);
    const workbook = workbookFile("工作簿1.xlsx", [
      { 货件号: "FBA19MSY9TRD", 单价: "13.3/KG", 发货时效: "9.3号快开船", 品名: "XL码 5JUN-RD 圣诞服9件套", SKU: "A022-XXX-09-0B500", 发货量: "15", 预计到仓时间: "10月5号" },
      { 货件号: "", 单价: "", 发货时效: "", 品名: "XXL码 5JUN-RD 圣诞服9件套", SKU: "A022-XXX-09-0C100", 发货量: "80", 预计到仓时间: "" },
    ]);

    fireEvent.change(screen.getByLabelText("选择报告文件"), { target: { files: [workbook] } });
    await waitFor(() => expect(screen.getByText("报告类型: 在途")).toBeTruthy());

    expect(screen.getByText("有效行: 2")).toBeTruthy();
    expect(screen.queryByText(/Missing required column: date/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("导入已保存"));

    expect(await opsDb.getInboundEntries()).toMatchObject([
      { fbaNumber: "FBA19MSY9TRD", unitPrice: "13.3/KG", sku: "A022-XXX-09-0B500", size: "XL", units: 15, shipDate: "2026-09-03", expectedArrivalDate: "2026-10-05" },
      { fbaNumber: "FBA19MSY9TRD", unitPrice: "13.3/KG", sku: "A022-XXX-09-0C100", size: "2XL", units: 80, shipDate: "2026-09-03", expectedArrivalDate: "2026-10-05" },
    ]);
    expect(await opsDb.list("imports")).toMatchObject([{ filename: "工作簿1.xlsx", reportKind: "inbound", rowCount: 2 }]);
    expect(await opsDb.list("rawImports")).toHaveLength(1);
    expect(await opsDb.list("rawRows")).toHaveLength(2);
  });

  test("shows old and incoming inventory values and atomically replaces formal and evidence records", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const existing: InventorySnapshot = {
      key: "inventory:2026-11-30:L",
      date: "2026-11-30",
      size: "L",
      fbaAvailable: 4,
      reserved: null,
      unfulfillable: null,
      sourceImportKey: "import:old",
    };
    await opsDb.replaceInventorySnapshots([existing]);
    render(<ImportPanel plan={plan} inventorySnapshotDate="2026-11-30" />);
    const csv = "SKU,afn-fulfillable-quantity,afn-reserved-quantity,afn-unsellable-quantity\nSKU-L,7,0,";

    fireEvent.change(screen.getByLabelText("选择报告文件"), { target: { files: [reportFile("business-report.csv", csv)] } });
    await waitFor(() => expect(screen.getByText("报告类型: 库存")).toBeTruthy());

    expect(screen.getByText("重复记录: 1")).toBeTruthy();
    expect(screen.getByText(/"fbaAvailable":4/)).toBeTruthy();
    expect(screen.getByText(/"fbaAvailable":7/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("替换旧记录"));
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("导入已保存"));

    const [stored] = await opsDb.listInventorySnapshots();
    const [log] = await opsDb.list("imports");
    expect(stored).toMatchObject({ key: existing.key, fbaAvailable: 7, reserved: 0, unfulfillable: null, sourceImportKey: log.key });
    expect(log).toMatchObject({ reportKind: "inventory", rowCount: 1, duplicateCount: 1, action: "replace" });
    expect(await opsDb.list("rawImports")).toHaveLength(1);
    expect(await opsDb.list("rawRows")).toMatchObject([{ values: { SKU: "SKU-L", "afn-fulfillable-quantity": "7" } }]);
    expect(await opsDb.list("derivedResults")).toMatchObject([{ reportKind: "inventory", record: { sourceImportKey: log.key } }]);
  });

  test("rolls back inventory and evidence when the import log cannot be written", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const log = { key: "import:duplicate", filename: "inventory.csv", importedAt: "2026-11-30T00:00:00.000Z", reportKind: "inventory" as const, rowCount: 1, issueCount: 0, duplicateCount: 0, action: "insert" as const };
    const record: InventorySnapshot = { key: "inventory:2026-11-30:L", date: "2026-11-30", size: "L", fbaAvailable: 7, reserved: null, unfulfillable: null, sourceImportKey: log.key };
    await opsDb.insert("imports", [log]);

    await expect(opsDb.commitImport("inventory", [record], log, {
      bytes: new TextEncoder().encode("SKU,afn-fulfillable-quantity\nSKU-L,7").buffer,
      rawRows: [{ SKU: "SKU-L", "afn-fulfillable-quantity": "7" }],
    })).rejects.toThrow();

    expect(await opsDb.listInventorySnapshots()).toEqual([]);
    expect(await opsDb.list("rawImports")).toEqual([]);
    expect(await opsDb.list("rawRows")).toEqual([]);
    expect(await opsDb.list("derivedResults")).toEqual([]);
  });
});
