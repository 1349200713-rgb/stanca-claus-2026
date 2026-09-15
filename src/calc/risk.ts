import type { MetricSnapshot, RiskSignal, Status } from "../domain/types";

export interface RiskTargets {
  completionRate?: number;
  targetAcos?: number;
  targetGrossMargin?: number;
  daysRemaining?: number;
}

export interface SizeRiskInput {
  size: string;
  metrics: MetricSnapshot;
  targets?: RiskTargets;
  trend?: MetricTrend;
}

export interface MetricTrend {
  values: readonly number[];
  direction: "rising-is-worse" | "falling-is-worse";
}

type TrendInput = readonly number[] | MetricTrend;

function normalizeTrend(trend: TrendInput): MetricTrend {
  return Array.isArray(trend)
    ? { values: trend, direction: "falling-is-worse" }
    : trend as MetricTrend;
}

const signal = (id: string, label: string, status: Status, detail: string): RiskSignal => ({
  id,
  label,
  status,
  detail,
});

function evaluateMetricRisks(
  metrics: MetricSnapshot,
  targets: Readonly<RiskTargets>,
  trendInput: TrendInput,
  prefix = "",
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const id = (name: string) => `${prefix}${name}`;
  const completionTarget = targets.completionRate ?? 0.9;

  if (metrics.completionRate === null) {
    signals.push(signal(id("completion-data"), "数据不足", "attention", "无法计算完成率。"));
  } else if (metrics.completionRate < completionTarget) {
    signals.push(signal(id("completion"), "完成率风险", "risk", "完成率低于目标。"));
  }

  if (metrics.overstockRate === null) {
    signals.push(signal(id("overstock-data"), "数据不足", "attention", "无法计算积压率。"));
  } else if (metrics.overstockRate > 0.25) {
    signals.push(signal(id("overstock"), "库存积压", "risk", "预计期末库存超过可接受范围。"));
  } else if (metrics.overstockRate > 0.15) {
    signals.push(signal(id("overstock"), "库存积压", "attention", "预计期末库存偏高。"));
  }

  if (metrics.acos === null) {
    signals.push(signal(id("acos-data"), "数据不足", "attention", "无法计算 ACOS。"));
  } else if (targets.targetAcos !== undefined && metrics.acos > targets.targetAcos) {
    signals.push(signal(id("acos"), "广告成本风险", "risk", "ACOS 高于目标。"));
  }

  if (metrics.grossMargin === null) {
    signals.push(signal(id("gross-margin-data"), "数据不足", "attention", "无法计算毛利率。"));
  } else if (targets.targetGrossMargin !== undefined && metrics.grossMargin < targets.targetGrossMargin) {
    signals.push(signal(id("gross-margin"), "毛利率风险", "risk", "毛利率低于目标。"));
  }

  if (metrics.daysToStockout === null) {
    signals.push(signal(id("stockout-data"), "数据不足", "attention", "无法计算断货天数。"));
    if (metrics.availableInventory !== null && metrics.last7DayAverageUnits === 0) {
      signals.push(signal(id("stale-inventory"), "滞销/积压风险", "attention", "近 7 日无销量，库存周转无法评估。"));
    }
  } else if (targets.daysRemaining !== undefined && metrics.daysToStockout < targets.daysRemaining) {
    signals.push(signal(id("stockout"), "缺货风险", "risk", "预计在季末前断货。"));
  }

  const trend = normalizeTrend(trendInput);
  const recent = trend.values.slice(-3);
  const deteriorating = recent.length >= 3 && recent.slice(1).every((value, index) =>
    trend.direction === "rising-is-worse" ? value > recent[index] : value < recent[index]);
  if (deteriorating) {
    signals.push(signal(id("deterioration"), "趋势异常", "risk", "连续三次观测恶化。"));
  }

  return signals;
}

/** Evaluates aggregate and optional size-level risks without mutating any inputs. */
export function evaluateRisks(
  metrics: Readonly<MetricSnapshot>,
  targets: Readonly<RiskTargets> = {},
  trend: TrendInput = [],
  optionalSize?: Readonly<SizeRiskInput> | readonly Readonly<SizeRiskInput>[],
): RiskSignal[] {
  const sizes = optionalSize === undefined ? [] : Array.isArray(optionalSize) ? optionalSize : [optionalSize];
  return [
    ...evaluateMetricRisks(metrics, targets, trend),
    ...sizes.flatMap((size) => evaluateMetricRisks(
      size.metrics,
      size.targets ?? targets,
      size.trend ?? trend,
      `size-${size.size}-`,
    )),
  ];
}
