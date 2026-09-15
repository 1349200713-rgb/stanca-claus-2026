// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportPanel } from "../../src/components/ImportPanel";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const plan = { sizeBySku: { A022: "XL" }, sizeByAsin: {} } as const;
const header = "Date,SKU,Units,Sales";
const duplicate = "2026-11-24,A022,8,506.16";
const unique = "2026-11-25,A022,3,189.81";

function file(name: string, csv: string): File {
  const report = new File([csv], name, { type: "text/csv" });
  Object.defineProperty(report, "arrayBuffer", { value: async () => new TextEncoder().encode(csv).buffer });
  return report;
}

async function preview(name: string, csv: string) {
  render(<ImportPanel plan={plan} />);
  fireEvent.change(screen.getByLabelText("选择报告文件"), { target: { files: [file(name, csv)] } });
  await waitFor(() => expect(screen.getByText("导入预览")).toBeTruthy());
}

afterEach(async () => {
  cleanup();
  await resetOpsDbForTests();
});

describe("ImportPanel", () => {
  test("disables saving a report with missing required columns and writes nothing", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await preview("business.csv", "Date,SKU,Units\n2026-11-24,A022,8");

    expect((screen.getByRole("button", { name: "保存导入" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Missing required column: sales/)).toBeTruthy();
    expect(await opsDb.list("business")).toEqual([]);
    expect(await opsDb.list("imports")).toEqual([]);
  });

  test("shows an unmapped identifier, counts one affected row, and excludes it from saved business records", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await preview("business.csv", `${header}\nnot-a-date,UNKNOWN,,`);

    expect(screen.getByText(/SKU\/ASIN does not map to a size/)).toBeTruthy();
    expect(screen.getByText(/UNKNOWN/)).toBeTruthy();
    expect(screen.getByText("问题行: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(async () => expect(await opsDb.list("imports")).toHaveLength(1));
    expect(await opsDb.list("business")).toEqual([]);
  });

  test("requires a choice for duplicate keys repeated within one uploaded file", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await preview("business.csv", `${header}\n${duplicate}\n${duplicate}`);

    expect(screen.getByText("重复记录: 1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存导入" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("忽略重复"));
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(async () => expect(await opsDb.list("imports")).toHaveLength(1));

    expect(await opsDb.list("business")).toMatchObject([{ date: "2026-11-24", units: 8 }]);
  });

  test("replacing duplicate keys within one uploaded file keeps the final row", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await preview("business.csv", `${header}\n${duplicate}\n2026-11-24,A022,9,568.31`);

    fireEvent.click(screen.getByLabelText("替换旧记录"));
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(async () => expect(await opsDb.list("imports")).toHaveLength(1));

    expect(await opsDb.list("business")).toMatchObject([{ date: "2026-11-24", units: 9, sales: 568.31 }]);
  });

  test("shows duplicate preview and requires an explicit ignore or replace choice", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", [{ key: "business:2026-11-24:a022", date: "2026-11-24", sku: "A022", asin: "", size: "XL", units: 1, sales: 1, refunds: 0 }]);
    await preview("business.csv", `${header}\n${duplicate}`);

    expect(screen.getByText("重复记录: 1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存导入" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("忽略重复")).toBeTruthy();
    expect(screen.getByLabelText("替换旧记录")).toBeTruthy();
    expect(screen.getByText(/"units":1/)).toBeTruthy();
    expect(screen.getByText(/"units":8/)).toBeTruthy();
  });

  test("ignoring duplicates saves only unique rows and logs the import counts", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", [{ key: "business:2026-11-24:a022", date: "2026-11-24", sku: "A022", asin: "", size: "XL", units: 1, sales: 1, refunds: 0 }]);
    await preview("business.csv", `${header}\n${duplicate}\n${unique}`);

    fireEvent.click(screen.getByLabelText("忽略重复"));
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(async () => expect(await opsDb.list("imports")).toHaveLength(1));

    expect(await opsDb.list("business")).toMatchObject([{ date: "2026-11-24", units: 1 }, { date: "2026-11-25", units: 3 }]);
    expect(await opsDb.list("imports")).toMatchObject([{ filename: "business.csv", reportKind: "business", rowCount: 2, issueCount: 0, duplicateCount: 1, action: "insert" }]);
    expect(await opsDb.list("rawImports")).toHaveLength(1);
    expect(await opsDb.list("rawRows")).toHaveLength(2);
    expect(await opsDb.list("derivedResults")).toHaveLength(1);
  });

  test("replacing duplicates overwrites the existing record", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", [{ key: "business:2026-11-24:a022", date: "2026-11-24", sku: "A022", asin: "", size: "XL", units: 1, sales: 1, refunds: 0 }]);
    await preview("business.csv", `${header}\n${duplicate}`);

    fireEvent.click(screen.getByLabelText("替换旧记录"));
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(async () => expect(await opsDb.list("imports")).toHaveLength(1));

    expect(await opsDb.list("business")).toMatchObject([{ date: "2026-11-24", units: 8, sales: 506.16 }]);
    expect(await opsDb.list("imports")).toMatchObject([{ action: "replace", duplicateCount: 1 }]);
  });
});
