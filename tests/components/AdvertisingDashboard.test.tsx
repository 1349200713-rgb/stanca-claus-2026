// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AdvertisingDashboard } from "../../src/components/AdvertisingDashboard";
import type { AdRecord } from "../../src/domain/types";

afterEach(cleanup);
const records: AdRecord[] = [
  { key: "risk", date: "2026-10-05", campaign: "Waste", spend: 30, adSales: 0, adOrders: 0, clicks: 25, impressions: 2000, topOfSearchImpressionShare: 0.123, adjusted: true },
  { key: "normal", date: "2026-10-04", campaign: "Healthy", spend: 10, adSales: 100, adOrders: 5, clicks: 20, impressions: 2000, adjusted: false },
];
function dashboard(rows = records, overrides: Partial<Parameters<typeof AdvertisingDashboard>[0]> = {}) {
  return render(<AdvertisingDashboard records={rows} mappings={[]} loaded targetAcos={0.22} onBack={() => undefined} {...overrides} />);
}

test("shows date activity actual threshold severity and actionable reason for anomalies", () => {
  dashboard();
  const table = screen.getByRole("table", { name: "广告异常清单" });
  expect(table.textContent).toContain("2026-10-05");
  expect(table.textContent).toContain("Waste");
  expect(table.textContent).toContain("US$30.00 / 0 单 / US$0.00");
  expect(table.textContent).toContain("US$20.00");
  expect(table.textContent).toContain("ACOS");
  expect(table.textContent).toContain("检查");
  expect(table.textContent).toContain("高");
  const detail = screen.getByRole("table", { name: "广告记录明细" });
  expect(detail.textContent).toContain("12.30%");
  expect(detail.textContent).toContain("调整记录");
  expect(detail.textContent).toContain("ROAS");
  expect(detail.textContent).toContain("广告转化率");
});

test("only-anomalies narrows the record list and does not redefine KPI totals", () => {
  dashboard();
  expect(screen.getByLabelText("总成本指标").textContent).toContain("US$40.00");
  fireEvent.click(screen.getByRole("checkbox", { name: "只看异常记录" }));
  const table = screen.getByRole("table", { name: "广告记录明细" });
  expect(table.textContent).toContain("Waste");
  expect(table.textContent).not.toContain("Healthy");
  expect(screen.getByLabelText("总成本指标").textContent).toContain("US$40.00");
  expect(screen.getByRole("table", { name: "广告每日趋势数据" }).textContent).toContain("2026-10-04");
});

test("global campaign and custom-date filters update all sections together", () => {
  dashboard();
  fireEvent.change(screen.getByLabelText("广告活动筛选"), { target: { value: "Healthy" } });
  expect(screen.getByLabelText("总成本指标").textContent).toContain("US$10.00");
  expect(screen.getByRole("table", { name: "广告记录明细" }).textContent).not.toContain("Waste");
  expect(screen.getByRole("table", { name: "广告每日趋势数据" }).textContent).not.toContain("2026-10-05");
  expect(screen.getByText("当前筛选下没有表现异常。" )).toBeTruthy();
  fireEvent.change(screen.getByLabelText("广告日期范围"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("广告开始日期"), { target: { value: "2026-10-05" } });
  fireEvent.change(screen.getByLabelText("广告结束日期"), { target: { value: "2026-10-05" } });
  expect(screen.getByText("当前筛选下没有广告记录。" )).toBeTruthy();
});

test("partial traffic displays coverage and unknown ratios rather than a false CPC", () => {
  dashboard([{ ...records[0], clicks: undefined }, records[1]]);
  expect(screen.getByLabelText("CPC指标").textContent).toContain("未知");
  expect(screen.getByLabelText("点击量指标").textContent).toContain("1/2");
  expect(screen.getByText(/部分记录缺少流量/)).toBeTruthy();
});

test("editable thresholds re-evaluate performance without changing spend totals", () => {
  dashboard();
  fireEvent.change(screen.getByLabelText("无订单花费阈值（USD）"), { target: { value: "100" } });
  expect(screen.getByRole("table", { name: "广告异常清单" }).textContent).not.toContain("无销售花费");
  expect(screen.getByLabelText("总成本指标").textContent).toContain("US$40.00");
});

test("loading error and genuinely empty datasets are distinct", () => {
  const view = dashboard([], { loaded: false });
  expect(screen.getByRole("status").textContent).toContain("正在加载广告数据");
  view.rerender(<AdvertisingDashboard records={[]} mappings={[]} loaded error="读取失败" targetAcos={0.22} onBack={() => undefined} />);
  expect(screen.getByRole("alert").textContent).toContain("读取失败");
  expect(screen.queryByText("暂无广告数据。请先手动录入或导入广告报告。")).toBeNull();
  view.rerender(<AdvertisingDashboard records={[]} mappings={[]} loaded targetAcos={0.22} onBack={() => undefined} />);
  expect(screen.getByText("暂无广告数据。请先手动录入或导入广告报告。")).toBeTruthy();
});

test("entry controls open the requested forms and supplied forms are rendered inside main", () => {
  let manual = false;
  let imported = false;
  dashboard([], { onOpenManual: () => { manual = true; }, onOpenImport: () => { imported = true; }, children: <section aria-label="广告录入表单">Entry</section> });
  fireEvent.click(screen.getByRole("button", { name: "手动录入广告" }));
  fireEvent.click(screen.getByRole("button", { name: "导入广告报告" }));
  expect(manual).toBe(true);
  expect(imported).toBe(true);
  expect(within(screen.getByRole("main")).getByRole("region", { name: "广告录入表单" })).toBeTruthy();
});

test("offers a left-side manual edit button for each original ad record", () => {
  let selected: AdRecord | undefined;
  dashboard(records, { onEditRecord: (row) => { selected = row; } });
  const detail = screen.getByRole("table", { name: "广告记录明细" });
  const button = within(detail).getByRole("button", { name: "手动修改广告 Waste 2026-10-05" });
  expect(button.closest("td")).toBe(button.closest("tr")?.firstElementChild);
  fireEvent.click(button);
  expect(selected).toBe(records[0]);
  expect(screen.getByLabelText("总成本指标").textContent).toContain("US$40.00");
});
