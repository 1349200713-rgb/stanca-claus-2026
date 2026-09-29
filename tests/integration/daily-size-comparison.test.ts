import { describe, expect, test } from "vitest";
import type { PlanModel } from "../../src/data/plan";
import type { ActivePlan, DailyPlanRow } from "../../src/domain/planning";
import type { BusinessRecord, SizeCode } from "../../src/domain/types";
import { buildDailySizeComparison } from "../../src/integration/daily-size-comparison";

const date = "2026-10-02";
const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];
const plan: PlanModel = {
  seasonEndDate: "2026-12-20",
  sizeTotals: { L: 20, XL: 40, "2XL": 60, "3XL": 80 },
  primaryMappings: [], sizeByAsin: {}, sizeBySku: {}, costAssumptions: {},
  targetThresholds: { minimumWeightedPriceUsd: 50 },
  dailyPlanRows: [],
  weeklyPlanRows: [{ startDate: date, endDate: "2026-10-03", plannedUnits: 200, targetPriceUsd: 50 }],
  unavailable: [],
};

function saved(rows: DailyPlanRow[]): ActivePlan {
  return { id: "plan-2026", rows, totalUnits: rows.reduce((sum, row) => sum + row.units, 0), updatedAt: "2026-10-01T00:00:00Z" };
}

function record(size: SizeCode, units: number, day = date, key = `${day}-${size}`): BusinessRecord {
  return { key, date: day, asin: `ASIN-${size}`, sku: `SKU-${size}`, size, units, sales: units * 50 };
}

describe("daily size comparison", () => {
  test("aggregates each size on only the selected date and computes the total from units", () => {
    const result = buildDailySizeComparison({ date, plan,
      activePlan: saved(sizes.map((size, index) => ({ date, size, units: [10, 20, 0, 2][index] }))),
      business: [record("L", 5), record("L", 7, date, "L-second-sku"), record("XL", 18), record("2XL", 0), record("3XL", 1), record("L", 999, "2026-10-03")],
    });

    expect(result.rows).toEqual([
      { size: "L", plannedUnits: 10, actualUnits: 12, variance: 2, completionRate: 1.2, status: "complete" },
      { size: "XL", plannedUnits: 20, actualUnits: 18, variance: -2, completionRate: 0.9, status: "risk" },
      { size: "2XL", plannedUnits: 0, actualUnits: 0, variance: 0, completionRate: null, status: "complete" },
      { size: "3XL", plannedUnits: 2, actualUnits: 1, variance: -1, completionRate: 0.5, status: "risk" },
    ]);
    expect(result.total).toEqual({ size: "total", plannedUnits: 32, actualUnits: 31, variance: -1, completionRate: 31 / 32, status: "risk" });
    expect(result).toMatchObject({ observedSizeCount: 4, observedUnits: 31, planSource: "saved" });
  });

  test("keeps partial coverage out of the total and distinguishes an observed zero from missing data", () => {
    const result = buildDailySizeComparison({ date, plan, business: [record("L", 0), record("XL", 8), record("2XL", 100, "2026-10-03")] });

    expect(result.rows[0]).toEqual({ size: "L", plannedUnits: 10, actualUnits: 0, variance: -10, completionRate: 0, status: "risk" });
    expect(result.rows[2]).toEqual({ size: "2XL", plannedUnits: 30, actualUnits: null, variance: null, completionRate: null, status: "missing" });
    expect(result.total).toEqual({ size: "total", plannedUnits: 100, actualUnits: null, variance: null, completionRate: null, status: "missing" });
    expect(result).toMatchObject({ observedSizeCount: 2, observedUnits: 8 });
  });

  test("an empty saved plan remains authoritative and does not turn missing plans into zero", () => {
    const result = buildDailySizeComparison({ date, plan, activePlan: saved([]), business: sizes.map((size) => record(size, 1)) });

    expect(result.rows.every((row) => row.plannedUnits === null && row.variance === null && row.completionRate === null && row.status === "no-plan")).toBe(true);
    expect(result.total).toEqual({ size: "total", plannedUnits: null, actualUnits: 4, variance: null, completionRate: null, status: "no-plan" });
    expect(result.planSource).toBe("saved");
  });

  test("does not fill gaps in a saved plan from legacy plan weights", () => {
    const result = buildDailySizeComparison({ date, plan,
      activePlan: saved([{ date, size: "L", units: 7 }, { date: "2026-10-03", size: "XL", units: 90 }]),
      business: sizes.map((size) => record(size, 8)),
    });

    expect(result.rows[0]).toMatchObject({ plannedUnits: 7, actualUnits: 8, variance: 1, status: "complete" });
    expect(result.rows[1]).toMatchObject({ plannedUnits: null, actualUnits: 8, status: "no-plan" });
    expect(result.total).toMatchObject({ plannedUnits: null, actualUnits: 32, variance: null, completionRate: null, status: "no-plan" });
  });

  test("uses the cockpit's legacy weekly-weight fallback when there is no saved plan", () => {
    const result = buildDailySizeComparison({ date, plan, activePlan: null, business: sizes.map((size, index) => record(size, [10, 20, 30, 40][index])) });

    expect(result.rows.map((row) => row.plannedUnits)).toEqual([10, 20, 30, 40]);
    expect(result.total).toEqual({ size: "total", plannedUnits: 100, actualUnits: 100, variance: 0, completionRate: 1, status: "complete" });
    expect(result.planSource).toBe("derived");
  });

  test("zero plans are complete for observed zero or positive sales without dividing by zero", () => {
    const result = buildDailySizeComparison({ date, plan,
      activePlan: saved(sizes.map((size) => ({ date, size, units: 0 }))),
      business: sizes.map((size, index) => record(size, index === 0 ? 3 : 0)),
    });

    expect(result.rows.every((row) => row.status === "complete" && row.completionRate === null)).toBe(true);
    expect(result.total).toEqual({ size: "total", plannedUnits: 0, actualUnits: 3, variance: 3, completionRate: null, status: "complete" });
  });

  test("a day with neither actuals nor plans is missing, with no false zero totals", () => {
    const result = buildDailySizeComparison({ date: "2026-10-04", plan, business: [record("L", 8)] });

    expect(result.rows.map((row) => row.size)).toEqual(["L", "XL", "2XL", "3XL"]);
    expect(result.rows.every((row) => row.plannedUnits === null && row.actualUnits === null && row.status === "missing")).toBe(true);
    expect(result.total).toEqual({ size: "total", plannedUnits: null, actualUnits: null, variance: null, completionRate: null, status: "missing" });
    expect(result).toMatchObject({ observedSizeCount: 0, observedUnits: 0 });
  });
});
