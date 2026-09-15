import { calculateInventoryRisk, type InventoryRiskResult, type InventoryRiskStatus, type SalesByDate } from "../calc/inventory-risk";
import type { ActivePlan, InboundEntry, InventorySnapshot } from "../domain/planning";
import type { BusinessRecord, SizeCode } from "../domain/types";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

export interface PlanInventorySummaryInput {
  activePlan: ActivePlan | null | undefined;
  inventory: readonly InventorySnapshot[];
  inbound: readonly InboundEntry[];
  business: readonly BusinessRecord[];
}

export interface SizePlanInventorySummary {
  size: SizeCode;
  inventorySnapshot: InventorySnapshot | null;
  inbound: InboundEntry | null;
  salesByDate: SalesByDate[];
  remainingPlan: number | null;
  risk: InventoryRiskResult;
}

export interface PlanInventorySummary {
  status: InventoryRiskStatus;
  bySize: Record<SizeCode, SizePlanInventorySummary>;
  planUpdatedAt: string | null;
  latestInventoryDate: string | null;
}

function latest<T>(rows: readonly T[], dateFor: (row: T) => string): T | null {
  return rows.reduce<T | null>((current, row) => current === null || dateFor(row) > dateFor(current) ? row : current, null);
}

function businessSales(rows: readonly BusinessRecord[], size: SizeCode): SalesByDate[] {
  const unitsByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.size !== size) continue;
    unitsByDate.set(row.date, (unitsByDate.get(row.date) ?? 0) + row.units);
  }
  return [...unitsByDate.entries()]
    .map(([date, units]) => ({ date, units }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function aggregateStatus(statuses: readonly InventoryRiskStatus[]): InventoryRiskStatus {
  if (statuses.includes("risk")) return "risk";
  if (statuses.includes("attention")) return "attention";
  if (statuses.includes("insufficient")) return "insufficient";
  return "complete";
}

function aggregateInbound(rows: readonly InboundEntry[], size: SizeCode): InboundEntry | null {
  const matching = rows.filter((row) => row.size === size);
  if (!matching.length) return null;
  const shipmentLines = matching.filter((row) => row.sku || row.fbaNumber);
  if (!shipmentLines.length) return latest(matching, (row) => row.updatedAt);
  const units = shipmentLines.some((row) => row.units !== null)
    ? shipmentLines.reduce((sum, row) => sum + (row.units ?? 0), 0)
    : null;
  const latestRow = latest(shipmentLines, (row) => row.updatedAt) ?? shipmentLines[0];
  const arrivalDates = shipmentLines
    .map((row) => row.expectedArrivalDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  return {
    size,
    units,
    expectedArrivalDate: arrivalDates[0] ?? null,
    updatedAt: latestRow.updatedAt,
  };
}

/** Builds the single persisted-plan view used by both the dashboard summary and the plan/inventory page. */
export function buildPlanInventorySummary(input: Readonly<PlanInventorySummaryInput>): PlanInventorySummary {
  const latestInventoryDate = latest(input.inventory, (row) => row.date)?.date ?? null;
  const bySize = Object.fromEntries(sizes.map((size) => {
    const inventorySnapshot = latest(input.inventory.filter((row) => row.size === size), (row) => row.date);
    const currentInbound = aggregateInbound(input.inbound, size);
    const salesByDate = businessSales(input.business, size);
    const latestSalesDate = salesByDate.at(-1)?.date ?? null;
    const planCutoff = inventorySnapshot?.date ?? latestSalesDate;
    const remainingPlan = input.activePlan && planCutoff
      ? input.activePlan.rows
        .filter((row) => row.size === size && row.date > planCutoff)
        .reduce((sum, row) => sum + row.units, 0)
      : null;
    const risk = calculateInventoryRisk({
      salesByDate,
      fbaAvailable: inventorySnapshot?.fbaAvailable ?? null,
      reserved: inventorySnapshot?.reserved ?? null,
      unfulfillable: inventorySnapshot?.unfulfillable ?? null,
      inbound: currentInbound?.units ?? null,
      arrivalDate: currentInbound?.expectedArrivalDate ?? null,
      remainingPlan,
    });
    return [size, { size, inventorySnapshot, inbound: currentInbound, salesByDate, remainingPlan, risk } satisfies SizePlanInventorySummary];
  })) as Record<SizeCode, SizePlanInventorySummary>;

  return {
    status: aggregateStatus(sizes.map((size) => bySize[size].risk.status)),
    bySize,
    planUpdatedAt: input.activePlan?.updatedAt ?? null,
    latestInventoryDate,
  };
}
