import { describe, expect, test } from "vitest";
import { loadPlan, validatePlan } from "../../src/data/plan";

describe("2026 Santa plan", () => {
  test("loads the verified 3,000-unit size allocation", () => {
    const plan = loadPlan();

    expect(Object.values(plan.sizeTotals).reduce((total, units) => total + units, 0)).toBe(3000);
    expect(plan.sizeTotals).toEqual({ L: 520, XL: 1600, "2XL": 550, "3XL": 330 });
    expect(Object.keys(plan.sizeTotals).sort()).toEqual(["2XL", "3XL", "L", "XL"]);
  });

  test("resolves each primary purchase ASIN and SKU to its size", () => {
    const plan = loadPlan();

    expect(plan.primaryMappings).toHaveLength(4);
    expect(plan.sizeByAsin).toMatchObject({
      B0CFPWYPRN: "L",
      B0CFPR34MH: "XL",
      B0CFQ3TMBZ: "2XL",
      B0CFQ2D8FD: "3XL",
    });
    expect(plan.sizeBySku).toMatchObject({
      "A022-XXX-09-0C100": "L",
      "A022-XXX-09-0B500": "XL",
      "A022-XXX-09-0L100": "2XL",
      "A022-XXX-09-0I100": "3XL",
    });
  });

  test("rejects a malformed plan with an actionable validation message", () => {
    expect(() => validatePlan({ sizeTotals: { L: 520, XL: 1600, "2XL": 550 } })).toThrow(
      "Plan is missing required size: 3XL",
    );
  });

  test("rejects a declared size map whose full total exceeds 3,000 units", () => {
    expect(() =>
      validatePlan({ sizeTotals: { L: 520, XL: 1600, "2XL": 550, "3XL": 330, M: 1 } }),
    ).toThrow("Plan size total must equal 3000; received 3001");
  });

  test("rejects a non-object size map with a clear validation message", () => {
    expect(() => validatePlan({ sizeTotals: null })).toThrow("Plan sizeTotals must be an object");
  });
});
