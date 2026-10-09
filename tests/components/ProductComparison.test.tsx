// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProductComparison } from "../../src/components/ProductComparison";
afterEach(cleanup);
test("shows daily 2025/2026/difference and analysis advice, then filters dates", () => {
  render(<ProductComparison records={[{ key: "a", scope: "parent", asin: "B012345678", date: "2026-10-01", units: 0, sales: 0, spend: 2.42, adSales: 65.99, adOrders: 1, clicks: 2, impressions: 382 }]} targetAcos={0.22} />);
  expect(screen.getByRole("table", { name: "2025与2026每日产品表现对比" }).textContent).toContain("分析建议");
  expect(screen.getByRole("table").textContent).toContain("未录入");
  expect(screen.getByRole("table").textContent).toContain("样本");
  fireEvent.change(screen.getByLabelText("同比开始日期"), { target: { value: "2026-10-02" } });
  fireEvent.change(screen.getByLabelText("同比结束日期"), { target: { value: "2026-10-02" } });
  expect(screen.getByRole("table").textContent).not.toContain("65.99");
});
test("daily, seven-day and fourteen-day presets align with the latest actual day and chart detail filters", () => {
  render(<ProductComparison records={[{ key: "a", scope: "parent", asin: "B012345678", date: "2026-10-07", units: 2, sales: 100, spend: 20, adSales: 80, adOrders: 2, clicks: 10, impressions: 1000 }]} targetAcos={0.22} />);
  fireEvent.click(screen.getByRole("button", { name: "最近7天" }));
  expect((screen.getByLabelText("同比开始日期") as HTMLInputElement).value).toBe("2026-10-01");
  fireEvent.click(screen.getByRole("button", { name: "最近14天" }));
  expect((screen.getByLabelText("同比开始日期") as HTMLInputElement).value).toBe("2026-09-24");
  fireEvent.click(screen.getByRole("button", { name: "日" }));
  expect((screen.getByLabelText("同比开始日期") as HTMLInputElement).value).toBe("2026-10-07");
  expect(screen.getByRole("img", { name: /广告效果/ })).toBeTruthy();
  expect(screen.getByRole("img", { name: /曝光点击/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("同比明细筛选"), { target: { value: "paired" } });
  expect(screen.getByText("当前明细筛选没有匹配日期。")).toBeTruthy();
});

test("daily selection remains one day and recent periods stay in the supported comparison year", () => {
  render(<ProductComparison records={[{ key: "a", scope: "parent", asin: "B012345678", date: "2026-01-03", spend: 2, adSales: 10, adOrders: 1 }]} targetAcos={0.22} />);
  fireEvent.click(screen.getByRole("button", { name: "最近14天" }));
  expect((screen.getByLabelText("同比开始日期") as HTMLInputElement).value).toBe("2026-01-01");
  fireEvent.click(screen.getByRole("button", { name: /^日$/ }));
  fireEvent.change(screen.getByLabelText("同比开始日期"), { target: { value: "2026-01-02" } });
  expect((screen.getByLabelText("同比结束日期") as HTMLInputElement).value).toBe("2026-01-02");
});

test("opens the available current-year grain when only ASIN detail was imported", () => {
  render(<ProductComparison records={[{ key: "a", scope: "asin", asin: "B012345678", date: "2026-10-01", spend: 2.42, adSales: 50, adOrders: 1 }]} targetAcos={0.22} />);
  expect((screen.getByLabelText("产品表现数据粒度") as HTMLSelectElement).value).toBe("asin");
  expect(screen.getByRole("table").textContent).toContain("$2.42");
});

test("recent presets follow a changed ASIN, and switching to custom keeps the displayed range", () => {
  render(<ProductComparison records={[
    { key: "a", scope: "parent", asin: "B012345678", date: "2026-10-07", spend: 2, adSales: 10, adOrders: 1 },
    { key: "b", scope: "parent", asin: "B112345678", date: "2026-10-01", spend: 3, adSales: 15, adOrders: 1 },
  ]} targetAcos={0.22} />);
  fireEvent.click(screen.getByRole("button", { name: "最近7天" }));
  fireEvent.change(screen.getByLabelText("2026对比ASIN"), { target: { value: "B112345678" } });
  expect((screen.getByLabelText("同比开始日期") as HTMLInputElement).value).toBe("2026-09-25");
  expect((screen.getByLabelText("同比结束日期") as HTMLInputElement).value).toBe("2026-10-01");
  fireEvent.click(screen.getByRole("button", { name: "自定义日期" }));
  expect((screen.getByLabelText("同比开始日期") as HTMLInputElement).value).toBe("2026-09-25");
  fireEvent.change(screen.getByLabelText("2026对比ASIN"), { target: { value: "B012345678" } });
  expect((screen.getByLabelText("同比结束日期") as HTMLInputElement).value).toBe("2026-10-01");
});

test("small percentage trends use a readable axis instead of a forced 100 percent scale", () => {
  render(<ProductComparison records={[{ key: "a", scope: "parent", asin: "B012345678", date: "2026-10-01", spend: 2.42, adSales: 50, adOrders: 1, clicks: 2, impressions: 382 }]} targetAcos={0.22} />);
  fireEvent.change(screen.getByLabelText("同比趋势指标"), { target: { value: "ctr" } });
  const chart = screen.getByRole("img", { name: /CTR每日同比趋势/ });
  expect(Number(chart.querySelector("circle")?.getAttribute("cy"))).toBeLessThan(100);
});
