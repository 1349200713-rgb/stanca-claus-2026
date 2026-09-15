// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { TrendChart } from "../../src/components/TrendChart";

afterEach(cleanup);

test("renders labeled promotion, Deal, and price-change event markers", () => {
  render(
    <TrendChart
      title="销售额 / 均价走势"
      rows={[
        { date: "11/24", sales: 1200, price: 62.9 },
        { date: "11/25", sales: 1320, price: 61.9 },
        { date: "11/26", sales: 1280, price: null },
      ]}
      series={[
        { key: "sales", label: "销售额", color: "#9f1d28", axis: "currency" },
        { key: "price", label: "均价", color: "#526277", axis: "currency" },
      ]}
      eventMarkers={[
        { date: "11/24", label: "促销" },
        { date: "11/25", label: "Deal" },
        { date: "11/26", label: "调价" },
      ]}
    />,
  );

  const chart = within(screen.getByRole("img", { name: "销售额 / 均价走势折线图" }));
  expect(chart.getByText("促销")).toBeTruthy();
  expect(chart.getByText("Deal")).toBeTruthy();
  expect(chart.getByText("调价")).toBeTruthy();
});

test("assigns currency totals and unit price to separate left and right axes", () => {
  render(
    <TrendChart
      title="销售额 / 均价走势"
      rows={[
        { date: "11/25", sales: 7182, price: 63 },
        { date: "11/26", sales: 6098, price: 62.9 },
      ]}
      series={[
        { key: "sales", label: "销售额", color: "#9f1d28", axis: "currency" },
        { key: "price", label: "均价", color: "#526277", axis: "price" },
      ]}
    />,
  );

  const chart = screen.getByRole("img", { name: "销售额 / 均价走势折线图" });
  expect(chart.getAttribute("data-axis-count")).toBe("2");
  expect(screen.getByText(/销售额使用左轴；均价使用右轴/)).toBeTruthy();
});

test("provides series names and latest non-null values in the accessible summary", () => {
  render(
    <TrendChart
      title="毛利润 / 毛利率"
      rows={[
        { date: "11/25", profit: 2184, margin: 0.304 },
        { date: "11/26", profit: 1741, margin: null },
      ]}
      series={[
        { key: "profit", label: "毛利润", color: "#9f1d28", axis: "currency" },
        { key: "margin", label: "毛利率", color: "#b1822f", axis: "percentage" },
      ]}
    />,
  );

  expect(screen.getByText(/毛利润最新值 US\$1,741/)).toBeTruthy();
  expect(screen.getByText(/毛利率最新值 30.4%/)).toBeTruthy();
});
