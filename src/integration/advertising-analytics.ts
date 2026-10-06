import type { AdRecord, SizeCode } from "../domain/types";
import type { PrimaryMapping } from "../data/plan";

export interface AdvertisingFilters {
  startDate?: string;
  endDate?: string;
  campaign?: string;
  asin?: string;
  sku?: string;
  adjusted?: "all" | "yes" | "no" | "unknown";
}
export interface AdvertisingThresholds {
  targetAcos: number;
  acosMinSpend: number;
  noOrdersSpend: number;
  minClicks: number;
  minImpressions: number;
  lowCtr: number;
  lowCvr: number;
  highCpc: number;
}
export interface AdvertisingMetrics {
  spend: number | null;
  adSales: number | null;
  adOrders: number | null;
  impressions: number | null;
  clicks: number | null;
  cpc: number | null;
  ctr: number | null;
  cvr: number | null;
  acos: number | null;
  roas: number | null;
}
export interface AdvertisingCoverage { records: number; clicks: number; impressions: number; traffic: number }
export interface AdvertisingMapping {
  asin?: string;
  sku?: string;
  size?: SizeCode;
  status: "mapped" | "unmapped" | "conflict" | "summary";
}
export interface AdvertisingRow {
  id: string;
  record: AdRecord;
  mapping: AdvertisingMapping;
  excluded: boolean;
  qualityReasons: string[];
}
export interface AdvertisingAnomaly {
  id: string;
  rowId: string;
  recordKey: string;
  date: string;
  campaign: string;
  code: "wasted-spend" | "no-orders" | "high-acos" | "low-ctr" | "low-cvr" | "high-cpc";
  label: string;
  actual: string;
  threshold: string;
  reason: string;
  severity: "risk" | "attention";
}
export interface AdvertisingDataIssue {
  id: string;
  rowId: string;
  date: string;
  campaign: string;
  kind: "overlap" | "duplicate" | "mapping-conflict" | "unmapped" | "missing-data" | "insufficient-sample" | "invalid-data";
  reason: string;
  excluded: boolean;
}
export interface AdvertisingAnalytics {
  metrics: AdvertisingMetrics;
  coverage: AdvertisingCoverage;
  filteredRows: AdvertisingRow[];
  trustedRows: AdvertisingRow[];
  trends: (AdvertisingMetrics & { date: string; records: number; excluded: number })[];
  anomalies: AdvertisingAnomaly[];
  dataIssues: AdvertisingDataIssue[];
  excluded: { count: number; spend: number };
}

const normalize = (value?: string) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const money = (value: number) => `US$${value.toFixed(2)}`;
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const known = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0;
export const advertisingRatio = (numerator: number | null | undefined, denominator: number | null | undefined): number | null =>
  numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 ? null : numerator / denominator;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function defaultAdvertisingThresholds(targetAcos: number): AdvertisingThresholds {
  return { targetAcos: Number.isFinite(targetAcos) && targetAcos > 0 ? targetAcos : 0.22, acosMinSpend: 20, noOrdersSpend: 20, minClicks: 20, minImpressions: 1000, lowCtr: 0.003, lowCvr: 0.05, highCpc: 1.5 };
}
export function advertisingDateRange(records: readonly AdRecord[], preset: "7" | "14" | "30" | "all"): Pick<AdvertisingFilters, "startDate" | "endDate"> {
  const dates = records.map((record) => record.date).filter(validDate).sort();
  if (!dates.length) return {};
  const endDate = dates[dates.length - 1];
  if (preset === "all") return { startDate: dates[0], endDate };
  const start = new Date(`${endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - Number(preset) + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

function resolveMapping(record: AdRecord, mappings: readonly PrimaryMapping[]): AdvertisingMapping {
  const asin = normalize(record.asin);
  const sku = normalize(record.sku);
  if (!asin && !sku) return { status: "summary" };
  const byAsin = asin ? mappings.filter((mapping) => normalize(mapping.asin) === asin) : [];
  const bySku = sku ? mappings.filter((mapping) => normalize(mapping.sku) === sku) : [];
  const matched = byAsin[0] ?? bySku[0];
  if (byAsin.length > 1 || bySku.length > 1 || (matched && ((asin && normalize(matched.asin) !== asin) || (sku && normalize(matched.sku) !== sku)))) {
    return { asin: record.asin, sku: record.sku, status: "conflict" };
  }
  return matched ? { asin: matched.asin, sku: matched.sku, size: matched.size, status: "mapped" } : { asin: record.asin, sku: record.sku, status: "unmapped" };
}

function aggregate(rows: readonly AdvertisingRow[]): { metrics: AdvertisingMetrics; coverage: AdvertisingCoverage } {
  const records = rows.map((row) => row.record);
  const count = records.length;
  const clicksRows = records.filter((record) => known(record.clicks));
  const impressionsRows = records.filter((record) => known(record.impressions));
  const trafficRows = records.filter((record) => known(record.clicks) && known(record.impressions));
  const spend = count ? records.reduce((sum, record) => sum + record.spend, 0) : null;
  const adSales = count ? records.reduce((sum, record) => sum + record.adSales, 0) : null;
  const adOrders = count ? records.reduce((sum, record) => sum + record.adOrders, 0) : null;
  const clicks = clicksRows.length ? clicksRows.reduce((sum, record) => sum + record.clicks!, 0) : null;
  const impressions = impressionsRows.length ? impressionsRows.reduce((sum, record) => sum + record.impressions!, 0) : null;
  // No full-spend / partial-clicks ratio: missing records are not silently imputed as zero.
  return {
    metrics: { spend, adSales, adOrders, clicks, impressions, cpc: clicksRows.length === count ? advertisingRatio(spend, clicks) : null, ctr: trafficRows.length === count ? advertisingRatio(clicks, impressions) : null, cvr: clicksRows.length === count ? advertisingRatio(adOrders, clicks) : null, acos: advertisingRatio(spend, adSales), roas: advertisingRatio(adSales, spend) },
    coverage: { records: count, clicks: clicksRows.length, impressions: impressionsRows.length, traffic: trafficRows.length },
  };
}

export function buildAdvertisingAnalytics(records: readonly AdRecord[], mappings: readonly PrimaryMapping[], filters: AdvertisingFilters = {}, thresholds: AdvertisingThresholds = defaultAdvertisingThresholds(0.22)): AdvertisingAnalytics {
  const rows: AdvertisingRow[] = records.map((record, index) => ({ id: `${index}:${record.key}`, record, mapping: resolveMapping(record, mappings), excluded: false, qualityReasons: [] }));
  const issues: AdvertisingDataIssue[] = [];
  const note = (row: AdvertisingRow, kind: AdvertisingDataIssue["kind"], reason: string, exclude = false) => {
    if (exclude) row.excluded = true;
    row.qualityReasons.push(reason);
    issues.push({ id: `${row.id}:${kind}:${issues.length}`, rowId: row.id, date: row.record.date, campaign: row.record.campaign, kind, reason, excluded: exclude });
  };
  const groups = new Map<string, AdvertisingRow[]>();
  for (const row of rows) {
    const record = row.record;
    const invalidRequired = !validDate(record.date) || !normalize(record.campaign) || [record.spend, record.adSales, record.adOrders].some((value) => !known(value)) || !Number.isSafeInteger(record.adOrders);
    const invalidTraffic = [record.clicks, record.impressions].some((value) => value !== undefined && (!known(value) || !Number.isSafeInteger(value))) || (known(record.clicks) && known(record.impressions) && record.clicks > record.impressions);
    if (invalidRequired || invalidTraffic) note(row, "invalid-data", "日期、活动、金额或流量数据无效，已排除；请核对原始报告。", true);
    if (row.mapping.status === "conflict") note(row, "mapping-conflict", "ASIN / SKU 显式映射冲突或映射不唯一，已排除；请核对商品关系。", true);
    if (row.mapping.status === "unmapped") note(row, "unmapped", "ASIN / SKU 未映射到计划商品；保留原标识，不推断尺码或分摊活动汇总。" );
    const groupKey = `${record.date}\u0000${normalize(record.campaign)}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }
  // Diagnose before filtering: a product filter cannot hide the overlapping summary.
  for (const group of groups.values()) {
    const summaries = group.filter((row) => row.mapping.status === "summary");
    const legacy = group.filter((row) => row.mapping.status !== "summary" && normalize(row.record.key) === `ads:${row.record.date}:${normalize(row.record.campaign)}`);
    const identities = group.map((row) => row.mapping.status === "summary" ? "summary" : `${normalize(row.mapping.asin)}|${normalize(row.mapping.sku)}`);
    const hasDuplicates = new Set(group.map((row) => row.record.key)).size < group.length || new Set(identities).size < identities.length;
    let kind: AdvertisingDataIssue["kind"] | undefined;
    let reason = "";
    if (legacy.length) { kind = "overlap"; reason = "旧汇总键带有商品标识，无法确认是活动汇总还是商品明细；同日活动组已排除，请核对原始报告。"; }
    else if (summaries.length && summaries.length < group.length) { kind = "overlap"; reason = "同日活动汇总与商品明细疑似重叠；整组已排除，请确认报表粒度后再使用，未删除或合并历史。"; }
    else if (hasDuplicates) { kind = "duplicate"; reason = "同日活动存在重复键或同一商品的重复记录；整组已排除，请核对来源，未自动合并。"; }
    if (kind) for (const row of group) note(row, kind, reason, true);
  }

  const filteredRows = rows.filter(({ record, mapping }) =>
    (!filters.startDate || record.date >= filters.startDate) && (!filters.endDate || record.date <= filters.endDate) &&
    (!filters.campaign || normalize(record.campaign) === normalize(filters.campaign)) &&
    (!filters.asin || normalize(mapping.asin) === normalize(filters.asin)) && (!filters.sku || normalize(mapping.sku) === normalize(filters.sku)) &&
    (!filters.adjusted || filters.adjusted === "all" || (filters.adjusted === "yes" ? record.adjusted === true : filters.adjusted === "no" ? record.adjusted === false : record.adjusted === undefined)));
  const trustedRows = filteredRows.filter((row) => !row.excluded);
  const anomalies: AdvertisingAnomaly[] = [];
  const add = (row: AdvertisingRow, code: AdvertisingAnomaly["code"], label: string, actual: string, threshold: string, reason: string, severity: AdvertisingAnomaly["severity"] = "attention") =>
    anomalies.push({ id: `${row.id}:${code}`, rowId: row.id, recordKey: row.record.key, date: row.record.date, campaign: row.record.campaign, code, label, actual, threshold, reason, severity });
  for (const row of trustedRows) {
    const record = row.record;
    const clicksKnown = known(record.clicks);
    const impressionsKnown = known(record.impressions);
    const enoughClicks = clicksKnown && record.clicks! >= thresholds.minClicks;
    const enoughImpressions = impressionsKnown && record.impressions! >= thresholds.minImpressions;
    const acos = advertisingRatio(record.spend, record.adSales);
    const ctr = advertisingRatio(record.clicks, record.impressions);
    const cvr = advertisingRatio(record.adOrders, record.clicks);
    const cpc = advertisingRatio(record.spend, record.clicks);
    if (!clicksKnown || !impressionsKnown) note(row, "missing-data", `缺少${!clicksKnown ? "点击量" : ""}${!clicksKnown && !impressionsKnown ? "、" : ""}${!impressionsKnown ? "展示量" : ""}，相关比率未知；不把缺失当作 0。`);
    if ((clicksKnown && !enoughClicks) || (impressionsKnown && !enoughImpressions) || (acos !== null && acos > thresholds.targetAcos && record.spend < thresholds.acosMinSpend)) note(row, "insufficient-sample", `样本不足：流量类规则至少 ${thresholds.minClicks} 点击 / CTR 至少 ${thresholds.minImpressions} 展示，ACOS 至少 ${money(thresholds.acosMinSpend)} 花费；暂不据此判定表现异常。`);
    if (record.spend > 0 && record.spend >= thresholds.noOrdersSpend && enoughClicks && record.adSales === 0) {
      add(row, "wasted-spend", "无销售花费", `${money(record.spend)} / ${record.adOrders} 单 / ${money(record.adSales)}`, `花费 ≥ ${money(thresholds.noOrdersSpend)}，点击 ≥ ${thresholds.minClicks}，销售额 = 0`, "有花费但无广告销售；ACOS 因销售额为零而未知。检查搜索词、商品页和归因延迟，再决定否词或降价竞价。", "risk");
    } else if (record.spend > 0 && record.spend >= thresholds.noOrdersSpend && enoughClicks && record.adOrders === 0) {
      add(row, "no-orders", "无订单花费", `${money(record.spend)} / 0 单`, `花费 ≥ ${money(thresholds.noOrdersSpend)}，点击 ≥ ${thresholds.minClicks}，订单 = 0`, "点击已有样本但尚无广告订单；检查归因窗口、落地商品与搜索词匹配。", "risk");
    }
    if (acos !== null && acos > thresholds.targetAcos && record.spend >= thresholds.acosMinSpend && enoughClicks) add(row, "high-acos", "ACOS 超目标", percent(acos), `ACOS > ${percent(thresholds.targetAcos)}，花费 ≥ ${money(thresholds.acosMinSpend)}，点击 ≥ ${thresholds.minClicks}`, "花费相对广告销售额偏高；检查高花费搜索词与竞价，结合利润空间调整。", "risk");
    if (ctr !== null && ctr < thresholds.lowCtr && enoughImpressions) add(row, "low-ctr", "点击率偏低", percent(ctr), `CTR < ${percent(thresholds.lowCtr)}，展示 ≥ ${thresholds.minImpressions}`, "展示已达样本门槛但点击率偏低；检查关键词相关性、主图与广告位。" );
    if (cvr !== null && cvr < thresholds.lowCvr && enoughClicks) add(row, "low-cvr", "广告转化率偏低", percent(cvr), `广告转化率 < ${percent(thresholds.lowCvr)}，点击 ≥ ${thresholds.minClicks}`, "点击已有样本但转化偏低；检查价格、优惠、商品页和归因窗口。" );
    if (cpc !== null && cpc > thresholds.highCpc && enoughClicks) add(row, "high-cpc", "CPC 偏高", money(cpc), `CPC > ${money(thresholds.highCpc)}，点击 ≥ ${thresholds.minClicks}`, "每次点击成本偏高；检查竞争词与广告位溢价，评估降竞价。" );
  }
  const visibleIds = new Set(filteredRows.map((row) => row.id));
  const trendDates = [...new Set(filteredRows.map((row) => row.record.date).filter(validDate))].sort();
  const excludedRows = filteredRows.filter((row) => row.excluded);
  return {
    ...aggregate(trustedRows), filteredRows, trustedRows, anomalies,
    dataIssues: issues.filter((issue) => visibleIds.has(issue.rowId)),
    excluded: { count: excludedRows.length, spend: excludedRows.reduce((sum, row) => sum + (known(row.record.spend) ? row.record.spend : 0), 0) },
    trends: trendDates.map((date) => ({ date, ...aggregate(trustedRows.filter((row) => row.record.date === date)).metrics, records: trustedRows.filter((row) => row.record.date === date).length, excluded: excludedRows.filter((row) => row.record.date === date).length })),
  };
}
