"use client";

import type { SizeCode } from "../domain/types";

export type DashboardSize = "all" | SizeCode;
export type DashboardMode = "daily" | "weekly" | "cumulative";

export interface DashboardFiltersProps {
  startDate: string;
  endDate: string;
  size: DashboardSize;
  mode: DashboardMode;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onSizeChange: (size: DashboardSize) => void;
  onModeChange: (mode: DashboardMode) => void;
}

export function DashboardFilters({
  startDate,
  endDate,
  size,
  mode,
  onStartDateChange,
  onEndDateChange,
  onSizeChange,
  onModeChange,
}: DashboardFiltersProps) {
  return (
    <div className="dashboard-filters" aria-label="驾驶舱筛选">
      <label className="filter-control">
        <span>开始日期</span>
        <input type="date" value={startDate} onChange={(event) => onStartDateChange(event.currentTarget.value)} />
      </label>
      <label className="filter-control">
        <span>结束日期</span>
        <input type="date" value={endDate} onChange={(event) => onEndDateChange(event.currentTarget.value)} />
      </label>
      <label className="filter-control filter-control--size">
        <span>尺码</span>
        <select value={size} onChange={(event) => onSizeChange(event.currentTarget.value as DashboardSize)}>
          <option value="all">全部尺码</option>
          <option value="L">L</option>
          <option value="XL">XL</option>
          <option value="2XL">2XL</option>
          <option value="3XL">3XL</option>
        </select>
      </label>
      <fieldset className="mode-filter">
        <legend>统计模式</legend>
        {([
          ["daily", "每日"],
          ["weekly", "每周"],
          ["cumulative", "累计"],
        ] as const).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="dashboard-mode"
              value={value}
              checked={mode === value}
              onChange={() => onModeChange(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
