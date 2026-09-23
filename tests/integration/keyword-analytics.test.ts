import { expect, test } from "vitest";
import { buildKeywordAnalytics } from "../../src/integration/keyword-analytics";
import type { KeywordRankSnapshot } from "../../src/domain/linkage";

test("detects large and continuous observed rank declines", () => {
  const row = (date: string, rank: number, id: string): KeywordRankSnapshot => ({ id, marketplace: "US", date, keywordId: "santa", keyword: "santa", asin: "B0CFPYYPRN", organicRank: rank, adRank: null, organicStatus: "ranked", adStatus: "missing", updatedAt: date });
  const result = buildKeywordAnalytics([row("2026-10-01", 5, "1"), row("2026-10-02", 11, "2"), row("2026-10-03", 22, "3")], "2026-10-03");
  expect(result.alerts.some((alert) => alert.severity === "risk")).toBe(true);
  expect(result.summary.tracked).toBe(1);
});
