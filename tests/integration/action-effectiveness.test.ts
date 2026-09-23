import { describe, expect, test } from "vitest";
import { compareActionWindows } from "../../src/integration/action-effectiveness";
import type { LinkedDay } from "../../src/integration/linked-dataset";

function day(date: string, units: number): LinkedDay {
  return { marketplace: "US", date, asin: "B0CFPYYPRN", sku: "SKU", size: "L", units, sales: units * 60, sessions: units * 5, totalOrders: units, impressions: units * 100, clicks: units * 10, adSpend: units * 5, adSales: units * 40, adOrders: units, plan: null, metrics: { ctr: 0.1, cpc: 0.5, cvr: 0.2, adCvr: 0.1, acos: 0.125, tacos: 1 / 12, organicOrders: 0, conflicts: [] } };
}

describe("action effectiveness", () => {
  test("compares three observed days before and after an action", () => {
    const rows = [day("2026-10-01", 1), day("2026-10-02", 2), day("2026-10-03", 3), day("2026-10-05", 4), day("2026-10-06", 5), day("2026-10-07", 6)];
    const result = compareActionWindows({ key: "op", date: "2026-10-04", action: "加预算", risk: "", tomorrowPlan: "", status: "已完成", updatedAt: "2026-10-04T00:00:00Z", asin: "B0CFPYYPRN" }, rows, "2026-10-07");
    expect(result.threeDay).toMatchObject({ status: "ready", before: { units: 2 }, after: { units: 5 }, change: { units: 3 } });
    expect(result.sevenDay.status).toBe("waiting");
  });

  test("does not count multiple size rows on one date as multiple observed days", () => {
    const sameDay = ["L", "XL", "2XL", "3XL"].map((size) => ({ ...day("2026-10-05", 4), size: size as LinkedDay["size"], sku: `SKU-${size}` }));
    const result = compareActionWindows({ key: "op", date: "2026-10-04", action: "调价", risk: "", tomorrowPlan: "", status: "已完成", updatedAt: "x", asin: "B0CFPYYPRN" }, [day("2026-10-01", 1), day("2026-10-02", 2), day("2026-10-03", 3), ...sameDay], "2026-10-05");
    expect(result.threeDay).toMatchObject({ status: "waiting", remainingDays: 2 });
  });
});
