"use client";

import { useId, useMemo, useState } from "react";
import type { PlanModel } from "../data/plan";
import type { ActivePlan, DailyOperationDraft } from "../domain/planning";
import type { BusinessRecord, SizeCode } from "../domain/types";
import { buildDailySizeComparison, type DailySizeComparisonRow } from "../integration/daily-size-comparison";

interface Props {
  plan: PlanModel;
  activePlan: ActivePlan | null;
  business: readonly BusinessRecord[];
  loaded: boolean;
  fallbackDate: string;
  onOpenPlan: () => void;
  onCreateOperation?: (draft: DailyOperationDraft) => void;
}

const units = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const statusLabels: Record<DailySizeComparisonRow["status"], string> = {
  complete: "已达标", risk: "未达标", missing: "未导入", "no-plan": "未设计划",
};

export function DailySizeComparison({ plan, activePlan, business, loaded, fallbackDate, onOpenPlan, onCreateOperation }: Props) {
  const headingId = useId();
  const [selectedDate, setSelectedDate] = useState("");
  const latestDate = useMemo(() => business.reduce((latest, row) => row.date > latest ? row.date : latest, ""), [business]);
  const date = selectedDate || latestDate || fallbackDate;
  const comparison = useMemo(() => buildDailySizeComparison({ date, plan, activePlan, business }), [date, plan, activePlan, business]);
  const partial = comparison.observedSizeCount > 0 && comparison.observedSizeCount < 4;

  function operationDraft(row: DailySizeComparisonRow): DailyOperationDraft {
    const size = row.size as SizeCode;
    if (row.status === "missing") return {
      date, size, category: "其他", priority: "高", action: `补充 ${size} 码当日销量数据`,
      risk: `${size} 码尚未导入 ${date} 的实际销量，无法判断是否达标。`,
      tomorrowPlan: "补充业务报告后复核计划完成率与异常原因",
    };
    if (row.status === "no-plan") return {
      date, size, category: "其他", priority: "高", action: `补充 ${size} 码日销量计划`,
      risk: `${size} 码已有实际销量，但尚未设置 ${date} 的日计划。`,
      tomorrowPlan: "在计划与库存页补充日计划后复核完成率",
    };
    const shortfall = Math.abs(row.variance ?? 0);
    const completion = ((row.completionRate ?? 0) * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
    return {
      date, size, category: "其他", priority: "高", action: `排查 ${size} 码销量落后计划的原因`,
      risk: `${size} 码实际销量 ${units(row.actualUnits ?? 0)} 件，较计划少 ${units(shortfall)} 件（完成率 ${completion}%）`,
      tomorrowPlan: "核查广告、价格、库存与关键词排名后制定调整动作",
    };
  }

  function renderRow(row: DailySizeComparisonRow) {
    const total = row.size === "total";
    const missingText = total && partial ? "数据不全" : "未导入";
    return <tr key={row.size} data-state={row.status} className={total ? "daily-size-total" : undefined}>
      <th scope="row">{total ? "合计" : row.size}</th>
      <td>{row.plannedUnits === null ? "未设计划" : units(row.plannedUnits)}</td>
      <td>{row.actualUnits === null ? missingText : units(row.actualUnits)}</td>
      <td className="daily-size-result">{row.variance === null ? "—" : `${row.variance > 0 ? "+" : ""}${units(row.variance)}`}</td>
      <td className="daily-size-result">{row.completionRate === null ? "—" : `${(row.completionRate * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`}</td>
      <td><span className={`daily-size-status daily-size-status--${row.status}`}>{total && partial ? "数据不全" : statusLabels[row.status]}</span></td>
    </tr>;
  }

  return <section className="panel daily-size-panel" aria-labelledby={headingId}>
    <div className="panel-heading daily-size-heading">
      <div><p className="eyebrow">DAILY SALES</p><h2 id={headingId}>每日尺码销量对比</h2><p className="daily-size-description">四个尺码一次看完 · 单位：件 · 差额 = 实际 − 计划</p></div>
      <div className="daily-size-controls">
        <label className="filter-control"><span>对比日期</span><input type="date" value={date} onChange={(event) => setSelectedDate(event.currentTarget.value)} /></label>
        <button type="button" className="secondary-button" disabled={!latestDate || !loaded} onClick={() => setSelectedDate("")}>最近有数据日</button>
        <button type="button" className="secondary-button" onClick={onOpenPlan}>调整日计划</button>
      </div>
    </div>
    {loaded ? <div className="table-scroll daily-size-scroll">
      <table className="daily-size-table" aria-label="每日尺码销量对比">
        <thead><tr><th scope="col">尺码</th><th scope="col">计划销量</th><th scope="col">实际销量</th><th scope="col">差额</th><th scope="col">完成率</th><th scope="col">状态</th></tr></thead>
        <tbody>{comparison.rows.map(renderRow)}</tbody>
        <tfoot>{renderRow(comparison.total)}</tfoot>
      </table>
    </div> : null}
    {loaded && onCreateOperation ? <div className="daily-size-actions" aria-label="异常处理入口">
      {comparison.rows.filter((row) => row.status !== "complete").map((row) => (
        <button key={row.size} type="button" className="secondary-button" onClick={() => onCreateOperation(operationDraft(row))}>处理 {row.size} 异常</button>
      ))}
    </div> : null}
    <p className="daily-size-note" role="status" aria-live="polite">{!loaded ? "正在加载销量与计划…" : comparison.observedSizeCount === 0 ? "当天尚未导入销量，请通过首页“导入今日数据”上传业务报告。" : partial ? `已录入 ${comparison.observedSizeCount}/4 个尺码，已录入销量 ${units(comparison.observedUnits)} 件；缺失尺码补齐后显示合计差额和完成率。` : "四个尺码数据齐全。绿色表示达标，红色表示未达标。"}</p>
    <p className="daily-size-source">计划来源：{activePlan ? "计划与库存 · 已保存日度计划" : "原工作簿 · 按尺码分配的推导计划"}。本表始终展示全部尺码，日期以本表选择为准。</p>
  </section>;
}
