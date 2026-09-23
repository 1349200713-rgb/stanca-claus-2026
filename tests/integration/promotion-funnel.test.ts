import { describe, expect, test } from "vitest";
import { buildPromotionAnalyticsRows } from "../../src/integration/promotion-analytics";
import type { AdRecord, BusinessRecord } from "../../src/domain/types";

describe("promotion funnel analytics", () => {
  test("derives traffic funnel ratios from observed numerators and denominators", () => {
    const business: BusinessRecord[] = [{
      key: "business:2026-10-02:sku-xl", date: "2026-10-02", sku: "SKU-XL", asin: "B0CFPR34MH", size: "XL",
      units: 6, sales: 600, sessions: 40, orders: 6,
    }];
    const ads: AdRecord[] = [{
      key: "ads:2026-10-02:launch", date: "2026-10-02", campaign: "Launch", asin: "B0CFPR34MH", sku: "SKU-XL",
      impressions: 1000, clicks: 50, spend: 100, adSales: 400, adOrders: 4,
    }];

    const row = buildPromotionAnalyticsRows({ ads, business, overrides: [], startDate: "2026-10-02", endDate: "2026-10-02" })[0];

    expect(row).toMatchObject({
      impressions: 1000, clicks: 50, sessions: 40, totalOrders: 6,
      ctr: 0.05, cpc: 2, cvr: 0.15, adCvr: 0.08, acos: 0.25,
      tacos: 1 / 6, organicOrders: 2,
    });
  });

  test("keeps missing funnel inputs unknown while preserving explicit zero", () => {
    const missing = buildPromotionAnalyticsRows({ ads: [], business: [], overrides: [], startDate: "2026-10-02", endDate: "2026-10-02" })[0];
    expect(missing).toMatchObject({ impressions: null, clicks: null, sessions: null, totalOrders: null, ctr: null, cpc: null, cvr: null, acos: null });

    const zero = buildPromotionAnalyticsRows({
      ads: [{ key: "ads:2026-10-02:zero", date: "2026-10-02", campaign: "Zero", impressions: 0, clicks: 0, spend: 0, adSales: 0, adOrders: 0 }],
      business: [{ key: "business:2026-10-02:zero", date: "2026-10-02", sku: "ZERO", asin: "", size: "L", units: 0, sales: 0, sessions: 0, orders: 0 }],
      overrides: [], startDate: "2026-10-02", endDate: "2026-10-02",
    })[0];
    expect(zero).toMatchObject({ ctr: 0, cpc: 0, cvr: 0, adCvr: 0, acos: 0, tacos: 0, organicOrders: 0 });
  });

  test("does not count future missing plans as operating anomalies", () => {
    const row = buildPromotionAnalyticsRows({ ads: [], business: [], overrides: [], startDate: "2026-10-02", endDate: "2026-10-02", asOfDate: "2026-10-01" })[0];
    expect(row.anomalies).toEqual([]);
  });
});
