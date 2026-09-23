"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionList } from "../src/components/ActionList";
import { DashboardFilters, type DashboardMode, type DashboardSize } from "../src/components/DashboardFilters";
import { ImportPanel } from "../src/components/ImportPanel";
import { InventoryRisk, type InventoryRiskRow } from "../src/components/InventoryRisk";
import { KpiCard, type KpiCardProps } from "../src/components/KpiCard";
import { PlanVsActualChart } from "../src/components/PlanVsActualChart";
import { TrendChart } from "../src/components/TrendChart";
import { PlanInventoryPage } from "../src/components/PlanInventoryPage";
import { PromotionPage } from "../src/components/PromotionPage";
import { PromotionReviewPage } from "../src/components/PromotionReviewPage";
import { DailyOperationsPage } from "../src/components/DailyOperationsPage";
import { DataMigrationPanel } from "../src/components/DataMigrationPanel";
import { statusForTarget } from "../src/calc/status";
import { loadPlan } from "../src/data/plan";
import type { AdRecord, BusinessRecord, ManualRecord, SizeCode } from "../src/domain/types";
import type { ActivePlan, DailyOperationRecord, InboundEntry, InventorySnapshot, PromotionPlanOverride } from "../src/domain/planning";
import { buildDashboardSeries, evaluateDashboardRisks, selectDashboardSnapshot, targetsForSize } from "../src/integration/dashboard";
import { buildPlanInventorySummary } from "../src/integration/plan-inventory";
import { opsDb, type ImportLog } from "../src/storage/db";
import { createHttpOpsRepository } from "../src/storage/http-ops-repository";
import { migrateLocalData, previewLocalMigration } from "../src/storage/local-migration";

const plan = loadPlan();
const SIZES: SizeCode[] = ["L", "XL", "2XL", "3XL"];
const cloudOpsRepository = createHttpOpsRepository();
const money = (value: number | null) => value === null ? "数据不完整" : `US$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const price = (value: number | null) => value === null ? "—" : `US$${value.toFixed(2)}`;
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;

interface AsinInboundSummaryRow {
  asin: string;
  sku: string;
  productName: string;
  units: number;
  earliestArrivalDate: string | null;
}

function summarizeInboundByAsin(entries: readonly InboundEntry[]): AsinInboundSummaryRow[] {
  const rows = new Map<string, AsinInboundSummaryRow>();

  for (const entry of entries) {
    const units = entry.units;
    if (!entry.asin || !entry.sku || units === null || !Number.isFinite(units)) continue;
    const productName = entry.productName ?? "—";
    const key = `${entry.asin}||${entry.sku}||${productName}`;
    const current = rows.get(key);
    if (!current) {
      rows.set(key, {
        asin: entry.asin,
        sku: entry.sku,
        productName,
        units,
        earliestArrivalDate: entry.expectedArrivalDate,
      });
      continue;
    }
    current.units += units;
    if (entry.expectedArrivalDate && (!current.earliestArrivalDate || entry.expectedArrivalDate < current.earliestArrivalDate)) {
      current.earliestArrivalDate = entry.expectedArrivalDate;
    }
  }

  return [...rows.values()].sort((a, b) => a.asin.localeCompare(b.asin) || a.sku.localeCompare(b.sku) || a.productName.localeCompare(b.productName));
}

function loadOpsData() {
  return Promise.all([opsDb.list("business"), opsDb.list("ads"), opsDb.list("manual"), opsDb.list("imports"), opsDb.getActivePlan(), opsDb.listInventorySnapshots(), opsDb.getInboundEntries(), opsDb.listPromotionPlanOverrides(), opsDb.listDailyOperations()]);
}

function manualKey(record: ManualRecord): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `manual:${record.date}:${record.size}:${suffix}`;
}

export default function Dashboard() {
  const [startDate, setStartDate] = useState("2026-11-20");
  const [endDate, setEndDate] = useState("2026-11-26");
  const [size, setSize] = useState<DashboardSize>("all");
  const [mode, setMode] = useState<DashboardMode>("daily");
  const [business, setBusiness] = useState<BusinessRecord[]>([]);
  const [ads, setAds] = useState<AdRecord[]>([]);
  const [manual, setManual] = useState<(ManualRecord & { key: string })[]>([]);
  const [imports, setImports] = useState<ImportLog[]>([]);
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [inboundEntries, setInboundEntries] = useState<InboundEntry[]>([]);
  const [promotionOverrides, setPromotionOverrides] = useState<PromotionPlanOverride[]>([]);
  const [dailyOperations, setDailyOperations] = useState<DailyOperationRecord[]>([]);
  const [page, setPage] = useState<"dashboard" | "plan-inventory" | "promotion" | "promotion-review" | "daily-operations">("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextBusiness, nextAds, nextManual, nextImports, nextActivePlan, nextInventory, nextInbound, nextPromotionOverrides, nextDailyOperations] = await loadOpsData();
      setBusiness(nextBusiness);
      setAds(nextAds);
      setManual(nextManual);
      setImports(nextImports);
      setActivePlan(nextActivePlan ?? null);
      setInventorySnapshots(nextInventory);
      setInboundEntries(nextInbound);
      setPromotionOverrides(nextPromotionOverrides);
      setDailyOperations(nextDailyOperations);
    } catch {
      // SSR and minimal test DOMs may not expose IndexedDB; the explicit empty state remains valid.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadOpsData().then(([nextBusiness, nextAds, nextManual, nextImports, nextActivePlan, nextInventory, nextInbound, nextPromotionOverrides, nextDailyOperations]) => {
      setBusiness(nextBusiness);
      setAds(nextAds);
      setManual(nextManual);
      setImports(nextImports);
      setActivePlan(nextActivePlan ?? null);
      setInventorySnapshots(nextInventory);
      setInboundEntries(nextInbound);
      setPromotionOverrides(nextPromotionOverrides);
      setDailyOperations(nextDailyOperations);
    }).catch(() => undefined).finally(() => setLoaded(true));
  }, []);

  const series = useMemo(() => buildDashboardSeries({ plan, business, ads, manual, startDate, endDate, size, mode, activePlan }),
    [business, ads, manual, startDate, endDate, size, mode, activePlan]);
  const current = selectDashboardSnapshot(series, mode);
  const hasReports = business.length > 0 || ads.length > 0;
  const targetPrice = Number(plan.targetThresholds.minimumWeightedPriceUsd);
  const activeTargets = size === "all" ? {
    completionRate: 0.9,
    targetGrossMargin: Number(plan.targetThresholds.targetNetMarginRate),
    targetAcos: Number(plan.targetThresholds.targetAcosRate),
  } : targetsForSize(plan, size);
  const targetMargin = activeTargets.targetGrossMargin ?? Number(plan.targetThresholds.targetNetMarginRate);
  const targetAcos = activeTargets.targetAcos ?? Number(plan.targetThresholds.targetAcosRate);

  const kpis: KpiCardProps[] = hasReports && current ? [
    { label: "销量完成率", primaryValue: percent(current.completionRate), comparison: current.actualUnits === null ? "缺少业务报告" : `实际 ${current.actualUnits.toFixed(0)} / 推导计划 ${current.plannedUnits.toFixed(1)}`, status: statusForTarget(current.completionRate, activeTargets.completionRate ?? 0.9, true) },
    { label: "销售额", primaryValue: money(current.sales), comparison: `计划差额 ${money(current.salesVariance)}`, status: statusForTarget(current.sales, current.plannedSales, true) },
    { label: "均价", primaryValue: price(current.averagePrice), comparison: `目标 ${price(targetPrice)}`, status: statusForTarget(current.averagePrice, targetPrice, true) },
    { label: "毛利润 / 毛利率", primaryValue: current.grossProfit === null ? "数据不完整" : `${money(current.grossProfit)} · ${percent(current.grossMargin)}`, comparison: current.grossProfit === null ? `缺少：${current.dataGaps.filter((gap) => ["退款", "折扣", "成本假设", "广告报告"].includes(gap)).join("、") || "财务输入"}` : `目标毛利率 ${percent(targetMargin)}`, status: statusForTarget(current.grossMargin, targetMargin, true) },
    { label: "广告花费 / ACOS", primaryValue: `${money(current.adSpend)} · ${percent(current.acos)}`, comparison: `目标 ACOS ${percent(targetAcos)}`, status: statusForTarget(current.acos, targetAcos, false) },
  ] : ["销量完成率", "销售额", "均价", "毛利润 / 毛利率", "广告花费 / ACOS"].map((label) => ({
    label, primaryValue: "—", comparison: "等待导入报告", status: "attention" as const,
  }));

  const planRows = series.map((row, index) => {
    const previous = index > 0 ? series[index - 1] : undefined;
    const valuesAreCumulative = mode === "cumulative";
    return {
      date: row.date.slice(5),
      plannedDaily: valuesAreCumulative ? row.plannedUnits - (previous?.plannedUnits ?? 0) : row.plannedUnits,
      actualDaily: row.actualUnits === null ? null : (valuesAreCumulative ? row.actualUnits - (previous?.actualUnits ?? 0) : row.actualUnits),
      plannedCumulative: valuesAreCumulative ? row.plannedUnits : series.slice(0, index + 1).reduce((sum, item) => sum + item.plannedUnits, 0),
      actualCumulative: row.actualUnits === null ? null : (valuesAreCumulative ? row.actualUnits : series.slice(0, index + 1).reduce((sum, item) => sum + (item.actualUnits ?? 0), 0)),
    };
  });

  const risks = useMemo(() => evaluateDashboardRisks({ plan, business, ads, manual, startDate, endDate, mode, activePlan }), [business, ads, manual, startDate, endDate, mode, activePlan]);
  const v2InventorySummary = useMemo(() => buildPlanInventorySummary({ activePlan, inventory: inventorySnapshots, inbound: inboundEntries, business }), [activePlan, inventorySnapshots, inboundEntries, business]);
  const asinInboundSummary = useMemo(() => summarizeInboundByAsin(inboundEntries), [inboundEntries]);
  const hasV2Inventory = inventorySnapshots.length > 0 || inboundEntries.length > 0;
  const inventoryRows = useMemo<InventoryRiskRow[]>(() => SIZES.map((itemSize) => {
    if (hasV2Inventory) {
      const item = v2InventorySummary.bySize[itemSize].risk;
      return { size: itemSize, inventory: item.availableInventory, daysToStockout: item.daysToStockout, projectedEndingInventory: item.projectedEndingInventory, riskLabel: item.status === "insufficient" ? "数据不足" : item.explanation, status: item.status === "insufficient" ? "attention" : item.status };
    }
    const row = selectDashboardSnapshot(buildDashboardSeries({ plan, business, ads, manual, startDate, endDate, size: itemSize, mode, activePlan }), mode);
    const signals = risks.sizeSignals[itemSize];
    const worst = signals.find((signal) => signal.status === "risk") ?? signals.find((signal) => signal.status === "attention");
    return {
      size: itemSize,
      inventory: row?.availableInventory ?? null,
      daysToStockout: row?.daysToStockout ?? null,
      projectedEndingInventory: row?.projectedEndingInventory ?? null,
      riskLabel: worst?.label ?? "正常",
      status: worst?.status ?? "complete",
    };
  }), [business, ads, manual, startDate, endDate, mode, risks, activePlan, hasV2Inventory, v2InventorySummary]);

  const events = manual.filter((row) => row.event && row.date >= startDate && row.date <= endDate && (size === "all" || row.size === size))
    .map((row) => ({ date: row.date.slice(5), label: row.event! }));
  const actions = manual.filter((row) => (row.issue || row.action) && row.date >= startDate && row.date <= endDate && (size === "all" || row.size === size)).map((row) => ({
    id: row.key, issue: row.issue || `${row.size} 手工动作`, suggestedAction: row.action || "待补充动作", completed: row.actionComplete,
  }));
  const lastImport = imports.toSorted((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
  const latestInventoryDate = inventorySnapshots.reduce<string | null>((latest, item) => latest === null || item.date > latest ? item.date : latest, null);
  const inventoryComplete = SIZES.every((itemSize) => {
    const snapshot = v2InventorySummary.bySize[itemSize].inventorySnapshot;
    const inbound = v2InventorySummary.bySize[itemSize].inbound;
    return snapshot !== null && snapshot.reserved !== null && snapshot.unfulfillable !== null && inbound?.units !== null && inbound !== null;
  });
  const completeness = current ? (current.dataGaps.length ? `缺少 ${current.dataGaps.join("、")}` : "完整") : "无报告";

  async function saveManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const optionalNumber = (name: string): number | undefined => {
      const raw = String(form.get(name) ?? "").trim();
      if (!raw) return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };
    const inbound = optionalNumber("inbound");
    const inventoryAdjustment = optionalNumber("inventoryAdjustment");
    const record: ManualRecord = {
      date: String(form.get("date")), size: String(form.get("size")) as SizeCode,
      ...(inbound === undefined ? {} : { inbound, inboundObserved: true }),
      ...(inventoryAdjustment === undefined ? {} : { inventoryAdjustment }),
      event: String(form.get("event") || "") || undefined, issue: String(form.get("issue") || "") || undefined,
      action: String(form.get("action") || "") || undefined, actionComplete: form.get("actionComplete") === "on",
    };
    await opsDb.insert("manual", [{ ...record, key: manualKey(record) }]);
    formElement.reset();
    await refresh();
  }

  if (page === "plan-inventory") {
    return <PlanInventoryPage plan={plan} onBack={() => { setPage("dashboard"); void refresh(); }} onPlanSaved={setActivePlan} />;
  }
  if (page === "promotion") {
    return <PromotionPage ads={ads} business={business} manual={manual} startDate="2026-10-02" endDate="2026-12-20" onBack={() => { setPage("dashboard"); void refresh(); }} onOpenReview={() => setPage("promotion-review")} onOpenDailyOperations={() => setPage("daily-operations")} />;
  }
  if (page === "promotion-review") {
    return <PromotionReviewPage ads={ads} business={business} overrides={promotionOverrides} operations={dailyOperations} startDate="2026-10-02" endDate="2026-12-20" onBack={() => { setPage("promotion"); void refresh(); }} />;
  }
  if (page === "daily-operations") {
    return <DailyOperationsPage operations={dailyOperations} defaultDate={endDate} onBack={() => { setPage("promotion"); void refresh(); }} onChanged={refresh} />;
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">SO</span><div>
          <p className="brand-kicker">DAILY OPERATIONS COCKPIT</p><h1>SANTA OPS 2026</h1>
          <p className="as-of">数据截至 {endDate} · 当前尺码：{size === "all" ? "全部" : size}</p>
        </div></div>
        <div className="header-actions dashboard-module-nav" aria-label="经营模块导航">
          <button className="import-button" type="button" onClick={() => setShowImport((shown) => !shown)}><span aria-hidden="true">＋</span> 导入今日数据</button>
          <button className="secondary-button dashboard-plan-link" type="button" onClick={() => setPage("promotion")}>广告推广</button>
          <button className="secondary-button dashboard-plan-link" type="button" onClick={() => setPage("promotion-review")}>推广复盘图表</button>
          <button className="secondary-button dashboard-plan-link" type="button" onClick={() => setPage("daily-operations")}>每日操作</button>
          <button className="secondary-button dashboard-plan-link" type="button" onClick={() => setPage("plan-inventory")}>计划与库存</button>
        </div>
      </header>
      <section className="v2-dashboard-summary" aria-label="计划与库存摘要"><strong>计划与库存</strong><span>{activePlan ? `计划更新：${new Date(activePlan.updatedAt).toLocaleString("zh-CN")}` : "计划尚未初始化"}</span><span>{latestInventoryDate ? `库存快照：${latestInventoryDate}` : "尚无库存快照"}</span>{inventoryComplete ? null : <span>库存数据不足（缺少部分尺码或必填字段）</span>}<button type="button" onClick={() => setPage("plan-inventory")}>进入计划与库存</button></section>
      <DataMigrationPanel
        preview={previewLocalMigration}
        migrate={() => migrateLocalData({ resources: ["business", "ads", "inventory", "inbound", "promotion", "dailyOps"], target: cloudOpsRepository })}
      />
      {asinInboundSummary.length > 0 ? (
        <section className="panel asin-dashboard-panel" aria-labelledby="asin-dashboard-heading">
          <div className="panel-heading"><div><p className="eyebrow">ASIN INBOUND</p><h2 id="asin-dashboard-heading">ASIN 在途汇总</h2></div><span className="panel-meta">来自发货明细</span></div>
          <div className="table-scroll">
            <table aria-label="ASIN在途汇总">
              <thead><tr><th scope="col">ASIN</th><th scope="col">SKU</th><th scope="col">品名</th><th scope="col">在途数量</th><th scope="col">最近到货</th></tr></thead>
              <tbody>{asinInboundSummary.map((row) => (
                <tr key={`${row.asin}:${row.sku}:${row.productName}`}>
                  <th scope="row">{row.asin}</th><td>{row.sku}</td><td>{row.productName}</td><td>{row.units}</td><td>{row.earliestArrivalDate ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="data-quality-banner" role="alert"><strong>数据质量提示：</strong>权威采购尺码分配合计 3000 件（L 520 / XL 1600 / 2XL 550 / 3XL 330），源工作簿周计划合计 3010 件且尺码冲突。图表使用“推导计划”，原始 3010 数据仍保留在计划 JSON 与审计说明中。</div>
      <section className="filter-bar" aria-label="数据筛选">
        <DashboardFilters startDate={startDate} endDate={endDate} size={size} mode={mode} onStartDateChange={setStartDate} onEndDateChange={setEndDate} onSizeChange={setSize} onModeChange={setMode} />
        <div className="freshness-indicator"><span aria-hidden="true" />{lastImport ? `最近导入：${new Date(lastImport.importedAt).toLocaleString("zh-CN")}` : "尚未导入"} · 完整性：{completeness}</div>
      </section>
      {!hasReports && loaded ? <p className="empty-state">请先导入业务报告和广告报告。当前仅显示推导计划，不会把演示值作为真实经营结果。</p> : null}
      {showImport ? <div className="operations-panel"><ImportPanel plan={{ sizeBySku: plan.sizeBySku, sizeByAsin: plan.sizeByAsin }} onImported={refresh} /></div> : null}

      <section className="kpi-grid" aria-label="核心指标">{kpis.map((card) => <KpiCard key={card.label} {...card} />)}</section>
      <section className="main-analysis" aria-label="核心分析">
        <PlanVsActualChart rows={planRows} mode={mode} summary={current?.actualUnits !== null && current?.actualUnits !== undefined ? `实际 ${current.actualUnits.toFixed(0)} 件 · 推导计划 ${current.plannedUnits.toFixed(1)} 件 · 进度差 ${current.unitVariance?.toFixed(1)} 件` : "暂无实际报告数据；灰线为推导计划"} />
        <InventoryRisk rows={inventoryRows} aggregateSignals={risks.aggregateSignals} />
      </section>
      <section className="trend-grid" aria-label="经营趋势">
        <TrendChart title="销售额 / 均价走势" rows={series.map((row) => ({ date: row.date.slice(5), sales: row.sales, price: row.averagePrice }))} series={[{ key: "sales", label: "销售额", color: "#9f1d28", axis: "currency" }, { key: "price", label: "均价", color: "#526277", axis: "price" }]} eventMarkers={events} />
        <TrendChart title="毛利润 / 毛利率" rows={series.map((row) => ({ date: row.date.slice(5), profit: row.grossProfit, margin: row.grossMargin }))} series={[{ key: "profit", label: "毛利润", color: "#9f1d28", axis: "currency" }, { key: "margin", label: "毛利率", color: "#b1822f", axis: "percentage" }]} />
        <TrendChart title="广告花费 / ACOS" rows={series.map((row) => ({ date: row.date.slice(5), spend: row.adSpend, acos: row.acos }))} series={[{ key: "spend", label: "广告花费", color: "#9f1d28", axis: "currency" }, { key: "acos", label: "ACOS", color: "#b1822f", axis: "percentage" }]} />
      </section>

      <section className="panel manual-panel" aria-labelledby="manual-heading"><div className="panel-heading"><div><p className="eyebrow">MANUAL LOG</p><h2 id="manual-heading">手工记录</h2></div><span className="panel-meta">本机保存</span></div>
        <form className="manual-form" onSubmit={(event) => void saveManual(event)}>
          <label>日期<input name="date" type="date" defaultValue={endDate} required /></label><label>尺码<select name="size">{SIZES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>入库<input name="inbound" type="number" /></label><label>库存调整<input name="inventoryAdjustment" type="number" /></label>
          <label>事件<input name="event" placeholder="促销 / Deal / 调价" /></label><label>问题<input name="issue" /></label><label>动作<input name="action" /></label>
          <label className="manual-checkbox"><input name="actionComplete" type="checkbox" /> 已完成</label><button type="submit">保存手工记录</button>
        </form>
      </section>
      <ActionList items={actions} />
      <footer className="dashboard-footer">SANTA OPS · LOCAL OPERATING VIEW · 2026</footer>
    </main>
  );
}
