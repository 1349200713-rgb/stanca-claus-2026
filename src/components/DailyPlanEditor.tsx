"use client";

import { useState, type ChangeEvent } from "react";
import { summarizePlan, validatePlan } from "../calc/daily-plan";
import type { SizeCode } from "../domain/types";
import type { DailyPlanRow } from "../domain/planning";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

export interface DailyPlanEditorProps {
  rows: readonly DailyPlanRow[];
  onRowsChange: (rows: DailyPlanRow[]) => void;
  onSave: (rows: DailyPlanRow[], reason: string) => void;
  locale?: "en" | "zh";
}

function formatShare(share: number | null): string {
  return share === null ? "—" : `${(share * 100).toFixed(1)}%`;
}

export function DailyPlanEditor({ rows, onRowsChange, onSave, locale = "en" }: DailyPlanEditorProps) {
  const [reason, setReason] = useState("");
  const summary = summarizePlan(rows);
  const validation = validatePlan(rows);
  const validReason = reason.trim().length > 0;
  const dates = [...new Set(rows.map((row) => row.date))];
  const zh = locale === "zh";

  const updateDate = (currentDate: string, nextDate: string) => {
    onRowsChange(rows.map((row) => ({ ...row, date: row.date === currentDate ? nextDate : row.date })));
  };

  const updateUnits = (date: string, size: SizeCode, event: ChangeEvent<HTMLInputElement>) => {
    const units = Number(event.currentTarget.value);
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
      <p>{zh ? "计划总量" : "Plan total"}: {summary.total}</p>
      <p>{zh ? "相对 3000 件差异" : "Difference from 3000"}: {summary.variance}</p>
      <dl>
        {sizes.map((size) => (
          <div key={size}>
            <dt>{size}</dt>
            <dd>{summary.sizeTotals[size]} ({formatShare(summary.sizeShares[size])})</dd>
          </div>
        ))}
      </dl>
      <table>
        <thead>
          <tr>
            <th scope="col">{zh ? "日期" : "Date"}</th>
            {sizes.map((size) => <th scope="col" key={size}>{size}</th>)}
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => (
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
                  <td key={size}>
                    <label>
                      <span className="sr-only">{date} {size} {zh ? "计划销量" : "units"}</span>
                      <input
                        aria-label={`${date} ${size} ${zh ? "计划销量" : "units"}`}
                        type="number"
                        min="0"
                        step="1"
                        value={row?.units ?? 0}
                        onChange={(event) => updateUnits(date, size, event)}
                      />
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
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
    </section>
  );
}
