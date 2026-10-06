import { describe, expect, test } from "vitest";
import type { AdRecord } from "../../src/domain/types";
import type { PrimaryMapping } from "../../src/data/plan";
import { buildAdvertisingAnalytics, defaultAdvertisingThresholds, advertisingDateRange } from "../../src/integration/advertising-analytics";

const mappings: PrimaryMapping[] = [
  { asin: "ASIN-A", sku: "SKU-A", size: "L", plannedUnits: 500 },
  { asin: "ASIN-B", sku: "SKU-B", size: "XL", plannedUnits: 500 },
];
const thresholds = defaultAdvertisingThresholds(0.22);
function row(overrides: Partial<AdRecord> = {}): AdRecord {
  return { key: "one", date: "2026-10-05", campaign: "Santa", asin: "ASIN-A", sku: "SKU-A", spend: 40, adSales: 100, adOrders: 2, clicks: 40, impressions: 4000, ...overrides };
}

describe("advertising analytics", () => {
  test("weights ratios from raw totals rather than averaging saved or row ratios", () => {
    // Averaging row ratios or trusting stored ratios must fail this fixture.
    const result = buildAdvertisingAnalytics([
      row({ spend: 10, adSales: 100, adOrders: 1, clicks: 10, impressions: 100, cpc: 999, acos: 999 }),
      row({ key: "two", date: "2026-10-04", spend: 90, adSales: 100, adOrders: 9, clicks: 90, impressions: 9000 }),
    ], mappings, {}, thresholds);
    expect(result.metrics).toMatchObject({ spend: 100, adSales: 200, adOrders: 10, clicks: 100, impressions: 9100, cpc: 1, cvr: 0.1, acos: 0.5, roas: 2 });
    expect(result.metrics.ctr).toBeCloseTo(100 / 9100);
  });

  test("partial traffic is a known subtotal with coverage and never a mixed-scope ratio", () => {
    const result = buildAdvertisingAnalytics([row(), row({ key: "two", date: "2026-10-04", clicks: undefined, impressions: undefined, spend: 100 })], mappings, {}, thresholds);
    expect(result.metrics).toMatchObject({ spend: 140, clicks: 40, impressions: 4000, cpc: null, ctr: null, cvr: null, acos: 0.7 });
    expect(result.coverage).toMatchObject({ records: 2, clicks: 1, impressions: 1, traffic: 1 });
    expect(result.dataIssues.some((issue) => issue.kind === "missing-data")).toBe(true);
  });

  test("zero sales keeps ACOS unknown and produces a separate wasted-spend explanation", () => {
    const result = buildAdvertisingAnalytics([row({ spend: 30, adSales: 0, adOrders: 0, clicks: 20, impressions: 1000 })], mappings, {}, thresholds);
    expect(result.metrics.acos).toBeNull();
    expect(result.metrics.roas).toBe(0);
    expect(result.anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ code: "wasted-spend", actual: "US$30.00 / 0 单 / US$0.00", severity: "risk", reason: expect.stringContaining("ACOS") })]));
    const zero = buildAdvertisingAnalytics([row({ spend: 0, adSales: 0, adOrders: 0, clicks: 0, impressions: 0 })], mappings, {}, thresholds);
    expect(zero.metrics).toMatchObject({ acos: null, roas: null, cpc: null, ctr: null, cvr: null });
    expect(zero.anomalies).toEqual([]);
  });

  test("date windows anchor to the latest actual record and never synthesize missing dates", () => {
    const records = [row({ date: "2026-10-05" }), row({ key: "two", date: "2026-09-20" })];
    expect(advertisingDateRange(records, "7")).toEqual({ startDate: "2026-09-29", endDate: "2026-10-05" });
    expect(advertisingDateRange(records, "all")).toEqual({ startDate: "2026-09-20", endDate: "2026-10-05" });
    expect(buildAdvertisingAnalytics(records, mappings, advertisingDateRange(records, "7"), thresholds).trends.map((day) => day.date)).toEqual(["2026-10-05"]);
  });

  test("the same date campaign product and adjustment filters govern totals trends and anomalies", () => {
    const records = [row({ adjusted: true }), row({ key: "two", date: "2026-10-04", spend: 80 }), row({ key: "three", campaign: "Other", asin: "ASIN-B", sku: "SKU-B", spend: 60 }), row({ key: "four", date: "2026-10-03", adjusted: false })];
    const result = buildAdvertisingAnalytics(records, mappings, { startDate: "2026-10-05", endDate: "2026-10-05", campaign: "Santa", sku: "SKU-A", adjusted: "yes" }, thresholds);
    expect(result.metrics.spend).toBe(40);
    expect(result.filteredRows.map((item) => item.record.key)).toEqual(["one"]);
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].spend).toBe(40);
    expect(result.anomalies.every((item) => item.recordKey === "one")).toBe(true);
  });

  test("summary plus product detail excludes the unresolved whole group without deleting history", () => {
    const records = [row({ key: "ads:2026-10-05:santa", asin: undefined, sku: undefined, spend: 100 }), row({ key: "detail", spend: 40 }), row({ key: "safe", date: "2026-10-04", spend: 10 })];
    const result = buildAdvertisingAnalytics(records, mappings, {}, thresholds);
    expect(result.metrics.spend).toBe(10);
    expect(result.excluded).toMatchObject({ count: 2, spend: 140 });
    expect(result.filteredRows).toHaveLength(3);
    expect(result.trends.find((item) => item.date === "2026-10-05")?.spend).toBeNull();
    expect(result.dataIssues.some((issue) => issue.kind === "overlap" && issue.reason.includes("汇总"))).toBe(true);
    // Filtering a product must not silently make its previously overlapping detail trustworthy.
    expect(buildAdvertisingAnalytics(records, mappings, { asin: "ASIN-A" }, thresholds).metrics.spend).toBe(10);
  });

  test("legacy summary keys remain ambiguous even after a manual product mapping was attached", () => {
    const result = buildAdvertisingAnalytics([row({ key: "ads:2026-10-05:santa" }), row({ key: "detail", asin: "ASIN-B", sku: "SKU-B" })], mappings, {}, thresholds);
    expect(result.metrics.spend).toBeNull();
    expect(result.excluded.count).toBe(2);
    expect(result.dataIssues.some((issue) => issue.reason.includes("旧汇总键"))).toBe(true);
  });

  test("ASIN-only and SKU-only duplicate mapped identities are not counted twice", () => {
    const result = buildAdvertisingAnalytics([row({ sku: undefined }), row({ key: "two", asin: undefined })], mappings, {}, thresholds);
    expect(result.metrics.spend).toBeNull();
    expect(result.excluded.count).toBe(2);
    expect(result.dataIssues.some((issue) => issue.kind === "duplicate")).toBe(true);
  });

  test("explicit mapping resolves one identifier but conflicting and unmapped products are disclosed", () => {
    const result = buildAdvertisingAnalytics([row({ sku: undefined }), row({ key: "two", date: "2026-10-04", sku: "SKU-B" }), row({ key: "three", date: "2026-10-03", asin: "OTHER", sku: undefined })], mappings, {}, thresholds);
    expect(result.filteredRows.find((item) => item.record.key === "one")?.mapping).toMatchObject({ asin: "ASIN-A", sku: "SKU-A", size: "L", status: "mapped" });
    expect(result.filteredRows.find((item) => item.record.key === "two")?.excluded).toBe(true);
    expect(result.filteredRows.find((item) => item.record.key === "three")?.mapping.status).toBe("unmapped");
    expect(result.dataIssues.some((issue) => issue.kind === "mapping-conflict")).toBe(true);
    expect(buildAdvertisingAnalytics([row({ asin: undefined, sku: undefined })], mappings, { asin: "ASIN-A" }, thresholds).filteredRows).toEqual([]);
  });

  test("small samples and missing clicks cannot masquerade as performance anomalies", () => {
    const result = buildAdvertisingAnalytics([row({ spend: 5, adSales: 1, adOrders: 0, clicks: 2, impressions: 100 })], mappings, {}, thresholds);
    expect(result.anomalies).toEqual([]);
    expect(result.dataIssues.some((issue) => issue.kind === "insufficient-sample")).toBe(true);
    const unknown = buildAdvertisingAnalytics([row({ spend: 30, adSales: 0, adOrders: 0, clicks: undefined })], mappings, {}, thresholds);
    expect(unknown.anomalies).toEqual([]);
    const relaxed = buildAdvertisingAnalytics([row({ spend: 5, adSales: 1, adOrders: 0, clicks: 2, impressions: 100 })], mappings, {}, { ...thresholds, minClicks: 2, acosMinSpend: 5, noOrdersSpend: 5 });
    expect(relaxed.anomalies.map((item) => item.code)).toContain("high-acos");
  });

  test("top-of-search share stays at record level without an invented aggregate denominator", () => {
    const result = buildAdvertisingAnalytics([row({ topOfSearchImpressionShare: 0.1 }), row({ key: "two", date: "2026-10-04", topOfSearchImpressionShare: 0.9 })], mappings, {}, thresholds);
    expect(result.metrics).not.toHaveProperty("topOfSearchImpressionShare");
    expect(result.filteredRows[0].record.topOfSearchImpressionShare).toBe(0.1);
  });
});
