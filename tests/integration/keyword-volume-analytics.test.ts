import { expect, test } from "vitest";
import type { SearchVolumeSnapshot } from "../../src/domain/keyword-volume";
import { buildKeywordVolumeAnalytics, prepareKeywordVolumeImport } from "../../src/integration/keyword-volume-analytics";

const row = (overrides: Partial<SearchVolumeSnapshot> = {}): SearchVolumeSnapshot => ({
  id: "volume-1", kind: "search-volume", marketplace: "US", keywordId: "santa-costume", keyword: "santa costume",
  asin: "B0CFPYYPRN", scope: "market", source: "Amazon SQP", period: "week",
  periodStart: "2026-09-28", periodEnd: "2026-10-04", searchVolume: 100, updatedAt: "2026-10-05", ...overrides,
});

// Comparing a month boundary or the most recent observation instead of yesterday must fail.
test.each([
  ["2026-10-06", "2026-10-05"], ["2026-10-01", "2026-09-30"],
  ["2027-01-01", "2026-12-31"], ["2024-03-01", "2024-02-29"],
  ["2025-03-01", "2025-02-28"], ["2024-02-29", "2024-02-28"],
])("compares the exact previous calendar day for %s against %s even outside the selected range", (date, previousDate) => {
  const result = buildKeywordVolumeAnalytics([
    row({ id: "daily-previous", period: "day", periodStart: previousDate, periodEnd: previousDate, searchVolume: 50 }),
    row({ id: "daily-current", period: "day", periodStart: date, periodEnd: date, searchVolume: 100 }),
  ], { period: "day", dateFrom: date, dateTo: date });
  expect(result.series).toHaveLength(1);
  expect(result.series[0].points).toHaveLength(1);
  expect(result.series[0].points[0]).toMatchObject({ periodStart: date, periodEnd: date, previousVolume: 50, changePercent: 1, changeStatus: "increase" });
});

test("keeps a missing yesterday unknown instead of comparing the last available daily count", () => {
  const result = buildKeywordVolumeAnalytics([
    row({ id: "daily-old", period: "day", periodStart: "2026-10-04", periodEnd: "2026-10-04", searchVolume: 50 }),
    row({ id: "daily-current", period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06", searchVolume: 100 }),
  ], { period: "day", dateFrom: "2026-10-06" });
  expect(result.series[0].points).toHaveLength(1);
  expect(result.series[0].points[0]).toMatchObject({ searchVolume: 100, previousVolume: null, changePercent: null, changeStatus: "missing" });
});

test("does not replace a missing daily value with zero when computing yesterday's change", () => {
  const result = buildKeywordVolumeAnalytics([
    row({ id: "daily-previous", period: "day", periodStart: "2026-10-05", periodEnd: "2026-10-05", searchVolume: null }),
    row({ id: "daily-current", period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06", searchVolume: 100 }),
  ], { period: "day", dateFrom: "2026-10-06" });
  expect(result.series[0].points[0]).toMatchObject({ previousVolume: null, changePercent: null, changeStatus: "missing" });
});

test("keeps daily and longer-period counts in separate intact series without allocation or mutation", () => {
  const rows = [
    row({ id: "daily", period: "day", periodStart: "2026-09-30", periodEnd: "2026-09-30", searchVolume: 12 }),
    row({ id: "weekly", searchVolume: 70 }),
    row({ id: "monthly", period: "month", periodStart: "2026-09-01", periodEnd: "2026-09-30", searchVolume: 300 }),
    row({ id: "quarterly", period: "quarter", periodStart: "2026-07-01", periodEnd: "2026-09-30", searchVolume: 900 }),
  ];
  const original = structuredClone(rows);
  const result = buildKeywordVolumeAnalytics(rows);
  expect(result.series).toHaveLength(4);
  expect(result.series.flatMap((series) => series.points)).toHaveLength(4);
  expect(result.series.find((series) => series.period === "week")?.points[0]).toMatchObject({ periodStart: "2026-09-28", periodEnd: "2026-10-04", searchVolume: 70 });
  expect(result.series.find((series) => series.period === "month")?.points[0]).toMatchObject({ periodStart: "2026-09-01", periodEnd: "2026-09-30", searchVolume: 300 });
  expect(result.series.find((series) => series.period === "quarter")?.points[0]).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-09-30", searchVolume: 900 });
  expect(buildKeywordVolumeAnalytics(rows, { period: "day" }).series[0].points).toMatchObject([{ periodStart: "2026-09-30", periodEnd: "2026-09-30", searchVolume: 12 }]);
  expect(rows).toEqual(original);
});

test("filters keyword, ASIN, source, scope, and intact reporting intervals together", () => {
  const result = buildKeywordVolumeAnalytics([
    row(), row({ id: "other-keyword", keywordId: "santa-hat", keyword: "santa hat" }),
    row({ id: "other-asin", asin: "B0OTHER123", scope: "asin" }),
    row({ id: "other-source", source: "Provider B" }),
    row({ id: "monthly", period: "month", periodStart: "2026-10-01", periodEnd: "2026-10-31" }),
  ], { keywordIds: ["santa-costume"], asin: "B0CFPYYPRN", source: "Amazon SQP", scope: "market", period: "week", dateFrom: "2026-09-28", dateTo: "2026-10-04" });
  expect(result.series).toHaveLength(1);
  expect(result.series[0].points).toMatchObject([{ periodStart: "2026-09-28", periodEnd: "2026-10-04", searchVolume: 100 }]);
  expect(buildKeywordVolumeAnalytics([row()], { dateFrom: "2026-10-01", dateTo: "2026-10-04" }).series).toHaveLength(0);
});

test("deduplicates the market count repeated across ASIN views instead of summing", () => {
  const rows = [row(), row({ id: "volume-2", asin: "B0OTHER123" })];
  const all = buildKeywordVolumeAnalytics(rows);
  expect(all.series).toHaveLength(1);
  expect(all.series[0].points[0].searchVolume).toBe(100);
  expect(all.summary.observedPeriods).toBe(1);
  expect(buildKeywordVolumeAnalytics(rows, { asin: "B0OTHER123" }).series[0].points[0].searchVolume).toBe(100);
});

test("does not merge distinct keyword text when their old rank slugs collide", () => {
  const result = buildKeywordVolumeAnalytics([row({ keywordId: "a-b", keyword: "a+b", searchVolume: 10 }), row({ id: "other", keywordId: "a-b", keyword: "a b", searchVolume: 20 })]);
  expect(result.series).toHaveLength(2);
  expect(result.summary.keywords).toBe(2);
  expect(result.warnings).toEqual([]);
});

test("reports conflicting same-scope counts even when an ASIN filter selects one view", () => {
  const result = buildKeywordVolumeAnalytics([row(), row({ id: "volume-2", asin: "B0OTHER123", searchVolume: 150 })], { asin: "B0CFPYYPRN" });
  expect(result.series[0].points[0]).toMatchObject({ searchVolume: null, conflict: true });
  expect(result.warnings.join(" ")).toContain("冲突");
  expect(result.summary.observedPeriods).toBe(0);
});

test("keeps sources and ASIN-specific scopes separate rather than inventing a combined count", () => {
  const result = buildKeywordVolumeAnalytics([row(), row({ id: "provider", source: "Provider B", searchVolume: 70 }), row({ id: "asin", scope: "asin", searchVolume: 40 })]);
  expect(result.series).toHaveLength(3);
  expect(result.series.map((item) => item.points[0].searchVolume).toSorted()).toEqual([100, 40, 70]);
});

test("compares the immediately previous interval outside the selected date range", () => {
  const previous = row({ id: "previous", periodStart: "2026-09-21", periodEnd: "2026-09-27", searchVolume: 80 });
  const result = buildKeywordVolumeAnalytics([previous, row()], { dateFrom: "2026-09-28" });
  expect(result.series[0].points).toHaveLength(1);
  expect(result.series[0].points[0]).toMatchObject({ previousVolume: 80, changePercent: 0.25, changeStatus: "increase" });
});

test("observed zero, previous zero, and absent previous intervals stay distinct", () => {
  const previous = row({ id: "previous", periodStart: "2026-09-21", periodEnd: "2026-09-27", searchVolume: 0 });
  expect(buildKeywordVolumeAnalytics([previous, row()]).series[0].points.at(-1)).toMatchObject({ previousVolume: 0, changePercent: null, changeStatus: "previous-zero" });
  expect(buildKeywordVolumeAnalytics([previous, row({ searchVolume: 0 })]).series[0].points.at(-1)).toMatchObject({ searchVolume: 0, previousVolume: 0, changePercent: 0, changeStatus: "unchanged" });
  expect(buildKeywordVolumeAnalytics([row()]).series[0].points[0]).toMatchObject({ previousVolume: null, changePercent: null, changeStatus: "missing" });
});

test("does not skip missing previous periods or turn missing search volume into zero", () => {
  const old = row({ id: "old", periodStart: "2026-09-14", periodEnd: "2026-09-20", searchVolume: 50 });
  expect(buildKeywordVolumeAnalytics([old, row()]).series[0].points.at(-1)?.changeStatus).toBe("missing");
  const missing = buildKeywordVolumeAnalytics([row({ searchVolume: null })]);
  expect(missing.series[0].points[0].searchVolume).toBeNull();
  expect(missing.summary.missingPeriods).toBe(1);
});

test("preserves month and quarter counts as single intervals with calendar-aware comparisons", () => {
  const monthly = buildKeywordVolumeAnalytics([
    row({ id: "september", period: "month", periodStart: "2026-09-01", periodEnd: "2026-09-30", searchVolume: 200 }),
    row({ period: "month", periodStart: "2026-10-01", periodEnd: "2026-10-31", searchVolume: 300 }),
  ], { period: "month" });
  expect(monthly.series[0].points).toHaveLength(2);
  expect(monthly.series[0].points[1].changePercent).toBe(0.5);
  const quarterly = buildKeywordVolumeAnalytics([
    row({ id: "q2", period: "quarter", periodStart: "2026-04-01", periodEnd: "2026-06-30", searchVolume: 200 }),
    row({ period: "quarter", periodStart: "2026-07-01", periodEnd: "2026-09-30", searchVolume: 100 }),
  ]);
  expect(quarterly.series[0].points).toHaveLength(2);
  expect(quarterly.series[0].points[1].changePercent).toBe(-0.5);
});

test("rejects invalid persisted counts instead of charting negative or unsafe totals", () => {
  const result = buildKeywordVolumeAnalytics([row({ searchVolume: -1 })]);
  expect(result.series[0].points[0].searchVolume).toBeNull();
  expect(result.warnings.join(" ")).toContain("无效");
});

test("does not silently replace a stored same-period count with a conflicting upload", () => {
  const prepared = prepareKeywordVolumeImport([row()], [row({ searchVolume: 150 })]);
  expect(prepared.records).toHaveLength(0);
  expect(prepared.issues.join(" ")).toContain("冲突");
});

test("allows filling missing counts but never downgrades a known count to missing", () => {
  expect(prepareKeywordVolumeImport([row({ searchVolume: null })], [row()]).records[0].searchVolume).toBe(100);
  const prepared = prepareKeywordVolumeImport([row()], [row({ searchVolume: null })]);
  expect(prepared.records).toHaveLength(0);
  expect(prepared.issues.join(" ")).toContain("保留");
});
