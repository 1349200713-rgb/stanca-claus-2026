import { describe, expect, test } from "vitest";
import { calculateInventoryRisk, statusForOverstock } from "../../src/calc/inventory-risk";

const sevenDays = [
  { date: "2026-11-01", units: 10 },
  { date: "2026-11-02", units: 10 },
  { date: "2026-11-03", units: 10 },
  { date: "2026-11-04", units: 10 },
  { date: "2026-11-05", units: 10 },
  { date: "2026-11-06", units: 10 },
  { date: "2026-11-07", units: 10 },
];

describe("inventory risk", () => {
  test("marks a broken seven-day sales window insufficient instead of treating missing dates as zero", () => {
    const result = calculateInventoryRisk({
      salesByDate: [...sevenDays.slice(0, 6), { date: "2026-11-08", units: 10 }],
      fbaAvailable: 100,
      reserved: 0,
      unfulfillable: 0,
      inbound: 0,
      arrivalDate: null,
      remainingPlan: 80,
    });

    expect(result.status).toBe("insufficient");
    expect(result.last7DayAverageUnits).toBeNull();
    expect(result.dataGaps).toContain("近 7 日连续销量");
  });

  test("aggregates same-day sales but requires the latest seven dates to be consecutive", () => {
    const result = calculateInventoryRisk({
      salesByDate: [...sevenDays, { date: "2026-11-07", units: 4 }],
      fbaAvailable: 70,
      reserved: 0,
      unfulfillable: 0,
      inbound: 0,
      arrivalDate: null,
      remainingPlan: 70,
    });

    expect(result.status).toBe("complete");
    expect(result.last7DayAverageUnits).toBe(74 / 7);
    expect(result.availableInventory).toBe(70);
    expect(result.projectedEndingInventory).toBe(0);
  });

  test.each([
    [0.15, "complete"],
    [0.16, "attention"],
    [0.25, "attention"],
    [0.26, "risk"],
  ] as const)("maps overstock rate %s to %s", (rate, status) => {
    expect(statusForOverstock(rate)).toBe(status);
  });

  test("raises red risk when an arrival follows the known stockout date", () => {
    const result = calculateInventoryRisk({
      salesByDate: sevenDays,
      fbaAvailable: 20,
      reserved: 0,
      unfulfillable: 0,
      inbound: null,
      arrivalDate: "2026-11-11",
      remainingPlan: null,
    });

    expect(result.expectedStockoutDate).toBe("2026-11-09");
    expect(result.status).toBe("risk");
    expect(result.arrivalAfterStockout).toBe(true);
    expect(result.dataGaps).toEqual(expect.arrayContaining(["在途数量", "剩余计划"]));
  });

  test("keeps missing inventory components unknown rather than converting them to zero", () => {
    const result = calculateInventoryRisk({
      salesByDate: sevenDays,
      fbaAvailable: 100,
      reserved: null,
      unfulfillable: 0,
      inbound: 0,
      arrivalDate: null,
      remainingPlan: 50,
    });

    expect(result.status).toBe("insufficient");
    expect(result.availableInventory).toBeNull();
    expect(result.futureAvailableInventory).toBeNull();
    expect(result.overstockRate).toBeNull();
  });

  test("marks a zero future-inventory denominator insufficient instead of green", () => {
    const result = calculateInventoryRisk({
      salesByDate: sevenDays,
      fbaAvailable: 0,
      reserved: 0,
      unfulfillable: 0,
      inbound: 0,
      arrivalDate: null,
      remainingPlan: 0,
    });

    expect(result.futureAvailableInventory).toBe(0);
    expect(result.overstockRate).toBeNull();
    expect(result.status).toBe("insufficient");
  });

  test("keeps a known arrival-after-stockout red when the overstock denominator is zero", () => {
    const result = calculateInventoryRisk({
      salesByDate: sevenDays,
      fbaAvailable: 0,
      reserved: 0,
      unfulfillable: 0,
      inbound: 0,
      arrivalDate: "2026-11-08",
      remainingPlan: 0,
    });

    expect(result.overstockRate).toBeNull();
    expect(result.arrivalAfterStockout).toBe(true);
    expect(result.status).toBe("risk");
  });
});
