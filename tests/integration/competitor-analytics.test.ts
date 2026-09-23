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
});
