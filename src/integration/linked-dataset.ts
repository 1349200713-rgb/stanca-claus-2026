import type { PromotionPlanOverride } from "../domain/planning";
import type { TrafficRecord } from "../domain/linkage";
import type { AdRecord, BusinessRecord, SizeCode } from "../domain/types";
import { calculateFunnelMetrics } from "../calc/funnel-metrics";

export interface LinkedDay {
  marketplace: "US";
  date: string;
  asin: string;
  sku: string;
  size: SizeCode;
  units: number;
  sales: number;
  sessions: number | null;
  totalOrders: number | null;
  impressions: number | null;
  clicks: number | null;
  adSpend: number | null;
  adSales: number | null;
  adOrders: number | null;
  plan: PromotionPlanOverride | null;
  metrics: ReturnType<typeof calculateFunnelMetrics>;
}

export interface LinkedDatasetInput {
  business: readonly BusinessRecord[];
  ads: readonly AdRecord[];
  traffic: readonly TrafficRecord[];
  promotion: readonly PromotionPlanOverride[];
}

const normalized = (value: string) => value.trim().toUpperCase();
const totalOrNull = (values: readonly (number | undefined)[]) => {
  const observed = values.filter((value): value is number => value !== undefined);
  return observed.length ? observed.reduce((sum, value) => sum + value, 0) : null;
};

export function buildLinkedDataset(input: LinkedDatasetInput): { days: LinkedDay[]; unmappedAds: AdRecord[] } {
  const businessDimensionCount = (ad: AdRecord) => input.business.filter((row) => row.date === ad.date && ad.asin && normalized(row.asin) === normalized(ad.asin)).length;
  const unmappedAds = input.ads.filter((row) => !row.asin?.trim() || (!row.sku?.trim() && businessDimensionCount(row) > 1));
  const days = input.business.map((business) => {
    const asin = normalized(business.asin);
    const sku = normalized(business.sku);
    const ads = input.ads.filter((row) => row.date === business.date && row.asin && normalized(row.asin) === asin && (row.sku ? normalized(row.sku) === sku : businessDimensionCount(row) === 1));
    const traffic = input.traffic.find((row) => row.date === business.date && normalized(row.asin) === asin && (!row.sku || normalized(row.sku) === sku));
    const impressions = totalOrNull(ads.map((row) => row.impressions));
    const clicks = totalOrNull(ads.map((row) => row.clicks));
    const adSpend = totalOrNull(ads.map((row) => row.spend));
    const adSales = totalOrNull(ads.map((row) => row.adSales));
    const adOrders = totalOrNull(ads.map((row) => row.adOrders));
    const sessions = traffic?.sessions ?? business.sessions ?? null;
    const totalOrders = traffic?.orders ?? business.orders ?? null;
    return {
      marketplace: business.marketplace ?? "US",
      date: business.date,
      asin,
      sku,
      size: business.size,
      units: business.units,
      sales: business.sales,
      sessions,
      totalOrders,
      impressions,
      clicks,
      adSpend,
      adSales,
      adOrders,
      plan: input.promotion.find((row) => row.date === business.date) ?? null,
      metrics: calculateFunnelMetrics({ impressions, clicks, sessions, adOrders, totalOrders, spend: adSpend, adSales, totalSales: business.sales }),
    } satisfies LinkedDay;
  });
  return { days, unmappedAds };
}
