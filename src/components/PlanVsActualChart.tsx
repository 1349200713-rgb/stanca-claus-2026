"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardMode } from "./DashboardFilters";
import { SalesComparisonSummary, type SalesComparisonSummaryProps } from "./SalesComparisonSummary";

export interface PlanActualRow {
  date: string;
  plannedDaily: number | null;
  actualDaily: number | null;
  plannedCumulative: number | null;
  actualCumulative: number | null;
  periodLabel?: string;
}

export interface PlanVsActualChartProps {
  rows: PlanActualRow[];
  mode: DashboardMode;
  summary?: string;
  planSource?: "saved" | "derived";
  dateRangeLabel?: string;
  comparisonLabel?: string;
  comparison?: Omit<SalesComparisonSummaryProps, "label">;
}

export function PlanVsActualChart({ rows, mode, summary = "暂无实际报告数据", planSource = "derived", dateRangeLabel, comparisonLabel, comparison }: PlanVsActualChartProps) {
  const cumulative = mode === "cumulative";
  const modeLabel = cumulative ? "累计" : mode === "weekly" ? "周视图" : "每日";

  return (
    <section className="panel plan-chart-panel" aria-labelledby="plan-actual-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PACE CONTROL</p>
          <h2 id="plan-actual-heading">计划销量 vs 实际销量</h2>
          <p className="derived-plan-label">计划来源：{planSource === "saved" ? "计划与库存 · 已保存日度计划" : "工作簿推导计划 · 按权威尺码总量比例缩放"}</p>
        </div>
        <span className="panel-meta">{modeLabel}</span>
      </div>
      {dateRangeLabel ? <p className="sales-scope-label">图表区间：{dateRangeLabel}</p> : null}
      {comparisonLabel ? <p className="sales-scope-label">摘要口径：{comparisonLabel}</p> : null}
      {comparison ? <SalesComparisonSummary {...comparison} label="趋势销量摘要" /> : null}
      <ul className="chart-legend" aria-label="销量图例">
        <li><span className="chart-legend__line" style={{ backgroundColor: "#2563a8" }} aria-hidden="true" /><span>实际销量</span><span className="legend-line-description">蓝色实线</span></li>
        <li><span className="chart-legend__line chart-legend__line--planned" aria-hidden="true" /><span>计划销量</span><span className="legend-line-description">灰色虚线</span></li>
      </ul>
      <div className="chart-wrapper chart-wrapper--large" role="img" aria-label="计划销量 vs 实际销量折线图" data-chart-kind="line">
        <LineChart accessibilityLayer={false} width={920} height={342} data={rows} margin={{ top: 16, right: 22, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#e8e6e1" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#68707c", fontSize: 12 }} />
          <YAxis axisLine={false} tickLine={false} width={42} tick={{ fill: "#68707c", fontSize: 11 }} />
          <Tooltip cursor={{ stroke: "#2563a8", strokeDasharray: "3 3" }} labelFormatter={(_, payload) => payload[0]?.payload?.periodLabel ?? payload[0]?.payload?.date ?? ""} formatter={(value, name) => [typeof value === "number" ? `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 件` : "未录入", name]} />
          <Line
            type="monotone"
            dataKey={cumulative ? "plannedCumulative" : "plannedDaily"}
            name="计划销量"
            stroke="#64748b"
            strokeWidth={2.4}
            strokeDasharray="7 5"
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey={cumulative ? "actualCumulative" : "actualDaily"}
            name="实际销量"
            stroke="#2563a8"
            strokeWidth={2.8}
            dot={{ r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        </LineChart>
      </div>
      <p className="chart-summary">{summary}</p>
    </section>
  );
}
