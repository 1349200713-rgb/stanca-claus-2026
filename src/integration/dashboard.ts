import { calculateMetrics, type MetricsInput } from "../calc/metrics";
import type { PlanModel } from "../data/plan";
import type { AdRecord, BusinessRecord, ManualRecord, MetricSnapshot, SizeCode } from "../domain/types";
import type { ActivePlan } from "../domain/planning";
import type { DashboardMode, DashboardSize } from "../components/DashboardFilters";
import { evaluateRisks, type RiskTargets } from "../calc/risk";
import type { RiskSignal } from "../domain/types";

const SIZES: SizeCode[] = ["L", "XL", "2XL", "3XL"];

interface WeeklyPlanRow {
  startDate: string;
  endDate: string;
  plannedUnits: number;
  targetPriceUsd: number;
}

export interface DerivedPlanRow {
  date: string;
  size: SizeCode;
  plannedUnits: number;
  targetPrice: number;
}

export interface DashboardSeriesRow extends MetricSnapshot {
  date: string;
  dataGaps: string[];
}

export interface DashboardSeriesInput {
  plan: PlanModel;
  business: readonly BusinessRecord[];
  ads: readonly AdRecord[];
  manual: readonly ManualRecord[];
  startDate: string;
  endDate: string;
  size: DashboardSize;
  mode: DashboardMode;
  /** Persisted V2 daily plan, which takes precedence after a user saves it. */
  activePlan?: ActivePlan | null;
}

export function mergeTargets<T extends object>(aggregate: T, size?: Partial<T>): T {
  const merged = { ...aggregate };
  if (!size) return merged;
  for (const [key, value] of Object.entries(size as Record<string, unknown>)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

export function trendIsDeteriorating(
  metric: "acos" | "grossMargin" | "completionRate",
  values: readonly (number | null)[],
): boolean {
  if (values.length < 3) return false;
  const recent = values.slice(-3);
  if (recent.some((value) => value === null)) return false;
  const numeric = recent as number[];
  return numeric.slice(1).every((value, index) => metric === "acos" ? value > numeric[index] : value < numeric[index]);
}

export function selectDashboardSnapshot(rows: readonly DashboardSeriesRow[], mode: DashboardMode): DashboardSeriesRow | undefined {
  return mode === "daily"
    ? rows.toReversed().find((row) => row.actualUnits !== null || row.adSpend !== null) ?? rows.at(-1)
    : rows.at(-1);
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  while (cursor <= finish) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function monday(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}

/** Scales preserved raw weekly weights to procurement-authoritative size totals. */
export function deriveDailyPlan(plan: PlanModel, activePlan?: ActivePlan | null): DerivedPlanRow[] {
  if (activePlan) {
    const weekly = plan.weeklyPlanRows as WeeklyPlanRow[];
    const fallbackPrice = Number(plan.targetThresholds.minimumWeightedPriceUsd);
    return activePlan.rows.map((row) => {
      const source = weekly.find((week) => row.date >= week.startDate && row.date <= week.endDate);
      return { date: row.date, size: row.size, plannedUnits: row.units, targetPrice: source?.targetPriceUsd ?? fallbackPrice };
    });
  }
  const weekly = plan.weeklyPlanRows as WeeklyPlanRow[];
  const rawTotal = weekly.reduce((sum, row) => sum + row.plannedUnits, 0);
  const rows: DerivedPlanRow[] = [];

  for (const size of SIZES) {
    for (const week of weekly) {
      const days = datesBetween(week.startDate, week.endDate);
      const weeklySizeUnits = rawTotal === 0 ? 0 : plan.sizeTotals[size] * week.plannedUnits / rawTotal;
      for (const date of days) {
        rows.push({ date, size, plannedUnits: weeklySizeUnits / days.length, targetPrice: week.targetPriceUsd });
      }
    }
    const sizeRows = rows.filter((row) => row.size === size);
    const difference = plan.sizeTotals[size] - sizeRows.reduce((sum, row) => sum + row.plannedUnits, 0);
    if (sizeRows.length) sizeRows[sizeRows.length - 1].plannedUnits += difference;
  }
  return rows;
}

function campaignSize(campaign: string, plan: PlanModel): SizeCode | undefined {
  const normalized = campaign.toLowerCase();
  for (const mapping of plan.primaryMappings) {
    if (normalized.includes(mapping.asin.toLowerCase()) || normalized.includes(mapping.sku.toLowerCase())) return mapping.size;
  }
  return (["3XL", "2XL", "XL", "L"] as SizeCode[])
    .find((size) => new RegExp(`(^|[^a-z0-9])${size.toLowerCase()}([^a-z0-9]|$)`, "i").test(campaign));
}

interface Bucket {
  date: string;
  sourceEndDate: string;
  sizes: SizeCode[];
  plan: DerivedPlanRow[];
  business: BusinessRecord[];
  ads: AdRecord[];
  manual: ManualRecord[];
}

interface ProjectionContext {
  plan: DerivedPlanRow[];
  manual: ManualRecord[];
}

function toInput(bucket: Bucket, plan: PlanModel, projection: ProjectionContext): { input: MetricsInput; dataGaps: string[] } {
  const dataGaps: string[] = [];
  const businessKnown = bucket.business.length > 0;
  const adsKnown = bucket.ads.length > 0;
  const actualUnits = bucket.business.reduce((sum, row) => sum + row.units, 0);
  const sales = bucket.business.reduce((sum, row) => sum + row.sales, 0);
  const plannedUnits = bucket.plan.reduce((sum, row) => sum + row.plannedUnits, 0);
  const plannedSales = bucket.plan.reduce((sum, row) => sum + row.plannedUnits * row.targetPrice, 0);
  const costs = plan.costAssumptions;
  const purchase = costs.purchaseCostUsdPerUnit;
  const inboundUnit = costs.inboundFreightUsdPerUnit;
  const fbaUnit = costs.fbaFeeUsdPerUnit;
  const commissionRate = costs.referralFeeRate;
  const refundsKnown = businessKnown && bucket.business.every((row) => row.refunds !== undefined);
  const discountsKnown = businessKnown && bucket.business.every((row) => row.discounts !== undefined);
  const refundCount = refundsKnown ? bucket.business.reduce((sum, row) => sum + row.refunds!, 0) : undefined;
  const discounts = discountsKnown ? bucket.business.reduce((sum, row) => sum + row.discounts!, 0) : undefined;
  const latestInventoryRows = bucket.sizes.map((size) => bucket.business
    .filter((row) => row.size === size)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .at(-1));
  const inventoryKnown = latestInventoryRows.length > 0 && latestInventoryRows.every((row) =>
    row !== undefined && row.fbaAvailable !== undefined && row.reserved !== undefined && row.unfulfillable !== undefined);
  const inboundRows = bucket.manual.filter((row) => row.inboundObserved === true && row.inbound !== undefined);
  const inboundKnown = inboundRows.length > 0;
  const trailingStart = new Date(`${bucket.sourceEndDate}T00:00:00Z`);
  trailingStart.setUTCDate(trailingStart.getUTCDate() - 6);
  const last7Dates = datesBetween(trailingStart.toISOString().slice(0, 10), bucket.sourceEndDate);
  const observedDates = new Set(bucket.business.map((row) => row.date));
  const trailingKnown = last7Dates.every((date) => observedDates.has(date));
  const last7DayAverageUnits = trailingKnown
    ? bucket.business.filter((row) => row.date >= last7Dates[0] && row.date <= last7Dates[6]).reduce((sum, row) => sum + row.units, 0) / 7
    : undefined;
  const futureManual = projection.manual.filter((row) => row.date > bucket.sourceEndDate && row.date <= plan.seasonEndDate);
  const projectionKnown = projection.manual.some((row) => row.inboundObserved === true && row.inbound !== undefined);
  const inSeasonInbound = projectionKnown ? futureManual.reduce((sum, row) => sum + (row.inbound ?? 0), 0) : undefined;
  const projectedRemainingSeasonSales = projection.plan
    .filter((row) => row.date > bucket.sourceEndDate && row.date <= plan.seasonEndDate)
    .reduce((sum, row) => sum + row.plannedUnits, 0);

  if (!businessKnown) dataGaps.push("业务报告");
  if (!adsKnown) dataGaps.push("广告报告");
  if (!refundsKnown) dataGaps.push("退款");
  if (!discountsKnown) dataGaps.push("折扣");
  if (purchase === undefined || inboundUnit === undefined || fbaUnit === undefined || commissionRate === undefined) dataGaps.push("成本假设");
  if (!inventoryKnown || !inboundKnown) dataGaps.push("库存");
  if (!trailingKnown) dataGaps.push("近7日销量");
  if (!projectionKnown) dataGaps.push("未来入库");

  return { input: {
    plannedUnits,
    ...(businessKnown ? { actualUnits } : {}),
    targetPrice: plannedUnits === 0 ? 0 : plannedSales / plannedUnits,
    ...(businessKnown ? { sales } : {}),
    ...(purchase === undefined || !businessKnown ? {} : { productCost: actualUnits * purchase }),
    ...(inboundUnit === undefined || !businessKnown ? {} : { inboundCost: actualUnits * inboundUnit }),
    ...(fbaUnit === undefined || !businessKnown ? {} : { fbaFees: actualUnits * fbaUnit }),
    ...(commissionRate === undefined || !businessKnown ? {} : { commission: sales * commissionRate }),
    ...(adsKnown ? { adSpend: bucket.ads.reduce((sum, row) => sum + row.spend, 0), adSales: bucket.ads.reduce((sum, row) => sum + row.adSales, 0) } : {}),
    ...(discounts === undefined ? {} : { discounts }),
    ...(purchase === undefined || refundCount === undefined ? {} : { refundLoss: refundCount * purchase }),
    ...(inventoryKnown ? {
      fbaAvailable: latestInventoryRows.reduce((sum, row) => sum + row!.fbaAvailable!, 0) +
        bucket.manual.reduce((sum, row) => sum + (row.inventoryAdjustment ?? 0), 0),
      reserved: latestInventoryRows.reduce((sum, row) => sum + row!.reserved!, 0),
      unfulfillable: latestInventoryRows.reduce((sum, row) => sum + row!.unfulfillable!, 0),
    } : {}),
    ...(inboundKnown ? { inbound: inboundRows.reduce((sum, row) => sum + row.inbound!, 0) } : {}),
    ...(last7DayAverageUnits === undefined ? {} : { last7DayAverageUnits }),
    ...(inSeasonInbound === undefined ? {} : { inSeasonInbound }),
    ...(inventoryKnown && inboundKnown ? { projectedRemainingSeasonSales } : {}),
  }, dataGaps: [...new Set(dataGaps)] };
}

function calculateBucket(bucket: Bucket, plan: PlanModel, projection: ProjectionContext): DashboardSeriesRow {
  const { input, dataGaps } = toInput(bucket, plan, projection);
  return { date: bucket.date, ...calculateMetrics(input), dataGaps };
}

export function buildDashboardSeries(input: DashboardSeriesInput): DashboardSeriesRow[] {
  const allowed = input.size === "all" ? new Set(SIZES) : new Set<SizeCode>([input.size]);
  const days = datesBetween(input.startDate, input.endDate);
  const derived = deriveDailyPlan(input.plan, input.activePlan).filter((row) => allowed.has(row.size) && row.date >= input.startDate && row.date <= input.endDate);
  const business = input.business.filter((row) => allowed.has(row.size) && row.date >= input.startDate && row.date <= input.endDate);
  const ads = input.ads.filter((row) => {
    if (row.date < input.startDate || row.date > input.endDate) return false;
    return input.size === "all" || campaignSize(row.campaign, input.plan) === input.size;
  });
  const allManual = input.manual.filter((row) => allowed.has(row.size));
  const manual = allManual.filter((row) => row.date >= input.startDate && row.date <= input.endDate);
  const allDerived = deriveDailyPlan(input.plan, input.activePlan).filter((row) => allowed.has(row.size));
  const projection = { plan: allDerived, manual: allManual };
  const daily = days.map<Bucket>((date) => ({
    date,
    sourceEndDate: date,
    sizes: [...allowed],
    plan: derived.filter((row) => row.date === date),
    business: business.filter((row) => row.date === date),
    ads: ads.filter((row) => row.date === date),
    manual: manual.filter((row) => row.date === date),
  }));

  if (input.mode === "daily") return daily.map((bucket) => calculateBucket(bucket, input.plan, projection));
  if (input.mode === "weekly") {
    const buckets = new Map<string, Bucket>();
    for (const day of daily) {
      const key = monday(day.date);
      const bucket = buckets.get(key) ?? { date: key, sourceEndDate: day.sourceEndDate, sizes: day.sizes, plan: [], business: [], ads: [], manual: [] };
      bucket.sourceEndDate = day.sourceEndDate;
      bucket.plan.push(...day.plan);
      bucket.business.push(...day.business);
      bucket.ads.push(...day.ads);
      bucket.manual.push(...day.manual);
      buckets.set(key, bucket);
    }
    return [...buckets.values()].map((bucket) => calculateBucket(bucket, input.plan, projection));
  }

  const cumulative: Bucket = { date: "", sourceEndDate: "", sizes: [...allowed], plan: [], business: [], ads: [], manual: [] };
  return daily.map((day) => {
    cumulative.date = day.date;
    cumulative.sourceEndDate = day.sourceEndDate;
    cumulative.plan.push(...day.plan);
    cumulative.business.push(...day.business);
    cumulative.ads.push(...day.ads);
    cumulative.manual.push(...day.manual);
    return calculateBucket(cumulative, input.plan, projection);
  });
}

function aggregateTargets(plan: PlanModel): RiskTargets {
  return {
    completionRate: 0.9,
    targetAcos: Number(plan.targetThresholds.targetAcosRate),
    targetGrossMargin: Number(plan.targetThresholds.targetNetMarginRate),
  };
}

export function targetsForSize(plan: PlanModel, size: SizeCode): RiskTargets {
  const aggregate = aggregateTargets(plan);
  const keyed = plan.targetThresholds as Record<string, string | number | undefined>;
  return mergeTargets(aggregate, {
    completionRate: typeof keyed[`${size}.completionRate`] === "number" ? keyed[`${size}.completionRate`] as number : undefined,
    targetAcos: typeof keyed[`${size}.targetAcosRate`] === "number" ? keyed[`${size}.targetAcosRate`] as number : undefined,
    targetGrossMargin: typeof keyed[`${size}.targetNetMarginRate`] === "number" ? keyed[`${size}.targetNetMarginRate`] as number : undefined,
  });
}

export interface DashboardRiskResult {
  sizeSignals: Record<SizeCode, RiskSignal[]>;
  aggregateSignals: RiskSignal[];
}

export function evaluateDashboardRisks(input: Omit<DashboardSeriesInput, "size" | "mode"> & { mode?: DashboardMode }): DashboardRiskResult {
  const activeMode = input.mode ?? "cumulative";
  const end = new Date(`${input.endDate}T00:00:00Z`);
  const seasonEnd = new Date(`${input.plan.seasonEndDate}T00:00:00Z`);
  const daysRemaining = Math.max(0, Math.ceil((seasonEnd.getTime() - end.getTime()) / 86_400_000));
  const sizeSignals = Object.fromEntries(SIZES.map((size) => {
    const daily = buildDashboardSeries({ ...input, size, mode: "daily" });
    const metrics = selectDashboardSnapshot(buildDashboardSeries({ ...input, size, mode: activeMode }), activeMode);
    if (!metrics) return [size, []];
    const targets = { ...targetsForSize(input.plan, size), daysRemaining };
    const signals = evaluateRisks(metrics, targets, []);
    for (const [metric, direction, values] of [
      ["acos", "rising-is-worse", daily.map((row) => row.acos)],
      ["grossMargin", "falling-is-worse", daily.map((row) => row.grossMargin)],
      ["completionRate", "falling-is-worse", daily.map((row) => row.completionRate)],
    ] as const) {
      if (trendIsDeteriorating(metric, values)) signals.push({ id: `size-${size}-${metric}-deterioration`, label: `${size} 趋势异常`, status: "risk", detail: `${metric} 连续三次恶化（${direction}）。` });
    }
    return [size, signals.map((signal) => ({ ...signal, id: signal.id.startsWith("size-") ? signal.id : `size-${size}-${signal.id}` }))];
  })) as Record<SizeCode, RiskSignal[]>;
  const aggregateMetrics = selectDashboardSnapshot(buildDashboardSeries({ ...input, size: "all", mode: activeMode }), activeMode);
  const aggregateSignals = aggregateMetrics ? evaluateRisks(aggregateMetrics, { ...aggregateTargets(input.plan), daysRemaining }, []) : [];
  return { sizeSignals, aggregateSignals };
}
