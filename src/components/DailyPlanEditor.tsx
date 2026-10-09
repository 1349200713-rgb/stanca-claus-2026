"use client";

import { Fragment, useId, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { summarizePlan, validatePlan } from "../calc/daily-plan";
import type { BusinessRecord, SizeCode } from "../domain/types";
import type { DailyPlanRow } from "../domain/planning";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

export interface DailyPlanEditorProps {
  rows: readonly DailyPlanRow[];
  onRowsChange: (rows: DailyPlanRow[]) => void;
  onSave: (rows: DailyPlanRow[], reason: string) => void;
  locale?: "en" | "zh";
  business?: readonly BusinessRecord[];
  savedRows?: readonly DailyPlanRow[];
  children?: ReactNode;
}

function formatShare(share: number | null): string {
  return share === null || !Number.isFinite(share) ? "—" : `${(share * 100).toFixed(1)}%`;
}

export function DailyPlanEditor({ rows, onRowsChange, onSave, locale = "en", business = [], savedRows, children }: DailyPlanEditorProps) {
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [showEntry, setShowEntry] = useState(false);
  const detailId = useId();
  const summary = summarizePlan(rows);
  const validation = validatePlan(rows);
  const validReason = reason.trim().length > 0;
  const dates = [...new Set([...rows.map((row) => row.date), ...business.map((row) => row.date)])].sort();
  const zh = locale === "zh";
  const invalidRange = Boolean(startDate && endDate && startDate > endDate);
  const filteredDates = invalidRange ? [] : dates.filter(date => (!startDate || date >= startDate) && (!endDate || date <= endDate));
  const draft = savedRows !== undefined && JSON.stringify(rows) !== JSON.stringify(savedRows);
  const actualByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of business) { const key = `${row.date}:${row.size}`; map.set(key, (map.get(key) ?? 0) + row.units); }
    return map;
  }, [business]);
  const planned = (date: string, size: SizeCode): number | null => {
    const matching = rows.filter(row => row.date === date && row.size === size);
    return matching.length === 1 && Number.isInteger(matching[0].units) && matching[0].units >= 0 ? matching[0].units : null;
  };
  const actual = (date: string, size: SizeCode): number | null => actualByKey.get(`${date}:${size}`) ?? null;
  const difference = (plan: number | null, sales: number | null): number | null => plan === null || sales === null ? null : sales - plan;
  const signed = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value}`;
  const rangeSummary = sizes.map(size => {
    const plans = filteredDates.map(date => planned(date, size));
    const sales = filteredDates.map(date => actual(date, size));
    const total = (values: (number | null)[]) => values.length && values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) : null;
    const plan = total(plans), units = total(sales);
    return { size, plan, units, delta: difference(plan, units), observed: sales.reduce<number>((sum, value) => sum + (value ?? 0), 0), coverage: sales.filter(value => value !== null).length };
  });
  const quickRange = (days: number | null) => {
    if (days === null) { setStartDate(""); setEndDate(""); return; }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const from = new Date(`${today}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - days + 1);
    setStartDate(from.toISOString().slice(0, 10)); setEndDate(today);
  };

  const updateDate = (currentDate: string, nextDate: string) => {
    onRowsChange(rows.map((row) => ({ ...row, date: row.date === currentDate ? nextDate : row.date })));
  };

  const updateUnits = (date: string, size: SizeCode, event: ChangeEvent<HTMLInputElement>) => {
    const units = event.currentTarget.value === "" ? NaN : Number(event.currentTarget.value);
    const existing = rows.find((row) => row.date === date && row.size === size);
    if (existing) {
      onRowsChange(rows.map((row) => (row === existing ? { ...row, units } : { ...row })));
      return;
    }
    onRowsChange([...rows.map((row) => ({ ...row })), { date, size, units }]);
  };

  return (
    <section aria-label="Daily plan editor" className="daily-plan-editor">
      <div
        role="status"
        data-state={validation.valid ? "valid" : "invalid"}
        className={`daily-plan-editor__validation daily-plan-editor__validation--${validation.valid ? "valid" : "invalid"}`}
        style={{ color: validation.valid ? "green" : "red" }}
      >
        {validation.valid ? (zh ? "计划有效" : "Plan is valid") : (zh ? "计划无效" : "Plan is invalid")}
      </div>
      <p>{zh ? "计划总量" : "Plan total"}: {Number.isFinite(summary.total) ? summary.total : "未填写完整"}</p>
      <p>{zh ? "相对 3000 件差异" : "Difference from 3000"}: {Number.isFinite(summary.variance) ? summary.variance : "—"}</p>
      <div className="daily-comparison-toolbar">
        <label>{zh ? "开始日期" : "Start date"}<input aria-label="对比开始日期" type="date" value={startDate} onChange={event => setStartDate(event.currentTarget.value)} /></label>
        <label>{zh ? "结束日期" : "End date"}<input aria-label="对比结束日期" type="date" value={endDate} onChange={event => setEndDate(event.currentTarget.value)} /></label>
        <button type="button" onClick={() => quickRange(1)}>{zh ? "今天" : "Today"}</button>
        <button type="button" onClick={() => quickRange(7)}>{zh ? "近7天" : "Last 7 days"}</button>
        <button type="button" onClick={() => quickRange(null)}>{zh ? "全部日期" : "All dates"}</button>
        <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>{expanded ? (zh ? "收起日度明细" : "Collapse daily details") : (zh ? "展开日度明细" : "Expand daily details")}</button>
      </div>
      <p className="daily-comparison-scope">{zh ? "筛选范围" : "Range"}：{startDate || (zh ? "不限开始" : "Any start")} — {endDate || (zh ? "不限结束" : "Any end")} · {filteredDates.length} {zh ? "个记录日期" : "record dates"}。{draft ? "计划为未保存草稿，保存后才生效。" : "计划来源：已保存日度计划。"} 实际取已保存销量；差异 = 实际 − 计划。缺数据不补零。筛选不改变完整计划的保存范围。
      </p>
      {invalidRange ? <p role="alert">开始日期不能晚于结束日期。</p> : null}
      <dl className="daily-comparison-summary">
        {rangeSummary.map(({size,plan,units,delta,observed,coverage}) => <div key={size} aria-label={`${size} 筛选汇总`}>
          <dt>{size}</dt><dd>计划 {plan ?? "未设完整计划"} · 实际 {units ?? (coverage ? `数据不全（已录入 ${observed} 件）` : "未录入")}</dd>
          <dd className={delta === null ? "" : delta < 0 ? "daily-variance--behind" : "daily-variance--ahead"}>差异 {signed(delta)} · {coverage}/{filteredDates.length} 天已录入</dd>
          <dd className="daily-full-size-total">全计划 {Number.isFinite(summary.sizeTotals[size]) ? summary.sizeTotals[size] : "未填写完整"}（{formatShare(summary.sizeShares[size])}）</dd>
        </div>)}
      </dl>
      <div id={detailId} hidden={!expanded} className="daily-comparison-details">
      {children ? <><button type="button" aria-expanded={showEntry} onClick={() => setShowEntry(value => !value)}>{showEntry ? "收起销量录入" : "手动录入实际销量"}</button><div hidden={!showEntry}>{children}</div></> : null}
      {!filteredDates.length && !invalidRange ? <p>所选日期没有计划或销量记录，请调整日期或手动录入。</p> : null}
      <div className="table-scroll"><table aria-label="每日尺码计划与实际对比" className="daily-comparison-table">
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>{zh ? "日期" : "Date"}</th>
            {sizes.map((size) => <th scope="colgroup" colSpan={3} key={size}>{size}</th>)}
          </tr>
          <tr>{sizes.map(size => <Fragment key={size}><th scope="col">计划（可修改）</th><th scope="col">实际</th><th scope="col">差异</th></Fragment>)}</tr>
        </thead>
        <tbody>
          {filteredDates.map((date) => (
            <tr key={date}>
              <td>
                <label>
                  <span className="sr-only">{zh ? `${date} 日期` : `Date for ${date}`}</span>
                  <input aria-label={zh ? `${date} 日期` : `Date for ${date}`} type="date" value={date} onChange={(event) => updateDate(date, event.currentTarget.value)} />
                </label>
              </td>
              {sizes.map((size) => {
                const row = rows.find((candidate) => candidate.date === date && candidate.size === size);
                return (
                  <Fragment key={size}><td>
                    <label>
                      <span className="sr-only">{date} {size} {zh ? "计划销量" : "units"}</span>
                      <input
                        aria-label={`${date} ${size} ${zh ? "计划销量" : "units"}`}
                        type="number"
                        min="0"
                        step="1"
                        value={row && Number.isFinite(row.units) ? row.units : ""}
                        placeholder="未设计划"
                        onChange={(event) => updateUnits(date, size, event)}
                      />
                    </label>
                  </td><td aria-label={`${date} ${size} 实际销量`} className="daily-actual">{actual(date, size) ?? "未录入"}</td><td aria-label={`${date} ${size} 销量差异`} className={difference(planned(date,size),actual(date,size)) === null ? "" : difference(planned(date,size),actual(date,size))! < 0 ? "daily-variance--behind" : "daily-variance--ahead"}>{signed(difference(planned(date,size),actual(date,size)))}</td></Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table></div>
      <label>
        {zh ? "调整原因" : "Adjustment reason"}
        <input aria-label={zh ? "调整原因" : undefined} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
      </label>
      <button
        type="button"
        disabled={!validation.valid || !validReason}
        onClick={() => onSave(rows.map((row) => ({ ...row })), reason.trim())}
      >
        {zh ? "保存计划" : "Save plan"}
      </button>
      </div>
    </section>
  );
}
