import type { MetricSnapshot } from "../domain/types";

export interface MetricsInput {
  plannedUnits: number;
  actualUnits?: number;
  targetPrice: number;
  sales?: number;
  productCost?: number;
  inboundCost?: number;
  fbaFees?: number;
  commission?: number;
  adSpend?: number;
  adSales?: number;
  discounts?: number;
  refundLoss?: number;
  fbaAvailable?: number;
  inbound?: number;
  reserved?: number;
  unfulfillable?: number;
  last7DayAverageUnits?: number;
  inSeasonInbound?: number;
  projectedRemainingSeasonSales?: number;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

/** Calculates dashboard metrics without rounding or mutating the supplied input. */
export function calculateMetrics(input: Readonly<MetricsInput>): MetricSnapshot {
  const plannedSales = input.plannedUnits * input.targetPrice;
  const actualUnits = input.actualUnits ?? null;
  const sales = input.sales ?? null;
  const financialParts = [sales, input.productCost, input.inboundCost, input.fbaFees, input.commission, input.adSpend, input.discounts, input.refundLoss];
  const grossProfit = financialParts.every((value): value is number => value !== null && value !== undefined)
    ? sales! - input.productCost! - input.inboundCost! - input.fbaFees! - input.commission! - input.adSpend! - input.discounts! - input.refundLoss!
    : null;
  const { fbaAvailable, inbound, reserved, unfulfillable } = input;
  const availableInventory = fbaAvailable === undefined || inbound === undefined || reserved === undefined || unfulfillable === undefined
    ? null
    : fbaAvailable + inbound - reserved - unfulfillable;
  const daysToStockout = availableInventory === null || input.last7DayAverageUnits === undefined || input.last7DayAverageUnits <= 0
    ? null
    : availableInventory / input.last7DayAverageUnits;
  const projectedEndingInventory = availableInventory === null ||
    input.inSeasonInbound === undefined ||
    input.projectedRemainingSeasonSales === undefined
    ? null
    : availableInventory + input.inSeasonInbound - input.projectedRemainingSeasonSales;
  const overstockDenominator = availableInventory === null || input.inSeasonInbound === undefined
    ? null
    : availableInventory + input.inSeasonInbound;

  return {
    plannedUnits: input.plannedUnits,
    actualUnits,
    unitVariance: actualUnits === null ? null : actualUnits - input.plannedUnits,
    completionRate: actualUnits === null ? null : ratio(actualUnits, input.plannedUnits),
    sales,
    plannedSales,
    salesVariance: sales === null ? null : sales - plannedSales,
    averagePrice: sales === null || actualUnits === null ? null : ratio(sales, actualUnits),
    grossProfit,
    grossMargin: grossProfit === null || sales === null ? null : ratio(grossProfit, sales),
    adSpend: input.adSpend ?? null,
    adSales: input.adSales ?? null,
    acos: input.adSpend === undefined || input.adSales === undefined ? null : ratio(input.adSpend, input.adSales),
    availableInventory,
    projectedEndingInventory,
    overstockRate: overstockDenominator === null || projectedEndingInventory === null
      ? null
      : ratio(projectedEndingInventory, overstockDenominator),
    daysToStockout,
    last7DayAverageUnits: input.last7DayAverageUnits ?? null,
  };
}
