import type { CompetitorSnapshot, KeywordRankSnapshot } from "../domain/linkage";
import type { LinkedDay } from "./linked-dataset";
import { buildCompetitorAnalytics } from "./competitor-analytics";
import { buildKeywordAnalytics } from "./keyword-analytics";

export interface OperatingAlert {
  id: string;
  type: "keyword-rank-drop" | "competitor-price-drop" | "competitor-promotion" | "competitor-bsr" | "traffic-no-clicks" | "clicks-no-orders";
  severity: "attention" | "risk";
  date: string;
  detail: string;
  asin?: string;
  keywordId?: string;
  competitorAsin?: string;
}

export function evaluateAlerts(input: { linked: readonly LinkedDay[]; keywords: readonly KeywordRankSnapshot[]; competitors: readonly CompetitorSnapshot[] }, now: Date): OperatingAlert[] {
  const asOfDate = now.toISOString().slice(0, 10);
  const keywordAlerts = buildKeywordAnalytics(input.keywords.filter((row) => row.date <= asOfDate), asOfDate).alerts.map((alert) => ({
    id: alert.id, type: "keyword-rank-drop" as const, severity: alert.severity, date: alert.date, detail: alert.detail, asin: alert.asin, keywordId: alert.keywordId,
  }));
  const competitorAlerts = buildCompetitorAnalytics(input.competitors.filter((row) => row.date <= asOfDate), asOfDate).alerts.map((alert) => ({
    id: alert.id,
    type: alert.type === "price-drop" ? "competitor-price-drop" as const : alert.type === "bsr-improvement" ? "competitor-bsr" as const : "competitor-promotion" as const,
    severity: alert.severity, date: alert.date, detail: alert.detail, competitorAsin: alert.competitorAsin,
  }));
  const funnelAlerts: OperatingAlert[] = [];
  for (const row of input.linked.filter((item) => item.date <= asOfDate)) {
    if (row.impressions !== null && row.impressions > 0 && row.clicks === 0) funnelAlerts.push({ id: `traffic-no-clicks:${row.asin}:${row.date}`, type: "traffic-no-clicks", severity: "attention", date: row.date, asin: row.asin, detail: "有曝光无点击，请检查主图、价格、标题和相关性" });
    if (row.clicks !== null && row.clicks > 0 && row.totalOrders === 0) funnelAlerts.push({ id: `clicks-no-orders:${row.asin}:${row.date}`, type: "clicks-no-orders", severity: "risk", date: row.date, asin: row.asin, detail: "有点击无订单，请检查Listing、评价、优惠和流量精准度" });
  }
  return [...keywordAlerts, ...competitorAlerts, ...funnelAlerts].toSorted((a, b) => b.date.localeCompare(a.date) || (a.severity === "risk" ? -1 : 1));
}
