import { describe, expect, test } from "vitest";
import { buildPlanInventorySummary } from "../../src/integration/plan-inventory";

const planRows = [
  { date: "2026-11-08", size: "L" as const, units: 7 },
  { date: "2026-11-08", size: "XL" as const, units: 14 },
  { date: "2026-11-08", size: "2XL" as const, units: 7 },
  { date: "2026-11-08", size: "3XL" as const, units: 7 },
];

const business = ["L", "XL", "2XL", "3XL"].flatMap((size) =>
  Array.from({ length: 7 }, (_, index) => ({
    key: `${size}-${index + 1}`,
    date: `2026-11-0${index + 1}`,
    asin: "",
    sku: size,
    size: size as "L" | "XL" | "2XL" | "3XL",
    units: 10,
    sales: 100,
  })),
);

describe("plan and inventory summary", () => {
  test("uses the latest snapshot, current inbound, seven-day business sales and plan remaining after the snapshot", () => {
    const summary = buildPlanInventorySummary({
      activePlan: { id: "plan-2026", rows: planRows, totalUnits: 35, updatedAt: "2026-11-01T00:00:00.000Z" },
      inventory: [
        { key: "old-xl", date: "2026-11-05", size: "XL", fbaAvailable: 999, reserved: 0, unfulfillable: 0, sourceImportKey: "old" },
        { key: "new-xl", date: "2026-11-07", size: "XL", fbaAvailable: 6, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
        { key: "l", date: "2026-11-07", size: "L", fbaAvailable: 7, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
        { key: "2xl", date: "2026-11-07", size: "2XL", fbaAvailable: 7, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
        { key: "3xl", date: "2026-11-07", size: "3XL", fbaAvailable: 7, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
      ],
      inbound: [
        { size: "XL", units: 3, expectedArrivalDate: "2026-11-09", updatedAt: "2026-11-06T00:00:00.000Z" },
        { size: "XL", units: 8, expectedArrivalDate: null, updatedAt: "2026-11-07T00:00:00.000Z" },
        { size: "L", units: 0, expectedArrivalDate: null, updatedAt: "2026-11-07T00:00:00.000Z" },
        { size: "2XL", units: 0, expectedArrivalDate: null, updatedAt: "2026-11-07T00:00:00.000Z" },
        { size: "3XL", units: 0, expectedArrivalDate: null, updatedAt: "2026-11-07T00:00:00.000Z" },
      ],
      business,
    });

    expect(summary.bySize.XL.inventorySnapshot?.key).toBe("new-xl");
    expect(summary.bySize.XL.inbound?.units).toBe(8);
    expect(summary.bySize.XL.remainingPlan).toBe(14);
    expect(summary.bySize.XL.risk.futureAvailableInventory).toBe(14);
    expect(summary.status).toBe("complete");
  });

  test("keeps every size visible and makes incomplete input neutral unless a size has red risk", () => {
    const summary = buildPlanInventorySummary({
      activePlan: { id: "plan-2026", rows: planRows, totalUnits: 35, updatedAt: "2026-11-01T00:00:00.000Z" },
      inventory: [
        { key: "xl", date: "2026-11-07", size: "XL", fbaAvailable: 20, reserved: 0, unfulfillable: 0, sourceImportKey: "x" },
      ],
      inbound: [{ size: "XL", units: 0, expectedArrivalDate: "2026-11-11", updatedAt: "2026-11-07T00:00:00.000Z" }],
      business,
    });

    expect(Object.keys(summary.bySize)).toEqual(["L", "XL", "2XL", "3XL"]);
    expect(summary.bySize.XL.risk.status).toBe("risk");
    expect(summary.status).toBe("risk");
    expect(summary.bySize.L.risk.status).toBe("insufficient");
  });

  test("makes a fully-known zero future inventory neutral and lets a yellow size retain aggregate precedence", () => {
    const zeroSnapshot = ["L", "XL", "2XL", "3XL"].map((size) => ({
      key: `zero-${size}`,
      date: "2026-11-07",
      size: size as "L" | "XL" | "2XL" | "3XL",
      fbaAvailable: 0,
      reserved: 0,
      unfulfillable: 0,
      sourceImportKey: "zero",
    }));
    const zeroInbound = ["L", "XL", "2XL", "3XL"].map((size) => ({
      size: size as "L" | "XL" | "2XL" | "3XL",
      units: 0,
      expectedArrivalDate: null,
      updatedAt: "2026-11-07T00:00:00.000Z",
    }));

    const insufficient = buildPlanInventorySummary({
      activePlan: { id: "plan-2026", rows: [], totalUnits: 0, updatedAt: "2026-11-01T00:00:00.000Z" },
      inventory: zeroSnapshot,
      inbound: zeroInbound,
      business,
    });

    expect(insufficient.bySize.XL.risk.overstockRate).toBeNull();
    expect(insufficient.bySize.XL.risk.status).toBe("insufficient");
    expect(insufficient.status).toBe("insufficient");

    const attention = buildPlanInventorySummary({
      activePlan: {
        id: "plan-2026",
        rows: [{ date: "2026-11-08", size: "L", units: 15 }],
        totalUnits: 15,
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
      inventory: [{ ...zeroSnapshot[0], fbaAvailable: 20 }, ...zeroSnapshot.slice(1)],
      inbound: zeroInbound,
      business,
    });

    expect(attention.bySize.L.risk.status).toBe("attention");
    expect(attention.bySize.XL.risk.status).toBe("insufficient");
    expect(attention.status).toBe("attention");
  });

  test("aggregates multiple FBA shipment lines by size for inventory risk", () => {
    const summary = buildPlanInventorySummary({
      activePlan: { id: "plan-2026", rows: planRows, totalUnits: 35, updatedAt: "2026-11-01T00:00:00.000Z" },
      inventory: [
        { key: "xl", date: "2026-11-07", size: "XL", fbaAvailable: 6, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
        { key: "l", date: "2026-11-07", size: "L", fbaAvailable: 7, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
        { key: "2xl", date: "2026-11-07", size: "2XL", fbaAvailable: 7, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
        { key: "3xl", date: "2026-11-07", size: "3XL", fbaAvailable: 7, reserved: 0, unfulfillable: 0, sourceImportKey: "new" },
      ],
      inbound: [
        { size: "XL", units: 15, expectedArrivalDate: "2026-10-05", updatedAt: "2026-09-10T00:00:00.000Z", fbaNumber: "FBA19MSY9TRD", sku: "A022-XXX-09-0B500", productName: "XL码 5JUN-RD 圣诞服9件套", shipDate: "2026-09-10" },
        { size: "XL", units: 40, expectedArrivalDate: "2026-10-20", updatedAt: "2026-09-10T00:00:00.000Z", fbaNumber: "FBA19NJ9VY3C", sku: "A022-XXX-09-0B500", productName: "XL码 5JUN-RD 圣诞服9件套", shipDate: "2026-09-10" },
        { size: "L", units: 0, expectedArrivalDate: null, updatedAt: "2026-11-07T00:00:00.000Z" },
        { size: "2XL", units: 0, expectedArrivalDate: null, updatedAt: "2026-11-07T00:00:00.000Z" },
        { size: "3XL", units: 0, expectedArrivalDate: null, updatedAt: "2026-11-07T00:00:00.000Z" },
      ],
      business,
    });

    expect(summary.bySize.XL.inbound?.units).toBe(55);
    expect(summary.bySize.XL.risk.futureAvailableInventory).toBe(61);
  });
});
