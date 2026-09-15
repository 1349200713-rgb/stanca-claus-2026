import * as XLSX from "xlsx";
import type { PromotionPlanOverride } from "../domain/planning";
import type { ParseIssue, RawReportRow } from "./report-parser";

type Row = Record<string, unknown>;

export interface PromotionPlanParseResult {
  fatal: boolean;
  reportKind: "promotionPlan";
  records: PromotionPlanOverride[];
  issues: ParseIssue[];
  rawRows: RawReportRow[];
}

const aliases = {
  date: ["日期", "date", "推广日期"],
  startDate: ["开始日期", "开始时间", "start date"],
  endDate: ["结束日期", "结束时间", "end date"],
  phase: ["阶段", "推广阶段", "phase"],
  weeklyTargetUnits: ["周销量目标", "计划周销量", "weekly target units"],
  lWeeklyUnits: ["L周销量", "l weekly units"],
  xlWeeklyUnits: ["XL周销量", "xl weekly units"],
  twoXlWeeklyUnits: ["2XL周销量", "xxl周销量", "2xl weekly units"],
  threeXlWeeklyUnits: ["3XL周销量", "xxxl周销量", "3xl weekly units"],
  targetDailyUnits: ["目标日销", "计划销量", "日目标销量", "target daily units"],
  cumulativeTargetUnits: ["累计售出目标", "累计销量目标", "cumulative target units"],
  targetConversionRate: ["目标转化率", "target conversion rate"],
  targetAdOrderShare: ["目标广告订单占比", "target ad order share"],
  targetAcos: ["目标acos", "acos目标", "目标 ACOS", "target acos"],
  targetPrice: ["目标价格", "预计售价", "价格", "target price"],
  plannedProfit: ["计划利润（扣推广预提）", "计划利润", "planned profit"],
  plannedEndingInventory: ["计划期末剩余", "计划剩余库存", "planned ending inventory"],
  plannedAdBudget: ["计划广告额度", "计划广告费", "planned ad budget"],
  plannedSales: ["计划销售额", "planned sales"],
  dailyAdBudget: ["广告日均额度", "daily ad budget"],
  plannedPromotionReserve: ["计划推广预提", "planned promotion reserve"],
  actualSales: ["实际销售额", "actual sales"],
  actualAdSpend: ["实际广告费", "actual ad spend"],
  actualAdSales: ["实际广告销售额", "actual ad sales"],
  actualAdOrders: ["实际广告订单", "actual ad orders"],
  actualTotalOrders: ["实际总订单", "actual total orders"],
  actualAdOrderShare: ["广告订单占比", "actual ad order share"],
  actualAcos: ["实际ACOS", "actual acos"],
  actualCvr: ["实际整体CVR", "实际CVR", "actual cvr"],
  actualProfitAfterAds: ["实际扣广告后利润", "actual profit after ads"],
  profitRate: ["利润率", "profit rate"],
  offsitePlan: ["站外", "站外计划", "站外推广计划", "offsite plan"],
  offsiteOrders: ["站外推广出单", "站外出单", "offsite orders"],
  operationFocus: ["操作重点", "当日重点", "动作重点", "operation focus"],
  reviewPlan: ["测评", "评价与售后", "测评计划", "测评（目标达到4.5以上）", "review plan"],
  reviewOrderNumber: ["测评单号", "review order number"],
  serviceProvider: ["服务商", "负责人/服务商", "服务商或负责人", "service provider"],
  reviewQuantity: ["测评数量", "review quantity"],
  weeklyConclusion: ["本周结论", "weekly conclusion"],
  nextAction: ["下周动作", "next action"],
  note: ["备注", "note"],
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
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateValue(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const serial = Number(value);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(value)) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const normalized = value.replace(/[年月/]/g, "-").replace(/[日号]/g, "").replace(/\./g, "-");
  const yearFirst = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slashShort = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const monthDay = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  const year = yearFirst?.[1] ?? (slashShort ? String(Number(slashShort[3]) + (slashShort[3].length === 2 ? 2000 : 0)) : "2026");
  const month = yearFirst?.[2] ?? slashShort?.[1] ?? monthDay?.[1];
  const day = yearFirst?.[3] ?? slashShort?.[2] ?? monthDay?.[2];
  if (!month || !day) return undefined;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function datesBetween(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return [];

  const dates: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function rowHasDateColumns(row: Row): boolean {
  return Boolean(columnFor(row, "date") || (columnFor(row, "startDate") && columnFor(row, "endDate")));
}

function rowHasAnyDateValue(row: Row): boolean {
  return Boolean(read(row, "date") || read(row, "startDate") || read(row, "endDate"));
}

function rowsFromAoA(rows: unknown[][]): Row[] {
  const headerIndex = rows.findIndex((row) => {
    const probe = Object.fromEntries(row.map((cell, index) => [stringValue(cell) || `__blank_${index}`, cell]));
    return rowHasDateColumns(probe);
  });
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map((cell, index) => stringValue(cell) || `__blank_${index}`);
  return rows.slice(headerIndex + 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
    .filter((row) => Object.values(row).some((value) => stringValue(value)));
}

function rowsFromWorkbook(input: ArrayBuffer, extension: string): Row[] {
  const workbook = extension === "csv"
    ? XLSX.read(new TextDecoder("utf-8").decode(input), { type: "string", cellDates: false })
    : XLSX.read(input, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  return rowsFromAoA(rows);
}

export function parsePromotionPlanRows(rows: Row[], updatedAt = new Date().toISOString()): PromotionPlanParseResult {
  const issues: ParseIssue[] = [];
  const sourceRows = rawRows(rows);
  const headers = rows[0] ?? {};
  if (!rowHasDateColumns(headers)) {
    return {
      fatal: true,
      reportKind: "promotionPlan",
      records: [],
      issues: [{ code: "MISSING_REQUIRED_COLUMN", field: "date", message: "Missing required column: date" }],
      rawRows: sourceRows,
    };
  }

  const records: PromotionPlanOverride[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!rowHasAnyDateValue(row)) return;

    const directDateRaw = read(row, "date");
    const startDateRaw = read(row, "startDate");
    const endDateRaw = read(row, "endDate");
    if (!directDateRaw && (!startDateRaw || !endDateRaw)) return;

    const directDate = dateValue(directDateRaw);
    const startDate = dateValue(startDateRaw);
    const endDate = dateValue(endDateRaw);
    const dates = directDate ? [directDate] : startDate && endDate ? datesBetween(startDate, endDate) : [];
    if (dates.length === 0) {
      issues.push({ code: "INVALID_VALUE", field: "date", row: rowNumber, message: "Invalid promotion date" });
      return;
    }

    const targetDailyUnits = numberValue(read(row, "targetDailyUnits"));
    const reviewQuantity = numberValue(read(row, "reviewQuantity"));
    const actualAdOrders = numberValue(read(row, "actualAdOrders"));
    const actualTotalOrders = numberValue(read(row, "actualTotalOrders"));
    const offsiteOrders = numberValue(read(row, "offsiteOrders"));
    dates.forEach((date) => {
      records.push({
        key: `promotion-plan:${date}`,
        date,
        phase: read(row, "phase") || undefined,
        weeklyTargetUnits: numberValue(read(row, "weeklyTargetUnits")),
        lWeeklyUnits: numberValue(read(row, "lWeeklyUnits")),
        xlWeeklyUnits: numberValue(read(row, "xlWeeklyUnits")),
        twoXlWeeklyUnits: numberValue(read(row, "twoXlWeeklyUnits")),
        threeXlWeeklyUnits: numberValue(read(row, "threeXlWeeklyUnits")),
        targetDailyUnits,
        cumulativeTargetUnits: numberValue(read(row, "cumulativeTargetUnits")),
        targetConversionRate: read(row, "targetConversionRate") || undefined,
        targetAdOrderShare: read(row, "targetAdOrderShare") || undefined,
        targetAcos: read(row, "targetAcos") || undefined,
        targetPrice: read(row, "targetPrice") || undefined,
        plannedProfit: read(row, "plannedProfit") || undefined,
        plannedEndingInventory: numberValue(read(row, "plannedEndingInventory")),
        plannedAdBudget: read(row, "plannedAdBudget") || undefined,
        plannedSales: read(row, "plannedSales") || undefined,
        dailyAdBudget: read(row, "dailyAdBudget") || undefined,
        plannedPromotionReserve: read(row, "plannedPromotionReserve") || undefined,
        actualSales: read(row, "actualSales") || undefined,
        actualAdSpend: read(row, "actualAdSpend") || undefined,
        actualAdSales: read(row, "actualAdSales") || undefined,
        actualAdOrders,
        actualTotalOrders,
        actualAdOrderShare: read(row, "actualAdOrderShare") || undefined,
        actualAcos: read(row, "actualAcos") || undefined,
        actualCvr: read(row, "actualCvr") || undefined,
        actualProfitAfterAds: read(row, "actualProfitAfterAds") || undefined,
        profitRate: read(row, "profitRate") || undefined,
        offsitePlan: read(row, "offsitePlan") || undefined,
        offsiteOrders,
        operationFocus: read(row, "operationFocus") || undefined,
        reviewPlan: read(row, "reviewPlan") || undefined,
        reviewOrderNumber: read(row, "reviewOrderNumber") || undefined,
        serviceProvider: read(row, "serviceProvider") || undefined,
        reviewQuantity,
        weeklyConclusion: read(row, "weeklyConclusion") || undefined,
        nextAction: read(row, "nextAction") || undefined,
        note: read(row, "note") || undefined,
        updatedAt,
      });
    });
  });

  return { fatal: false, reportKind: "promotionPlan", records, issues, rawRows: sourceRows };
}

export function parsePromotionPlanReport(input: ArrayBuffer, filename: string, updatedAt?: string): PromotionPlanParseResult {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx" && extension !== "xls") {
    return { fatal: true, reportKind: "promotionPlan", records: [], issues: [{ code: "UNSUPPORTED_FILE", message: `Unsupported promotion plan file: ${filename}` }], rawRows: [] };
  }
  return parsePromotionPlanRows(rowsFromWorkbook(input, extension), updatedAt);
}
