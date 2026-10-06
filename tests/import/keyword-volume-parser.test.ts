import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { isSearchVolumeSnapshot } from "../../src/domain/keyword-volume";
import { parseKeywordRankRows } from "../../src/import/keyword-rank-parser";
import { parseKeywordVolumeReport, parseKeywordVolumeRows } from "../../src/import/keyword-volume-parser";

const updatedAt = "2026-10-05T00:00:00Z";
const row = {
  关键词: " Santa Costume ",
  ASIN: "b0cfpyyprn",
  统计周期: "month",
  开始日期: "2026-09-01",
  结束日期: "2026-09-30",
  搜索量: "1,234",
  统计范围: "market",
  来源: "Amazon Search Query Performance",
};

// Fixtures and expected values are hand-checked, never computed by the parser.
const snapshot = {
  id: "keyword-volume:fixture",
  kind: "search-volume",
  marketplace: "US",
  keywordId: "santa-costume",
  keyword: "Santa Costume",
  asin: "B0CFPYYPRN",
  scope: "market",
  source: "Amazon Search Query Performance",
  period: "month",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  searchVolume: 1234,
  updatedAt,
};

describe("keyword volume rows", () => {
  // Rejecting day aliases or allowing multi-day observations would break daily source data.
  test.each(["day", "daily", "日", "天", "日度"])("imports the true single-day period alias %s", (period) => {
    const result = parseKeywordVolumeRows([{ ...row, 统计周期: period, 开始日期: "2026-10-06", 结束日期: "2026-10-06" }], updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06", searchVolume: 1234 });
  });

  test.each(["日期", "Date"])("maps a daily %s column to identical start and end dates", (dateHeader) => {
    const result = parseKeywordVolumeRows([{
      关键词: "Santa Costume", ASIN: "B0CFPYYPRN", 统计周期: "daily", [dateHeader]: "2026-10-06",
      搜索量: "42", 统计范围: "market", 来源: "Daily source",
    }], updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06", searchVolume: 42 });
  });

  test.each([
    { 开始日期: "2026-10-05", 结束日期: "2026-10-06" },
    { 开始日期: "2026-10-06", 结束日期: "2026-10-07" },
    { 开始日期: "not a date", 结束日期: "2026-10-06" },
    { 开始日期: "2026-10-06", 结束日期: "2026-02-30" },
    { 开始日期: "2026-10-06", 结束日期: "2026-10-06", 日期: "2026-02-30" },
  ])("rejects conflicting or invalid explicit boundaries instead of replacing them with the daily date (%j)", (change) => {
    const result = parseKeywordVolumeRows([{ ...row, 统计周期: "day", 日期: "2026-10-06", ...change }]);
    expect(result.records).toEqual([]);
    expect(result.issues).not.toEqual([]);
  });

  test("accepts matching explicit boundaries alongside a daily date", () => {
    const result = parseKeywordVolumeRows([{ ...row, 统计周期: "day", 日期: "2026-10-06", 开始日期: "2026-10-06", 结束日期: "2026-10-06" }]);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06" });
  });

  test("rejects a multi-day range labeled day even without a single-date column", () => {
    const result = parseKeywordVolumeRows([{ ...row, 统计周期: "day", 开始日期: "2026-10-05", 结束日期: "2026-10-06" }]);
    expect(result.records).toEqual([]);
    expect(result.issues.join(" ")).toMatch(/同一天|单日/);
  });

  test("does not use a daily date column to override an explicitly weekly range", () => {
    const result = parseKeywordVolumeRows([{ ...row, 统计周期: "week", 日期: "2026-12-01", 开始日期: "2026-09-28", 结束日期: "2026-10-04" }]);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ period: "week", periodStart: "2026-09-28", periodEnd: "2026-10-04" });
  });

  test("does not infer a longer reporting range from a single date", () => {
    const result = parseKeywordVolumeRows([{ 关键词: "Santa Costume", 统计周期: "month", 日期: "2026-09-01", 搜索量: "10", 统计范围: "market", 来源: "Daily source" }]);
    expect(result.records).toEqual([]);
    expect(result.issues).not.toEqual([]);
  });

  test.each([46357, "46357"])("accepts an integer Excel date serial in a daily date column (%s)", (date) => {
    const result = parseKeywordVolumeRows([{ 关键词: "Santa Costume", 统计周期: "day", Date: date, 搜索量: "42", 统计范围: "market", 来源: "Daily source" }]);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ periodStart: "2026-12-01", periodEnd: "2026-12-01", searchVolume: 42 });
  });

  test.each(["60", 60, "46357.5", 46357.5, "1e3", 0])("rejects invalid daily date serials without fabricating a calendar date (%s)", (date) => {
    const result = parseKeywordVolumeRows([{ 关键词: "Santa Costume", 统计周期: "day", 日期: date, 搜索量: "42", 统计范围: "market", 来源: "Daily source" }]);
    expect(result.records).toEqual([]);
    expect(result.issues).not.toEqual([]);
  });

  test("keeps daily and legacy longer-period identities intact without converting their counts", () => {
    const result = parseKeywordVolumeRows([
      { ...row, 统计周期: "day", 开始日期: "2026-09-30", 结束日期: "2026-09-30", 搜索量: "12" },
      { ...row, 统计周期: "week", 开始日期: "2026-09-28", 结束日期: "2026-10-04", 搜索量: "70" },
      row,
      { ...row, 统计周期: "quarter", 开始日期: "2026-07-01", 结束日期: "2026-09-30", 搜索量: "500" },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.records.map((record) => [record.period, record.periodStart, record.periodEnd, record.searchVolume])).toEqual([
      ["day", "2026-09-30", "2026-09-30", 12], ["week", "2026-09-28", "2026-10-04", 70],
      ["month", "2026-09-01", "2026-09-30", 1234], ["quarter", "2026-07-01", "2026-09-30", 500],
    ]);
    expect(new Set(result.records.map((record) => record.id)).size).toBe(4);
    expect(result.records[2].id).toBe("keyword-volume:US:santa%20costume:Amazon%20Search%20Query%20Performance:market:B0CFPYYPRN:month:2026-09-01:2026-09-30");
  });

  test("imports true query counts and keeps an optional market ASIN", () => {
    const result = parseKeywordVolumeRows([row], updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ ...snapshot, id: expect.stringMatching(/^keyword-volume:/) });
  });

  test("preserves a measured zero as zero", () => {
    expect(parseKeywordVolumeRows([{ ...row, 搜索量: "0" }]).records[0]?.searchVolume).toBe(0);
  });

  test.each(["", " ", null, undefined])("keeps an explicitly present missing count as null (%s)", (value) => {
    const result = parseKeywordVolumeRows([{ ...row, 搜索量: value }]);
    expect(result.issues).toEqual([]);
    expect(result.records[0]?.searchVolume).toBeNull();
  });

  test("does not attribute an unspecified source to Amazon", () => {
    const result = parseKeywordVolumeRows([{ ...row, 来源: " " }]);
    expect(result.records[0]?.source).toBe("uploaded");
    expect(result.issues.join(" ")).toMatch(/来源|source/i);
  });

  test("supports English query performance headers and weekly values", () => {
    const result = parseKeywordVolumeRows([{
      "Search Query": "Santa Costume",
      "Search Query Volume": 42,
      "Reporting Period": "weekly",
      "Start Date": "2026-09-28",
      "End Date": "2026-10-04",
      Scope: "ASIN",
      ASIN: "B0CFPYYPRN",
      Source: "SQP export",
    }], updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ keywordId: "santa-costume", searchVolume: 42, scope: "asin", period: "week", periodStart: "2026-09-28", periodEnd: "2026-10-04" });
  });

  test.each([
    ["周", "2026-09-28", "2026-10-04", "week"],
    ["月度", "2024-02-01", "2024-02-29", "month"],
    ["季度", "2026-07-01", "2026-09-30", "quarter"],
    ["quarterly", "2026-10-01", "2026-12-31", "quarter"],
  ])("normalizes %s without inferring a reporting interval", (period, start, end, want) => {
    const result = parseKeywordVolumeRows([{ ...row, 统计周期: period, 开始日期: start, 结束日期: end }]);
    expect(result.issues).toEqual([]);
    expect(result.records[0]?.period).toBe(want);
  });

  test("accepts raw Excel date serials", () => {
    const result = parseKeywordVolumeRows([{ ...row, 开始日期: 46357, 结束日期: 46387 }]);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ periodStart: "2026-12-01", periodEnd: "2026-12-31" });
  });

  test.each(["-1", -1, "1.5", 1.5, "9007199254740992", "10%", "1,23", "12,34,567", "1,234,", "1e3", true, "not a count"])("rejects unsafe or malformed search counts (%s)", (value) => {
    const result = parseKeywordVolumeRows([{ ...row, 搜索量: value }]);
    expect(result.records).toEqual([]);
    expect(result.issues.join(" ")).toMatch(/搜索量|count|volume/i);
  });

  test("does not treat an ABA search rank as a count column", () => {
    const rankOnly: Record<string, unknown> = { ...row, ABA搜索排名: 12 };
    delete rankOnly.搜索量;
    const result = parseKeywordVolumeRows([rankOnly]);
    expect(result.records).toEqual([]);
    expect(result.issues.join(" ")).toMatch(/搜索量|count|volume/i);
  });

  test.each(["统计周期", "开始日期", "结束日期", "统计范围"])("requires an explicit %s field", (field) => {
    const input: Record<string, unknown> = { ...row };
    delete input[field];
    const result = parseKeywordVolumeRows([input]);
    expect(result.records).toEqual([]);
    expect(result.issues).not.toEqual([]);
  });

  test.each([
    { 统计周期: "year" },
    { 统计范围: "inferred" },
    { 开始日期: "2026-09-31" },
    { 结束日期: "2026-02-30" },
    { 开始日期: "2026-10-01", 结束日期: "2026-09-30" },
    { 统计周期: "week", 开始日期: "2026-09-01", 结束日期: "2026-09-08" },
    { 开始日期: "2026-09-02" },
    { 统计周期: "quarter", 开始日期: "2026-08-01", 结束日期: "2026-10-31" },
    { 开始日期: 60, 结束日期: 90 },
  ])("rejects invalid dates, scopes, and partial intervals (%j)", (change) => {
    const result = parseKeywordVolumeRows([{ ...row, ...change }]);
    expect(result.records).toEqual([]);
    expect(result.issues).not.toEqual([]);
  });

  test("allows a market-wide record without an ASIN", () => {
    const result = parseKeywordVolumeRows([{ ...row, ASIN: "" }]);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).not.toHaveProperty("asin");
  });

  test("requires an ASIN for ASIN-scoped counts", () => {
    const result = parseKeywordVolumeRows([{ ...row, ASIN: "", 统计范围: "asin" }]);
    expect(result.records).toEqual([]);
    expect(result.issues.join(" ")).toMatch(/ASIN/);
  });

  test("retains separately uploaded market views for downstream deduplication", () => {
    const result = parseKeywordVolumeRows([row, { ...row, ASIN: "B0G8XZL8QJ" }]);
    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => record.asin)).toEqual(["B0CFPYYPRN", "B0G8XZL8QJ"]);
  });

  test("isolates volume IDs from ranks and all distinct reporting dimensions", () => {
    const inputs = [
      row,
      { ...row, 关键词: "Santa Hat" },
      { ...row, 来源: "Other source" },
      { ...row, 统计范围: "asin" },
      { ...row, ASIN: "B0G8XZL8QJ" },
      { ...row, 统计周期: "week", 开始日期: "2026-09-01", 结束日期: "2026-09-07" },
      { ...row, 开始日期: "2026-10-01", 结束日期: "2026-10-31" },
    ];
    const records = parseKeywordVolumeRows(inputs).records;
    expect(records).toHaveLength(7);
    expect(new Set(records.map((record) => record.id)).size).toBe(7);
    expect(records.every((record) => record.id.startsWith("keyword-volume:"))).toBe(true);
    const rank = parseKeywordRankRows([{ 日期: "2026-09-01", 关键词: "Santa Costume", ASIN: "B0CFPYYPRN", 自然排名: 1 }]).records[0];
    expect(records[0].keywordId).toBe(rank.keywordId);
    expect(records[0].id).not.toBe(rank.id);
    expect(parseKeywordVolumeRows([row], "2026-11-01T00:00:00Z").records[0]?.id).toBe(records[0].id);
  });

  test("keeps distinct keywords with the same rank slug isolated", () => {
    const records = parseKeywordVolumeRows([{ ...row, 关键词: "santa+costume" }, { ...row, 关键词: "santa costume" }]).records;
    expect(records).toHaveLength(2);
    expect(records[0].id).not.toBe(records[1].id);
  });

  test("deduplicates repeated same-ID known counts", () => {
    const result = parseKeywordVolumeRows([row, { ...row, 搜索量: 1234 }]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].searchVolume).toBe(1234);
  });

  test.each([["", 1234], [1234, ""]])("keeps the known count when a same-ID row has missing data (%j)", (first, second) => {
    const result = parseKeywordVolumeRows([{ ...row, 搜索量: first }, { ...row, 搜索量: second }]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].searchVolume).toBe(1234);
  });

  test("deduplicates repeated same-ID missing counts", () => {
    const result = parseKeywordVolumeRows([{ ...row, 搜索量: "" }, { ...row, 搜索量: null }]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].searchVolume).toBeNull();
  });

  test("excludes a conflicting same-ID group while keeping unrelated rows", () => {
    const result = parseKeywordVolumeRows([row, { ...row, 搜索量: 1235 }, row, { ...row, 关键词: "Santa Hat", 搜索量: 10 }]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ keyword: "Santa Hat", searchVolume: 10 });
    expect(result.issues.join(" ")).toMatch(/冲突|conflict/i);
  });
});

describe("search volume guard", () => {
  test("accepts a real same-calendar-day observation including leap day and measured zero", () => {
    expect(isSearchVolumeSnapshot({ ...snapshot, period: "day", periodStart: "2024-02-29", periodEnd: "2024-02-29", searchVolume: 0 })).toBe(true);
    expect(isSearchVolumeSnapshot({ ...snapshot, period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06", searchVolume: null })).toBe(true);
  });

  test.each([
    ["2026-10-05", "2026-10-06"], ["2026-10-06", "2026-10-05"], ["2025-02-29", "2025-02-29"],
  ])("rejects a day observation with unequal or invalid dates (%s, %s)", (start, end) => {
    expect(isSearchVolumeSnapshot({ ...snapshot, period: "day", periodStart: start, periodEnd: end })).toBe(false);
  });

  test("accepts measured and missing volume records", () => {
    expect(isSearchVolumeSnapshot(snapshot)).toBe(true);
    expect(isSearchVolumeSnapshot({ ...snapshot, searchVolume: 0 })).toBe(true);
    expect(isSearchVolumeSnapshot({ ...snapshot, searchVolume: null, asin: undefined })).toBe(true);
  });

  test.each([
    null, {}, { ...snapshot, kind: "keyword-rank" }, { ...snapshot, keyword: "" },
    { ...snapshot, id: "keyword:US:2026-09-01:B0CFPYYPRN:santa-costume" },
    { ...snapshot, searchVolume: "1234" }, { ...snapshot, searchVolume: -1 },
    { ...snapshot, period: "year" }, { ...snapshot, scope: "unknown" },
    { ...snapshot, periodStart: "2026-02-30" }, { ...snapshot, updatedAt: undefined },
    { ...snapshot, scope: "asin", asin: undefined },
  ])("rejects unusable or rank records (%j)", (value) => {
    expect(isSearchVolumeSnapshot(value)).toBe(false);
  });
});

describe("keyword volume files", () => {
  test("imports a true daily Chinese single-date CSV without splitting the observation", () => {
    const csv = "关键词,ASIN,统计周期,日期,搜索量,统计范围,来源\r\nSanta Costume,B0CFPYYPRN,日,2026-10-06,0,market,Daily source\r\n";
    const result = parseKeywordVolumeReport(new TextEncoder().encode(csv).buffer, "daily.csv", updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06", searchVolume: 0, updatedAt });
  });

  test("imports a daily numeric date serial from a raw CSV Date column", () => {
    const csv = "Keyword,Period,Date,Search Volume,Scope,Source\r\nSanta Costume,daily,46357,42,market,Daily source\r\n";
    const result = parseKeywordVolumeReport(new TextEncoder().encode(csv).buffer, "daily-serial.csv", updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ period: "day", periodStart: "2026-12-01", periodEnd: "2026-12-01", searchVolume: 42 });
  });

  test("imports a daily numeric date serial from an XLSX Date column", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Keyword: "Santa Costume", Period: "daily", Date: 46357, "Search Volume": 42, Scope: "market", Source: "Daily source" }]), "Daily");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const result = parseKeywordVolumeReport(data, "daily.xlsx", updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ period: "day", periodStart: "2026-12-01", periodEnd: "2026-12-01", searchVolume: 42 });
  });

  test("imports the Chinese CSV template through the real file parser", () => {
    const csv = "关键词,ASIN,统计周期,开始日期,结束日期,搜索量,统计范围,来源\r\nSanta Costume,B0CFPYYPRN,month,2026-09-01,2026-09-30,0,market,SQP export\r\n";
    const result = parseKeywordVolumeReport(new TextEncoder().encode(csv).buffer, "volume.csv", updatedAt);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ keywordId: "santa-costume", searchVolume: 0, updatedAt });
  });

  test("imports raw date serials from an XLSX workbook", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ ...row, 开始日期: 46357, 结束日期: 46387 }]), "Volume");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const result = parseKeywordVolumeReport(data, "volume.XLSX");
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ periodStart: "2026-12-01", periodEnd: "2026-12-31", searchVolume: 1234 });
  });

  test.each(["volume.pdf", "volume.xlsx"])("returns issues for unsupported or corrupt files (%s)", (filename) => {
    const result = parseKeywordVolumeReport(new Uint8Array([0, 255, 12, 23]).buffer, filename);
    expect(result.records).toEqual([]);
    expect(result.issues).not.toEqual([]);
  });

  test("returns an issue for a header-only CSV", () => {
    const data = new TextEncoder().encode("关键词,统计周期,开始日期,结束日期,搜索量,统计范围,来源\r\n").buffer;
    expect(parseKeywordVolumeReport(data, "empty.csv").issues).not.toEqual([]);
  });
});
