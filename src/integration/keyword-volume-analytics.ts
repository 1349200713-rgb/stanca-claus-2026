import type { SearchVolumePeriod, SearchVolumeSnapshot } from "../domain/keyword-volume";

export interface KeywordVolumeFilters {
  keywordIds?: readonly string[];
  keywordTerms?: readonly string[];
  asin?: string;
  source?: string;
  scope?: "market" | "asin";
  period?: SearchVolumePeriod;
  dateFrom?: string;
  dateTo?: string;
}

export interface KeywordVolumePoint {
  periodStart: string;
  periodEnd: string;
  searchVolume: number | null;
  previousVolume: number | null;
  changePercent: number | null;
  changeStatus: "increase" | "decrease" | "unchanged" | "previous-zero" | "missing";
  conflict: boolean;
  asins: string[];
}

export interface KeywordVolumeSeries {
  id: string;
  keywordId: string;
  keyword: string;
  source: string;
  scope: "market" | "asin";
  period: SearchVolumePeriod;
  asin?: string;
  points: KeywordVolumePoint[];
}

const intervalKey = (start: string, end: string) => `${start}:${end}`;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const validCount = (value: number | null) => value === null || (Number.isSafeInteger(value) && value >= 0);

function previousInterval(period: SearchVolumePeriod, start: string, end: string) {
  const current = new Date(`${start}T00:00:00Z`);
  if (period === "day") {
    current.setUTCDate(current.getUTCDate() - 1);
    const previous = iso(current);
    return intervalKey(previous, previous);
  }
  if (period === "week") {
    const previousStart = new Date(current); previousStart.setUTCDate(previousStart.getUTCDate() - 7);
    const previousEnd = new Date(`${end}T00:00:00Z`); previousEnd.setUTCDate(previousEnd.getUTCDate() - 7);
    return intervalKey(iso(previousStart), iso(previousEnd));
  }
  const months = period === "quarter" ? 3 : 1;
  return intervalKey(iso(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - months, 1))), iso(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0))));
}

export function buildKeywordVolumeAnalytics(rows: readonly SearchVolumeSnapshot[], filters: KeywordVolumeFilters = {}) {
  const grouped = new Map<string, { series: KeywordVolumeSeries; intervals: Map<string, SearchVolumeSnapshot[]> }>();
  for (const row of rows) {
    if (filters.keywordIds && !filters.keywordIds.includes(row.keywordId)) continue;
    if (filters.keywordTerms && !filters.keywordTerms.includes(row.keyword.trim().toLowerCase())) continue;
    if (filters.source && filters.source !== row.source) continue;
    if (filters.scope && filters.scope !== row.scope) continue;
    if (filters.period && filters.period !== row.period) continue;
    const id = JSON.stringify([row.marketplace, row.keyword.trim().toLowerCase(), row.source, row.scope, row.scope === "asin" ? row.asin : "market", row.period]);
    let group = grouped.get(id);
    if (!group) {
      group = { series: { id, keywordId: row.keywordId, keyword: row.keyword, source: row.source, scope: row.scope, period: row.period, ...(row.scope === "asin" ? { asin: row.asin } : {}), points: [] }, intervals: new Map() };
      grouped.set(id, group);
    }
    const key = intervalKey(row.periodStart, row.periodEnd);
    group.intervals.set(key, [...(group.intervals.get(key) ?? []), row]);
  }
  const warnings: string[] = [];
  const series: KeywordVolumeSeries[] = [];
  for (const group of grouped.values()) {
    const points = new Map<string, KeywordVolumePoint>();
    for (const [key, snapshots] of group.intervals) {
      const values = [...new Set(snapshots.map((row) => row.searchVolume).filter((value): value is number => value !== null && validCount(value)))];
      const invalid = snapshots.some((row) => !validCount(row.searchVolume));
      const conflict = values.length > 1;
      points.set(key, { periodStart: snapshots[0].periodStart, periodEnd: snapshots[0].periodEnd, searchVolume: conflict || invalid ? null : values[0] ?? null, previousVolume: null, changePercent: null, changeStatus: "missing", conflict, asins: snapshots.some((row) => !row.asin) ? [] : [...new Set(snapshots.map((row) => row.asin!))] });
    }
    for (const [key, point] of points) {
      const previous = points.get(previousInterval(group.series.period, point.periodStart, point.periodEnd));
      point.previousVolume = previous?.searchVolume ?? null;
      if (point.searchVolume !== null && point.previousVolume !== null) {
        if (point.previousVolume === 0 && point.searchVolume > 0) point.changeStatus = "previous-zero";
        else {
          point.changePercent = point.previousVolume === 0 ? 0 : (point.searchVolume - point.previousVolume) / point.previousVolume;
          point.changeStatus = point.changePercent > 0 ? "increase" : point.changePercent < 0 ? "decrease" : "unchanged";
        }
      }
      if (filters.asin && point.asins.length && !point.asins.includes(filters.asin)) continue;
      if (filters.dateFrom && point.periodStart < filters.dateFrom) continue;
      if (filters.dateTo && point.periodEnd > filters.dateTo) continue;
      const scope = group.series.scope === "market" ? "市场" : group.series.asin;
      if (point.conflict) warnings.push(`${group.series.keyword} · ${group.series.source} · ${scope} · ${point.periodStart}–${point.periodEnd}：同口径搜索量冲突，未采用任何一个值。`);
      if (group.intervals.get(key)!.some((row) => !validCount(row.searchVolume))) warnings.push(`${group.series.keyword} · ${point.periodStart}：搜索量无效，已排除。`);
      group.series.points.push(point);
    }
    group.series.points.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    if (group.series.points.length) series.push(group.series);
  }
  series.sort((a, b) => a.keyword.localeCompare(b.keyword) || a.id.localeCompare(b.id));
  const points = series.flatMap((item) => item.points);
  return { series, warnings, summary: { keywords: new Set(series.map((item) => item.keyword.trim().toLowerCase())).size, observedPeriods: points.filter((point) => point.searchVolume !== null).length, missingPeriods: points.filter((point) => point.searchVolume === null && !point.conflict).length, conflictPeriods: points.filter((point) => point.conflict).length } };
}

export function prepareKeywordVolumeImport(existing: readonly SearchVolumeSnapshot[], incoming: readonly SearchVolumeSnapshot[]) {
  const stored = new Map(existing.map((row) => [row.id, row]));
  const records: SearchVolumeSnapshot[] = []; const issues: string[] = [];
  for (const row of incoming) {
    const previous = stored.get(row.id);
    if (previous?.searchVolume !== undefined && previous.searchVolume !== null) {
      if (row.searchVolume === null) {
        issues.push(`${row.keyword} · ${row.periodStart}：新文件为空值，保留已存搜索量 ${previous.searchVolume}。`);
        continue;
      }
      if (row.searchVolume !== previous.searchVolume) {
        issues.push(`${row.keyword} · ${row.periodStart}：与已存同周期搜索量冲突（${previous.searchVolume} / ${row.searchVolume}），未覆盖，请核对来源。`);
        continue;
      }
    }
    records.push(row);
  }
  return { records, issues };
}
