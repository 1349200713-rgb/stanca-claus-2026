"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { summarizePlan, validatePlan } from "../calc/daily-plan";
import type { PlanModel } from "../data/plan";
import type { ActivePlan, DailyPlanRow, InboundEntry, InventorySnapshot } from "../domain/planning";
import type { BusinessRecord } from "../domain/types";
import { buildPlanInventorySummary } from "../integration/plan-inventory";
import { createInitialActivePlan, type LegacyWeeklyPlanRow } from "../integration/legacy-plan-adapter";
import { opsDb } from "../storage/db";
import { DailyPlanEditor } from "./DailyPlanEditor";
import { ImportPanel } from "./ImportPanel";
import { InventoryEditor } from "./InventoryEditor";
import { InventoryRiskPanel } from "./InventoryRiskPanel";
import { SizeInventoryOverview } from "./SizeInventoryOverview";
import { ManualSalesForm } from "./ManualSalesForm";

export interface PlanInventoryPageProps {
  plan: PlanModel;
  onBack: () => void;
  onPlanSaved?: (plan: ActivePlan) => void;
}

interface PageData {
  activePlan: ActivePlan | null;
  inventory: InventorySnapshot[];
  inbound: InboundEntry[];
  business: BusinessRecord[];
}

function now(): string { return new Date().toISOString(); }
function planNumber(value: number): number | string { return Number.isFinite(value) ? value : "未填写完整"; }

function changeId(changedAt: string): string {
  return `plan-change:${changedAt}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function toLegacyRows(rows: readonly unknown[]): LegacyWeeklyPlanRow[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") throw new Error("第一版周计划格式无效");
    const candidate = row as Partial<LegacyWeeklyPlanRow>;
    if (typeof candidate.startDate !== "string" || typeof candidate.plannedUnits !== "number") {
      throw new Error("第一版周计划缺少起始日期或计划销量");
    }
    return { startDate: candidate.startDate, plannedUnits: candidate.plannedUnits };
  });
}

function emptyData(): PageData { return { activePlan: null, inventory: [], inbound: [], business: [] }; }

export function PlanInventoryPage({ plan, onBack, onPlanSaved }: PlanInventoryPageProps) {
  const [data, setData] = useState<PageData>(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string>();
  const [savedRows, setSavedRows] = useState<DailyPlanRow[]>();

  const refresh = useCallback(async () => {
    const [activePlan, inventory, inbound, business] = await Promise.all([
      opsDb.getActivePlan(), opsDb.listInventorySnapshots(), opsDb.getInboundEntries(), opsDb.list("business"),
    ]);
    setSavedRows(activePlan?.rows);
    // A sales/inventory refresh must not replace the user's unsaved plan draft.
    setData(current => ({ activePlan: current.activePlan ?? activePlan ?? null, inventory, inbound, business }));
  }, []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const existing = await opsDb.getActivePlan();
        if (!existing) {
          const changedAt = now();
          const initial = createInitialActivePlan(toLegacyRows(plan.weeklyPlanRows), plan.sizeTotals, changedAt);
          await opsDb.saveActivePlan(initial, {
            id: changeId(changedAt), changedAt, reason: "根据第一版周计划初始化", beforeTotal: 0, afterTotal: initial.totalUnits,
          });
          if (live) onPlanSaved?.(initial);
        }
        if (live) await refresh();
      } catch (error) {
        if (live) setMessage(error instanceof Error ? error.message : "无法加载计划与库存数据");
      } finally {
        if (live) setLoaded(true);
      }
    };
    void load();
    return () => { live = false; };
  }, [onPlanSaved, plan.sizeTotals, plan.weeklyPlanRows, refresh]);

  const summary = useMemo(() => buildPlanInventorySummary({
    activePlan: data.activePlan, inventory: data.inventory, inbound: data.inbound, business: data.business,
  }), [data]);
  const planSummary = useMemo(() => data.activePlan ? summarizePlan(data.activePlan.rows) : null, [data.activePlan]);

  const updateRows = (rows: DailyPlanRow[]) => {
    if (!data.activePlan) return;
    const totalUnits = summarizePlan(rows).total;
    setData((current) => current.activePlan ? { ...current, activePlan: { ...current.activePlan, rows, totalUnits } } : current);
    setMessage(undefined);
  };

  const savePlan = async (rows: DailyPlanRow[], reason: string) => {
    if (!data.activePlan || !validatePlan(rows).valid) return;
    const changedAt = now();
    const next: ActivePlan = { id: "plan-2026", rows: structuredClone(rows), totalUnits: summarizePlan(rows).total, updatedAt: changedAt };
    try {
      await opsDb.saveActivePlan(next, {
        id: changeId(changedAt), changedAt, reason, beforeTotal: data.activePlan.totalUnits, afterTotal: next.totalUnits,
      });
      setData((current) => ({ ...current, activePlan: next }));
      setSavedRows(next.rows);
      setMessage("计划已保存并生效");
      onPlanSaved?.(next);
    } catch {
      setMessage("计划保存失败，请重试");
    }
  };

  if (!loaded || !data.activePlan || !planSummary) return <main className="dashboard-shell"><p className="empty-state">正在加载计划与库存…</p>{message && <p role="alert">{message}</p>}</main>;

  return (
    <main className="dashboard-shell plan-inventory-shell">
      <header className="dashboard-header plan-inventory-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">SO</span><div><p className="brand-kicker">PLAN & INVENTORY CENTER</p><h1>计划与库存</h1><p className="as-of">管理日计划、库存快照、在途和季末积压风险</p></div></div>
        <button className="secondary-button" type="button" onClick={onBack}>返回经营驾驶舱</button>
      </header>
      {message && <p role={message.includes("失败") ? "alert" : "status"} className="v2-message">{message}</p>}

      <section className="plan-summary-grid" aria-label="计划概览">
        <article><span>计划总量</span><strong>计划总量：{planNumber(planSummary.total)}</strong><em className={planSummary.total >= 2900 && planSummary.total <= 3100 ? "is-complete" : "is-risk"}>{planSummary.total >= 2900 && planSummary.total <= 3100 ? "可保存" : "超出 2900–3100"}</em></article>
        <article><span>相对 3000 件差异</span><strong>{planSummary.variance > 0 ? "+" : ""}{planNumber(planSummary.variance)}</strong><em>四码可自由调整</em></article>
        <article><span>尺码数量</span><strong>L {planNumber(planSummary.sizeTotals.L)} · XL {planNumber(planSummary.sizeTotals.XL)}</strong><em>2XL {planNumber(planSummary.sizeTotals["2XL"])} · 3XL {planNumber(planSummary.sizeTotals["3XL"])}</em></article>
        <article><span>最后更新</span><strong>{new Date(data.activePlan.updatedAt).toLocaleString("zh-CN")}</strong><em>{summary.latestInventoryDate ? `库存快照 ${summary.latestInventoryDate}` : "尚未导入库存"}</em></article>
      </section>
      <SizeInventoryOverview summary={summary} />
      <section className="panel v2-editor-panel"><div className="panel-heading"><div><p className="eyebrow">DAILY PLAN & ACTUAL</p><h2>每日计划与实际对比</h2></div></div><DailyPlanEditor rows={data.activePlan.rows} savedRows={savedRows} business={data.business} onRowsChange={updateRows} onSave={(rows, reason) => void savePlan(rows, reason)} locale="zh">
        <ManualSalesForm mappings={plan.primaryMappings} records={data.business} loaded={loaded} onSaved={refresh} />
      </DailyPlanEditor></section>
      <section className="panel v2-import-panel"><div className="panel-heading"><div><p className="eyebrow">AMAZON INVENTORY</p><h2>导入库存报告</h2></div><span className="panel-meta">CSV / XLSX / XLS</span></div><ImportPanel plan={{ sizeBySku: plan.sizeBySku, sizeByAsin: plan.sizeByAsin }} onImported={refresh} /></section>
      <section className="panel v2-editor-panel"><InventoryEditor inventory={data.inventory} inbound={data.inbound} updatedAt={now()} onSaved={() => void refresh()} locale="zh" /></section>
      <InventoryRiskPanel summary={summary} />
    </main>
  );
}
