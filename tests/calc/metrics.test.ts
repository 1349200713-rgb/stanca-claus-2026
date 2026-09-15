import { describe, expect, it } from "vitest";
import { calculateMetrics } from "../../src/calc/metrics";

describe("calculateMetrics", () => {
  it("keeps profit and margin incomplete when any required financial input is absent", () => {
    const metrics = calculateMetrics({
      plannedUnits: 10,
      actualUnits: 10,
      targetPrice: 60,
      sales: 600,
      productCost: 100,
      inboundCost: 20,
      fbaFees: 80,
      commission: 100,
      adSpend: 30,
      adSales: 150,
      refundLoss: 0,
    });

    expect(metrics.grossProfit).toBeNull();
    expect(metrics.grossMargin).toBeNull();
  });

  it("keeps business and ad metrics incomplete when their source input is absent", () => {
    const metrics = calculateMetrics({ plannedUnits: 10, targetPrice: 60 });

    expect(metrics.actualUnits).toBeNull();
    expect(metrics.sales).toBeNull();
    expect(metrics.averagePrice).toBeNull();
    expect(metrics.adSpend).toBeNull();
    expect(metrics.acos).toBeNull();
  });
  it("derives operating metrics from the supplied financial inputs", () => {
    const metrics = calculateMetrics({
      plannedUnits: 100,
      actualUnits: 80,
      targetPrice: 50,
      sales: 3440,
      productCost: 1200,
      inboundCost: 200,
      fbaFees: 640,
      commission: 516,
      adSpend: 300,
      adSales: 1000,
      discounts: 0,
      refundLoss: 100,
    });

    expect(metrics.completionRate).toBe(0.8);
    expect(metrics.unitVariance).toBe(-20);
    expect(metrics.plannedSales).toBe(5000);
    expect(metrics.salesVariance).toBe(-1560);
    expect(metrics.averagePrice).toBe(43);
    expect(metrics.acos).toBe(0.3);
    expect(metrics.grossProfit).toBe(484);
    expect(metrics.grossMargin).toBe(484 / 3440);
  });

  it("keeps ratios unknown when their denominator is zero", () => {
    const metrics = calculateMetrics({
      plannedUnits: 0,
      actualUnits: 0,
      targetPrice: 50,
      sales: 0,
      productCost: 0,
      inboundCost: 0,
      fbaFees: 0,
      commission: 0,
      adSpend: 100,
      adSales: 0,
      discounts: 0,
      refundLoss: 0,
    });

    expect(metrics.completionRate).toBeNull();
    expect(metrics.averagePrice).toBeNull();
    expect(metrics.grossMargin).toBeNull();
    expect(metrics.acos).toBeNull();
  });

  it("calculates inventory, stockout horizon, and remaining-season inventory", () => {
    const metrics = calculateMetrics({
      plannedUnits: 100,
      actualUnits: 80,
      targetPrice: 50,
      sales: 3440,
      productCost: 0,
      inboundCost: 0,
      fbaFees: 0,
      commission: 0,
      adSpend: 0,
      adSales: 0,
      discounts: 0,
      refundLoss: 0,
      fbaAvailable: 100,
      inbound: 20,
      reserved: 10,
      unfulfillable: 5,
      last7DayAverageUnits: 15,
      inSeasonInbound: 50,
      projectedRemainingSeasonSales: 120,
    });

    expect(metrics.availableInventory).toBe(105);
    expect(metrics.daysToStockout).toBe(7);
    expect(metrics.projectedEndingInventory).toBe(35);
    expect(metrics.overstockRate).toBe(35 / 155);
  });

  it("does not mutate its input object", () => {
    const input = {
      plannedUnits: 100,
      actualUnits: 80,
      targetPrice: 50,
      sales: 3440,
      productCost: 1200,
      inboundCost: 200,
      fbaFees: 640,
      commission: 516,
      adSpend: 300,
      adSales: 1000,
      discounts: 0,
      refundLoss: 100,
      fbaAvailable: 100,
      inbound: 20,
      reserved: 10,
      unfulfillable: 5,
    };
    const before = structuredClone(input);

    calculateMetrics(input);

    expect(input).toEqual(before);
  });
});
