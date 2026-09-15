export type InventoryRiskStatus = "complete" | "attention" | "risk" | "insufficient";
export type OverstockStatus = Exclude<InventoryRiskStatus, "insufficient">;

export interface SalesByDate {
  date: string;
  units: number;
}

export interface InventoryRiskInput {
  salesByDate: readonly SalesByDate[];
  fbaAvailable: number | null;
  reserved: number | null;
  unfulfillable: number | null;
  inbound: number | null;
  arrivalDate: string | null;
  remainingPlan: number | null;
}

export interface InventoryRiskResult {
  status: InventoryRiskStatus;
  dataGaps: string[];
  explanation: string;
  salesWindow: SalesByDate[];
  last7DayAverageUnits: number | null;
  availableInventory: number | null;
  futureAvailableInventory: number | null;
  daysToStockout: number | null;
  expectedStockoutDate: string | null;
  projectedEndingInventory: number | null;
  overstockRate: number | null;
  overstockStatus: OverstockStatus | null;
  arrivalAfterStockout: boolean | null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function completeNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function latestSevenConsecutiveSales(rows: readonly SalesByDate[]): SalesByDate[] | null {
  const unitsByDate = new Map<string, number>();
  for (const row of rows) {
    if (!isIsoDate(row.date) || !Number.isFinite(row.units)) return null;
    unitsByDate.set(row.date, (unitsByDate.get(row.date) ?? 0) + row.units);
  }
  const dates = [...unitsByDate.keys()].sort();
  if (dates.length < 7) return null;
  const window = dates.slice(-7).map((date) => ({ date, units: unitsByDate.get(date)! }));
  if (window.some((row, index) => index > 0 && row.date !== addDays(window[index - 1].date, 1))) return null;
  return window;
}

/** Maps end-of-season positive inventory share to the dashboard's green/yellow/red state. */
export function statusForOverstock(rate: number): OverstockStatus {
  if (rate > 0.25) return "risk";
  if (rate > 0.15) return "attention";
  return "complete";
}

function highestStatus(...statuses: OverstockStatus[]): OverstockStatus {
  return statuses.includes("risk") ? "risk" : statuses.includes("attention") ? "attention" : "complete";
}

/**
 * Calculates one size's stockout, seasonal overstock, and arrival-delay risk.
 * Missing source values remain null and make a non-risk result explicitly insufficient.
 */
export function calculateInventoryRisk(input: Readonly<InventoryRiskInput>): InventoryRiskResult {
  const dataGaps: string[] = [];
  const salesWindow = latestSevenConsecutiveSales(input.salesByDate);
  if (!salesWindow) dataGaps.push("近 7 日连续销量");

  const inventoryKnown = completeNumber(input.fbaAvailable) && completeNumber(input.reserved) && completeNumber(input.unfulfillable);
  if (!completeNumber(input.fbaAvailable)) dataGaps.push("FBA 可售库存");
  if (!completeNumber(input.reserved)) dataGaps.push("预留库存");
  if (!completeNumber(input.unfulfillable)) dataGaps.push("不可售库存");
  if (!completeNumber(input.inbound)) dataGaps.push("在途数量");
  if (!completeNumber(input.remainingPlan)) dataGaps.push("剩余计划");
  if (input.arrivalDate !== null && !isIsoDate(input.arrivalDate)) dataGaps.push("预计到仓日期");

  const last7DayAverageUnits = salesWindow
    ? salesWindow.reduce((sum, row) => sum + row.units, 0) / 7
    : null;
  const availableInventory = inventoryKnown
    ? input.fbaAvailable - input.reserved - input.unfulfillable
    : null;
  const futureAvailableInventory = availableInventory !== null && completeNumber(input.inbound)
    ? availableInventory + input.inbound
    : null;
  if (futureAvailableInventory !== null && futureAvailableInventory <= 0) dataGaps.push("季末库存分母");
  const daysToStockout = availableInventory === null || last7DayAverageUnits === null || last7DayAverageUnits <= 0
    ? null
    : Math.max(0, availableInventory / last7DayAverageUnits);
  const expectedStockoutDate = daysToStockout === null || !salesWindow
    ? null
    : addDays(salesWindow.at(-1)!.date, Math.ceil(daysToStockout));
  const projectedEndingInventory = futureAvailableInventory === null || !completeNumber(input.remainingPlan)
    ? null
    : futureAvailableInventory - input.remainingPlan;
  const overstockRate = projectedEndingInventory === null || futureAvailableInventory === null || futureAvailableInventory <= 0
    ? null
    : Math.max(0, projectedEndingInventory) / futureAvailableInventory;
  const overstockStatus = overstockRate === null ? null : statusForOverstock(overstockRate);
  const arrivalAfterStockout = isIsoDate(input.arrivalDate) && expectedStockoutDate !== null
    ? input.arrivalDate > expectedStockoutDate
    : null;

  const riskStatus = highestStatus(
    overstockStatus ?? "complete",
    arrivalAfterStockout ? "risk" : "complete",
  );
  // The 7-day window is the explicit prerequisite for this dashboard's risk
  // judgement, including seasonal-overstock colour. Do not let an inventory
  // arithmetic result disguise missing daily sales.
  const status: InventoryRiskStatus = !salesWindow
    ? "insufficient"
    : riskStatus !== "complete"
      ? riskStatus
      : dataGaps.length > 0
        ? "insufficient"
        : "complete";
  const explanation = status === "risk"
    ? arrivalAfterStockout
      ? "预计到仓日晚于预计售罄日。"
      : "季末积压率超过 25%。"
    : status === "attention"
      ? "季末积压率超过 15% 且不超过 25%。"
      : status === "insufficient"
        ? `数据不足：${dataGaps.join("、")}。`
        : "库存与计划未触发积压或到仓延迟风险。";

  return {
    status,
    dataGaps,
    explanation,
    salesWindow: salesWindow ?? [],
    last7DayAverageUnits,
    availableInventory,
    futureAvailableInventory,
    daysToStockout,
    expectedStockoutDate,
    projectedEndingInventory,
    overstockRate,
    overstockStatus,
    arrivalAfterStockout,
  };
}
