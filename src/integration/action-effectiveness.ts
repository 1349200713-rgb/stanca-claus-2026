import type { DailyOperationRecord } from "../domain/planning";
import type { LinkedDay } from "./linked-dataset";

interface MetricAverage { units: number | null; sales: number | null; sessions: number | null; ctr: number | null; cpc: number | null; cvr: number | null }
interface ReadyWindow { status: "ready"; before: MetricAverage; after: MetricAverage; change: MetricAverage }
interface WaitingWindow { status: "waiting" | "insufficient"; remainingDays: number }
export interface ActionEffectiveness { threeDay: ReadyWindow | WaitingWindow; sevenDay: ReadyWindow | WaitingWindow }

function average(rows: readonly LinkedDay[]): MetricAverage {
  const metric = (select: (row: LinkedDay) => number | null) => {
    const values = rows.map(select).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  return { units: metric((row) => row.units), sales: metric((row) => row.sales), sessions: metric((row) => row.sessions), ctr: metric((row) => row.metrics.ctr), cpc: metric((row) => row.metrics.cpc), cvr: metric((row) => row.metrics.cvr) };
}

function windowResult(operation: DailyOperationRecord, rows: readonly LinkedDay[], asOfDate: string, days: number): ReadyWindow | WaitingWindow {
  const matching = rows.filter((row) => (!operation.asin || row.asin === operation.asin) && (!operation.sku || row.sku === operation.sku));
  const beforeDates = [...new Set(matching.filter((row) => row.date < operation.date).map((row) => row.date))].toSorted().slice(-days);
  const afterDates = [...new Set(matching.filter((row) => row.date > operation.date && row.date <= asOfDate).map((row) => row.date))].toSorted().slice(0, days);
  if (afterDates.length < days) return { status: "waiting", remainingDays: days - afterDates.length };
  if (beforeDates.length < days) return { status: "insufficient", remainingDays: days - beforeDates.length };
  const beforeRows = matching.filter((row) => beforeDates.includes(row.date));
  const afterRows = matching.filter((row) => afterDates.includes(row.date));
  const before = average(beforeRows); const after = average(afterRows);
  const delta = (afterValue: number | null, beforeValue: number | null) => afterValue === null || beforeValue === null ? null : afterValue - beforeValue;
  return { status: "ready", before, after, change: { units: delta(after.units, before.units), sales: delta(after.sales, before.sales), sessions: delta(after.sessions, before.sessions), ctr: delta(after.ctr, before.ctr), cpc: delta(after.cpc, before.cpc), cvr: delta(after.cvr, before.cvr) } };
}

export function compareActionWindows(operation: DailyOperationRecord, rows: readonly LinkedDay[], asOfDate: string): ActionEffectiveness {
  return { threeDay: windowResult(operation, rows, asOfDate, 3), sevenDay: windowResult(operation, rows, asOfDate, 7) };
}
