import { describe, expect, test } from "vitest";
import { calculateFunnelMetrics } from "../../src/calc/funnel-metrics";

describe("calculateFunnelMetrics", () => {
  test("calculates traffic, advertising, and organic metrics from observed inputs", () => {
    expect(calculateFunnelMetrics({
      impressions: 1000,
      clicks: 50,
      sessions: 40,
      adOrders: 4,
      totalOrders: 6,
      spend: 100,
      adSales: 400,
      totalSales: 600,
    })).toMatchObject({
      ctr: 0.05,
      cpc: 2,
      cvr: 0.15,
      adCvr: 0.08,
      acos: 0.25,
      tacos: 1 / 6,
      organicOrders: 2,
      conflicts: [],
    });
  });

  test("distinguishes missing inputs from observed zero values", () => {
    expect(calculateFunnelMetrics({ impressions: null, clicks: 0, sessions: null, adOrders: 0, totalOrders: null, spend: 0, adSales: null, totalSales: null }).ctr).toBeNull();
    expect(calculateFunnelMetrics({ impressions: 0, clicks: 0, sessions: 0, adOrders: 0, totalOrders: 0, spend: 0, adSales: 0, totalSales: 0 }).ctr).toBe(0);
  });

  test("reports impossible organic order reconciliation instead of hiding it", () => {
    const result = calculateFunnelMetrics({ impressions: 100, clicks: 10, sessions: 10, adOrders: 5, totalOrders: 3, spend: 20, adSales: 30, totalSales: 50 });
    expect(result.organicOrders).toBe(-2);
    expect(result.conflicts).toContain("广告订单大于总订单");
  });
});

