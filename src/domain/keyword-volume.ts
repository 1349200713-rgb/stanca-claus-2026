export type SearchVolumePeriod = "day" | "week" | "month" | "quarter";

export interface SearchVolumeSnapshot {
  id: string;
  kind: "search-volume";
  marketplace: "US";
  keywordId: string;
  keyword: string;
  asin?: string;
  scope: "market" | "asin";
  source: string;
  period: SearchVolumePeriod;
  periodStart: string;
  periodEnd: string;
  searchVolume: number | null;
  updatedAt: string;
}

const nonemptyText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function fullReportingInterval(period: SearchVolumePeriod, start: string, end: string): boolean {
  if (end < start) return false;
  if (period === "day") return start === end;
  const first = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  if (period === "week") return last.getTime() - first.getTime() === 6 * 86_400_000;
  if (first.getUTCDate() !== 1) return false;
  if (period === "quarter" && first.getUTCMonth() % 3 !== 0) return false;
  const after = new Date(first);
  after.setUTCMonth(first.getUTCMonth() + (period === "month" ? 1 : 3));
  after.setUTCDate(0);
  return after.getTime() === last.getTime();
}

/** Separates usable volume records from legacy rank records in shared storage. */
export function isSearchVolumeSnapshot(value: unknown): value is SearchVolumeSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind !== "search-volume" || record.marketplace !== "US") return false;
  if (!nonemptyText(record.id) || !record.id.startsWith("keyword-volume:")) return false;
  if (!nonemptyText(record.keywordId) || !nonemptyText(record.keyword) || !nonemptyText(record.source) || !nonemptyText(record.updatedAt)) return false;
  if (record.scope !== "market" && record.scope !== "asin") return false;
  if (record.asin !== undefined && (typeof record.asin !== "string" || !/^[A-Z0-9]{10}$/.test(record.asin))) return false;
  if (record.scope === "asin" && !record.asin) return false;
  if (record.period !== "day" && record.period !== "week" && record.period !== "month" && record.period !== "quarter") return false;
  if (!calendarDate(record.periodStart) || !calendarDate(record.periodEnd)) return false;
  if (!fullReportingInterval(record.period, record.periodStart, record.periodEnd)) return false;
  return record.searchVolume === null || (typeof record.searchVolume === "number" && Number.isSafeInteger(record.searchVolume) && record.searchVolume >= 0);
}
