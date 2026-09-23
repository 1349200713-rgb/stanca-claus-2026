import type { KeywordRankSnapshot } from "../domain/linkage";

export function buildKeywordAnalytics(rows: readonly KeywordRankSnapshot[], asOfDate: string) {
  const groups = new Map<string, KeywordRankSnapshot[]>();
  rows.filter((row) => row.date <= asOfDate).forEach((row) => { const key = `${row.asin}:${row.keywordId}`; groups.set(key, [...(groups.get(key) ?? []), row]); });
  const alerts: { id: string; severity: "attention" | "risk"; detail: string; asin: string; keywordId: string; date: string }[] = [];
  for (const snapshots of groups.values()) {
    const observed = snapshots.filter((row) => row.organicRank != null).toSorted((a, b) => a.date.localeCompare(b.date)); const current = observed.at(-1); const previous = observed.at(-2);
    if (!current || !previous) continue; const drop = current.organicRank! - previous.organicRank!;
    if (drop >= 5) alerts.push({ id: `rank:${current.id}`, severity: drop >= 10 ? "risk" : "attention", detail: `自然排名下降 ${drop} 位`, asin: current.asin, keywordId: current.keywordId, date: current.date });
    const lastThree = observed.slice(-3); if (lastThree.length === 3 && lastThree[0].organicRank! < lastThree[1].organicRank! && lastThree[1].organicRank! < lastThree[2].organicRank!) alerts.push({ id: `continuous:${current.id}`, severity: "risk", detail: "自然排名连续3次下降", asin: current.asin, keywordId: current.keywordId, date: current.date });
  }
  const latest = [...groups.values()].map((group) => group.toSorted((a, b) => b.date.localeCompare(a.date))[0]);
  return { summary: { tracked: groups.size, top10: latest.filter((row) => row.organicRank != null && row.organicRank <= 10).length, firstPage: latest.filter((row) => row.organicRank != null && row.organicRank <= 48).length }, alerts };
}
