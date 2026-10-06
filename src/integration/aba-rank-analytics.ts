import type { KeywordRankSnapshot } from "../domain/linkage";

export interface AbaRankComparison {
  id: string;
  marketplace: "US";
  monthDay: string;
  keyword: string;
  rank2026: number | null;
  rank2025: number | null;
  conflict2026: boolean;
  conflict2025: boolean;
  /** Positive means a worse (larger) rank number, not more searches. */
  difference: number | null;
}

export function buildAbaRankComparisons(rows: readonly KeywordRankSnapshot[]): AbaRankComparison[] {
  const groups = new Map<string, { marketplace: "US"; monthDay: string; keyword: string; ranks2026: Set<number>; ranks2025: Set<number> }>();
  for (const row of rows) {
    if (row.marketplace !== "US" || !Number.isSafeInteger(row.abaRank) || row.abaRank! <= 0) continue;
    if (!/^(2025|2026)-\d{2}-\d{2}$/.test(row.date)) continue;
    const parsed = new Date(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.date) continue;
    const keyword = row.keyword.trim().replace(/\s+/g, " ");
    if (!keyword) continue;
    const monthDay = row.date.slice(5);
    // ABA is keyword-level: the tracking ASIN must not duplicate its rank.
    const id = JSON.stringify([row.marketplace, keyword.toLowerCase(), monthDay]);
    const group = groups.get(id) ?? { marketplace: row.marketplace, monthDay, keyword, ranks2026: new Set<number>(), ranks2025: new Set<number>() };
    (row.date.startsWith("2026-") ? group.ranks2026 : group.ranks2025).add(row.abaRank!);
    groups.set(id, group);
  }
  return [...groups].map(([id, group]) => {
    const rank2026 = group.ranks2026.size === 1 ? [...group.ranks2026][0] : null;
    const rank2025 = group.ranks2025.size === 1 ? [...group.ranks2025][0] : null;
    return {
      id, marketplace: group.marketplace, monthDay: group.monthDay, keyword: group.keyword,
      rank2026, rank2025, conflict2026: group.ranks2026.size > 1, conflict2025: group.ranks2025.size > 1,
      difference: rank2026 !== null && rank2025 !== null ? rank2026 - rank2025 : null,
    };
  }).sort((a, b) => b.monthDay.localeCompare(a.monthDay) || a.keyword.localeCompare(b.keyword));
}
