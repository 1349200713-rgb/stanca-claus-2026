import { expect, test } from "vitest";
import { parseRank, parseKeywordRankRows } from "../../src/import/keyword-rank-parser";

test("normalizes ranked, unindexed, zero, and missing values", () => {
  expect(parseRank("8")).toEqual({ rank: 8, status: "ranked" });
  expect(parseRank("未收录")).toEqual({ rank: null, status: "notIndexed" });
  expect(parseRank("0")).toEqual({ rank: null, status: "notIndexed" });
  expect(parseRank("")).toEqual({ rank: null, status: "missing" });
});

test("parses keyword rows with independent organic and ad ranks", () => {
  const result = parseKeywordRankRows([{ 日期: "2026-10-02", 关键词: " Santa Costume ", ASIN: "b0cfpyyprn", 自然排名: "8", 广告排名: "未收录" }], "2026-10-02T00:00:00Z");
  expect(result.records[0]).toMatchObject({ keywordId: "santa-costume", asin: "B0CFPYYPRN", organicRank: 8, organicStatus: "ranked", adRank: null, adStatus: "notIndexed" });
});
