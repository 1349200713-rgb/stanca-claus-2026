import type { CompetitorSnapshot } from "../domain/linkage";

export interface CompetitorAlert { id: string; type: "price-drop" | "new-coupon" | "bsr-improvement" | "review-growth"; severity: "attention" | "risk"; competitorAsin: string; date: string; detail: string }

export function buildCompetitorAnalytics(rows: readonly CompetitorSnapshot[], asOfDate: string) {
  const byAsin = new Map<string, CompetitorSnapshot[]>();
  rows.filter((row) => row.date <= asOfDate).forEach((row) => byAsin.set(row.competitorAsin, [...(byAsin.get(row.competitorAsin) ?? []), row]));
  const alerts: CompetitorAlert[] = [];
  for (const [asin, snapshots] of byAsin) {
    const sorted = snapshots.toSorted((a, b) => a.date.localeCompare(b.date));
    const current = sorted.at(-1); const previous = sorted.at(-2);
    if (!current || !previous) continue;
    const add = (type: CompetitorAlert["type"], severity: CompetitorAlert["severity"], detail: string) => alerts.push({ id: `${type}:${asin}:${current.date}`, type, severity, competitorAsin: asin, date: current.date, detail });
    if (current.price !== null && previous.price !== null && current.price <= previous.price * 0.95) add("price-drop", "risk", `价格由 ${previous.price} 降至 ${current.price}`);
    if ((current.couponPercent ?? 0) > 0 && !(previous.couponPercent ?? 0)) add("new-coupon", "attention", `新增 ${current.couponPercent}% 优惠`);
    if (current.bsrRank != null && previous.bsrRank != null && current.bsrRank <= previous.bsrRank * 0.8) add("bsr-improvement", "risk", `BSR由 ${previous.bsrRank} 升至 ${current.bsrRank}`);
    if (current.reviewCount != null && previous.reviewCount != null && current.reviewCount - previous.reviewCount >= 10) add("review-growth", "attention", `评论增加 ${current.reviewCount - previous.reviewCount}`);
  }
  return { summary: { tracked: byAsin.size, alerts: alerts.length }, alerts };
}
