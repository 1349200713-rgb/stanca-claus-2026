import * as XLSX from "xlsx";
import type { InboundEntry } from "../domain/planning";
import type { SizeCode } from "../domain/types";
import type { ParseIssue, RawReportRow } from "./report-parser";

type Row = Record<string, unknown>;

export interface InboundParseResult {
  fatal: boolean;
  reportKind: "inbound";
  records: InboundEntry[];
  issues: ParseIssue[];
  rawRows: RawReportRow[];
}

const aliases = {
  fbaNumber: ["fba单号", "fba 单号", "货件号", "shipment id"],
  unitPrice: ["单价", "price", "unit price"],
  asin: ["asin"],
  sku: ["sku", "卖家sku"],
  productName: ["品名", "产品名称", "product name"],
  units: ["数量", "发货量", "合计", "units", "quantity"],
  shipDate: ["开船时间", "发货时效", "发货时间", "ship date"],
  expectedArrivalDate: ["到货时间", "预计到仓时间", "预计到仓日期", "arrival date"],
} as const;

function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim().replace(/\s+/g, " ");
}

function columnFor(row: Row, field: keyof typeof aliases): string | undefined {
  return Object.keys(row).find((header) => aliases[field].some((alias) => canonical(header) === canonical(alias)));
}

function read(row: Row, field: keyof typeof aliases): string {
  const column = columnFor(row, field);
  return column ? stringValue(row[column]) : "";
}

function rawRows(rows: Row[]): RawReportRow[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([header, value]) => [header, value == null ? "" : String(value)])));
}

function numberValue(value: string): number | undefined {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateValue(value: string, defaultYear: number): string | undefined {
  if (!value.trim()) return undefined;
  const serial = Number(value);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(value)) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const normalized = value.replace(/[年月/]/g, "-").replace(/[日号]/g, "").replace(/\./g, "-");
  const yearFirst = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const monthDay = normalized.match(/(?:^|[^\d])(\d{1,2})-(\d{1,2})(?:[^\d]|$)/);
  const year = yearFirst?.[1] ?? String(defaultYear);
  const month = yearFirst?.[2] ?? monthDay?.[1];
  const day = yearFirst?.[3] ?? monthDay?.[2];
  if (!month || !day) return undefined;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function sizeFromProductName(productName: string): SizeCode {
  const normalized = productName.trim().toUpperCase();
  if (/^(3XL|XXXL)\b|^(3XL|XXXL)码/.test(normalized)) return "3XL";
  if (/^(2XL|XXL)\b|^(2XL|XXL)码/.test(normalized)) return "2XL";
  if (/^XL\b|^XL码/.test(normalized)) return "XL";
  return "L";
}

function rowsFromWorkbook(input: ArrayBuffer): Row[] {
  const workbook = XLSX.read(input, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
}

export function isInboundReport(input: ArrayBuffer): boolean {
  const headers = rowsFromWorkbook(input)[0] ?? {};
  return Boolean(columnFor(headers, "fbaNumber") && columnFor(headers, "sku") && columnFor(headers, "productName") && columnFor(headers, "units"));
}

export function parseInboundRows(rows: Row[], options: { defaultYear?: number; updatedAt: string }): InboundParseResult {
  const issues: ParseIssue[] = [];
  const sourceRows = rawRows(rows);
  const headers = rows[0] ?? {};
  const missing = (["fbaNumber", "sku", "productName", "units"] as const).filter((field) => !columnFor(headers, field));
  if (missing.length) {
    return {
      fatal: true,
      reportKind: "inbound",
      records: [],
      issues: missing.map((field) => ({ code: "MISSING_REQUIRED_COLUMN", field, message: `Missing required column: ${field}` })),
      rawRows: sourceRows,
    };
  }

  const defaultYear = options.defaultYear ?? new Date().getFullYear();
  const records: InboundEntry[] = [];
  let fbaNumber = "";
  let unitPrice = "";
  let shipDate: string | null = null;
  let expectedArrivalDate: string | null = null;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    fbaNumber = read(row, "fbaNumber") || fbaNumber;
    unitPrice = read(row, "unitPrice") || unitPrice;
    shipDate = dateValue(read(row, "shipDate"), defaultYear) ?? shipDate;
    expectedArrivalDate = dateValue(read(row, "expectedArrivalDate"), defaultYear) ?? expectedArrivalDate;
    const asin = read(row, "asin");
    const sku = read(row, "sku");
    const productName = read(row, "productName");
    const units = numberValue(read(row, "units"));

    if (!fbaNumber) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "fbaNumber", row: rowNumber, message: "Missing FBA number" });
    if (!sku) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "sku", row: rowNumber, message: "Missing SKU" });
    if (!productName) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "productName", row: rowNumber, message: "Missing product name" });
    if (units === undefined) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "units", row: rowNumber, message: "Missing or invalid quantity" });
    if (!fbaNumber || !sku || !productName || units === undefined) return;

    records.push({
      size: sizeFromProductName(productName),
      units,
      expectedArrivalDate,
      updatedAt: options.updatedAt,
      fbaNumber,
      unitPrice,
      asin,
      sku,
      productName,
      shipDate,
    });
  });

  return { fatal: false, reportKind: "inbound", records, issues, rawRows: sourceRows };
}

export function parseInboundReport(input: ArrayBuffer, filename: string, options: { defaultYear?: number; updatedAt: string }): InboundParseResult {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx" && extension !== "xls") {
    return { fatal: true, reportKind: "inbound", records: [], issues: [{ code: "UNSUPPORTED_FILE", message: `Unsupported inbound file: ${filename}` }], rawRows: [] };
  }
  return parseInboundRows(rowsFromWorkbook(input), options);
}
