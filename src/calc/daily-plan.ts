import type { SizeCode } from "../domain/types";
import type { DailyPlanRow } from "../domain/planning";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];
const minimumPlanTotal = 2900;
const maximumPlanTotal = 3100;

export interface WeeklyPlanRow {
  weekStart: string;
  size: SizeCode;
  units: number;
}

export interface PlanSummary {
  total: number;
  variance: number;
  sizeTotals: Record<SizeCode, number>;
  sizeShares: Record<SizeCode, number | null>;
}

export interface PlanValidation {
  valid: boolean;
  errors: string[];
}

function isSizeCode(value: unknown): value is SizeCode {
  return typeof value === "string" && sizes.includes(value as SizeCode);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateOffset(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zeroSizeRecord<T>(value: T): Record<SizeCode, T> {
  return { L: value, XL: value, "2XL": value, "3XL": value };
}

export function generateDailyPlan(weeklyRows: readonly WeeklyPlanRow[]): DailyPlanRow[] {
  return weeklyRows.flatMap((weeklyRow) => {
    if (!isIsoDate(weeklyRow.weekStart)) throw new Error("Weekly plan row must have an ISO weekStart date");
    if (new Date(`${weeklyRow.weekStart}T00:00:00.000Z`).getUTCDay() !== 1) {
      throw new Error("Weekly plan row weekStart must be a Monday");
    }
    if (!isSizeCode(weeklyRow.size)) throw new Error("Weekly plan row must have a supported size");
    if (!Number.isInteger(weeklyRow.units) || weeklyRow.units < 0) {
      throw new Error("Weekly plan row units must be a nonnegative integer");
    }

    const base = Math.floor(weeklyRow.units / 7);
    const remainder = weeklyRow.units % 7;
    return Array.from({ length: 7 }, (_, day) => ({
      date: dateOffset(weeklyRow.weekStart, day),
      size: weeklyRow.size,
      units: base + (day < remainder ? 1 : 0),
    }));
  });
}

export function summarizePlan(rows: readonly DailyPlanRow[]): PlanSummary {
  const sizeTotals = zeroSizeRecord(0);
  let total = 0;
  for (const row of rows) {
    total += row.units;
    if (isSizeCode(row.size)) sizeTotals[row.size] += row.units;
  }

  const sizeShares = zeroSizeRecord<number | null>(null);
  if (total !== 0) {
    for (const size of sizes) sizeShares[size] = sizeTotals[size] / total;
  }

  return { total, variance: total - 3000, sizeTotals, sizeShares };
}

export function validatePlan(rows: readonly DailyPlanRow[]): PlanValidation {
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row, index) => {
    if (!isIsoDate(row.date)) errors.push(`Row ${index + 1} must have an ISO date`);
    if (!isSizeCode(row.size)) errors.push(`Row ${index + 1} has an invalid size`);
    if (!Number.isInteger(row.units) || row.units < 0) {
      errors.push(`Row ${index + 1} units must be a nonnegative integer`);
    }

    const key = `${row.date}\u0000${row.size}`;
    if (seenKeys.has(key)) errors.push(`Row ${index + 1} duplicates a date and size`);
    seenKeys.add(key);
  });

  const { total } = summarizePlan(rows);
  if (total < minimumPlanTotal || total > maximumPlanTotal) {
    errors.push(`Plan total must be between ${minimumPlanTotal} and ${maximumPlanTotal}`);
  }

  return { valid: errors.length === 0, errors };
}
