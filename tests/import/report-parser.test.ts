import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, test } from "vitest";
import { findDuplicates } from "../../src/import/dedupe";
import { parseReport, parseRows } from "../../src/import/report-parser";
import type { AdRecord, BusinessRecord } from "../../src/domain/types";

const skuMap = {
  sizeBySku: { "A022-XXX-09-0B500": "XL" },
  sizeByAsin: { B0CFPR34MH: "XL" },
} as const;

describe("report parser", () => {
  test("normalizes a business row and maps its SKU to XL", () => {
    const result = parseRows(
      [{ Date: "2026/11/24", SKU: "  a022-xxx-09-0b500 ", Units: "8", Sales: "$506.16" }],
      "business",
      skuMap,
    );

    expect(result).toMatchObject({ fatal: false, records: [{ date: "2026-11-24", sku: "a022-xxx-09-0b500", size: "XL", units: 8, sales: 506.16 }] });
    expect((result.records[0] as BusinessRecord).key).toBe("business:2026-11-24:a022-xxx-09-0b500");
  });

  test("normalizes an ad row with currency fields", () => {
    const result = parseRows(
      [{ Date: "2026-11-24", Campaign: "  Holiday Push ", Spend: "$12.50", "Ad Sales": "$90.25", "Ad Orders": "2", Clicks: "10", Impressions: "1,200" }],
      "ads",
      skuMap,
    );

    expect(result).toMatchObject({ fatal: false, records: [{ date: "2026-11-24", campaign: "Holiday Push", spend: 12.5, adSales: 90.25, adOrders: 2, clicks: 10, impressions: 1200 }] });
    expect((result.records[0] as AdRecord).key).toBe("ads:2026-11-24:holiday push");
  });

  test("recognizes UTF-8 Chinese business headers", () => {
    const result = parseRows(
      [{ 日期: "2026-11-24", 卖家SKU: "A022-XXX-09-0B500", 已订购商品数量: "8", 已订购商品销售额: "506.16" }],
      "business",
      skuMap,
    );

    expect(result).toMatchObject({ fatal: false, records: [{ size: "XL", units: 8, sales: 506.16 }] });
  });

  test("recognizes UTF-8 Chinese ad headers and normalizes percentage strings", () => {
    const result = parseRows(
      [{ 日期: "2026-11-24", 广告活动名称: "Campaign I", 花费: "12.5%", 广告销售额: "90.25%", 广告订单: "2" }],
      "ads",
      skuMap,
    );

    expect(result).toMatchObject({ fatal: false, records: [{ campaign: "Campaign I", spend: 12.5, adSales: 90.25, adOrders: 2 }] });
    expect((result.records[0] as AdRecord).key).toBe("ads:2026-11-24:campaign i");
  });

  test("rejects a business report missing a required column", () => {
    const result = parseRows([{ Date: "2026-11-24", SKU: "A022-XXX-09-0B500", Units: "8" }], "business", skuMap);

    expect(result).toMatchObject({ fatal: true, records: [] });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_COLUMN", field: "sales" }));
  });

  test("excludes an unmapped business row", () => {
    const result = parseRows([{ Date: "2026-11-24", SKU: "UNKNOWN", Units: "8", Sales: "506.16" }], "business", skuMap);

    expect(result.records).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "UNMAPPED_SKU", identifier: "UNKNOWN" }));
  });

  test("preserves explicit zero but reports blank required numeric values", () => {
    const result = parseRows([
      { Date: "2026-11-24", SKU: "A022-XXX-09-0B500", Units: "0", Sales: "0" },
      { Date: "2026-11-25", SKU: "A022-XXX-09-0B500", Units: "", Sales: "" },
    ], "business", skuMap);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ units: 0, sales: 0 });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_VALUE", field: "units" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_VALUE", field: "sales" }));
  });

  test("parses a CSV fixture", async () => {
    const buffer = await readFile(resolve(import.meta.dirname, "fixtures/business.csv"));
    const result = parseReport(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "business.csv", skuMap);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ size: "XL", sales: 506.16 });
  });

  test("parses an XLSX-compatible workbook buffer", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Date: "2026-11-24", Campaign: "Holiday Push", Spend: "$12.50", "Ad Sales": "$90.25", "Ad Orders": 2 }]), "Sponsored Products");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    expect(parseReport(buffer, "ads.xlsx", skuMap).records).toMatchObject([{ campaign: "Holiday Push", spend: 12.5, adSales: 90.25 }]);
  });

  test("detects advertising content before considering a generic filename", () => {
    const csv = "Date,Campaign,Spend,Ad Sales,Ad Orders\n2026-11-24,Holiday Push,12.5,90.25,2";
    const result = parseReport(new TextEncoder().encode(csv).buffer, "amazon-export.csv", skuMap);

    expect(result.reportKind).toBe("ads");
    expect(result.records).toMatchObject([{ campaign: "Holiday Push", spend: 12.5 }]);
  });

  test("detects business content before a misleading advertising filename", () => {
    const csv = "Date,SKU,Units,Sales\n2026-11-24,A022-XXX-09-0B500,8,506.16";
    const result = parseReport(new TextEncoder().encode(csv).buffer, "advertising-backup.csv", skuMap);

    expect(result.reportKind).toBe("business");
    expect(result.records).toMatchObject([{ sku: "A022-XXX-09-0B500", units: 8 }]);
  });

  test("retains optional CPC, CTR, and CVR supplied by an advertising report", () => {
    const result = parseRows([{
      Date: "2026-11-24",
      Campaign: "Holiday Push",
      Spend: "12.50",
      "Ad Sales": "90.25",
      "Ad Orders": "2",
      CPC: "$1.25",
      CTR: "2.5%",
      CVR: "10%",
    }], "ads", skuMap);

    expect(result.records).toMatchObject([{ cpc: 1.25, ctr: 0.025, cvr: 0.1 }]);
  });
});

describe("dedupe", () => {
  test("returns duplicate deterministic keys without mutating either input", () => {
    const existing: BusinessRecord[] = [{ key: "business:2026-11-24:A022", date: "2026-11-24", asin: "", sku: "A022", size: "XL", units: 8, sales: 506.16, refunds: 0 }];
    const incoming: BusinessRecord[] = [existing[0], { ...existing[0], key: "business:2026-11-25:A022", date: "2026-11-25" }];
    const existingBefore = structuredClone(existing);
    const incomingBefore = structuredClone(incoming);

    const result = findDuplicates(existing, incoming);

    expect(result.duplicates).toEqual([incoming[0]]);
    expect(result.unique).toEqual([incoming[1]]);
    expect(existing).toEqual(existingBefore);
    expect(incoming).toEqual(incomingBefore);
  });
});
