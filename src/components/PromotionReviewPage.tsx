"use client";

import { useState } from "react";
import type { AdRecord, BusinessRecord } from "../domain/types";
import type { DailyOperationRecord, PromotionPlanOverride } from "../domain/planning";
import { buildPromotionAnalyticsRows } from "../integration/promotion-analytics";
import { TrendChart } from "./TrendChart";

export interface PromotionReviewPageProps {
  ads: readonly AdRecord[];
  business: readonly BusinessRecord[];
  overrides: readonly PromotionPlanOverride[];
  operations: readonly DailyOperationRecord[];
  startDate: string;
  endDate: string;
  onBack: () => void;
}

const money = (value: number | null) => value === null ? "—" : `US$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;

export function PromotionReviewPage({ ads, business, overrides, operations, startDate, endDate, onBack }: PromotionReviewPageProps) {
  const rows = buildPromotionAnalyticsRows({ ads, business, overrides, startDate, endDate, asOfDate: new Date().toISOString().slice(0, 10) });
  const [range, setRange] = useState<7 | 14 | 30 | "custom">(7);
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const rangedRows = range === "custom"
    ? rows.filter((row) => row.date >= customStart && row.date <= customEnd)
    : rows.slice(-range);
  const chartRows = rangedRows.map((row) => ({
    date: row.date.slice(5),
    targetUnits: row.targetDailyUnits,
    actualUnits: row.actualUnits,
    plannedAd: row.plannedAdBudgetNumber,
    adSpend: row.adSpend,
    targetAcos: row.targetAcosNumber,
    acos: row.acos,
    plannedSales: row.plannedSalesNumber,
    actualSales: row.actualSales,
    impressions: row.impressions,
    clicks: row.clicks,
    sessions: row.sessions,
    totalOrders: row.totalOrders,
    ctr: row.ctr,
    cvr: row.cvr,
    tacos: row.tacos,
    cpc: row.cpc,
  }));
  const eventMarkers = operations
    .filter((row) => row.date >= startDate && row.date <= endDate)
    .map((row) => ({ date: row.date.slice(5), label: row.action }));
  const operationDates = new Set(operations.map((row) => row.date));
  const anomalyRows = rows.filter((row) => row.anomalies.length > 0).slice(0, 30);
  const totalTarget = rows.reduce((sum, row) => sum + row.targetDailyUnits, 0);
  const observedActual = rows.map((row) => row.actualUnits).filter((value): value is number => value !== null);
  const totalActual = observedActual.length ? observedActual.reduce((sum, value) => sum + value, 0) : null;
  const totalPlanAd = rows.reduce((sum, row) => sum + (row.plannedAdBudgetNumber ?? 0), 0);
  const observedAdSpend = rows.map((row) => row.adSpend).filter((value): value is number => value !== null);
  const totalAdSpend = observedAdSpend.length ? observedAdSpend.reduce((sum, value) => sum + value, 0) : null;

  return (
    <main className="dashboard-shell promotion-shell">
      <header className="dashboard-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">AD</span><div>
          <p className="brand-kicker">PROMOTION REVIEW</p><h1>推广复盘图表</h1>
          <p className="as-of">复盘区间 · {startDate} 至 {endDate}</p>
        </div></div>
        <button className="secondary-button" type="button" onClick={onBack}>返回推广作战看板</button>
      </header>
      <section className="promotion-kpi-grid" aria-label="推广复盘核心指标">
        <article><span>计划销量</span><strong>{Math.round(totalTarget)}</strong></article>
        <article><span>实际销量</span><strong>{totalActual === null ? "—" : Math.round(totalActual)}</strong></article>
        <article><span>销量完成率</span><strong>{percent(totalTarget && totalActual !== null ? totalActual / totalTarget : null)}</strong></article>
        <article><span>计划广告额度</span><strong>{money(totalPlanAd)}</strong></article>
        <article><span>实际广告花费</span><strong>{money(totalAdSpend)}</strong></article>
        <article><span>异常天数</span><strong>{rows.filter((row) => row.anomalies.length > 0).length}</strong></article>
      </section>
      <section className="panel promotion-range-panel" aria-label="复盘图表区间">
        <div className="filter-actions" role="group" aria-label="选择复盘区间">
          {([7, 14, 30] as const).map((days) => <button key={days} className={range === days ? "primary-button" : "secondary-button"} type="button" onClick={() => setRange(days)}>{days}日</button>)}
          <button className={range === "custom" ? "primary-button" : "secondary-button"} type="button" onClick={() => setRange("custom")}>自定义</button>
        </div>
        {range === "custom" ? <div className="date-range-fields">
          <label>开始日期<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
          <label>结束日期<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
        </div> : null}
      </section>
      <section className="trend-grid" aria-label="推广复盘图表">
        <TrendChart title="计划销量 vs 实际销量" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "actualUnits", label: "实际销量", color: "#9f1d28", axis: "value" }, { key: "targetUnits", label: "目标销量", color: "#526277", axis: "value" }]} />
        <TrendChart title="计划广告 vs 实际广告" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "adSpend", label: "实际广告", color: "#9f1d28", axis: "currency" }, { key: "plannedAd", label: "计划广告", color: "#526277", axis: "currency" }]} />
        <TrendChart title="目标ACOS vs 实际ACOS" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "acos", label: "实际ACOS", color: "#9f1d28", axis: "percentage" }, { key: "targetAcos", label: "目标ACOS", color: "#526277", axis: "percentage" }]} />
        <TrendChart title="计划销售额 vs 实际销售额" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "actualSales", label: "实际销售额", color: "#9f1d28", axis: "currency" }, { key: "plannedSales", label: "计划销售额", color: "#526277", axis: "currency" }]} />
        <TrendChart title="曝光量 / 点击量" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "impressions", label: "曝光量", color: "#526277", axis: "value" }, { key: "clicks", label: "点击量", color: "#9f1d28", axis: "value" }]} />
        <TrendChart title="访问量 / 订单量" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "sessions", label: "访问量", color: "#526277", axis: "value" }, { key: "totalOrders", label: "订单量", color: "#9f1d28", axis: "value" }]} />
        <TrendChart title="CTR / CVR" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "ctr", label: "CTR", color: "#526277", axis: "percentage" }, { key: "cvr", label: "CVR", color: "#9f1d28", axis: "percentage" }]} />
        <TrendChart title="CPC / 广告花费" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "cpc", label: "CPC", color: "#b9822b", axis: "price" }, { key: "adSpend", label: "广告花费", color: "#9f1d28", axis: "currency" }]} />
        <TrendChart title="ACOS / TACOS" rows={chartRows} eventMarkers={eventMarkers} series={[{ key: "acos", label: "ACOS", color: "#9f1d28", axis: "percentage" }, { key: "tacos", label: "TACOS", color: "#b9822b", axis: "percentage" }]} />
      </section>
      <section className="panel promotion-table-panel" aria-labelledby="promotion-anomaly-heading">
        <div className="panel-heading"><div><p className="eyebrow">EXCEPTION REVIEW</p><h2 id="promotion-anomaly-heading">异常提醒清单</h2></div><span className="panel-meta">按天发现问题</span></div>
        <div className="table-scroll">
          <table aria-label="推广异常提醒表">
            <thead><tr><th scope="col">日期</th><th scope="col">阶段</th><th scope="col">目标/实际销量</th><th scope="col">广告</th><th scope="col">ACOS</th><th scope="col">异常</th><th scope="col">操作记录</th></tr></thead>
            <tbody>{anomalyRows.map((row) => (
              <tr key={row.date}>
                <th scope="row">{row.date}</th><td>{row.phase}</td><td>{row.targetDailyUnits} / {row.actualUnits ?? "尚未导入"}</td><td>{money(row.plannedAdBudgetNumber)} / {row.adSpend === null ? "尚未导入" : money(row.adSpend)}</td><td>{percent(row.targetAcosNumber)} / {percent(row.acos)}</td><td>{row.anomalies.join("、")}</td><td>{operationDates.has(row.date) ? "有操作记录" : "未记录"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
