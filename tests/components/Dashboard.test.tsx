// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import Dashboard from "../../app/page";
import { ActionList } from "../../src/components/ActionList";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  await resetOpsDbForTests();
});

describe("Santa Ops dashboard", () => {
  test("editing a dashboard ad preserves one record and refreshes KPI totals and anomalies", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const original = { key: "ads:edit-original", date: "2026-10-04", campaign: "Waste", spend: 30, adSales: 0, adOrders: 0, clicks: 25, impressions: 2000 };
    await opsDb.insert("ads", [original]);
    history.replaceState(null, "", "/?page=advertising-dashboard");
    render(<Dashboard />);
    const edit = await screen.findByRole("button", { name: "手动修改广告 Waste 2026-10-04" });
    fireEvent.click(edit);
    await screen.findByRole("heading", { name: "手动修改广告数据" });
    fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    expect(screen.queryByRole("heading", { name: "手动修改广告数据" })).toBeNull();
    expect(await opsDb.list("ads")).toEqual([original]);
    fireEvent.click(screen.getByRole("button", { name: "手动修改广告 Waste 2026-10-04" }));
    fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("广告销售额（USD）"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("广告订单（单）"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
    await waitFor(() => expect(screen.getByLabelText("总成本指标").textContent).toContain("US$1.00"));
    expect(screen.getByText("当前筛选下没有表现异常。")).toBeTruthy();
    expect(await opsDb.list("ads")).toMatchObject([{ key: original.key, spend: 1, adSales: 100, adOrders: 5 }]);
    expect(await opsDb.list("ads")).toHaveLength(1);
  });

  test("opens the standalone advertising dashboard with import and manual entry from navigation", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("ads", [{ key: "ads:latest", date: "2026-10-04", campaign: "Latest campaign", spend: 20, adSales: 0, adOrders: 0, clicks: 25, impressions: 2000 }]);
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "广告数据看板" }));
    expect(await screen.findByRole("heading", { name: "广告数据看板", level: 1 })).toBeTruthy();
    const adDetails = await screen.findByRole("table", { name: "广告记录明细" });
    expect(within(adDetails).getByRole("rowheader", { name: "Latest campaign" })).toBeTruthy();
    expect(new URLSearchParams(location.search).get("page")).toBe("advertising-dashboard");
    fireEvent.click(screen.getByRole("button", { name: "手动录入广告" }));
    expect(await screen.findByRole("heading", { name: "手动录入广告数据" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "导入广告报告" }));
    expect((await screen.findByLabelText("报告类型" ) as HTMLSelectElement).value).toBe("ads");
  });

  test("restores the advertising dashboard from its direct URL", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    history.replaceState(null, "", "/?page=advertising-dashboard");
    render(<Dashboard />);
    expect(await screen.findByRole("heading", { name: "广告数据看板", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "计划销量 vs 实际销量" })).toBeNull();
  });

  test("does not mistake a failed advertising read for an empty advertising database", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const list = opsDb.list.bind(opsDb);
    vi.spyOn(opsDb, "list").mockImplementation((table) => table === "ads" ? Promise.reject(new Error("广告接口离线")) : list(table));
    history.replaceState(null, "", "/?page=advertising-dashboard");
    render(<Dashboard />);
    await screen.findByText(/广告接口离线/);
    expect(screen.queryByText(/尚未导入广告/)).toBeNull();
  });

  test("shows the saved plan source and exact KPI day separately from the chart interval", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    history.replaceState(null, "", "/?startDate=2026-10-02&endDate=2026-10-03&size=XL");
    await opsDb.insert("activePlan", [{ key: "active-plan", id: "plan-2026", totalUnits: 50, updatedAt: "2026-10-05T00:00:00Z", rows: [
      { date: "2026-10-02", size: "XL", units: 20 }, { date: "2026-10-03", size: "XL", units: 30 },
    ] }]);
    await opsDb.insert("business", [{ key: "xl-day", date: "2026-10-02", sku: "XL", asin: "", size: "XL", units: 15, sales: 750 }]);
    render(<Dashboard />);
    const summary = await screen.findByRole("group", { name: "趋势销量摘要" });
    await waitFor(() => expect(summary.textContent).toContain("15 件"));
    expect(summary.textContent).toContain("20 件");
    expect(summary.textContent).toContain("落后 5 件");
    expect(screen.getByText(/图表区间：2026-10-02 至 2026-10-03 · XL/)).toBeTruthy();
    expect(screen.getByText(/摘要口径：2026-10-02 单日/)).toBeTruthy();
    const chart = screen.getByRole("heading", { name: "计划销量 vs 实际销量" }).closest("section")!;
    expect(chart.textContent).toContain("已保存日度计划");
    expect(chart.textContent).not.toContain("按权威尺码总量比例缩放");
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("销量完成率").closest("article")?.textContent).toContain("2026-10-02");
    fireEvent.click(screen.getByRole("radio", { name: "累计" }));
    await waitFor(() => expect(summary.textContent).toContain("数据不全"));
    expect(summary.textContent).not.toContain("落后 35 件");
  });

  test("manual advertising refreshes the advertising KPI and saves campaign-level metrics", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "手动录入广告" }));
    await screen.findByRole("heading", { name: "手动录入广告数据" });
    fireEvent.change(screen.getByLabelText("广告日期"), { target: { value: "2026-10-04" } });
    fireEvent.change(screen.getByLabelText("广告活动名称"), { target: { value: "XL santa costume exact" } });
    fireEvent.change(screen.getByLabelText("广告ASIN（选填）"), { target: { value: "B0CFPR34MH" } });
    fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("广告销售额（USD）"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("广告订单（单）"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("点击量（选填）"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("展示量（选填）"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
    await screen.findByText(/广告数据已保存/);
    expect(await opsDb.list("ads")).toMatchObject([{ date: "2026-10-04", campaign: "XL santa costume exact", asin: "B0CFPR34MH", sku: "A022-XXX-09-0B500", spend: 20, adSales: 100, adOrders: 2, clicks: 10, impressions: 1000, cpc: 2, ctr: 0.01, cvr: 0.2 }]);
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("US$20 · 20.0%")).toBeTruthy();
    const salesKpi = within(screen.getByRole("region", { name: "核心指标" })).getByText("销量完成率").closest("article")!;
    expect(salesKpi.textContent).toContain("尚未录入销量");
    expect(salesKpi.textContent).not.toContain("已录入 0 件");
  });

  test("manual sales immediately refreshes size totals and the sales KPI", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    await waitFor(() => expect((screen.getByRole("button", { name: "保存销量" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("销售日期"), { target: { value: "2026-10-04" } });
    fireEvent.change(screen.getByLabelText("销售ASIN"), { target: { value: "B0CFPR34MH" } });
    fireEvent.change(screen.getByLabelText("销量（件）"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("销售额（USD）"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("售价（USD / 件）"), { target: { value: "59.99" } });
    fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
    await screen.findByText(/2026-10-04 · XL 已保存/);
    expect(screen.getByRole("table", { name: "当日销量录入记录" }).textContent).toContain("US$400.00");
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("US$400")).toBeTruthy();
    expect((screen.getByLabelText("对比日期") as HTMLInputElement).value).toBe("2026-10-04");
  });

  test("shows the latest business day for all sizes on the home page and links to the saved daily plan", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    history.replaceState(null, "", "/?size=XL&endDate=2026-11-26");
    await opsDb.insert("activePlan", [{
      key: "active-plan", id: "plan-2026", totalUnits: 50, updatedAt: "2026-09-29T00:00:00Z",
      rows: [
        { date: "2026-10-02", size: "L", units: 10 },
        { date: "2026-10-02", size: "XL", units: 20 },
        { date: "2026-10-02", size: "2XL", units: 10 },
        { date: "2026-10-02", size: "3XL", units: 10 },
      ],
    }]);
    await opsDb.insert("business", [
      { key: "business:2026-10-02:l", date: "2026-10-02", sku: "L", asin: "", size: "L", units: 12, sales: 600, refunds: 0 },
      { key: "business:2026-10-02:xl", date: "2026-10-02", sku: "XL", asin: "", size: "XL", units: 15, sales: 750, refunds: 0 },
    ]);
    render(<Dashboard />);
    const table = await screen.findByRole("table", { name: "每日尺码销量对比" });
    expect((screen.getByLabelText("对比日期") as HTMLInputElement).value).toBe("2026-10-02");
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["L", "XL", "2XL", "3XL", "合计"]);
    expect(within(table).getByRole("row", { name: "L 10 12 +2 120% 已达标" })).toBeTruthy();
    expect(within(table).getByRole("row", { name: "XL 20 15 -5 75% 未达标" })).toBeTruthy();
    expect(within(table).getByRole("row", { name: "合计 50 数据不全 — — 数据不全" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "计划销量 vs 实际销量折线图" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "调整日计划" }));
    expect(await screen.findByRole("heading", { name: "计划与库存" })).toBeTruthy();
  });

  test("renders the approved sections and five KPI labels in order", () => {
    render(<Dashboard />);

    const navigation = screen.getByRole("navigation", { name: "经营模块导航" });
    expect(within(navigation).getAllByRole("button").map((button) => button.textContent)).toEqual(["经营驾驶舱", "计划与库存", "广告推广", "广告数据看板", "推广复盘图表", "关键词排名", "竞品跟踪", "每日操作"]);
    expect(within(navigation).getByRole("button", { name: "经营驾驶舱" }).getAttribute("aria-current")).toBe("page");

    expect(screen.getByRole("heading", { name: "计划销量 vs 实际销量" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "库存与积压风险" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "销售额 / 均价走势" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "毛利润 / 毛利率" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "广告花费 / ACOS" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "今日异常与动作" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "迁移本机数据" })).toBeTruthy();

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

  test("opens competitor tracking from the home cockpit", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "竞品跟踪" }));
    expect(await screen.findByRole("heading", { name: "竞品跟踪" })).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText("分类"), { target: { value: "广告预算" } });
    fireEvent.change(screen.getByLabelText("优先级"), { target: { value: "高" } });
    fireEvent.change(screen.getByLabelText("负责人"), { target: { value: "运营A" } });
    fireEvent.change(screen.getByLabelText("关联ASIN"), { target: { value: "B0CFPYYPRN" } });
    fireEvent.click(screen.getByRole("button", { name: "保存每日操作" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("每日操作已保存"));
    expect(await opsDb.listDailyOperations()).toMatchObject([{ date: "2026-10-02", action: "提高核心词预算", risk: "ACOS偏高", tomorrowPlan: "复查转化率", category: "广告预算", priority: "高", owner: "运营A", asin: "B0CFPYYPRN" }]);
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
