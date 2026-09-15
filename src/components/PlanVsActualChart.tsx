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

export interface PlanActualRow {
  date: string;
  plannedDaily: number;
  actualDaily: number | null;
  plannedCumulative: number;
  actualCumulative: number | null;
}

export interface PlanVsActualChartProps {
  rows: PlanActualRow[];
  mode: DashboardMode;
  summary?: string;
}

export function PlanVsActualChart({ rows, mode, summary = "暂无实际报告数据" }: PlanVsActualChartProps) {
  const cumulative = mode === "cumulative";
  const modeLabel = cumulative ? "累计" : mode === "weekly" ? "周视图" : "每日";

  return (
    <section className="panel plan-chart-panel" aria-labelledby="plan-actual-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PACE CONTROL</p>
          <h2 id="plan-actual-heading">计划销量 vs 实际销量</h2>
          <p className="derived-plan-label">推导计划 · 按权威尺码总量比例缩放</p>
        </div>
        <span className="panel-meta">{modeLabel}</span>
      </div>
      <ul className="chart-legend" aria-label="销量图例">
        <li><span className="chart-legend__line" style={{ backgroundColor: "#9f1d28" }} aria-hidden="true" /><span>实际销量</span></li>
        <li><span className="chart-legend__line" style={{ backgroundColor: "#526277" }} aria-hidden="true" /><span>计划销量</span></li>
      </ul>
      <div className="chart-wrapper chart-wrapper--large" role="img" aria-label="计划销量 vs 实际销量折线图" data-chart-kind="line">
        <LineChart accessibilityLayer={false} width={920} height={342} data={rows} margin={{ top: 16, right: 22, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#e8e6e1" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#68707c", fontSize: 12 }} />
          <YAxis axisLine={false} tickLine={false} width={42} tick={{ fill: "#68707c", fontSize: 11 }} />
          <Tooltip cursor={{ stroke: "#9f1d28", strokeDasharray: "3 3" }} />
          <Line
            type="monotone"
            dataKey={cumulative ? "plannedCumulative" : "plannedDaily"}
            name="计划销量"
            stroke="#526277"
            strokeWidth={2.4}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey={cumulative ? "actualCumulative" : "actualDaily"}
            name="实际销量"
            stroke="#9f1d28"
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
