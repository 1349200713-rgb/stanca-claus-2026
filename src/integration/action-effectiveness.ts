import type { DailyOperationRecord } from "../domain/planning";
import type { LinkedDay } from "./linked-dataset";

interface MetricAverage { units: number; sales: number; sessions: number; ctr: number; cpc: number; cvr: number }
interface ReadyWindow { status: "ready"; before: MetricAverage; after: MetricAverage; change: MetricAverage }
interface WaitingWindow { status: "waiting" | "insufficient"; remainingDays: number }
export interface ActionEffectiveness { threeDay: ReadyWindow | WaitingWindow; sevenDay: ReadyWindow | WaitingWindow }

function average(rows: readonly LinkedDay[]): MetricAverage {
  const metric = (select: (row: LinkedDay) => number | null) => {
    const values = rows.map(select).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  };
  return { units: metric((row) => row.units), sales: metric((row) => row.sales), sessions: metric((row) => row.sessions), ctr: metric((row) => row.metrics.ctr), cpc: metric((row) => row.metrics.cpc), cvr: metric((row) => row.metrics.cvr) };
}

function windowResult(operation: DailyOperationRecord, rows: readonly LinkedDay[], asOfDate: string, days: number): ReadyWindow | WaitingWindow {
  const matching = rows.filter((row) => (!operation.asin || row.asin === operation.asin) && (!operation.sku || row.sku === operation.sku));
  const beforeRows = matching.filter((row) => row.date < operation.date).toSorted((a, b) => b.date.localeCompare(a.date)).slice(0, days).reverse();
  const afterRows = matching.filter((row) => row.date > operation.date && row.date <= asOfDate).toSorted((a, b) => a.date.localeCompare(b.date)).slice(0, days);
  if (afterRows.length < days) return { status: "waiting", remainingDays: days - afterRows.length };
  if (beforeRows.length < days) return { status: "insufficient", remainingDays: days - beforeRows.length };
  const before = average(beforeRows); const after = average(afterRows);
  return { status: "ready", before, after, change: { units: after.units - before.units, sales: after.sales - before.sales, sessions: after.sessions - before.sessions, ctr: after.ctr - before.ctr, cpc: after.cpc - before.cpc, cvr: after.cvr - before.cvr } };
}

export function compareActionWindows(operation: DailyOperationRecord, rows: readonly LinkedDay[], asOfDate: string): ActionEffectiveness {
  return { threeDay: windowResult(operation, rows, asOfDate, 3), sevenDay: windowResult(operation, rows, asOfDate, 7) };
}
