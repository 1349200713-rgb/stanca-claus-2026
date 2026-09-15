import * as XLSX from "xlsx";
import type { InventorySnapshot } from "../domain/planning";
import type { ParseIssue, RawReportRow, SkuMap } from "./report-parser";

type Row = Record<string, unknown>;

export interface InventoryParseOptions {
  fallbackDate: string;
  sourceImportKey: string;
}

export interface InventoryParseResult {
  fatal: boolean;
  reportKind: "inventory";
  records: InventorySnapshot[];
  issues: ParseIssue[];
  rawRows: RawReportRow[];
}

const aliases = {
  date: ["snapshot-date", "snapshot date", "日期"],
  sku: ["seller-sku", "seller sku", "sku", "卖家sku"],
  asin: ["asin"],
  fbaAvailable: ["afn-fulfillable-quantity", "afn fulfillable quantity", "fba可售"],
  reserved: ["afn-reserved-quantity", "afn reserved quantity", "预留"],
  unfulfillable: ["afn-unsellable-quantity", "afn unsellable quantity", "不可售"],
} as const;

function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function columnFor(row: Row, field: keyof typeof aliases): string | undefined {
  return Object.keys(row).find((header) => aliases[field].some((alias) => canonical(header) === canonical(alias)));
}

function read(row: Row, field: keyof typeof aliases): string {
  const column = columnFor(row, field);
  return column ? stringValue(row[column]) : "";
}

function numberValue(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rawRows(rows: Row[]): RawReportRow[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([header, value]) => [header, value == null ? "" : String(value)]),
  ));
}

function dateValue(value: string): string | undefined {
  if (!value) return undefined;
  const serial = Number(value);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(value)) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const normalized = value.replace(/[./]/g, "-");
  const yearFirst = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const monthFirst = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (!yearFirst && !monthFirst) return undefined;
  const year = yearFirst?.[1] ?? String(Number(monthFirst![3]) + (monthFirst![3].length === 2 ? 2000 : 0));
  const month = yearFirst?.[2] ?? monthFirst![1];
  const day = yearFirst?.[3] ?? monthFirst![2];
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function sizeFor(skuMap: SkuMap, sku: string, asin: string) {
  const find = (entries: Record<string, InventorySnapshot["size"]>, identifier: string) =>
    Object.entries(entries).find(([key]) => canonical(key) === canonical(identifier))?.[1];
  return (sku && find(skuMap.sizeBySku, sku)) || (asin && find(skuMap.sizeByAsin, asin));
}

function hasInventorySignature(row: Row): boolean {
  return Boolean((columnFor(row, "sku") || columnFor(row, "asin")) && columnFor(row, "fbaAvailable"));
}

function hasBusinessOrAdSignature(row: Row): boolean {
  const headers = new Set(Object.keys(row).map(canonical));
  const has = (...values: string[]) => values.some((value) => headers.has(canonical(value)));
  const business = Boolean(columnFor(row, "sku") || columnFor(row, "asin"))
    && has("date", "日期")
    && has("units", "销量", "已订购商品数量")
    && has("sales", "销售额", "已订购商品销售额");
  const ads = has("date", "日期")
    && has("campaign", "广告活动名称")
    && has("spend", "花费")
    && has("ad sales", "广告销售额")
    && has("ad orders", "广告订单");
  return business || ads;
}

function rowsFromWorkbook(input: ArrayBuffer): Row[] {
  const workbook = XLSX.read(input, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
}

export function inventoryKindFromFilename(filename: string): boolean {
  return /(^|[-_. ])(inventory|stock)([-_. ]|$)/i.test(filename);
}

/** Complete V1 signatures win, then inventory headers; filenames are only the final fallback. */
export function isInventoryReport(input: ArrayBuffer, filename: string): boolean {
  const headers = rowsFromWorkbook(input)[0] ?? {};
  if (hasBusinessOrAdSignature(headers)) return false;
  if (hasInventorySignature(headers)) return true;
  return inventoryKindFromFilename(filename);
}

export function parseInventoryRows(rows: Row[], skuMap: SkuMap, options: InventoryParseOptions): InventoryParseResult {
  const issues: ParseIssue[] = [];
  const sourceRows = rawRows(rows);
  const headers = rows[0] ?? {};
  const missing: Array<{ field: string; absent: boolean }> = [
    { field: "sku", absent: !columnFor(headers, "sku") && !columnFor(headers, "asin") },
    { field: "fbaAvailable", absent: !columnFor(headers, "fbaAvailable") },
  ];
  const missingColumns = missing.filter(({ absent }) => absent);
  if (missingColumns.length) {
    return {
      fatal: true,
      reportKind: "inventory",
      records: [],
      issues: missingColumns.map(({ field }) => ({ code: "MISSING_REQUIRED_COLUMN", field, message: `Missing required column: ${field}` })),
      rawRows: sourceRows,
    };
  }

  const fallbackDate = dateValue(options.fallbackDate);
  if (!fallbackDate) {
    return {
      fatal: true,
      reportKind: "inventory",
      records: [],
      issues: [{ code: "INVALID_VALUE", field: "fallbackDate", message: "Invalid fallback snapshot date" }],
      rawRows: sourceRows,
    };
  }

  const records: InventorySnapshot[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const sku = read(row, "sku");
    const asin = read(row, "asin");
    const identifier = sku || asin;
    const suppliedDate = read(row, "date");
    const date = suppliedDate ? dateValue(suppliedDate) : fallbackDate;
    const fbaAvailable = numberValue(read(row, "fbaAvailable"));
    const size = sizeFor(skuMap, sku, asin);

    if (!identifier) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "sku", row: rowNumber, message: "Missing SKU/ASIN" });
    else if (!size) issues.push({ code: "UNMAPPED_SKU", field: sku ? "sku" : "asin", row: rowNumber, identifier, message: "SKU/ASIN does not map to a size" });
    if (!date) issues.push({ code: "INVALID_VALUE", field: "date", row: rowNumber, message: "Invalid snapshot date" });
    if (fbaAvailable === undefined) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "fbaAvailable", row: rowNumber, message: "Missing or invalid fulfillable quantity" });
    if (!identifier || !size || !date || fbaAvailable === undefined) return;

    const optional = (field: "reserved" | "unfulfillable"): number | null => {
      const value = read(row, field);
      if (!value) return null;
      const parsed = numberValue(value);
      if (parsed === undefined) issues.push({ code: "INVALID_VALUE", field, row: rowNumber, message: `Invalid ${field} quantity` });
      return parsed ?? null;
    };
    records.push({
      key: `inventory:${date}:${size}`,
      date,
      size,
      fbaAvailable,
      reserved: optional("reserved"),
      unfulfillable: optional("unfulfillable"),
      sourceImportKey: options.sourceImportKey,
    });
  });

  return { fatal: false, reportKind: "inventory", records, issues, rawRows: sourceRows };
}

export function parseInventoryReport(input: ArrayBuffer, filename: string, skuMap: SkuMap, options: InventoryParseOptions): InventoryParseResult {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx" && extension !== "xls") {
    return { fatal: true, reportKind: "inventory", records: [], issues: [{ code: "UNSUPPORTED_FILE", message: `Unsupported inventory file: ${filename}` }], rawRows: [] };
  }
  return parseInventoryRows(rowsFromWorkbook(input), skuMap, options);
}
