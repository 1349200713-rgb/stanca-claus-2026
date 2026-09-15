import rawPlan from "./plan-2026.json";

export type SizeCode = "L" | "XL" | "2XL" | "3XL";

export interface PrimaryMapping {
  asin: string;
  sku: string;
  size: SizeCode;
  plannedUnits: number;
}

export interface PlanModel {
  seasonEndDate: string;
  sizeTotals: Record<SizeCode, number>;
  primaryMappings: PrimaryMapping[];
  sizeByAsin: Record<string, SizeCode>;
  sizeBySku: Record<string, SizeCode>;
  costAssumptions: Record<string, number>;
  targetThresholds: Record<string, string | number>;
  dailyPlanRows: unknown[];
  weeklyPlanRows: unknown[];
  unavailable: string[];
}

const requiredSizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

export function validatePlan(candidate: unknown): asserts candidate is { sizeTotals: Record<SizeCode, number> } {
  if (!candidate || typeof candidate !== "object" || !("sizeTotals" in candidate)) {
    throw new Error("Plan must include sizeTotals");
  }

  const sizeTotals = (candidate as { sizeTotals: unknown }).sizeTotals;
  if (!sizeTotals || typeof sizeTotals !== "object" || Array.isArray(sizeTotals)) {
    throw new Error("Plan sizeTotals must be an object");
  }

  const declaredSizeTotals = sizeTotals as Record<string, unknown>;
  for (const size of requiredSizes) {
    if (typeof declaredSizeTotals[size] !== "number") {
      throw new Error(`Plan is missing required size: ${size}`);
    }
  }

  const total = Object.entries(declaredSizeTotals).reduce((sum, [size, units]) => {
    if (typeof units !== "number" || !Number.isFinite(units)) {
      throw new Error(`Plan size total for ${size} must be a finite number`);
    }
    return sum + units;
  }, 0);
  if (total !== 3000) {
    throw new Error(`Plan size total must equal 3000; received ${total}`);
  }
}

export function loadPlan(): PlanModel {
  validatePlan(rawPlan);
  const primaryMappings = rawPlan.primaryMappings as PrimaryMapping[];

  return {
    ...rawPlan,
    sizeTotals: rawPlan.sizeTotals as Record<SizeCode, number>,
    primaryMappings,
    sizeByAsin: Object.fromEntries(primaryMappings.map((mapping) => [mapping.asin, mapping.size])),
    sizeBySku: Object.fromEntries(primaryMappings.map((mapping) => [mapping.sku, mapping.size])),
  };
}
