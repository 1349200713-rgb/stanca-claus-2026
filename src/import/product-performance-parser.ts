import type { ProductPerformanceRecord } from "../domain/product-performance";
import type { ParseIssue, RawReportRow } from "./report-parser";
import * as XLSX from "xlsx";
export interface ProductPerformanceParseResult { fatal: boolean; reportKind: "productPerformance"; records: ProductPerformanceRecord[]; issues: ParseIssue[]; rawRows: RawReportRow[] }

const aliases = {
  date: ["时间", "日期", "date"], asin: ["ASIN", "父ASIN", "parent asin"], productName: ["品名", "产品名称"],
  units: ["销量"], sales: ["净销售额"], grossProfit: ["结算毛利润"], spend: ["广告花费"], adSales: ["广告销售额"], adOrders: ["广告订单量"], adUnits: ["广告销量"],
  clicks: ["点击", "点击量"], impressions: ["展示", "展示量"], sessions: ["Sessions-Total"], price: ["售价(总价)"], fbaAvailable: ["FBA-可售"], rating: ["评分"], reviews: ["评论数"],
  categoryRank: ["大类排名"], subcategoryRank: ["小类排名"], adOperations: ["广告操作日志运营日志"], listingOperations: ["Listing操作日志运营日志"],
} as const;
const canonical = (value: string) => value.replace(/^\uFEFF/, "").replace(/[（）]/g, (char) => char === "（" ? "(" : ")").replace(/\s/g, "").toLowerCase();
type Row = Record<string, unknown>;
function column(row: Row, field: keyof typeof aliases) { return Object.keys(row).find((key) => aliases[field].some((alias) => canonical(key) === canonical(alias))); }
function cell(row: Row, field: keyof typeof aliases) { const key = column(row, field); return key ? String(row[key] ?? "").trim() : ""; }
function rowsFrom(input: ArrayBuffer) {
  const workbook = XLSX.read(input, { type: "array", cellDates: false, codepage: 65001, raw: true });
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], { defval: "", raw: false });
    if (rows[0] && column(rows[0], "asin") && column(rows[0], "adOrders")) return rows;
  }
  return XLSX.utils.sheet_to_json<Row>(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
}
export function isProductPerformanceReport(input: ArrayBuffer): boolean {
  try { const row = rowsFrom(input)[0]; return Boolean(row && column(row, "asin") && column(row, "sales") && column(row, "adOrders") && column(row, "spend") && !Object.keys(row).some((key) => canonical(key) === "广告活动名称")); }
  catch { return false; }
}
export function parseProductPerformanceReport(input: ArrayBuffer, filename: string): ProductPerformanceParseResult {
  const result: ProductPerformanceParseResult = { fatal: false, reportKind: "productPerformance", records: [], issues: [], rawRows: [] };
  if (!/\.(xlsx|xls|csv)$/i.test(filename)) return { ...result, fatal: true, issues: [{ code: "UNSUPPORTED_FILE", message: "请选择领星按日产品表现 Excel 或 CSV" }] };
  let rows: Row[];
  try { rows = rowsFrom(input); } catch { return { ...result, fatal: true, issues: [{ code: "UNSUPPORTED_FILE", message: "无法读取领星文件" }] }; }
  result.rawRows = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")])));
  for (const field of ["date", "asin", "spend", "adSales", "adOrders"] as const) {
    if (!rows[0] || !column(rows[0], field)) result.issues.push({ code: "MISSING_REQUIRED_COLUMN", field, message: `领星产品表现缺少列：${aliases[field][0]}` });
  }
  if (result.issues.length) return { ...result, fatal: true };
  const scope = /父ASIN|parent/i.test(filename) || Boolean(column(rows[0], "asin")?.includes("父")) ? "parent" : "asin";
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const textDate = cell(row, "date");
    if (/^(总计|合计|汇总|total)$/i.test(textDate)) return;
    const date = textDate.replace(/[/.]/g, "-");
    const dateObject = new Date(`${date}T00:00:00Z`);
    const asin = cell(row, "asin").toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateObject.getTime()) || dateObject.toISOString().slice(0, 10) !== date || !/^[A-Z0-9]{10}$/.test(asin)) {
      result.issues.push({ code: "INVALID_VALUE", row: rowNumber, message: `第${rowNumber}行日期或ASIN无效，已跳过；不会用文件名补造日期` }); return;
    }
    const record: ProductPerformanceRecord = { key: `product-performance:${scope}:${date}:${asin}`, date, asin, scope, sourceFilename: filename };
    let invalid = false;
    const counts = new Set(["units", "adOrders", "adUnits", "clicks", "impressions", "sessions", "fbaAvailable", "reviews"]);
    for (const field of ["units", "sales", "grossProfit", "spend", "adSales", "adOrders", "adUnits", "clicks", "impressions", "sessions", "price", "fbaAvailable", "rating", "reviews"] as const) {
      const value = cell(row, field);
      if (!value || /^(—|-|n\/a)$/i.test(value)) {
        if (["spend", "adSales", "adOrders"].includes(field)) { invalid = true; result.issues.push({ code: "MISSING_REQUIRED_VALUE", row: rowNumber, field, message: `第${rowNumber}行缺少${aliases[field][0]}，已跳过` }); }
        continue;
      }
      const numeric = Number(value.replace(/US\$|USD|[$,\s]/gi, ""));
      if (!Number.isFinite(numeric) || (field !== "grossProfit" && numeric < 0) || (counts.has(field) && !Number.isSafeInteger(numeric)) || (field === "rating" && numeric > 5)) {
        invalid = true; result.issues.push({ code: "INVALID_VALUE", row: rowNumber, field, message: `第${rowNumber}行${aliases[field][0]}无效，已跳过` });
      } else record[field] = numeric;
    }
    if (invalid) return;
    for (const field of ["productName", "categoryRank", "subcategoryRank", "adOperations", "listingOperations"] as const) if (cell(row, field)) record[field] = cell(row, field);
    if (record.units != null && record.adOrders! > record.units) result.issues.push({ code: "INVALID_VALUE", row: rowNumber, message: `第${rowNumber}行广告归因订单高于销量：保留原值，两者日期口径可能不同，不相减推算自然订单` });
    result.records.push(record);
  });
  return result;
}
