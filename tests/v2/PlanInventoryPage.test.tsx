// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { PlanInventoryPage } from "../../src/components/PlanInventoryPage";
import { adaptLegacyWeeklyPlanRows } from "../../src/integration/legacy-plan-adapter";
import type { PlanModel } from "../../src/data/plan";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const plan = {
  seasonEndDate: "2026-12-20",
  sizeTotals: { L: 520, XL: 1600, "2XL": 550, "3XL": 330 },
  primaryMappings: [],
  sizeBySku: { "SKU-L": "L" },
  sizeByAsin: {},
  costAssumptions: {},
  targetThresholds: {},
  dailyPlanRows: [],
  weeklyPlanRows: [{ startDate: "2026-09-25", endDate: "2026-10-01", plannedUnits: 7 }],
  unavailable: [],
} satisfies PlanModel;

afterEach(async () => {
  cleanup();
  await resetOpsDbForTests();
});

describe("legacy weekly plan adapter", () => {
  test("moves Friday-Thursday source weeks to ISO Mondays, splits by size deterministically, and preserves every source week total", () => {
    const result = adaptLegacyWeeklyPlanRows([
      { startDate: "2026-09-25", plannedUnits: 7 },
      { startDate: "2026-10-02", plannedUnits: 21 },
    ], plan.sizeTotals);

    expect(result).toEqual([
      { weekStart: "2026-09-21", size: "L", units: 1 },
      { weekStart: "2026-09-21", size: "XL", units: 4 },
      { weekStart: "2026-09-21", size: "2XL", units: 1 },
      { weekStart: "2026-09-21", size: "3XL", units: 1 },
      { weekStart: "2026-09-28", size: "L", units: 4 },
      { weekStart: "2026-09-28", size: "XL", units: 11 },
      { weekStart: "2026-09-28", size: "2XL", units: 4 },
      { weekStart: "2026-09-28", size: "3XL", units: 2 },
    ]);
    expect(result.reduce((sum, row) => sum + row.units, 0)).toBe(28);
  });
});

describe("PlanInventoryPage", () => {
  test("initializes a plan from the legacy weekly source and exposes all four size risks without disguising missing inventory", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<PlanInventoryPage plan={plan} onBack={() => undefined} />);

    expect(await screen.findByRole("heading", { name: "计划与库存" })).toBeTruthy();
    expect(await screen.findByText("计划总量：7")).toBeTruthy();
    expect(await opsDb.getActivePlan()).toMatchObject({ totalUnits: 7 });
    expect(screen.getAllByText("数据不足").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole("row", { name: /^L 数据不足/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /^XL 数据不足/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /^2XL 数据不足/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /^3XL 数据不足/ })).toBeTruthy();
  });

  test("saves the inclusive 2900 boundary, blocks 2899, and retains the saved active plan after remount", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const rows = [
      { date: "2026-11-02", size: "L" as const, units: 1000 },
      { date: "2026-11-02", size: "XL" as const, units: 1000 },
      { date: "2026-11-02", size: "2XL" as const, units: 500 },
      { date: "2026-11-02", size: "3XL" as const, units: 400 },
    ];
    await opsDb.saveActivePlan(
      { id: "plan-2026", rows, totalUnits: 2900, updatedAt: "2026-08-17T00:00:00.000Z" },
      { id: "seed", changedAt: "2026-08-17T00:00:00.000Z", reason: "seed", beforeTotal: 0, afterTotal: 2900 },
    );
    const view = render(<PlanInventoryPage plan={plan} onBack={() => undefined} />);

    expect(await screen.findByText("计划总量：2900")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("调整原因"), { target: { value: "确认 2900 件计划" } });
    const save = screen.getByRole("button", { name: "保存计划" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(async () => expect((await opsDb.getActivePlan())?.totalUnits).toBe(2900));

    fireEvent.change(screen.getByLabelText("2026-11-02 L 计划销量"), { target: { value: "999" } });
    expect((screen.getByRole("button", { name: "保存计划" }) as HTMLButtonElement).disabled).toBe(true);

    view.unmount();
    render(<PlanInventoryPage plan={plan} onBack={() => undefined} />);
    expect(await screen.findByText("计划总量：2900")).toBeTruthy();
  });
});
