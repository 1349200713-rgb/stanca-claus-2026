export interface SalesComparisonSummaryProps {
  label: string;
  actualUnits: number | null;
  plannedUnits: number | null;
  variance: number | null;
  completionRate: number | null;
  observedUnits?: number;
  hasPartialActual?: boolean;
}

const units = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function SalesComparisonSummary({ label, actualUnits, plannedUnits, variance, completionRate, observedUnits = 0, hasPartialActual = false }: SalesComparisonSummaryProps) {
  const varianceLabel = variance === null ? "暂不判断" : variance === 0 ? "与计划持平" : `${variance > 0 ? "超出" : "落后"} ${units(Math.abs(variance))} 件`;
  return <dl className="sales-comparison-summary" role="group" aria-label={label}>
    <div className="sales-summary-actual"><dt>实际销量</dt><dd>{actualUnits === null ? hasPartialActual ? "数据不全" : "未录入" : `${units(actualUnits)} 件`}</dd><small>{hasPartialActual ? `已录入 ${units(observedUnits)} 件 · 待补齐` : "来自销量录入 / 业务报告"}</small></div>
    <div className="sales-summary-plan"><dt>计划销量</dt><dd>{plannedUnits === null ? "未设完整计划" : `${units(plannedUnits)} 件`}</dd><small>目标值，不是实际销售结果</small></div>
    <div className={variance === null || variance === 0 ? "" : variance > 0 ? "sales-summary-ahead" : "sales-summary-behind"}><dt>与计划相比</dt><dd>{varianceLabel}</dd><small>差额 = 实际 − 计划</small></div>
    <div><dt>计划完成率</dt><dd>{completionRate === null ? "—" : `${(completionRate * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`}</dd><small>{plannedUnits === 0 ? "计划为 0，不计算比例" : "实际 ÷ 计划 · 100% 为达标"}</small></div>
  </dl>;
}
