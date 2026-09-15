import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, test } from "vitest";
import { isInventoryReport, parseInventoryReport, parseInventoryRows } from "../../src/import/inventory-parser";

const skuMap = {
  sizeBySku: { "A022-XXX-09-0B500": "XL", "SKU-L": "L", "SKU-2XL": "2XL", "SKU-3XL": "3XL" },
  sizeByAsin: { B0CFPR34MH: "XL" },
} as const;
const options = { fallbackDate: "2026-11-30", sourceImportKey: "import:inventory-test" };

describe("inventory parser", () => {
  test("recognizes English inventory headers and creates deterministic date-size keys", () => {
    const result = parseInventoryRows([{
      "seller-sku": "A022-XXX-09-0B500",
      ASIN: "B0CFPR34MH",
      "afn-fulfillable-quantity": "24",
      "afn-reserved-quantity": "2",
      "afn-unsellable-quantity": "1",
      "snapshot-date": "2026-11-24",
    }], skuMap, options);

    expect(result).toMatchObject({
      fatal: false,
      reportKind: "inventory",
      records: [{
        key: "inventory:2026-11-24:XL",
        date: "2026-11-24",
        size: "XL",
        fbaAvailable: 24,
        reserved: 2,
        unfulfillable: 1,
        sourceImportKey: "import:inventory-test",
      }],
    });
  });

  test("recognizes Chinese headers and maps by ASIN", () => {
    const result = parseInventoryRows([{
      卖家SKU: "",
      ASIN: "B0CFPR34MH",
      FBA可售: "9",
      预留: "0",
      不可售: "3",
      日期: "2026/11/25",
    }], skuMap, options);

    expect(result.records).toEqual([{
      key: "inventory:2026-11-25:XL",
      date: "2026-11-25",
      size: "XL",
      fbaAvailable: 9,
      reserved: 0,
      unfulfillable: 3,
      sourceImportKey: "import:inventory-test",
    }]);
  });

  test("uses the explicitly supplied fallback date without reading the clock", () => {
    const result = parseInventoryRows([{
      SKU: "SKU-L",
      "afn-fulfillable-quantity": "0",
      "afn-reserved-quantity": "",
      "afn-unsellable-quantity": "",
      "snapshot-date": "",
    }], skuMap, options);

    expect(result.records).toEqual([{
      key: "inventory:2026-11-30:L",
      date: "2026-11-30",
      size: "L",
      fbaAvailable: 0,
      reserved: null,
      unfulfillable: null,
      sourceImportKey: "import:inventory-test",
    }]);
  });

  test("returns a fatal result with no records when identifier or fulfillable columns are missing", () => {
    const noIdentifier = parseInventoryRows([{ "afn-fulfillable-quantity": "2" }], skuMap, options);
    const noFulfillable = parseInventoryRows([{ SKU: "SKU-L" }], skuMap, options);

    expect(noIdentifier).toMatchObject({ fatal: true, records: [] });
    expect(noIdentifier.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_COLUMN", field: "sku" }));
    expect(noFulfillable).toMatchObject({ fatal: true, records: [] });
    expect(noFulfillable.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_COLUMN", field: "fbaAvailable" }));
  });

  test("excludes invalid required quantities and reports the exact unmapped identifier", () => {
    const result = parseInventoryRows([
      { SKU: "SKU-L", "afn-fulfillable-quantity": "" },
      { SKU: "Exact-UNKNOWN_42", "afn-fulfillable-quantity": "7" },
    ], skuMap, options);

    expect(result.records).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_VALUE", field: "fbaAvailable", row: 2 }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "UNMAPPED_SKU", identifier: "Exact-UNKNOWN_42", row: 3 }));
  });

  test("parses the CSV fixture", async () => {
    const buffer = await readFile(resolve(import.meta.dirname, "../fixtures/inventory.csv"));
    const input = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    expect(parseInventoryReport(input, "inventory.csv", skuMap, options).records)
      .toMatchObject([{ key: "inventory:2026-11-24:XL", fbaAvailable: 24 }]);
  });

  test("parses XLSX and XLS workbook buffers through SheetJS", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      SKU: "SKU-2XL",
      "FBA可售": 12,
      预留: "",
      不可售: 0,
      日期: "2026-11-26",
    }]), "Inventory");

    for (const bookType of ["xlsx", "xls"] as const) {
      const buffer = XLSX.write(workbook, { type: "array", bookType }) as ArrayBuffer;
      expect(parseInventoryReport(buffer, `inventory.${bookType}`, skuMap, options).records)
        .toMatchObject([{ key: "inventory:2026-11-26:2XL", reserved: null, unfulfillable: 0 }]);
    }
  });

  test("identifies inventory by headers before a misleading business filename", () => {
    const csv = "SKU,afn-fulfillable-quantity,snapshot-date\nSKU-3XL,8,2026-11-27";
    const input = new TextEncoder().encode(csv).buffer;

    expect(isInventoryReport(input, "business-report.csv")).toBe(true);
    expect(parseInventoryReport(input, "business-report.csv", skuMap, options).reportKind).toBe("inventory");
  });

  test("preserves a complete V1 business signature when an inventory quantity column is incidental", () => {
    const csv = "Date,SKU,Units,Sales,afn-fulfillable-quantity\n2026-11-24,SKU-L,2,20,8";

    expect(isInventoryReport(new TextEncoder().encode(csv).buffer, "inventory-backup.csv")).toBe(false);
  });

  test("preserves a complete V1 advertising signature when inventory identifier and quantity columns are incidental", () => {
    const csv = "Date,Campaign,Spend,Ad Sales,Ad Orders,SKU,afn-fulfillable-quantity\n2026-11-24,Holiday Push,5,20,2,SKU-L,8";

    expect(isInventoryReport(new TextEncoder().encode(csv).buffer, "inventory-backup.csv")).toBe(false);
  });
});
