import { expect, test } from "vitest";
import { buildProductComparison, productAdvice } from "../../src/integration/product-performance-analytics";
const row = (date: string, extra = {}) => ({ key: date, scope: "parent" as const, asin: "B012345678", date, units: 2, sales: 100, spend: 20, adSales: 80, adOrders: 2, clicks: 10, impressions: 1000, ...extra });
test("aligns month/day, keeps missing days unknown and weights ratios rather than averaging", () => {
  const data = buildProductComparison([row("2025-10-01"), row("2026-10-01", { spend: 10 }), row("2026-10-02", { spend: 30, adSales: 20 })], { startDate: "2026-10-01", endDate: "2026-10-03", currentAsin: "B012345678", previousAsin: "B012345678", scope: "parent" });
  expect(data.days).toHaveLength(3);
  expect(data.days[0].current?.acos).toBe(0.125);
  expect(data.days[1].previous).toBeNull();
  expect(data.days[2].current).toBeNull();
  expect(data.current.acos).toBe(0.4);
  expect(data.previous.spend).toBe(20);
  expect(data.pairedDays).toBe(1);
  expect(data.comparableCurrent.spend).toBe(10);
});
test("zero denominators and partially missing traffic never produce false ratios", () => {
  const data = buildProductComparison([row("2026-10-01", { sales: 0, adSales: 0, clicks: undefined }), row("2026-10-02")], { startDate: "2026-10-01", endDate: "2026-10-02", currentAsin: "B012345678", previousAsin: "", scope: "parent" });
  expect(data.days[0].current?.tacos).toBeNull();
  expect(data.current.cpc).toBeNull();
  expect(data.current.cvr).toBeNull();
});
test("advice distinguishes small samples, loss and attribution differences without inferring natural orders", () => {
  const data = buildProductComparison([row("2026-10-01", { units: 0, sales: 0, grossProfit: -3.16, spend: 2.42, adSales: 65.99, adOrders: 1, clicks: 2 })], { startDate: "2026-10-01", endDate: "2026-10-01", currentAsin: "B012345678", previousAsin: "", scope: "parent" });
  const advice = productAdvice(data.days[0], 0.22);
  expect(advice.join(" ")).toMatch(/样本|观察/);
  expect(advice.join(" ")).toContain("归因");
  expect(advice.join(" ")).toContain("亏损");
  expect(advice.join(" ")).not.toContain("立即加预算");
});

test("rejects an invalid range end instead of rolling into the next month", () => {
  const data = buildProductComparison([row("2026-02-28")], { startDate: "2026-02-28", endDate: "2026-02-30", currentAsin: "B012345678", previousAsin: "", scope: "parent" });
  expect(data.days).toHaveLength(0);
});
