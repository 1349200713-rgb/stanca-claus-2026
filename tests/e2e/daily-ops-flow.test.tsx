// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import Dashboard from "../../app/page";
import { loadPlan } from "../../src/data/plan";
import {
  buildDashboardSeries,
  deriveDailyPlan,
  evaluateDashboardRisks,
  mergeTargets,
  targetsForSize,
  trendIsDeteriorating,
} from "../../src/integration/dashboard";
import { closeOpsDbForTests, configureOpsDbForTests, resetOpsDbForTests } from "../../src/storage/db";
import { opsDb } from "../../src/storage/db";
import { parseReport } from "../../src/import/report-parser";
import { createMemoryIdbFactory } from "../storage/memory-idb";

afterEach(async () => {
  cleanup();
  history.replaceState(null, "", "/");
  await resetOpsDbForTests();
});

describe("Santa Ops daily operating flow", () => {
  function reportFile(name: string, csv: string): File {
    const file = new File([csv], name, { type: "text/csv" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(csv).buffer });
    return file;
  }

  test("first run is empty and keeps the source-plan conflict visible", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);

    expect((await screen.findByRole("alert")).textContent).toContain("3000");
    expect(screen.getByRole("alert").textContent).toContain("3010");
    expect(screen.getByText(/请先导入业务报告和广告报告/)).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.queryByText("726")).toBeNull();
  });

  test("derived plan reconciles authoritative sizes while retaining the raw warning", () => {
    const plan = loadPlan();
    const rows = deriveDailyPlan(plan);
    const totals = Object.fromEntries(["L", "XL", "2XL", "3XL"].map((size) => [
      size,
      rows.filter((row) => row.size === size).reduce((sum, row) => sum + row.plannedUnits, 0),
    ])) as Record<string, number>;

    expect(totals).toEqual({ L: 520, XL: 1600, "2XL": 550, "3XL": 330 });
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(3000);
    expect((plan.weeklyPlanRows as Array<{ plannedUnits: number }>).reduce((sum, row) => sum + row.plannedUnits, 0)).toBe(3010);
    expect(plan.unavailable.join(" ")).toContain("3010");
  });

  test("weekly buckets start Monday and cumulative ratios are recomputed", () => {
    const series = buildDashboardSeries({
      plan: loadPlan(),
      business: [
        { key: "a", date: "2026-11-22", sku: "A022-XXX-09-0C100", asin: "", size: "L", units: 2, sales: 100, refunds: 0 },
        { key: "b", date: "2026-11-23", sku: "A022-XXX-09-0C100", asin: "", size: "L", units: 2, sales: 300, refunds: 0 },
      ],
      ads: [
        { key: "x", date: "2026-11-22", campaign: "L", spend: 20, adSales: 100, adOrders: 1 },
        { key: "y", date: "2026-11-23", campaign: "L", spend: 90, adSales: 300, adOrders: 1 },
      ],
      manual: [],
      startDate: "2026-11-22",
      endDate: "2026-11-23",
      size: "L",
      mode: "weekly",
    });

    expect(series.map((row) => row.date)).toEqual(["2026-11-16", "2026-11-23"]);
    const cumulative = buildDashboardSeries({
      plan: loadPlan(),
      business: [
        { key: "a", date: "2026-11-22", sku: "A022-XXX-09-0C100", asin: "", size: "L", units: 2, sales: 100, refunds: 0 },
        { key: "b", date: "2026-11-23", sku: "A022-XXX-09-0C100", asin: "", size: "L", units: 2, sales: 300, refunds: 0 },
      ],
      ads: [
        { key: "x", date: "2026-11-22", campaign: "L", spend: 20, adSales: 100, adOrders: 1 },
        { key: "y", date: "2026-11-23", campaign: "L", spend: 90, adSales: 300, adOrders: 1 },
      ],
      manual: [],
      startDate: "2026-11-22", endDate: "2026-11-23", size: "L", mode: "cumulative",
    });
    expect(cumulative.at(-1)?.averagePrice).toBe(100);
    expect(cumulative.at(-1)?.acos).toBe(0.275);
  });

  test("target fallback and deterioration direction are metric-specific", () => {
    expect(mergeTargets({ targetAcos: 0.22, targetGrossMargin: 0.3 }, { targetAcos: 0.18 }))
      .toEqual({ targetAcos: 0.18, targetGrossMargin: 0.3 });
    expect(trendIsDeteriorating("acos", [0.15, 0.17, 0.2])).toBe(true);
    expect(trendIsDeteriorating("grossMargin", [0.35, 0.32, 0.29])).toBe(true);
    expect(trendIsDeteriorating("completionRate", [0.98, 0.94, 0.88])).toBe(true);
  });

  test("size targets override field by field and every size receives risk evaluation", () => {
    const base = loadPlan();
    const plan = {
      ...base,
      targetThresholds: { ...base.targetThresholds, "XL.targetAcosRate": 0.1 },
    };
    expect(targetsForSize(plan, "XL")).toMatchObject({
      targetAcos: 0.1,
      targetGrossMargin: Number(base.targetThresholds.targetNetMarginRate),
    });
    const risks = evaluateDashboardRisks({
      plan,
      business: [{ key: "xl", date: "2026-11-24", sku: "XL", asin: "", size: "XL", units: 2, sales: 120, refunds: 0, discounts: 0 }],
      ads: [{ key: "xl-ad", date: "2026-11-24", campaign: "XL", spend: 20, adSales: 100, adOrders: 1 }],
      manual: [],
      startDate: "2026-11-24",
      endDate: "2026-11-24",
    });
    expect(Object.keys(risks.sizeSignals)).toEqual(["L", "XL", "2XL", "3XL"]);
    expect(risks.sizeSignals.XL.some((signal) => signal.id === "size-XL-acos")).toBe(true);
    expect(risks.aggregateSignals.some((signal) => signal.id === "acos")).toBe(false);
  });

  test("inventory and manual inputs produce stockout and overstock metrics", () => {
    const business = Array.from({ length: 7 }, (_, index) => {
      const day = 20 + index;
      return {
        key: `inventory-${day}`,
        date: `2026-11-${day}`,
        sku: "L",
        asin: "",
        size: "L" as const,
        units: 10,
        sales: 600,
        refunds: 0,
        discounts: 0,
        fbaAvailable: 1000,
        reserved: 0,
        unfulfillable: 0,
      };
    });
    const manual = [{ key: "inventory-manual", date: "2026-11-26", size: "L" as const, inbound: 0, inboundObserved: true, inventoryAdjustment: 0, actionComplete: false }];
    const input = { plan: loadPlan(), business, ads: [], manual, startDate: "2026-11-20", endDate: "2026-11-26" };
    const metrics = buildDashboardSeries({ ...input, size: "L", mode: "cumulative" }).at(-1);
    expect(metrics?.last7DayAverageUnits).toBe(10);
    expect(metrics?.daysToStockout).toBe(100);
    expect(metrics?.overstockRate).not.toBeNull();
    expect(evaluateDashboardRisks(input).sizeSignals.L.some((signal) => signal.id === "size-L-overstock")).toBe(true);
  });

  test("all-size inventory and aggregate risk sum the latest snapshot for every size", () => {
    const sizes = ["L", "XL", "2XL", "3XL"] as const;
    const inventory = { L: 1000, XL: 1000, "2XL": 1000, "3XL": 100 };
    const business = Array.from({ length: 7 }, (_, dayIndex) => sizes.map((itemSize) => ({
      key: `${itemSize}-${dayIndex}`,
      date: `2026-11-${20 + dayIndex}`,
      sku: itemSize,
      asin: "",
      size: itemSize,
      units: 10,
      sales: 600,
      refunds: 0,
      discounts: 0,
      fbaAvailable: inventory[itemSize],
      reserved: 0,
      unfulfillable: 0,
    }))).flat();
    const manual = sizes.map((itemSize) => ({
      key: `manual-${itemSize}`,
      date: "2026-11-26",
      size: itemSize,
      inbound: 0,
      inboundObserved: true,
      inventoryAdjustment: 0,
      actionComplete: false,
    }));
    const input = { plan: loadPlan(), business, ads: [], manual, startDate: "2026-11-20", endDate: "2026-11-26" };

    const aggregate = buildDashboardSeries({ ...input, size: "all", mode: "cumulative" }).at(-1);
    const risks = evaluateDashboardRisks(input);

    expect(aggregate?.availableInventory).toBe(3100);
    expect(aggregate?.daysToStockout).toBe(77.5);
    expect(risks.aggregateSignals.some((signal) => signal.id === "stockout")).toBe(false);
    expect(risks.sizeSignals["3XL"].some((signal) => signal.id === "size-3XL-stockout")).toBe(true);
  });

  test("action-only manual records preserve unknown inbound and inventory projections", () => {
    const business = Array.from({ length: 7 }, (_, index) => ({
      key: `action-only-${index}`,
      date: `2026-11-${20 + index}`,
      sku: "L",
      asin: "",
      size: "L" as const,
      units: 10,
      sales: 600,
      refunds: 0,
      discounts: 0,
      fbaAvailable: 100,
      reserved: 0,
      unfulfillable: 0,
    }));
    const manual = [{
      key: "manual-action-only",
      date: "2026-11-26",
      size: "L" as const,
      inbound: 0,
      inventoryAdjustment: 0,
      issue: "Review Deal",
      action: "Check price",
      actionComplete: false,
    }];

    const metrics = buildDashboardSeries({
      plan: loadPlan(), business, ads: [], manual,
      startDate: "2026-11-20", endDate: "2026-11-26", size: "L", mode: "cumulative",
    }).at(-1);

    expect(metrics?.availableInventory).toBeNull();
    expect(metrics?.projectedEndingInventory).toBeNull();
    expect(metrics?.overstockRate).toBeNull();
    expect(metrics?.dataGaps).toEqual(expect.arrayContaining(["库存", "未来入库"]));
  });

  test("daily, weekly, and cumulative risk signals use the active aggregation mode", () => {
    const plan = loadPlan();
    const plannedSecondDay = deriveDailyPlan(plan).find((row) => row.size === "L" && row.date === "2026-11-23")!.plannedUnits;
    const input = {
      plan,
      business: [
        { key: "sun", date: "2026-11-22", sku: "L", asin: "", size: "L" as const, units: 0, sales: 0, refunds: 0, discounts: 0 },
        { key: "mon", date: "2026-11-23", sku: "L", asin: "", size: "L" as const, units: Math.ceil(plannedSecondDay), sales: 2000, refunds: 0, discounts: 0 },
      ],
      ads: [], manual: [], startDate: "2026-11-22", endDate: "2026-11-23",
    };

    for (const mode of ["daily", "weekly"] as const) {
      expect(evaluateDashboardRisks({ ...input, mode }).sizeSignals.L.some((signal) => signal.id === "size-L-completion")).toBe(false);
    }
    expect(evaluateDashboardRisks({ ...input, mode: "cumulative" }).sizeSignals.L.some((signal) => signal.id === "size-L-completion")).toBe(true);
  });

  test("missing calendar days cannot masquerade as three consecutive deteriorations", () => {
    expect(trendIsDeteriorating("acos", [0.1, null, 0.2, 0.3])).toBe(false);
  });

  test("reload reads persisted records", async () => {
    const factory = createMemoryIdbFactory();
    configureOpsDbForTests(factory);
    await opsDb.insert("business", [{
      key: "business:2026-11-24:a022-xxx-09-0b500", date: "2026-11-24", sku: "A022-XXX-09-0B500", asin: "B0CFPR34MH", size: "XL",
      units: 24, sales: 1392, refunds: 0, discounts: 0,
    }]);
    render(<Dashboard />);
    await screen.findByText("US$1,392");
    cleanup();
    await closeOpsDbForTests();
    render(<Dashboard />);
    await screen.findByText("US$1,392");
  });

  test("XL isolates XL while all-size aggregates all four sizes", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", [
      { key: "l", date: "2026-11-24", sku: "L", asin: "", size: "L", units: 1, sales: 60, refunds: 0, discounts: 0 },
      { key: "xl", date: "2026-11-24", sku: "XL", asin: "", size: "XL", units: 2, sales: 120, refunds: 0, discounts: 0 },
      { key: "2xl", date: "2026-11-24", sku: "2XL", asin: "", size: "2XL", units: 3, sales: 180, refunds: 0, discounts: 0 },
      { key: "3xl", date: "2026-11-24", sku: "3XL", asin: "", size: "3XL", units: 4, sales: 240, refunds: 0, discounts: 0 },
    ]);
    render(<Dashboard />);
    await screen.findByText("US$600");
    fireEvent.change(screen.getAllByLabelText("尺码")[0], { target: { value: "XL" } });
    expect(await within(screen.getByRole("region", { name: "核心指标" })).findByText("US$120")).toBeTruthy();
    expect(screen.queryByText("US$600")).toBeNull();
  });

  test("cumulative margin is recomputed and missing cost remains incomplete", () => {
    const completePlan = loadPlan();
    const business = [
      { key: "a", date: "2026-11-23", sku: "L", asin: "", size: "L" as const, units: 1, sales: 100, refunds: 0, discounts: 0 },
      { key: "b", date: "2026-11-24", sku: "L", asin: "", size: "L" as const, units: 1, sales: 200, refunds: 0, discounts: 0 },
    ];
    const ads = [
      { key: "ad-a", date: "2026-11-23", campaign: "L", spend: 10, adSales: 50, adOrders: 1 },
      { key: "ad-b", date: "2026-11-24", campaign: "L", spend: 20, adSales: 100, adOrders: 1 },
    ];
    const rows = buildDashboardSeries({ plan: completePlan, business, ads, manual: [], startDate: "2026-11-23", endDate: "2026-11-24", size: "L", mode: "cumulative" });
    const expectedProfit = 300 - 2 * 11.283 - 2 * 3.44 - 2 * 8.31 - 300 * 0.17 - 30;
    expect(rows.at(-1)?.grossProfit).toBeCloseTo(expectedProfit, 8);
    expect(rows.at(-1)?.grossMargin).toBeCloseTo(expectedProfit / 300, 8);

    const noCostPlan = { ...completePlan, costAssumptions: { ...completePlan.costAssumptions, purchaseCostUsdPerUnit: undefined as unknown as number } };
    expect(buildDashboardSeries({ plan: noCostPlan, business, ads, manual: [], startDate: "2026-11-23", endDate: "2026-11-24", size: "L", mode: "cumulative" }).at(-1)?.grossProfit).toBeNull();
  });

  test("actual public samples reconcile and render binding red and green states", async () => {
    const businessCsv = readFileSync(`${process.cwd()}/public/sample-business-report.csv`, "utf8");
    const adCsv = readFileSync(`${process.cwd()}/public/sample-ad-report.csv`, "utf8");
    const mapping = { sizeBySku: loadPlan().sizeBySku, sizeByAsin: loadPlan().sizeByAsin };
    const businessResult = parseReport(new TextEncoder().encode(businessCsv).buffer, "sample-business-report.csv", mapping);
    const adResult = parseReport(new TextEncoder().encode(adCsv).buffer, "sample-ad-report.csv", mapping);
    expect(businessResult.records).toHaveLength(8);
    expect(businessResult.records.reduce((sum, row) => sum + ("units" in row ? row.units : 0), 0)).toBe(94);
    expect(businessResult.records.reduce((sum, row) => sum + ("sales" in row ? row.sales : 0), 0)).toBe(5516);
    expect(adResult.records.reduce((sum, row) => sum + ("spend" in row ? row.spend : 0), 0)).toBe(800);
    expect(adResult.records.reduce((sum, row) => sum + ("adSales" in row ? row.adSales : 0), 0)).toBe(4000);

    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", businessResult.records.filter((row) => "units" in row));
    await opsDb.insert("ads", adResult.records.filter((row) => "spend" in row));
    render(<Dashboard />);
    await screen.findByText("US$2,964");
    const kpis = screen.getByRole("region", { name: "核心指标" });
    expect(within(kpis).getByText("销量完成率").closest("article")?.querySelector(".status-risk")).toBeTruthy();
    expect(within(kpis).getByText("均价").closest("article")?.querySelector(".status-risk")).toBeTruthy();
    expect(within(kpis).getByText("广告花费 / ACOS").closest("article")?.querySelector(".status-complete")).toBeTruthy();
    expect(within(kpis).getByText("毛利润 / 毛利率").closest("article")?.textContent).toContain("数据不完整");
  });

  test("manual actions obey active date and size filters", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("manual", [
      { key: "manual:l", date: "2026-11-24", size: "L", inbound: 0, inventoryAdjustment: 0, issue: "L 当前动作", action: "处理 L", actionComplete: false },
      { key: "manual:xl", date: "2026-11-24", size: "XL", inbound: 0, inventoryAdjustment: 0, issue: "XL 当前动作", action: "处理 XL", actionComplete: false },
      { key: "manual:old", date: "2026-11-10", size: "L", inbound: 0, inventoryAdjustment: 0, issue: "过期动作", action: "不应显示", actionComplete: false },
    ]);
    render(<Dashboard />);
    expect(await screen.findByText("L 当前动作")).toBeTruthy();
    expect(screen.getByText("XL 当前动作")).toBeTruthy();
    expect(screen.queryByText("过期动作")).toBeNull();
    fireEvent.change(screen.getAllByLabelText("尺码")[0], { target: { value: "XL" } });
    expect(screen.queryByText("L 当前动作")).toBeNull();
    expect(screen.getByText("XL 当前动作")).toBeTruthy();
  });

  test("sample imports refresh KPIs and chart summaries immediately", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    await screen.findByText(/请先导入业务报告和广告报告/);
    fireEvent.click(screen.getByRole("button", { name: /导入今日数据/ }));
    const input = screen.getByLabelText("选择报告文件");
    const businessCsv = [
      "date,sku,asin,units,sales",
      "2026-11-24,A022-XXX-09-0C100,B0CFPWYPRN,12,708",
      "2026-11-24,A022-XXX-09-0B500,B0CFPR34MH,24,1392",
      "2026-11-24,A022-XXX-09-0L100,B0CFQ3TMBZ,9,522",
      "2026-11-24,A022-XXX-09-0I100,B0CFQ2D8FD,6,342",
    ].join("\n");
    fireEvent.change(input, { target: { files: [reportFile("sample-business-report.csv", businessCsv)] } });
    await screen.findByText("有效行: 4");
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("US$2,964")).toBeTruthy());
    const businessOnlyKpis = screen.getByRole("region", { name: "核心指标" });
    expect(within(businessOnlyKpis).getByText("广告花费 / ACOS").closest("article")?.textContent).toContain("数据不完整");
    expect(within(businessOnlyKpis).getByText("毛利润 / 毛利率").closest("article")?.textContent).toContain("数据不完整");

    const adCsv = [
      "date,campaign,spend,ad sales,ad orders",
      "2026-11-24,Campaign B0CFPWYPRN L,90,450,6",
      "2026-11-24,Campaign B0CFPR34MH XL,180,900,11",
      "2026-11-24,Campaign B0CFQ3TMBZ 2XL,90,450,5",
      "2026-11-24,Campaign B0CFQ2D8FD 3XL,80,400,5",
    ].join("\n");
    fireEvent.change(input, { target: { files: [reportFile("sample-ad-report.csv", adCsv)] } });
    await screen.findByText("报告类型: 广告");
    fireEvent.click(screen.getByRole("button", { name: "保存导入" }));
    await waitFor(() => expect(screen.getByText(/实际 51 件/)).toBeTruthy());
    expect(screen.getByRole("img", { name: "广告花费 / ACOS折线图" }).textContent).not.toContain("726");
  });

  test("manual event saves, renders a marker, and completed actions are green", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    await screen.findByText(/请先导入业务报告和广告报告/);
    fireEvent.change(screen.getByLabelText("事件"), { target: { value: "Deal 调价" } });
    fireEvent.change(screen.getByLabelText("问题"), { target: { value: "检查活动价" } });
    fireEvent.change(screen.getByLabelText("动作"), { target: { value: "已复核" } });
    fireEvent.click(screen.getByLabelText("已完成"));
    fireEvent.click(screen.getByRole("button", { name: "保存手工记录" }));
    expect(await screen.findByText("Deal 调价")).toBeTruthy();
    expect(screen.getByText("已复核")).toBeTruthy();
    expect(screen.getAllByText("已完成").find((node) => node.className.includes("status-complete"))).toBeTruthy();
    const saved = await opsDb.list("manual");
    expect(saved[0]).not.toHaveProperty("inbound");
    expect(saved[0]).not.toHaveProperty("inventoryAdjustment");
  });
});
