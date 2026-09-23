import { describe, expect, test } from "vitest";
import { buildLinkedDataset } from "../../src/integration/linked-dataset";

describe("buildLinkedDataset", () => {
  test("links records only when date and normalized product dimensions match", () => {
    const result = buildLinkedDataset({
      business: [{ key: "b", date: "2026-10-02", marketplace: "US", asin: "b0cfpyyprn", sku: "a022-xxx-09-0b500", size: "L", units: 3, sales: 180, sessions: 20, orders: 3 }],
      ads: [{ key: "a", date: "2026-10-02", marketplace: "US", asin: "B0CFPYYPRN", campaign: "Core", spend: 30, adSales: 120, adOrders: 2, impressions: 1000, clicks: 40 }],
      traffic: [],
      promotion: [],
    });

    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({ date: "2026-10-02", asin: "B0CFPYYPRN", sku: "A022-XXX-09-0B500", units: 3, adSpend: 30 });
    expect(result.unmappedAds).toEqual([]);
  });

  test("keeps ads without an ASIN separate instead of assigning them to every product", () => {
    const result = buildLinkedDataset({
      business: [{ key: "b", date: "2026-10-02", asin: "B0CFPYYPRN", sku: "SKU-1", size: "L", units: 3, sales: 180 }],
      ads: [{ key: "a", date: "2026-10-02", campaign: "Unknown", spend: 30, adSales: 120, adOrders: 2 }],
      traffic: [],
      promotion: [],
    });

    expect(result.days[0].adSpend).toBeNull();
    expect(result.unmappedAds).toHaveLength(1);
  });
});
