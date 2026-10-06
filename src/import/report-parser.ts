import * as XLSX from "xlsx";
import type { AdRecord, BusinessRecord, SizeCode } from "../domain/types";

export type ReportKind = "business" | "ads";
type Row = Record<string, unknown>;
export type RawReportRow = Record<string, string>;

export interface ReportParseOptions {
  reportKind?: ReportKind;
  /** Explicit user-supplied date for a single-day campaign export with no date column. */
  fallbackAdDate?: string;
}

export interface SkuMap {
  sizeBySku: Record<string, SizeCode>;
  sizeByAsin: Record<string, SizeCode>;
}

export interface ParseIssue {
  code: "MISSING_REQUIRED_COLUMN" | "MISSING_REQUIRED_VALUE" | "UNMAPPED_SKU" | "INVALID_VALUE" | "UNSUPPORTED_FILE";
  field?: string;
  row?: number;
  identifier?: string;
  message: string;
}

export interface ParseResult {
  fatal: boolean;
  reportKind: ReportKind;
  records: Array<BusinessRecord | AdRecord>;
  issues: ParseIssue[];
  rawRows: RawReportRow[];
}

const aliases = {
  date: ["date", "日期", "时间", "report date", "报表日期"],
  sku: ["sku", "seller sku", "卖家SKU", "advertised sku", "推广的sku", "广告sku"],
  asin: ["asin", "advertised asin", "推广的asin", "广告asin"],
  units: ["units", "销量", "已订购商品数量"],
  sales: ["sales", "销售额", "已订购商品销售额"],
  sessions: ["sessions", "访问量", "会话数"],
  pageViews: ["page views", "pageviews", "页面浏览量"],
  orders: ["orders", "订单量", "订单数", "总订单"],
  refunds: ["refunds", "refund units", "退款数量"],
  discounts: ["discounts", "discount", "折扣"],
  fbaAvailable: ["fba available", "available inventory", "可售库存"],
  reserved: ["reserved", "预留库存"],
  unfulfillable: ["unfulfillable", "不可售库存"],
  campaign: ["campaign", "campaign name", "广告活动名称", "广告活动"],
  spend: ["spend", "cost", "total cost", "花费", "总成本", "成本", "广告花费"],
  adSales: ["ad sales", "sales", "广告销售额", "销售额", "7 day total sales", "14 day total sales", "7天总销售额", "14天总销售额"],
  adOrders: ["ad orders", "purchases", "orders", "广告订单", "订单", "购买量", "订单数", "7 day total orders (#)", "14 day total orders (#)", "7 day total orders", "14 day total orders", "7天总订单数", "14天总订单数"],
  clicks: ["clicks", "点击", "点击量"],
  impressions: ["impressions", "展示", "展示量"],
  cpc: ["cpc", "cost per click", "cost-per-click (cpc)", "单次点击成本", "每次点击费用"],
  ctr: ["ctr", "click through rate", "click-through rate", "click-thru rate (ctr)", "点击率"],
  cvr: ["cvr", "conversion rate", "7 day conversion rate", "转化率"],
  acos: ["acos", "total advertising cost of sales (acos)", "广告投入产出比"],
  roas: ["roas", "total return on advertising spend (roas)", "广告投资回报率"],
  topOfSearchImpressionShare: ["top of search impression share", "top of search impression share (is)", "搜索结果首页首位展示量份额", "搜索结果首页首位展示份额"],
  adjusted: ["是否调整", "adjusted"],
} as const;

function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim().replace(/\s+/g, " ");
}

function columnFor(row: Row, field: keyof typeof aliases): string | undefined {
  const headerName = (header: string) => canonical(header.replace(/^\uFEFF/, "").replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/\((?:USD|US\$|\$)\)/gi, "").replace(/[‐‑–-]/g, " "));
  return Object.keys(row).find((header) => aliases[field].some((alias) => headerName(header) === headerName(alias)));
}

function read(row: Row, field: keyof typeof aliases): string {
  const column = columnFor(row, field);
  return column ? stringValue(row[column]) : "";
}

function numberValue(value: string): number | undefined {
  const cleaned = value.trim().replace(/US\$|USD|[,$￥¥%\s]/gi, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function percentageValue(value: string): number | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined) return undefined;
  return value.includes("%") ? parsed / 100 : parsed;
}

function rawRows(rows: Row[]): RawReportRow[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([header, value]) => [header, value == null ? "" : String(value)])));
}

function dateValue(value: string): string | undefined {
  if (!value) return undefined;
  const serial = Number(value);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(value)) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const normalized = value.replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const monthFirst = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  const year = match?.[1] ?? (monthFirst ? String(Number(monthFirst[3]) + (monthFirst[3].length === 2 ? 2000 : 0)) : undefined);
  const month = match?.[2] ?? monthFirst?.[1];
  const day = match?.[3] ?? monthFirst?.[2];
  if (!year || !month || !day) return undefined;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function lookup(map: SkuMap, identifier: string, type: "sku" | "asin"): SizeCode | undefined {
  const entries = type === "sku" ? map.sizeBySku : map.sizeByAsin;
  return Object.entries(entries).find(([key]) => canonical(key) === canonical(identifier))?.[1];
}

function requiredFields(kind: ReportKind): Array<keyof typeof aliases> {
  return kind === "business" ? ["date", "units", "sales"] : ["date", "campaign", "spend", "adSales", "adOrders"];
}

function hasSignature(row: Row, kind: ReportKind): boolean {
  const required = requiredFields(kind).every((field) => columnFor(row, field));
  return kind === "business"
    ? required && Boolean(columnFor(row, "sku") || columnFor(row, "asin"))
    : required;
}

export function reportKindFromFilename(filename: string): ReportKind {
  return /(^|[-_. ])(ad|ads|advertising)([-_. ]|$)/i.test(filename) ? "ads" : "business";
}

/** Uses recognizable report columns first; filenames are only a fallback for incomplete/unknown files. */
export function detectReportKind(rows: readonly Row[], filename: string): ReportKind {
  const headers = rows[0] ?? {};
  if (hasSignature(headers, "ads")) return "ads";
  if (hasSignature(headers, "business")) return "business";
  if (columnFor(headers, "campaign") && ["spend", "impressions", "clicks", "adSales", "adOrders"].some((field) => columnFor(headers, field as keyof typeof aliases))) return "ads";
  return reportKindFromFilename(filename);
}

export function parseRows(rows: Row[], kind: ReportKind, skuMap: SkuMap, options: ReportParseOptions = {}): ParseResult {
  const issues: ParseIssue[] = [];
  const sourceRows = rawRows(rows);
  const headers = rows[0] ?? {};
  const fallbackDate = kind === "ads" ? dateValue(options.fallbackAdDate ?? "") : undefined;
  const missing = requiredFields(kind).filter((field) => !columnFor(headers, field) && !(field === "date" && fallbackDate));
  if (kind === "business" && !columnFor(headers, "sku") && !columnFor(headers, "asin")) missing.push("sku");
  if (missing.length) {
    return {
      fatal: true,
      reportKind: kind,
      records: [],
      issues: missing.map((field) => ({ code: "MISSING_REQUIRED_COLUMN", field, message: `${kind === "ads" && field === "date" ? "请填写单日广告报表日期，或上传含日期的按日报表。" : `缺少必填列：${({ date: "日期", units: "销量", sales: "销售额", sku: "SKU或ASIN", campaign: "广告活动名称", spend: "总成本/花费", adSales: "广告销售额", adOrders: "购买量/广告订单" } as Record<string, string>)[field] ?? field}。`} (Missing required column: ${field})` })),
      rawRows: sourceRows,
    };
  }

  const records: Array<BusinessRecord | AdRecord> = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const date = columnFor(headers, "date") ? dateValue(read(row, "date")) : fallbackDate;
    if (!date) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "date", row: rowNumber, message: "Missing or invalid date" });

    if (kind === "business") {
      const sku = read(row, "sku");
      const asin = read(row, "asin");
      const units = numberValue(read(row, "units"));
      const sales = numberValue(read(row, "sales"));
      const optionalNumber = (field: "sessions" | "pageViews" | "orders" | "refunds" | "discounts" | "fbaAvailable" | "reserved" | "unfulfillable") =>
        columnFor(row, field) ? numberValue(read(row, field)) : undefined;
      if (units === undefined) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "units", row: rowNumber, message: "Missing or invalid units" });
      if (sales === undefined) issues.push({ code: "MISSING_REQUIRED_VALUE", field: "sales", row: rowNumber, message: "Missing or invalid sales" });
      const size = (sku && lookup(skuMap, sku, "sku")) || (asin && lookup(skuMap, asin, "asin"));
      if (!size) issues.push({ code: "UNMAPPED_SKU", field: sku ? "sku" : "asin", row: rowNumber, identifier: sku || asin, message: "SKU/ASIN does not map to a size" });
      if (!date || units === undefined || sales === undefined || !size) return;
      const keyIdentifier = sku || asin;
      const refunds = optionalNumber("refunds");
      const sessions = optionalNumber("sessions");
      const pageViews = optionalNumber("pageViews");
      const orders = optionalNumber("orders");
      const discounts = optionalNumber("discounts");
      const fbaAvailable = optionalNumber("fbaAvailable");
      const reserved = optionalNumber("reserved");
      const unfulfillable = optionalNumber("unfulfillable");
      records.push({
        key: `business:${date}:${canonical(keyIdentifier)}`, date, sku, asin, size, units, sales,
        ...(sessions === undefined ? {} : { sessions }),
        ...(pageViews === undefined ? {} : { pageViews }),
        ...(orders === undefined ? {} : { orders }),
        ...(refunds === undefined ? {} : { refunds }),
        ...(discounts === undefined ? {} : { discounts }),
        ...(fbaAvailable === undefined ? {} : { fbaAvailable }),
        ...(reserved === undefined ? {} : { reserved }),
        ...(unfulfillable === undefined ? {} : { unfulfillable }),
      });
      return;
    }

    const campaign = read(row, "campaign");
    const asin = read(row, "asin").toUpperCase();
    const sku = read(row, "sku").toUpperCase();
    const spend = numberValue(read(row, "spend"));
    const adSales = numberValue(read(row, "adSales"));
    const adOrders = numberValue(read(row, "adOrders"));
    const clicks = numberValue(read(row, "clicks"));
    const impressions = numberValue(read(row, "impressions"));
    const cpc = numberValue(read(row, "cpc"));
    const ctr = percentageValue(read(row, "ctr"));
    const cvr = percentageValue(read(row, "cvr"));
    const acos = percentageValue(read(row, "acos"));
    const roas = numberValue(read(row, "roas"));
    const topOfSearchImpressionShare = percentageValue(read(row, "topOfSearchImpressionShare"));
    const adjustedText = read(row, "adjusted");
    const adjusted = /^(是|已调整|yes|true|1)$/i.test(adjustedText) ? true : /^(否|未调整|no|false|0)$/i.test(adjustedText) ? false : undefined;
    for (const [field, value] of [["campaign", campaign], ["spend", spend], ["adSales", adSales], ["adOrders", adOrders]] as const) {
      if (value === "" || value === undefined) issues.push({ code: "MISSING_REQUIRED_VALUE", field, row: rowNumber, message: `Missing or invalid ${field}` });
    }
    if (!date || !campaign || spend === undefined || adSales === undefined || adOrders === undefined) return;
    records.push({
      key: `ads:${date}:${canonical(campaign)}${asin ? `:${canonical(asin)}` : ""}${sku ? `:${canonical(sku)}` : ""}`, date, campaign, spend, adSales, adOrders,
      ...(asin ? { asin } : {}),
      ...(sku ? { sku } : {}),
      ...(clicks === undefined ? {} : { clicks }),
      ...(impressions === undefined ? {} : { impressions }),
      ...(cpc === undefined ? {} : { cpc }),
      ...(ctr === undefined ? {} : { ctr }),
      ...(cvr === undefined ? {} : { cvr }),
      ...(acos === undefined ? {} : { acos }),
      ...(roas === undefined ? {} : { roas }),
      ...(topOfSearchImpressionShare === undefined ? {} : { topOfSearchImpressionShare }),
      ...(adjusted === undefined ? {} : { adjusted }),
    });
  });

  return { fatal: false, reportKind: kind, records, issues, rawRows: sourceRows };
}

export function parseReport(input: ArrayBuffer, filename: string, skuMap: SkuMap, options: ReportParseOptions = {}): ParseResult {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx" && extension !== "xls") {
    return { fatal: true, reportKind: reportKindFromFilename(filename), records: [], issues: [{ code: "UNSUPPORTED_FILE", message: `Unsupported report file: ${filename}` }], rawRows: [] };
  }
  const workbook = XLSX.read(input, { type: "array", cellDates: false, ...(extension === "csv" ? { codepage: 65001 } : {}) });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
  const kind = options.reportKind ?? detectReportKind(rows, filename);
  return parseRows(rows, kind, skuMap, options);
}
