import { describe, expect, test } from "vitest";
import { buildCompetitorAnalytics } from "../../src/integration/competitor-analytics";
import type { CompetitorSnapshot } from "../../src/domain/linkage";

const base: CompetitorSnapshot = { id: "one", marketplace: "US", date: "2026-10-01", competitorAsin: "B012345678", price: 60, couponPercent: null, bsrRank: 2000, reviewCount: 100, updatedAt: "2026-10-01T00:00:00Z" };

describe("competitor analytics", () => {
  test("detects price drops, new coupons, BSR improvement, and review growth", () => {
    const rows = [base, { ...base, id: "two", date: "2026-10-02", price: 54, couponPercent: 10, bsrRank: 1500, reviewCount: 120 }];
    const result = buildCompetitorAnalytics(rows, "2026-10-02");
    expect(result.alerts.map((row) => row.type)).toEqual(expect.arrayContaining(["price-drop", "new-coupon", "bsr-improvement", "review-growth"]));
    expect(result.summary.tracked).toBe(1);
  });

  test("compares competitors with the own-product baseline by effective price and size", () => {
    const rows: CompetitorSnapshot[] = [
      { ...base, id: "own", competitorAsin: "B0CFQ3TMBZ", size: "XL", price: 59.99, effectivePrice: 59.99, isOwnProduct: true },
      { ...base, id: "rival-1", competitorAsin: "B077MBK8RM", size: "XL", price: 89.9, effectivePrice: 71.92, isOwnProduct: false },
      { ...base, id: "rival-2", date: "2026-10-02", competitorAsin: "B077MBK8RM", size: "XL", price: 89.9, effectivePrice: 67.43, couponPercent: 25, isOwnProduct: false, subcategoryRank: 150 },
    ];

    const result = buildCompetitorAnalytics(rows, "2026-10-02");

    expect(result.summary.tracked).toBe(1);
    expect(result.summary.ownEffectivePrice).toBe(59.99);
    expect(result.summary.lowestCompetitorPrice).toBe(67.43);
    expect(result.summary.priceGap).toBeCloseTo(7.44);
    expect(result.summary.promotionChanges).toBe(1);
  });
});
