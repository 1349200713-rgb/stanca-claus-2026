import { describe, expect, test } from "vitest";
import { evaluateAlerts } from "../../src/integration/alert-engine";
import type { KeywordRankSnapshot } from "../../src/domain/linkage";

const rank = (id: string, date: string, organicRank: number | null): KeywordRankSnapshot => ({
  id, marketplace: "US", date, keywordId: "santa-costume", keyword: "Santa Costume", asin: "B0CFPYYPRN",
  organicRank, adRank: null, organicStatus: organicRank === null ? "missing" : "ranked", adStatus: "missing", updatedAt: `${date}T00:00:00Z`,
});

describe("alert engine", () => {
  test("emits a linked keyword drop alert only for observed dates not later than now", () => {
    const alerts = evaluateAlerts({
      linked: [], competitors: [],
      keywords: [rank("one", "2026-10-09", 8), rank("two", "2026-10-10", 19), rank("future", "2026-10-11", 40)],
    }, new Date("2026-10-10T23:59:59Z"));

    expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "keyword-rank-drop", severity: "risk", asin: "B0CFPYYPRN", keywordId: "santa-costume" })]));
    expect(alerts.some((alert) => alert.date === "2026-10-11")).toBe(false);
  });

  test("does not turn missing source metrics into operating anomalies", () => {
    const alerts = evaluateAlerts({
      keywords: [], competitors: [],
      linked: [{ marketplace: "US", date: "2026-10-10", asin: "B0CFPYYPRN", sku: "SKU", size: "L", units: 0, sales: 0, sessions: null, totalOrders: null, impressions: null, clicks: null, adSpend: null, adSales: null, adOrders: null, plan: null, metrics: { ctr: null, cpc: null, cvr: null, adCvr: null, acos: null, tacos: null, organicOrders: null, conflicts: [] } }],
    }, new Date("2026-10-10T23:59:59Z"));
    expect(alerts).toEqual([]);
  });
});
