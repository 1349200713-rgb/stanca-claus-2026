import { buildDailyPromotionPlan } from "../data/promotion-plan";
import type { PromotionPlanOverride } from "../domain/planning";
import type { AdRecord, BusinessRecord } from "../domain/types";
import { calculateFunnelMetrics } from "../calc/funnel-metrics";

type DailyPromotionPlan = ReturnType<typeof buildDailyPromotionPlan>[number];

type PromotionAnalyticsOverride = Omit<Partial<PromotionPlanOverride>,
  "actualSales" | "actualAdSpend" | "actualAdSales" | "actualAdOrders" | "actualTotalOrders" | "actualAcos" | "actualCvr"
>;

export type PromotionAnalyticsRow = DailyPromotionPlan & PromotionAnalyticsOverride & {
  actualUnits: number | null;
  actualSales: number | null;
  adSpend: number | null;
  adSales: number | null;
  adOrders: number | null;
  impressions: number | null;
  clicks: number | null;
  sessions: number | null;
  totalOrders: number | null;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  adCvr: number | null;
  acos: number | null;
  tacos: number | null;
  organicOrders: number | null;
  dataConflicts: string[];
  targetAcosNumber: number | null;
  plannedAdBudgetNumber: number | null;
  plannedSalesNumber: number | null;
  completionRate: number | null;
  salesCompletionRate: number | null;
  adBudgetUsageRate: number | null;
  anomalies: string[];
};

export function numberFromText(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const cleaned = value.replace(/[,$￥¥\s]/g, "").trim();
  const percent = cleaned.endsWith("%");
  const parsed = Number(cleaned.replace("%", ""));
  if (!Number.isFinite(parsed)) return null;
  return percent ? parsed / 100 : parsed;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function sumObserved<T>(rows: readonly T[], select: (row: T) => number | undefined): number | null {
  const values = rows.map(select).filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function aggregateAds(rows: readonly AdRecord[]) {
  const spend = rows.length ? rows.reduce((sum, row) => sum + row.spend, 0) : null;
  const adSales = rows.length ? rows.reduce((sum, row) => sum + row.adSales, 0) : null;
  return {
    spend,
    adSales,
    adOrders: rows.length ? rows.reduce((sum, row) => sum + row.adOrders, 0) : null,
    impressions: sumObserved(rows, (row) => row.impressions),
    clicks: sumObserved(rows, (row) => row.clicks),
  };
}

export function buildPromotionAnalyticsRows(input: {
  ads: readonly AdRecord[];
  business: readonly BusinessRecord[];
  overrides: readonly PromotionPlanOverride[];
  startDate: string;
  endDate: string;
  asOfDate?: string;
}): PromotionAnalyticsRow[] {
  const overrideByDate = new Map(input.overrides.map((row) => [row.date, row]));
  return buildDailyPromotionPlan()
    .filter((row) => row.date >= input.startDate && row.date <= input.endDate)
    .map((plan) => {
      const override = overrideByDate.get(plan.date);
      const merged = override ? {
        ...plan,
        ...Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined && value !== "")),
      } : plan;
      const dayBusiness = input.business.filter((row) => row.date === plan.date);
      const actualUnits = dayBusiness.length ? dayBusiness.reduce((sum, row) => sum + row.units, 0) : null;
      const actualSales = dayBusiness.length ? dayBusiness.reduce((sum, row) => sum + row.sales, 0) : null;
      const sessions = sumObserved(dayBusiness, (row) => row.sessions);
      const totalOrders = sumObserved(dayBusiness, (row) => row.orders);
      const ad = aggregateAds(input.ads.filter((row) => row.date === plan.date));
      const funnel = calculateFunnelMetrics({
        impressions: ad.impressions,
        clicks: ad.clicks,
        sessions,
        adOrders: ad.adOrders,
        totalOrders,
        spend: ad.spend,
        adSales: ad.adSales,
        totalSales: actualSales,
      });
      const targetAcosNumber = numberFromText(merged.targetAcos);
      const plannedAdBudgetNumber = numberFromText(merged.plannedAdBudget);
      const plannedSalesNumber = numberFromText(merged.plannedSales);
      const completionRate = ratio(actualUnits, merged.targetDailyUnits);
      const salesCompletionRate = ratio(actualSales, plannedSalesNumber);
      const adBudgetUsageRate = ratio(ad.spend, plannedAdBudgetNumber);
      const anomalies: string[] = [];
      const reached = plan.date <= (input.asOfDate ?? input.endDate);
      if (!reached) return { ...merged, actualUnits, actualSales, adSpend: ad.spend, adSales: ad.adSales, adOrders: ad.adOrders, impressions: ad.impressions, clicks: ad.clicks, sessions, totalOrders, ctr: funnel.ctr, cpc: funnel.cpc, cvr: funnel.cvr, adCvr: funnel.adCvr, acos: funnel.acos, tacos: funnel.tacos, organicOrders: funnel.organicOrders, dataConflicts: funnel.conflicts, targetAcosNumber, plannedAdBudgetNumber, plannedSalesNumber, completionRate, salesCompletionRate, adBudgetUsageRate, anomalies };
      if (actualUnits === null) anomalies.push("缺实际销量");
      else if (completionRate !== null && completionRate < 0.8) anomalies.push("销量未达标");
      if (actualSales === null) anomalies.push("缺实际销售额");
      else if (salesCompletionRate !== null && salesCompletionRate < 0.8) anomalies.push("销售额未达标");
      if (adBudgetUsageRate !== null && adBudgetUsageRate > 1.15) anomalies.push("广告超预算");
      if (funnel.acos !== null && targetAcosNumber !== null && funnel.acos > targetAcosNumber) anomalies.push("ACOS超目标");
      if (ad.spend === null && merged.targetDailyUnits > 0) anomalies.push("有计划无广告数据");
      return {
        ...merged,
        actualUnits,
        actualSales,
        adSpend: ad.spend,
        adSales: ad.adSales,
        adOrders: ad.adOrders,
        impressions: ad.impressions,
        clicks: ad.clicks,
        sessions,
        totalOrders,
        ctr: funnel.ctr,
        cpc: funnel.cpc,
        cvr: funnel.cvr,
        adCvr: funnel.adCvr,
        acos: funnel.acos,
        tacos: funnel.tacos,
        organicOrders: funnel.organicOrders,
        dataConflicts: funnel.conflicts,
        targetAcosNumber,
        plannedAdBudgetNumber,
        plannedSalesNumber,
        completionRate,
        salesCompletionRate,
        adBudgetUsageRate,
        anomalies,
      };
    });
}
