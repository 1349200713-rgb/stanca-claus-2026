// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import Dashboard from "../../app/page";
import { ActionList } from "../../src/components/ActionList";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

afterEach(async () => {
  cleanup();
  await resetOpsDbForTests();
});

describe("Santa Ops dashboard", () => {
  test("renders the approved sections and five KPI labels in order", () => {
    render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "计划销量 vs 实际销量" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "库存与积压风险" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "销售额 / 均价走势" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "毛利润 / 毛利率" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "广告花费 / ACOS" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "今日异常与动作" })).toBeTruthy();

    const kpis = within(screen.getByRole("region", { name: "核心指标" }))
      .getAllByTestId("kpi-label")
      .map((label) => label.textContent);
    expect(kpis).toEqual([
      "销量完成率",
      "销售额",
      "均价",
      "毛利润 / 毛利率",
      "广告花费 / ACOS",
    ]);
  });

  test("keeps all four approved analysis sections as accessible line charts", () => {
    render(<Dashboard />);

    for (const name of [
      "计划销量 vs 实际销量折线图",
      "销售额 / 均价走势折线图",
      "毛利润 / 毛利率折线图",
      "广告花费 / ACOS折线图",
    ]) {
      expect(screen.getByRole("img", { name }).getAttribute("data-chart-kind")).toBe("line");
    }
  });

  test("renders legends in normal flow without Recharts' absolute overlay", () => {
    const { container } = render(<Dashboard />);
    const planPanel = screen.getByRole("heading", { name: "计划销量 vs 实际销量" }).closest("section")!;
    const legend = within(planPanel).getByRole("list", { name: "销量图例" });
    expect(within(legend).getByText("实际销量")).toBeTruthy();
    expect(within(legend).getByText("计划销量")).toBeTruthy();
    expect(container.querySelector(".recharts-legend-wrapper")).toBeNull();
  });

  test("uses attention labels for unavailable first-run KPI data", () => {
    const { container } = render(<Dashboard />);

    expect(container.querySelectorAll(".kpi-grid .status-attention")).toHaveLength(5);
    expect(container.querySelector(".kpi-grid .status-complete")).toBeNull();
    expect(container.querySelector(".kpi-grid .status-risk")).toBeNull();
  });

  test("does not present historical demo values as current results", () => {
    render(<Dashboard />);
    const kpiRegion = screen.getByRole("region", { name: "核心指标" });
    expect(within(kpiRegion).getAllByText("—")).toHaveLength(5);
    expect(screen.queryByText("实际 726 / 计划 780")).toBeNull();
  });

  test("does not render starter loading content", () => {
    render(<Dashboard />);

    expect(screen.queryByText("Your site is taking shape")).toBeNull();
    expect(screen.queryByText("Building your site…")).toBeNull();
  });

  test("shows ASIN inbound summary on the operating cockpit", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.saveInboundEntry({
      size: "XL",
      units: 15,
      expectedArrivalDate: "2026-10-05",
      updatedAt: "2026-09-10T08:00:00.000Z",
      fbaNumber: "FBA19MSY9TRD",
      unitPrice: "13.3/KG",
      asin: "B0CFPR34MH",
      sku: "A022-XXX-09-0B500",
      productName: "XL码 5JUN-RD 圣诞服9件套",
      shipDate: "2026-09-10",
    });
    await opsDb.saveInboundEntry({
      size: "XL",
      units: 40,
      expectedArrivalDate: "2026-10-20",
      updatedAt: "2026-09-10T08:00:00.000Z",
      fbaNumber: "FBA19NJ9VY3C",
      unitPrice: "13.6/KG",
      asin: "B0CFPR34MH",
      sku: "A022-XXX-09-0B500",
      productName: "XL码 5JUN-RD 圣诞服9件套",
      shipDate: "2026-09-10",
    });

    render(<Dashboard />);
    const table = await screen.findByRole("table", { name: "ASIN在途汇总" });

    await waitFor(() => expect(within(table).getByRole("row", { name: /B0CFPR34MH A022-XXX-09-0B500 XL码 5JUN-RD 圣诞服9件套 55 2026-10-05/ })).toBeTruthy());
  });

  test("opens a daily promotion cockpit that combines ad metrics and promotion plan fields", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("ads", [{
      key: "ads:2026-11-20:xl",
      date: "2026-11-20",
      campaign: "XL santa costume exact",
      spend: 60,
      adSales: 300,
      adOrders: 5,
      clicks: 120,
      impressions: 6000,
    }]);

    const { container } = render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "广告推广" }));

    expect(await screen.findByRole("heading", { name: "推广作战看板" })).toBeTruthy();
    expect(screen.getByText(/2026-10-02 至 2026-12-20/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "每日推广作战表" });
    expect(table.textContent).toContain("2026-10-02");
    expect(table.textContent).toContain("2026-12-20");
    expect(container.textContent).toContain("CPC");
    expect(container.textContent).toContain("CTR");
    expect(container.textContent).toContain("CVR");
    expect(container.textContent).toContain("站外推广出单");
    expect(container.textContent).toContain("服务商");
    expect(container.textContent).toContain("测评单号");
    expect(container.textContent).toContain("测评数量");
    expect(screen.getByText("当日动作")).toBeTruthy();
    expect(table.textContent).toContain("2026-11-20");
    expect(table.textContent).toContain("主利润期");
    expect(table.textContent).toContain("US$60");
    expect(table.textContent).toContain("US$300");
    expect(table.textContent).toContain("US$0.50");
    expect(table.textContent).toContain("黑五网一");
    expect(table.textContent).toContain("视情况而定");
  });

  test("opens promotion review charts from the promotion cockpit", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", [{ key: "business:2026-10-02:xl", date: "2026-10-02", sku: "A022", asin: "", size: "XL", units: 1, sales: 58, refunds: 0 }]);
    await opsDb.insert("ads", [{ key: "ads:2026-10-02:xl", date: "2026-10-02", campaign: "XL", spend: 30, adSales: 58, adOrders: 1, clicks: 10, impressions: 1000 }]);

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "广告推广" }));
    fireEvent.click(await screen.findByRole("button", { name: "进入推广复盘图表" }));

    expect(await screen.findByRole("heading", { name: "推广复盘图表" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "计划销量 vs 实际销量折线图" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "异常提醒清单" })).toBeTruthy();
  });

  test("opens promotion review and daily operations directly from the home cockpit", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "推广复盘图表" }));
    expect(await screen.findByRole("heading", { name: "推广复盘图表" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回推广作战看板" }));
    fireEvent.click(await screen.findByRole("button", { name: "返回经营驾驶舱" }));
    fireEvent.click(await screen.findByRole("button", { name: "每日操作" }));

    expect(await screen.findByRole("heading", { name: "每日操作记录" })).toBeTruthy();
  });

  test("opens daily operations page and saves action risk and tomorrow plan", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "广告推广" }));
    fireEvent.click(await screen.findByRole("button", { name: "每日操作" }));

    expect(await screen.findByRole("heading", { name: "每日操作记录" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText("动作"), { target: { value: "提高核心词预算" } });
    fireEvent.change(screen.getByLabelText("风险"), { target: { value: "ACOS偏高" } });
    fireEvent.change(screen.getByLabelText("明日计划"), { target: { value: "复查转化率" } });
    fireEvent.click(screen.getByRole("button", { name: "保存每日操作" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("每日操作已保存"));
    expect(await opsDb.listDailyOperations()).toMatchObject([{ date: "2026-10-02", action: "提高核心词预算", risk: "ACOS偏高", tomorrowPlan: "复查转化率" }]);
    expect(screen.getByRole("table", { name: "每日操作记录表" }).textContent).toContain("提高核心词预算");
  });

  test("renders an unfinished manual action as red risk rather than yellow attention", () => {
    const { container } = render(<ActionList items={[{
      id: "pending",
      issue: "Pending inventory check",
      suggestedAction: "Count stock",
      completed: false,
    }]} />);

    expect(container.querySelectorAll(".status-risk")).toHaveLength(2);
    expect(container.querySelector(".status-attention")).toBeNull();
  });
});
