import { describe, expect, it } from "vitest";
import { calculateMetrics } from "../../src/calc/metrics";
import { evaluateRisks } from "../../src/calc/risk";

const baseMetrics = calculateMetrics({
  plannedUnits: 100,
  actualUnits: 100,
  targetPrice: 50,
  sales: 5000,
  productCost: 1000,
  inboundCost: 200,
  fbaFees: 500,
  commission: 500,
  adSpend: 200,
  adSales: 1000,
  discounts: 0,
  refundLoss: 0,
  fbaAvailable: 100,
  inbound: 0,
  reserved: 0,
  unfulfillable: 0,
  last7DayAverageUnits: 10,
  inSeasonInbound: 0,
  projectedRemainingSeasonSales: 0,
});

describe("evaluateRisks", () => {
  it("marks completion below 90 percent as red", () => {
    const signals = evaluateRisks({ ...baseMetrics, completionRate: 0.89 }, {}, []);
    expect(signals).toContainEqual(expect.objectContaining({ id: "completion", status: "risk" }));
  });

  it.each([
    [0.16, "attention"],
    [0.26, "risk"],
  ] as const)("marks overstock of %s as %s", (overstockRate, status) => {
    const signals = evaluateRisks({ ...baseMetrics, overstockRate }, {}, []);
    expect(signals).toContainEqual(expect.objectContaining({ id: "overstock", status }));
  });

  it("marks ACOS above target and margin below target as red", () => {
    const signals = evaluateRisks(
      { ...baseMetrics, acos: 0.25, grossMargin: 0.2 },
      { targetAcos: 0.22, targetGrossMargin: 0.22 },
      [],
    );
    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "acos", status: "risk" }),
      expect.objectContaining({ id: "gross-margin", status: "risk" }),
    ]));
  });

  it("marks inventory that stocks out before season end as red", () => {
    const signals = evaluateRisks({ ...baseMetrics, daysToStockout: 5 }, { daysRemaining: 10 }, []);
    expect(signals).toContainEqual(expect.objectContaining({ id: "stockout", status: "risk" }));
  });

  it("flags stale inventory when recent sales are zero despite cumulative sales", () => {
    const metrics = calculateMetrics({
      plannedUnits: 100,
      actualUnits: 80,
      targetPrice: 50,
      sales: 4000,
      productCost: 0,
      inboundCost: 0,
      fbaFees: 0,
      commission: 0,
      adSpend: 0,
      adSales: 0,
      discounts: 0,
      refundLoss: 0,
      fbaAvailable: 100,
      inbound: 0,
      reserved: 0,
      unfulfillable: 0,
      last7DayAverageUnits: 0,
    });

    const signals = evaluateRisks(metrics, {}, []);

    expect(signals).toContainEqual(expect.objectContaining({ id: "stale-inventory", status: "attention" }));
  });

  it("adds a red anomaly after three deteriorating observations", () => {
    const signals = evaluateRisks(baseMetrics, {}, [0.8, 0.7, 0.6]);
    expect(signals).toContainEqual(expect.objectContaining({ id: "deterioration", status: "risk" }));
  });

  it("treats rising ACOS and falling completion or margin as deterioration", () => {
    expect(evaluateRisks(baseMetrics, {}, { values: [0.15, 0.18, 0.21], direction: "rising-is-worse" }))
      .toContainEqual(expect.objectContaining({ id: "deterioration", status: "risk" }));
    expect(evaluateRisks(baseMetrics, {}, { values: [0.95, 0.92, 0.88], direction: "falling-is-worse" }))
      .toContainEqual(expect.objectContaining({ id: "deterioration", status: "risk" }));
  });

  it("does not let aggregate completion hide a size-level risk", () => {
    const signals = evaluateRisks(baseMetrics, {}, [], {
      size: "XL",
      metrics: { ...baseMetrics, completionRate: 0.8 },
    });
    expect(signals).toContainEqual(expect.objectContaining({ id: "size-XL-completion", status: "risk" }));
  });
});
