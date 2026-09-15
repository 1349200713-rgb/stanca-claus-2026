import { describe, expect, test } from "vitest";
import { generateDailyPlan, summarizePlan, validatePlan } from "../../src/calc/daily-plan";
import type { DailyPlanRow } from "../../src/domain/planning";

describe("daily plan calculations", () => {
  test.each([
    [2900, true],
    [3100, true],
    [2899, false],
    [3101, false],
  ])("accepts only totals within the save range: %i", (total, valid) => {
    expect(validatePlan([{ date: "2026-11-02", size: "XL", units: total }]).valid).toBe(valid);
  });

  test("rejects malformed daily rows and duplicate date-size keys", () => {
    const invalidRows: DailyPlanRow[] = [
      { date: "2026-02-30", size: "L", units: 2900 },
      { date: "2026-11-02", size: "XL", units: -1 },
      { date: "2026-11-02", size: "2XL", units: 1.5 },
      { date: "2026-11-02", size: "3XL", units: 0 },
      { date: "2026-11-02", size: "3XL", units: 0 },
    ];

    const result = validatePlan(invalidRows);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/date|nonnegative integer|duplicate/i);
    expect(validatePlan([{ date: "2026-11-02", size: "M" as "XL", units: 2900 }]).valid).toBe(false);
  });

  test("splits weekly totals into Monday-first integers without losing units", () => {
    const rows = generateDailyPlan([
      { weekStart: "2026-11-02", size: "L", units: 10 },
      { weekStart: "2026-11-02", size: "XL", units: 0 },
    ]);

    expect(rows).toEqual([
      { date: "2026-11-02", size: "L", units: 2 },
      { date: "2026-11-03", size: "L", units: 2 },
      { date: "2026-11-04", size: "L", units: 2 },
      { date: "2026-11-05", size: "L", units: 1 },
      { date: "2026-11-06", size: "L", units: 1 },
      { date: "2026-11-07", size: "L", units: 1 },
      { date: "2026-11-08", size: "L", units: 1 },
      { date: "2026-11-02", size: "XL", units: 0 },
      { date: "2026-11-03", size: "XL", units: 0 },
      { date: "2026-11-04", size: "XL", units: 0 },
      { date: "2026-11-05", size: "XL", units: 0 },
      { date: "2026-11-06", size: "XL", units: 0 },
      { date: "2026-11-07", size: "XL", units: 0 },
      { date: "2026-11-08", size: "XL", units: 0 },
    ]);
  });

  test("accepts Monday week starts and rejects non-Monday week starts", () => {
    expect(generateDailyPlan([{ weekStart: "2026-11-02", size: "L", units: 7 }])).toHaveLength(7);
    expect(() => generateDailyPlan([{ weekStart: "2026-11-06", size: "L", units: 7 }])).toThrow(/Monday/i);
    expect(() => generateDailyPlan([{ weekStart: "2026-02-30", size: "L", units: 7 }])).toThrow(/ISO/i);
  });

  test("summarizes total variance and each size share", () => {
    expect(
      summarizePlan([
        { date: "2026-11-02", size: "L", units: 1000 },
        { date: "2026-11-02", size: "XL", units: 2000 },
      ]),
    ).toEqual({
      total: 3000,
      variance: 0,
      sizeTotals: { L: 1000, XL: 2000, "2XL": 0, "3XL": 0 },
      sizeShares: { L: 1 / 3, XL: 2 / 3, "2XL": 0, "3XL": 0 },
    });
    expect(summarizePlan([]).sizeShares).toEqual({ L: null, XL: null, "2XL": null, "3XL": null });
  });
});
