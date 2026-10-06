"use client";

import { useMemo, useState } from "react";
import type { KeywordRankSnapshot } from "../domain/linkage";
import { buildAbaRankComparisons, type AbaRankComparison } from "../integration/aba-rank-analytics";

const displayRank = (rank: number | null, conflict: boolean) => conflict ? "数据冲突" : rank === null ? "未录入" : rank.toLocaleString("en-US");
function displayDifference(row: AbaRankComparison) {
  if (row.conflict2026 || row.conflict2025) return "待核对";
  if (row.difference === null) return "未录入";
  if (row.difference === 0) return "持平";
  return `${row.difference > 0 ? "后退" : "提前"} ${Math.abs(row.difference).toLocaleString("en-US")} 名`;
}

export function AbaRankPanel({ rows, loaded, error }: { rows: readonly KeywordRankSnapshot[]; loaded: boolean; error?: string }) {
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const comparisons = useMemo(() => buildAbaRankComparisons(rows), [rows]);
  const keywords = useMemo(() => [...new Map(comparisons.map((row) => [row.keyword.toLowerCase(), row.keyword])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [comparisons]);
  const dates = useMemo(() => [...new Set(comparisons.map((row) => row.monthDay))].sort(), [comparisons]);
  const invalidRange = !!dateFrom && !!dateTo && dateFrom > dateTo;
  const filtered = comparisons.filter((row) => !invalidRange && (!keyword || row.keyword.toLowerCase() === keyword) && (!dateFrom || row.monthDay >= dateFrom) && (!dateTo || row.monthDay <= dateTo));

  return <section className="panel promotion-table-panel aba-rank-panel" aria-labelledby="aba-rank-heading">
    <div className="panel-heading"><div><p className="eyebrow">ABA SEARCH FREQUENCY RANK</p><h2 id="aba-rank-heading">ABA 搜索排名</h2></div></div>
    <p className="analytics-note">排名越小越靠前，不代表搜索次数。按同关键词、同月同日的采样记录对比 2026 与 2025；原表未提供统计周期，因此不是同周期搜索量同比。缺少任一年不计算差值。</p>
    <div className="volume-filters">
      <label>关键词<select aria-label="ABA关键词" value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)}><option value="">全部关键词</option>{keywords.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>开始日期（月日）<select aria-label="ABA开始日期（月日）" value={dateFrom} onChange={(event) => setDateFrom(event.currentTarget.value)}><option value="">不限开始日期</option>{dates.map((date) => <option key={date}>{date}</option>)}</select></label>
      <label>结束日期（月日）<select aria-label="ABA结束日期（月日）" value={dateTo} onChange={(event) => setDateTo(event.currentTarget.value)}><option value="">不限结束日期</option>{dates.map((date) => <option key={date}>{date}</option>)}</select></label>
    </div>
    <div className="volume-actions"><button className="secondary-button" type="button" onClick={() => { setKeyword(""); setDateFrom(""); setDateTo(""); }}>重置ABA筛选</button><span className="analytics-note">显示 {filtered.length} 条日期 / 关键词对比记录</span></div>
    {invalidRange ? <p className="volume-warnings" role="alert">开始日期不能晚于结束日期。</p> : null}
    <div className="table-scroll"><table aria-label="ABA搜索排名">
      <thead><tr><th scope="col">日期（月日）</th><th scope="col">关键词</th><th scope="col">2026 搜索排名</th><th scope="col">2025 搜索排名</th><th scope="col">2026 / 2025 排名差异</th></tr></thead>
      <tbody>{filtered.map((row) => <tr key={row.id}>
        <th scope="row">{row.monthDay}</th><td>{row.keyword}</td><td>{displayRank(row.rank2026, row.conflict2026)}</td><td>{displayRank(row.rank2025, row.conflict2025)}</td>
        <td className={row.difference === null ? "" : row.difference > 0 ? "aba-rank-worse" : row.difference < 0 ? "aba-rank-better" : ""}>{displayDifference(row)}</td>
      </tr>)}</tbody>
    </table></div>
    {!loaded ? <p role="status">正在加载 ABA 搜索排名…</p> : error && !comparisons.length ? <p className="volume-empty">读取失败，暂时无法展示 ABA 搜索排名，请刷新重试。</p> : !filtered.length && !invalidRange ? <p className="volume-empty">{comparisons.length ? "筛选范围内没有 ABA 排名记录。" : "尚无 2026 / 2025 ABA 搜索排名记录。"}</p> : null}
  </section>;
}
