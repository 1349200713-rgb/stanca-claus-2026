"use client";

import { useId } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendRow {
  date: string;
  [key: string]: string | number | null;
}

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  axis?: "currency" | "price" | "percentage" | "value";
}

export interface EventMarker {
  date: string;
  label: string;
}

export interface TrendChartProps {
  title: string;
  rows: TrendRow[];
  series: TrendSeries[];
  eventMarkers?: EventMarker[];
}

const currencyTick = (value: number) => value >= 1000 ? `US$${Math.round(value / 1000)}k` : `US$${value}`;
const priceTick = (value: number) => `US$${value.toFixed(1)}`;
const percentTick = (value: number) => `${Math.round(value * 100)}%`;

function usesSecondaryAxis(axis: TrendSeries["axis"]): boolean {
  return axis === "price" || axis === "percentage";
}

function latestSeriesValue(rows: TrendRow[], key: string): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index]?.[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function formatSeriesValue(value: number | null, axis: TrendSeries["axis"]): string {
  if (value === null) return "暂无数据";
  if (axis === "percentage") return `${(value * 100).toFixed(1)}%`;
  if (axis === "price") return `US$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (axis === "currency") return `US$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return value.toLocaleString("en-US");
}

export function TrendChart({ title, rows, series, eventMarkers = [] }: TrendChartProps) {
  const chartSeries = series.map((item) => ({
    ...item,
    yAxisId: usesSecondaryAxis(item.axis) ? "secondary" : "primary",
  }));
  const secondarySeries = chartSeries.find((item) => item.yAxisId === "secondary");
  const axisDescription = chartSeries
    .map((item) => `${item.label}使用${item.yAxisId === "secondary" ? "右轴" : "左轴"}`)
    .join("；");
  const valueDescription = chartSeries
    .map((item) => `${item.label}最新值 ${formatSeriesValue(latestSeriesValue(rows, item.key), item.axis)}`)
    .join("；");
  const headingId = useId();

  return (
    <section className="panel trend-panel" aria-labelledby={headingId}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">TREND</p>
          <h2 id={headingId}>{title}</h2>
        </div>
        <span className="panel-meta">7 日</span>
      </div>
      <ul className="chart-legend" aria-label={`${title}图例`}>
        {chartSeries.map((item) => <li key={item.key}><span className="chart-legend__line" style={{ backgroundColor: item.color }} aria-hidden="true" /><span>{item.label}</span></li>)}
      </ul>
      <div
        className="chart-wrapper"
        role="img"
        aria-label={`${title}折线图`}
        data-chart-kind="line"
        data-axis-count={secondarySeries ? 2 : 1}
      >
        <LineChart accessibilityLayer={false} width={720} height={272} data={rows} margin={{ top: 20, right: 18, left: 0, bottom: 2 }}>
          <CartesianGrid stroke="#e8e6e1" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#68707c", fontSize: 12 }} />
          <YAxis
            yAxisId="primary"
            axisLine={false}
            tickLine={false}
            width={52}
            tick={{ fill: "#68707c", fontSize: 11 }}
            tickFormatter={currencyTick}
          />
          {secondarySeries ? (
            <YAxis
              yAxisId="secondary"
              orientation="right"
              axisLine={false}
              tickLine={false}
              width={46}
              domain={secondarySeries.axis === "percentage" ? [0, "auto"] : ["auto", "auto"]}
              tick={{ fill: "#68707c", fontSize: 11 }}
              tickFormatter={secondarySeries.axis === "percentage" ? percentTick : priceTick}
            />
          ) : null}
          <Tooltip cursor={{ stroke: "#9f1d28", strokeDasharray: "3 3" }} />
          {eventMarkers.map((marker) => (
            <ReferenceLine
              key={`${marker.date}-${marker.label}`}
              x={marker.date}
              yAxisId="primary"
              stroke="#9a7b2f"
              strokeDasharray="3 3"
              label={{ value: marker.label, position: "insideTopRight", fill: "#735b20", fontSize: 10 }}
            />
          ))}
          {chartSeries.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              yAxisId={item.yAxisId}
              stroke={item.color}
              strokeWidth={2.25}
              dot={{ r: 2.5, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </div>
      {eventMarkers.length > 0 ? (
        <ul className="chart-events" aria-label={`${title}事件标记`}>
          {eventMarkers.map((marker) => <li key={`${marker.date}-${marker.label}-legend`}><span>{marker.date}</span>{marker.label}</li>)}
        </ul>
      ) : null}
      <p className="sr-only">{title}按日期展示多指标折线，{axisDescription}；{valueDescription}；空值保持断点。</p>
    </section>
  );
}
