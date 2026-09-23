import { describe, expect, test } from "vitest";
import { parseCompetitorRows } from "../../src/import/competitor-parser";

describe("competitor report parser", () => {
  test("recognizes Chinese columns and keeps blank measurements unknown", () => {
    const result = parseCompetitorRows([
      { 日期: "2026-10-02", 竞品ASIN: "b012345678", 品牌: "North", 价格: "$49.99", 优惠: "10%", 评分: "4.5", 评论数: "120", BSR排名: "1,200" },
      { 日期: "2026-10-02", 竞品ASIN: "B087654321", 价格: "", 评分: "", 评论数: "", BSR排名: "" },
    ], "2026-10-02T01:00:00.000Z");
    expect(result.records[0]).toMatchObject({ date: "2026-10-02", marketplace: "US", competitorAsin: "B012345678", price: 49.99, couponPercent: 10, bsrRank: 1200 });
    expect(result.records[1]).toMatchObject({ price: null, rating: null, reviewCount: null, bsrRank: null });
    expect(result.issues).toEqual([]);
  });

  test("rejects rows without a valid date or ASIN", () => {
    const result = parseCompetitorRows([{ 日期: "2026-99-99", 竞品ASIN: "B012345678" }], "2026-10-02T01:00:00.000Z");
    expect(result.records).toEqual([]);
    expect(result.issues).toHaveLength(1);
  });

  test("accepts an Excel serial date", () => {
    expect(parseCompetitorRows([{ 日期: 46358, 竞品ASIN: "B012345678" }]).records[0]?.date).toBe("2026-12-02");
  });
});
