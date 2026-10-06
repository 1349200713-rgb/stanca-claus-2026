// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { DailySizeComparison } from "../../src/components/DailySizeComparison";
import { loadPlan } from "../../src/data/plan";
import type { ActivePlan } from "../../src/domain/planning";
import type { BusinessRecord, SizeCode } from "../../src/domain/types";

afterEach(cleanup);
const plan = loadPlan();
const activePlan: ActivePlan = {
  id: "plan-2026", updatedAt: "2026-09-29T00:00:00Z", totalUnits: 100,
  rows: [
    { date: "2026-10-02", size: "L", units: 10 },
    { date: "2026-10-02", size: "XL", units: 20 },
    { date: "2026-10-02", size: "2XL", units: 10 },
    { date: "2026-10-02", size: "3XL", units: 10 },
    { date: "2026-10-03", size: "L", units: 10 },
    { date: "2026-10-03", size: "XL", units: 20 },
    { date: "2026-10-03", size: "2XL", units: 10 },
    { date: "2026-10-03", size: "3XL", units: 10 },
  ],
};
function business(date: string, size: SizeCode, units: number): BusinessRecord {
  return { key: `${date}:${size}`, date, size, units, asin: "", sku: size, sales: units * 50 };
}
function values(label: string) {
  const table = screen.getByRole("table", { name: "每日尺码销量对比" });
  const row = within(table).getByRole("rowheader", { name: label }).closest("tr")!;
  return within(row).getAllByRole("cell").map((cell) => cell.textContent);
}

test("defaults to the latest sales date after loading and keeps a manually selected date", () => {
  const props = { plan, activePlan, fallbackDate: "2026-09-29", onOpenPlan: () => undefined };
  const { rerender } = render(<DailySizeComparison {...props} business={[]} loaded={false} />);
  expect(screen.getByRole("status").textContent).toContain("加载");
  const reports = [business("2026-10-02", "L", 12), business("2026-10-03", "XL", 15)];
  rerender(<DailySizeComparison {...props} business={reports} loaded />);
  const date = screen.getByLabelText("对比日期") as HTMLInputElement;
  expect(date.value).toBe("2026-10-03");
  expect(values("XL")).toEqual(["20", "15", "-5", "75%", "未达标"]);
  expect(values("L")).toEqual(["10", "未导入", "—", "—", "未导入"]);
  expect(values("合计")).toEqual(["50", "数据不全", "—", "—", "数据不全"]);
  expect(screen.getByRole("status").textContent).toContain("已录入 1/4 个尺码，已录入销量 15 件");

  fireEvent.change(date, { target: { value: "2026-10-02" } });
  expect(values("L")).toEqual(["10", "12", "+2", "120%", "已达标"]);
  rerender(<DailySizeComparison {...props} business={[...reports, business("2026-10-04", "L", 1)]} loaded />);
  expect(date.value).toBe("2026-10-02");
  fireEvent.click(screen.getByRole("button", { name: "最近有数据日" }));
  expect(date.value).toBe("2026-10-04");
});

test("shows all four sizes and total, treating recorded zero as real sales", () => {
  render(<DailySizeComparison plan={plan} activePlan={activePlan} loaded fallbackDate="2026-09-29"
    business={[business("2026-10-02", "L", 12), business("2026-10-02", "XL", 20), business("2026-10-02", "2XL", 10), business("2026-10-02", "3XL", 0)]}
    onOpenPlan={() => undefined} />);
  expect(values("3XL")).toEqual(["10", "0", "-10", "0%", "未达标"]);
  expect(values("合计")).toEqual(["50", "42", "-8", "84%", "未达标"]);
  const table = screen.getByRole("table", { name: "每日尺码销量对比" });
  expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["L", "XL", "2XL", "3XL", "合计"]);
  expect(within(table).getByRole("rowheader", { name: "L" }).closest("tr")?.getAttribute("data-state")).toBe("complete");
  expect(within(table).getByRole("rowheader", { name: "3XL" }).closest("tr")?.getAttribute("data-state")).toBe("risk");
});

test("offers a review action for a below-plan size without creating an operation", () => {
  const drafts: unknown[] = [];
  render(<DailySizeComparison plan={plan} activePlan={activePlan} loaded fallbackDate="2026-09-29"
    business={[business("2026-10-02", "L", 8)]}
    onOpenPlan={() => undefined} onCreateOperation={(draft) => drafts.push(draft)} />);

  fireEvent.click(screen.getByRole("button", { name: "处理 L 异常" }));
  expect(drafts).toEqual([{
    date: "2026-10-02", size: "L", category: "其他", priority: "高",
    action: "排查 L 码销量落后计划的原因", risk: "L 码实际销量 8 件，较计划少 2 件（完成率 80%）",
    tomorrowPlan: "核查广告、价格、库存与关键词排名后制定调整动作",
  }]);
  expect(screen.getByRole("table", { name: "每日尺码销量对比" })).toBeTruthy();
});

test("makes the single-day actual and plan totals explicit without judging partial sales", () => {
  render(<DailySizeComparison plan={plan} activePlan={activePlan} loaded fallbackDate="2026-10-02"
    business={[business("2026-10-02", "L", 12)]} onOpenPlan={() => undefined} />);
  const summary = screen.getByRole("group", { name: "单日销量摘要" });
  expect(within(summary).getByText("实际销量").closest("div")?.textContent).toContain("数据不全");
  expect(within(summary).getByText("计划销量").closest("div")?.textContent).toContain("50 件");
  expect(summary.textContent).toContain("已录入 12 件");
  expect(summary.textContent).not.toContain("落后 38 件");
  expect(screen.getByText(/单日对比：2026-10-02/)).toBeTruthy();
});

test("explains how many units are behind plan when all sizes are recorded", () => {
  render(<DailySizeComparison plan={plan} activePlan={activePlan} loaded fallbackDate="2026-10-02"
    business={[business("2026-10-02", "L", 12), business("2026-10-02", "XL", 20), business("2026-10-02", "2XL", 10), business("2026-10-02", "3XL", 0)]}
    onOpenPlan={() => undefined} />);
  const summary = screen.getByRole("group", { name: "单日销量摘要" });
  expect(summary.textContent).toContain("42 件");
  expect(summary.textContent).toContain("50 件");
  expect(summary.textContent).toContain("落后 8 件");
  expect(summary.textContent).toContain("84%");
});
