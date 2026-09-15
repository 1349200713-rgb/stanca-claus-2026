import { generateDailyPlan, type WeeklyPlanRow } from "../calc/daily-plan";
import type { ActivePlan, DailyPlanRow } from "../domain/planning";
import type { SizeCode } from "../domain/types";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

export interface LegacyWeeklyPlanRow {
  startDate: string;
  plannedUnits: number;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function mondayFor(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Uses a fixed size order for largest-remainder rounding so the same source always produces the same four allocations. */
function allocateBySize(total: number, sizeTotals: Readonly<Record<SizeCode, number>>): Record<SizeCode, number> {
  const denominator = sizes.reduce((sum, size) => sum + sizeTotals[size], 0);
  if (!Number.isInteger(total) || total < 0) throw new Error("Legacy weekly plannedUnits must be a nonnegative integer");
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error("Legacy size totals must have a positive total");
  if (sizes.some((size) => !Number.isFinite(sizeTotals[size]) || sizeTotals[size] < 0)) {
    throw new Error("Legacy size totals must be nonnegative finite numbers");
  }

  const allocations = sizes.map((size, index) => {
    const exact = total * sizeTotals[size] / denominator;
    return { size, index, units: Math.floor(exact), remainder: exact % 1 };
  });
  let remaining = total - allocations.reduce((sum, allocation) => sum + allocation.units, 0);
  allocations.toSorted((left, right) => right.remainder - left.remainder || left.index - right.index)
    .slice(0, remaining)
    .forEach((allocation) => { allocation.units += 1; remaining -= 1; });
  if (remaining !== 0) throw new Error("Unable to allocate legacy weekly plan");
  return Object.fromEntries(allocations.map(({ size, units }) => [size, units])) as Record<SizeCode, number>;
}

/**
 * Adapts the V1 Friday-Thursday, size-free weekly source into the Monday-based
 * per-size input required by the V2 daily-plan generator. It deliberately
 * preserves each source week's unit total; only the calendar label and size
 * distribution are normalized.
 */
export function adaptLegacyWeeklyPlanRows(
  legacyRows: readonly LegacyWeeklyPlanRow[],
  sizeTotals: Readonly<Record<SizeCode, number>>,
): WeeklyPlanRow[] {
  return legacyRows.flatMap((row) => {
    if (!isIsoDate(row.startDate)) throw new Error("Legacy weekly plan row must have a valid startDate");
    const allocated = allocateBySize(row.plannedUnits, sizeTotals);
    const weekStart = mondayFor(row.startDate);
    return sizes.map((size) => ({ weekStart, size, units: allocated[size] }));
  });
}

export function createInitialActivePlan(
  legacyRows: readonly LegacyWeeklyPlanRow[],
  sizeTotals: Readonly<Record<SizeCode, number>>,
  updatedAt: string,
): ActivePlan {
  const rows: DailyPlanRow[] = generateDailyPlan(adaptLegacyWeeklyPlanRows(legacyRows, sizeTotals));
  return {
    id: "plan-2026",
    rows,
    totalUnits: rows.reduce((sum, row) => sum + row.units, 0),
    updatedAt,
  };
}
