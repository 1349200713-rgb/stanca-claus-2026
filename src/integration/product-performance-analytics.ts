import type { ProductPerformanceRecord } from "../domain/product-performance";
export interface ProductComparisonOptions { startDate: string; endDate: string; currentAsin: string; previousAsin: string; scope: ProductPerformanceRecord["scope"] }
const sumKeys = ["units", "sales", "grossProfit", "spend", "adSales", "adOrders", "adUnits", "clicks", "impressions", "sessions"] as const;
const snapshotKeys = ["price", "fbaAvailable", "rating"] as const;
export type ProductMetric = typeof sumKeys[number] | typeof snapshotKeys[number] | "acos" | "tacos" | "cpc" | "ctr" | "cvr" | "roas" | "grossMargin";
export type ProductMetrics = Record<ProductMetric, number | null>;
export interface ProductComparisonDay { date: string; previous: ProductMetrics | null; current: ProductMetrics | null; record?: ProductPerformanceRecord; conflict?: boolean }
export const productRatio = (numerator: number | null, denominator: number | null) => numerator == null || denominator == null || denominator <= 0 ? null : numerator / denominator;
function aggregate(rows: readonly ProductPerformanceRecord[]): ProductMetrics {
  const metrics = {} as ProductMetrics;
  for (const key of sumKeys) metrics[key] = rows.length && rows.every((row) => row[key] != null && Number.isFinite(row[key])) ? rows.reduce((sum, row) => sum + row[key]!, 0) : null;
  const last = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0];
  for (const key of snapshotKeys) metrics[key] = last?.[key] ?? null;
  metrics.acos = productRatio(metrics.spend, metrics.adSales);
  metrics.tacos = productRatio(metrics.spend, metrics.sales);
  metrics.cpc = productRatio(metrics.spend, metrics.clicks);
  metrics.ctr = productRatio(metrics.clicks, metrics.impressions);
  metrics.cvr = productRatio(metrics.adOrders, metrics.clicks);
  metrics.roas = productRatio(metrics.adSales, metrics.spend);
  metrics.grossMargin = productRatio(metrics.grossProfit, metrics.sales);
  return metrics;
}
export function buildProductComparison(records: readonly ProductPerformanceRecord[], options: ProductComparisonOptions) {
  const { startDate, endDate, currentAsin, previousAsin, scope } = options;
  const days: ProductComparisonDay[] = [];
  const currentRows: ProductPerformanceRecord[] = [], previousRows: ProductPerformanceRecord[] = [], pairedCurrent: ProductPerformanceRecord[] = [], pairedPrevious: ProductPerformanceRecord[] = [];
  const date = new Date(`${startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${endDate}T00:00:00Z`);
  const valid = /^2026-\d{2}-\d{2}$/.test(startDate) && /^2026-\d{2}-\d{2}$/.test(endDate) && Number.isFinite(date.getTime()) && Number.isFinite(rangeEnd.getTime()) && date.toISOString().slice(0, 10) === startDate && rangeEnd.toISOString().slice(0, 10) === endDate && startDate <= endDate;
  const grouped = new Map<string, ProductPerformanceRecord[]>();
  for (const record of records) {
    if (record.scope !== scope || !(record.asin === currentAsin && record.date.startsWith("2026-") || record.asin === previousAsin && record.date.startsWith("2025-"))) continue;
    const key = `${record.date}:${record.asin}`;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  while (valid && date.toISOString().slice(0, 10) <= endDate && days.length < 366) {
    const day = date.toISOString().slice(0, 10);
    const current = grouped.get(`${day}:${currentAsin}`) ?? [];
    const previous = grouped.get(`2025-${day.slice(5)}:${previousAsin}`) ?? [];
    const currentRecord = current.length === 1 ? current[0] : undefined;
    const previousRecord = previous.length === 1 ? previous[0] : undefined;
    if (currentRecord) currentRows.push(currentRecord);
    if (previousRecord) previousRows.push(previousRecord);
    if (currentRecord && previousRecord) { pairedCurrent.push(currentRecord); pairedPrevious.push(previousRecord); }
    days.push({ date: day, current: currentRecord ? aggregate([currentRecord]) : null, previous: previousRecord ? aggregate([previousRecord]) : null, record: currentRecord, conflict: current.length > 1 || previous.length > 1 });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return { days, current: aggregate(currentRows), previous: aggregate(previousRows), comparableCurrent: aggregate(pairedCurrent), comparablePrevious: aggregate(pairedPrevious), pairedDays: pairedCurrent.length, currentDays: currentRows.length, previousDays: previousRows.length };
}

/** Transparent local rules, not generated copy from an imported AI column. */
export function productAdvice(day: ProductComparisonDay, targetAcos: number): string[] {
  const { current: now, previous: before } = day;
  if (day.conflict) return ["同日同ASIN有重复记录，先核对来源，不据此调整投放。"];
  if (!now) return ["2026当天未录入，补齐数据后再分析。"];
  const advice: string[] = [];
  if (now.grossProfit != null && now.grossProfit < 0) advice.push(`当天结算毛利润亏损$${Math.abs(now.grossProfit).toFixed(2)}，核对费用明细和折扣，不直接归因于广告。`);
  if (now.units != null && now.adOrders != null && now.adOrders > now.units) advice.push("广告归因订单高于销量，先核对归因日期，不相减推算自然订单。");
  if (now.clicks == null || now.adOrders == null) advice.push("缺少点击或订单数据，无法判断转化，先补齐报表。");
  else if (now.clicks < 20 || now.adOrders < 3 && now.adOrders > 0) advice.push(`仅${now.clicks}次点击、${now.adOrders}个广告订单，样本不足，继续观察，不据单日表现大幅加价或停投。`);
  else if (now.adOrders === 0 && now.spend != null && now.spend >= 10) advice.push("有花费但暂未归因出单，核查搜索词与广告位；优先限制低效流量，等待归因回补后复核。");
  else if (now.acos != null && now.acos > targetAcos && now.spend != null && now.spend >= 10) advice.push(`ACOS ${(now.acos * 100).toFixed(1)}%超过计划目标${(targetAcos * 100).toFixed(1)}%，核查低效词和顶部加价；目标不是盈亏平衡线。`);
  else advice.push("先保持投放，结合滚动多日数据与每单毛利复核，单日表现不支持直接放量。");
  if (!before) advice.push("2025同日未录入，暂不能给出同比结论。");
  else if (now.spend != null && before.spend != null && now.adSales != null && before.adSales != null && now.spend > before.spend && now.adSales < before.adSales) advice.push("同比花费增加、广告销售额下降，优先检查流量相关性和转化，不继续盲目加预算。");
  else if (now.cvr != null && before.cvr != null && now.cvr < before.cvr && now.clicks != null && now.clicks >= 20) advice.push("广告转化率低于去年同日，核对主图、尺码、到手价与评价；尚不能认定是价格造成。");
  if (now.sales === 0) advice.push("净销售额为0，TACOS及毛利率无法计算；不采用源表的100%占位值。");
  return advice;
}
