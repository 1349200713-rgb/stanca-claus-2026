import type { FunnelMetrics } from "../domain/linkage";

export interface FunnelMetricInput {
  impressions: number | null;
  clicks: number | null;
  sessions: number | null;
  adOrders: number | null;
  totalOrders: number | null;
  spend: number | null;
  adSales: number | null;
  totalSales: number | null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (denominator === 0) return numerator === 0 ? 0 : null;
  return numerator / denominator;
}

export function calculateFunnelMetrics(input: FunnelMetricInput): FunnelMetrics {
  const organicOrders = input.totalOrders === null || input.adOrders === null
    ? null
    : input.totalOrders - input.adOrders;
  const conflicts = organicOrders !== null && organicOrders < 0 ? ["广告订单大于总订单"] : [];
  return {
    ctr: ratio(input.clicks, input.impressions),
    cpc: ratio(input.spend, input.clicks),
    cvr: ratio(input.totalOrders, input.sessions),
    adCvr: ratio(input.adOrders, input.clicks),
    acos: ratio(input.spend, input.adSales),
    tacos: ratio(input.spend, input.totalSales),
    organicOrders,
    conflicts,
  };
}
