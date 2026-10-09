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
  test("product import does not offer an unrelated fallback advertising date", () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<ImportPanel plan={plan} initialReportKind="productPerformance" />);
    expect(screen.queryByLabelText("广告报表日期")).toBeNull();
  });
  test("saves Lingxing parent product data separately and previews duplicate updates", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const csv = "时间,ASIN,销量,净销售额,结算毛利润,广告花费,广告销售额,广告订单量,点击,展示\n2026-10-01,B0HC59CW1H,0,0,-3.16,2.42,65.99,1,2,382";
    await preview("产品表现日详情父ASIN.csv", csv);
    await screen.findByText("有效行: 1");
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await screen.findByText("导入已保存");
    expect(await opsDb.list("productPerformance")).toMatchObject([{ scope: "parent", date: "2026-10-01", spend: 2.42 }]);
    expect(await opsDb.list("ads")).toEqual([]);
    expect(await opsDb.list("business")).toEqual([]);
    expect(await opsDb.list("rawRows")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("选择报告文件"), { target: { files: [file("产品表现日详情父ASIN.csv", csv.replace("2.42", "3.42"))] } });
    await screen.findByText("重复记录: 1");
    expect((screen.getByRole("button", { name: "保存导入" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("替换旧记录"));
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await screen.findByText("导入已保存");
    expect(await opsDb.list("productPerformance")).toMatchObject([{ spend: 3.42 }]);
    expect(await opsDb.list("productPerformance")).toHaveLength(1);
  });
  test("re-previews a native campaign export after the user supplies its single-day report date", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await preview("export.csv", "广告活动名称,广告活动开始日期,展示量,点击量,总成本,销售额,购买量,ACOS,ROAS,转化率,搜索结果首页首位展示量份额,是否调整\nSanta,2024-11-21,1000,10,US$12,US$60,2,20%,5,20%,12.5%,是");
    expect(screen.getByText("报告类型: 广告")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存导入" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("广告报表日期"), { target: { value: "2026-10-04" } });
    await screen.findByText("有效行: 1");
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await screen.findByText("导入已保存");
    expect(await opsDb.list("ads")).toMatchObject([{ date: "2026-10-04", campaign: "Santa", spend: 12, adSales: 60, adOrders: 2, acos: 0.2, roas: 5, cvr: 0.2, topOfSearchImpressionShare: 0.125, adjusted: true }]);
    expect(await opsDb.list("business")).toEqual([]);
  });

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
