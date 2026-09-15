// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { PlanInventoryPage } from "../../src/components/PlanInventoryPage";
import Dashboard from "../../app/page";
import type { PlanModel } from "../../src/data/plan";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const plan = {
  seasonEndDate: "2026-12-20", sizeTotals: { L: 520, XL: 1600, "2XL": 550, "3XL": 330 }, primaryMappings: [],
  sizeBySku: { "SKU-L": "L" }, sizeByAsin: {}, costAssumptions: {}, targetThresholds: {}, dailyPlanRows: [],
  weeklyPlanRows: [{ startDate: "2026-11-06", endDate: "2026-11-12", plannedUnits: 3000 }], unavailable: [],
} satisfies PlanModel;

function reportFile(name: string, csv: string): File {
  const file = new File([csv], name, { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(csv).buffer });
  return file;
}

afterEach(async () => {
  cleanup();
  await resetOpsDbForTests();
});

test("imports inventory, saves shipment inbound, and continues to show insufficient risk when the remaining sizes are unknown", async () => {
  configureOpsDbForTests(createMemoryIdbFactory());
  render(<PlanInventoryPage plan={plan} onBack={() => undefined} />);

  await screen.findByText("计划总量：3000");
  fireEvent.change(screen.getByLabelText("选择报告文件"), {
    target: { files: [reportFile("inventory.csv", "SKU,afn-fulfillable-quantity\nSKU-L,120")] },
  });
  await screen.findByText("报告类型: 库存");
  fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
  await waitFor(async () => expect(await opsDb.listInventorySnapshots()).toHaveLength(1));

  fireEvent.change(screen.getByLabelText("FBA单号"), { target: { value: "FBA-L" } });
  fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "SKU-L" } });
  fireEvent.change(screen.getByLabelText("品名"), { target: { value: "L码 5JUN-RD 圣诞服9件套" } });
  fireEvent.change(screen.getByLabelText("数量"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("到货时间"), { target: { value: "2026-11-15" } });
  fireEvent.click(screen.getByRole("button", { name: "保存发货明细" }));
  await waitFor(async () => expect((await opsDb.getInboundEntries())[0]).toMatchObject({ size: "L", units: 20, expectedArrivalDate: "2026-11-15" }));

  expect(screen.getAllByText("数据不足").length).toBeGreaterThanOrEqual(4);
  expect(screen.getByRole("row", { name: /^XL 数据不足/ })).toBeTruthy();
});

test("keeps the dashboard as the default view and returns to its unchanged four-chart cockpit after plan navigation", async () => {
  configureOpsDbForTests(createMemoryIdbFactory());
  render(<Dashboard />);

  expect(screen.getByRole("heading", { name: "计划销量 vs 实际销量" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "计划与库存" }));
  expect(await screen.findByRole("heading", { name: "计划与库存" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回经营驾驶舱" }));

  expect(await screen.findByRole("heading", { name: "计划销量 vs 实际销量" })).toBeTruthy();
  expect(screen.getAllByRole("img").filter((node) => node.getAttribute("data-chart-kind") === "line")).toHaveLength(4);
});
