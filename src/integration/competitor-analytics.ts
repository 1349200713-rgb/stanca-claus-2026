import type { CompetitorSnapshot } from "../domain/linkage";

export interface CompetitorAlert { id: string; type: "price-drop" | "new-coupon" | "bsr-improvement" | "review-growth"; severity: "attention" | "risk"; competitorAsin: string; date: string; detail: string }

export function buildCompetitorAnalytics(rows: readonly CompetitorSnapshot[], asOfDate: string) {
  const eligible = rows.filter((row) => row.date <= asOfDate);
  const byAsin = new Map<string, CompetitorSnapshot[]>();
  eligible.filter((row) => !row.isOwnProduct).forEach((row) => byAsin.set(row.competitorAsin, [...(byAsin.get(row.competitorAsin) ?? []), row]));
  const byVariant = new Map<string, CompetitorSnapshot[]>();
  eligible.filter((row) => !row.isOwnProduct).forEach((row) => {
    const key = `${row.competitorAsin}:${row.size ?? "all"}`;
    byVariant.set(key, [...(byVariant.get(key) ?? []), row]);
  });
  const alerts: CompetitorAlert[] = [];
  let promotionChanges = 0;
  for (const [variant, snapshots] of byVariant) {
    const asin = variant.split(":")[0];
    const sorted = snapshots.toSorted((a, b) => a.date.localeCompare(b.date));
    const current = sorted.at(-1); const previous = sorted.at(-2);
    if (!current || !previous) continue;
    const add = (type: CompetitorAlert["type"], severity: CompetitorAlert["severity"], detail: string) => alerts.push({ id: `${type}:${asin}:${current.date}`, type, severity, competitorAsin: asin, date: current.date, detail });
    const currentPrice = current.effectivePrice ?? current.price;
    const previousPrice = previous.effectivePrice ?? previous.price;
    if (currentPrice !== null && previousPrice !== null && currentPrice <= previousPrice * 0.95) add("price-drop", "risk", `${current.size ?? ""}到手价由 ${previousPrice} 降至 ${currentPrice}`);
    const currentPromotion = (current.couponPercent ?? 0) + (current.codePercent ?? 0) + (current.couponAmount ?? 0) + (current.primeSavings ? 1 : 0);
    const previousPromotion = (previous.couponPercent ?? 0) + (previous.codePercent ?? 0) + (previous.couponAmount ?? 0) + (previous.primeSavings ? 1 : 0);
    if (currentPromotion !== previousPromotion) promotionChanges += 1;
    if (currentPromotion > 0 && previousPromotion === 0) add("new-coupon", "attention", `新增 ${current.couponPercent ?? current.codePercent ?? current.couponAmount ?? "Prime"} 优惠`);
    const currentRank = current.subcategoryRank ?? current.bsrRank;
    const previousRank = previous.subcategoryRank ?? previous.bsrRank;
    if (currentRank != null && previousRank != null && currentRank <= previousRank * 0.8) add("bsr-improvement", "risk", `小类排名由 ${previousRank} 升至 ${currentRank}`);
    if (current.reviewCount != null && previous.reviewCount != null && current.reviewCount - previous.reviewCount >= 10) add("review-growth", "attention", `评论增加 ${current.reviewCount - previous.reviewCount}`);
  }
  const latestByVariant = [...byVariant.values()].map((snapshots) => snapshots.toSorted((a, b) => a.date.localeCompare(b.date)).at(-1)).filter(Boolean) as CompetitorSnapshot[];
  const competitorPrices = latestByVariant.map((row) => row.effectivePrice ?? row.price).filter((price): price is number => price != null);
  const ownPrices = eligible.filter((row) => row.isOwnProduct).map((row) => row.effectivePrice ?? row.price).filter((price): price is number => price != null);
  const lowestCompetitorPrice = competitorPrices.length ? Math.min(...competitorPrices) : null;
  const ownEffectivePrice = ownPrices.length ? Math.min(...ownPrices) : null;
  return { summary: { tracked: byAsin.size, alerts: alerts.length, lowestCompetitorPrice, ownEffectivePrice, priceGap: lowestCompetitorPrice != null && ownEffectivePrice != null ? lowestCompetitorPrice - ownEffectivePrice : null, promotionChanges }, alerts };
}
