import type { PlanModel } from "../data/plan";
import type { ActivePlan } from "../domain/planning";
import type { BusinessRecord, SizeCode } from "../domain/types";
import { deriveDailyPlan } from "./dashboard";

const SIZES: readonly SizeCode[] = ["L", "XL", "2XL", "3XL"];

export interface DailySizeComparisonRow {
  size: SizeCode | "total";
  plannedUnits: number | null;
  actualUnits: number | null;
  variance: number | null;
  completionRate: number | null;
  status: "complete" | "risk" | "missing" | "no-plan";
}

function comparisonRow(
  size: DailySizeComparisonRow["size"],
  plannedUnits: number | null,
  actualUnits: number | null,
): DailySizeComparisonRow {
  const variance = plannedUnits === null || actualUnits === null ? null : actualUnits - plannedUnits;
  const completionRate = plannedUnits === null || plannedUnits === 0 || actualUnits === null ? null : actualUnits / plannedUnits;
  const status = actualUnits === null ? "missing"
    : plannedUnits === null ? "no-plan"
    : actualUnits >= plannedUnits ? "complete" : "risk";
  return { size, plannedUnits, actualUnits, variance, completionRate, status };
}

export function buildDailySizeComparison(input: {
  date: string;
  plan: PlanModel;
  activePlan?: ActivePlan | null;
  business: readonly BusinessRecord[];
}): {
  rows: DailySizeComparisonRow[];
  total: DailySizeComparisonRow;
  observedSizeCount: number;
  observedUnits: number;
  planSource: "saved" | "derived";
} {
  const dailyPlan = deriveDailyPlan(input.plan, input.activePlan).filter((row) => row.date === input.date);
  const dailyBusiness = input.business.filter((row) => row.date === input.date);
  const rows = SIZES.map((size) => {
    const planned = dailyPlan.filter((row) => row.size === size);
    const actual = dailyBusiness.filter((row) => row.size === size);
    return comparisonRow(
      size,
      planned.length ? planned.reduce((sum, row) => sum + row.plannedUnits, 0) : null,
      actual.length ? actual.reduce((sum, row) => sum + row.units, 0) : null,
    );
  });
  const observedSizeCount = rows.filter((row) => row.actualUnits !== null).length;
  const observedUnits = rows.reduce((sum, row) => sum + (row.actualUnits ?? 0), 0);
  // A partial import is not a complete day's total or a missed sales target.
  const totalActual = observedSizeCount === SIZES.length ? observedUnits : null;
  const totalPlan = rows.every((row) => row.plannedUnits !== null)
    ? rows.reduce((sum, row) => sum + row.plannedUnits!, 0) : null;
  return {
    rows,
    total: comparisonRow("total", totalPlan, totalActual),
    observedSizeCount,
    observedUnits,
    planSource: input.activePlan ? "saved" : "derived",
  };
}
