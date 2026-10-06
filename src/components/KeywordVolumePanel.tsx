"use client";

import { useMemo, useState } from "react";
import type { SearchVolumePeriod, SearchVolumeSnapshot } from "../domain/keyword-volume";
import { buildKeywordVolumeAnalytics, type KeywordVolumePoint, type KeywordVolumeSeries } from "../integration/keyword-volume-analytics";

const colors = ["#2563a8", "#b66a36", "#4b7a61", "#7b4ba3", "#bf4752", "#007f89"];
const grain = { day: "天", week: "周", month: "月", quarter: "季度" };
const count = (value: number | null) => value === null ? "未提供" : value.toLocaleString("en-US");
function change(point: KeywordVolumePoint, period: SearchVolumePeriod) {
  if (point.conflict) return "冲突，待核对";
  if (point.searchVolume === null) return period === "day" ? "未提供当日数据" : "未提供本期数据";
  if (point.changeStatus === "previous-zero") return period === "day" ? "前一天为 0，新增搜索量" : "上期为 0，新增搜索量";
  if (point.changePercent === null) return period === "day" ? "缺少前一天数据" : "缺少可比上期";
  return `${point.changePercent > 0 ? "+" : ""}${(point.changePercent * 100).toFixed(1)}%`;
}
function seriesLabel(series: KeywordVolumeSeries) {
  return `${series.keyword} · ${series.source} · ${series.scope === "market" ? "市场" : series.asin} · ${grain[series.period]}`;
}
function VolumeChart({ series, daily }: { series: KeywordVolumeSeries[]; daily: boolean }) {
  const points = series.flatMap((item) => item.points);
  const values = points.map((point) => point.searchVolume).filter((value): value is number => value !== null);
  const dates = points.map((point) => Date.parse(point.periodStart));
  const first = Math.min(...dates); const last = Math.max(...dates);
  const max = Math.max(1, ...values);
  const x = (date: string) => first === last ? 400 : 75 + (Date.parse(date) - first) / (last - first) * 645;
  const y = (value: number) => 220 - value / max * 170;
  return <div className="volume-chart">
    {!values.length ? <p className="volume-empty">没有可绘制的真实搜索量；未知或冲突值不当作零。</p> : <svg viewBox="0 0 760 280" role="img" aria-label={daily ? "关键词每日搜索量趋势图" : "关键词搜索量趋势图"}>
      <title>{daily ? "真实单日搜索次数，按天展示；缺失日期不补零。" : "真实搜索次数，按完整报告周期展示；"}不同关键词、来源和范围独立曲线，未知值断开。</title>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1="75" x2="720" y1={y(max * fraction)} y2={y(max * fraction)} stroke="#dce8f3" /><text x="4" y={y(max * fraction) + 4} fill="#64748b" fontSize="12">{Math.round(max * fraction).toLocaleString("en-US")}</text></g>)}
      <text x="4" y="25" fill="#64748b" fontSize="12">次数</text>
      {series.map((item, index) => {
        const segments: string[][] = [[]]; let previousEnd: string | undefined;
        for (const point of item.points) {
          const expectedStart = previousEnd ? new Date(Date.parse(previousEnd) + 86_400_000).toISOString().slice(0, 10) : undefined;
          if (point.searchVolume === null || (expectedStart && expectedStart !== point.periodStart)) {
            if (segments.at(-1)!.length) segments.push([]);
          }
          if (point.searchVolume !== null) segments.at(-1)!.push(`${x(point.periodStart)},${y(point.searchVolume)}`);
          previousEnd = point.periodEnd;
        }
        return <g key={item.id} fill={colors[index % colors.length]} stroke={colors[index % colors.length]}>
          {segments.filter((segment) => segment.length > 1).map((segment, segmentIndex) => <polyline key={segmentIndex} points={segment.join(" ")} fill="none" strokeWidth="2.5" />)}
          {item.points.filter((point) => point.searchVolume !== null).map((point) => <circle key={point.periodStart} cx={x(point.periodStart)} cy={y(point.searchVolume!)} r="4"><title>{seriesLabel(item)} · {point.periodStart}{item.period === "day" ? "" : ` 至 ${point.periodEnd}`}：{count(point.searchVolume)} 次 · {change(point, item.period)}</title></circle>)}
        </g>;
      })}
      <text x="75" y="253" fontSize="12" fill="#64748b">{new Date(first).toISOString().slice(0, 10)}</text>
      {first !== last ? <text x="720" y="253" textAnchor="end" fontSize="12" fill="#64748b">{new Date(last).toISOString().slice(0, 10)}</text> : null}
    </svg>}
    <ul className="volume-legend" aria-label="搜索量图例">{series.map((item, index) => <li key={item.id}><span className="volume-series-color" style={{ color: colors[index % colors.length] }}>● </span>{seriesLabel(item)}</li>)}</ul>
  </div>;
}

const template = "\uFEFF关键词,ASIN,统计周期,日期,搜索量,统计范围,来源\n";
export function KeywordVolumePanel({ rows, loaded, error, onUpload, uploading = false }: {
  rows: readonly SearchVolumeSnapshot[];
  loaded: boolean;
  error?: string;
  onUpload: (file?: File) => Promise<void>;
  uploading?: boolean;
}) {
  const [period, setPeriod] = useState<SearchVolumePeriod>("day");
  const daily = period === "day";
  const [asin, setAsin] = useState(""); const [source, setSource] = useState(""); const [scope, setScope] = useState<"" | "market" | "asin">("");
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const [excludedTerms, setExcludedTerms] = useState<string[]>([]);
  const keywords = useMemo(() => [...new Map(rows.map((row) => [row.keyword.trim().toLowerCase(), row.keyword])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const terms = useMemo(() => keywords.map(([term]) => term).filter((term) => !excludedTerms.includes(term)), [keywords, excludedTerms]);
  const analytics = useMemo(() => buildKeywordVolumeAnalytics(rows, { keywordTerms: terms, period, asin, source, scope: scope || undefined, dateFrom, dateTo }), [rows, terms, period, asin, source, scope, dateFrom, dateTo]);
  const details = analytics.series.flatMap((series) => series.points.map((point) => ({ series, point }))).sort((a, b) => b.point.periodStart.localeCompare(a.point.periodStart) || a.series.keyword.localeCompare(b.series.keyword));
  return <section className="panel volume-panel" aria-labelledby="keyword-volume-heading">
    <div className="panel-heading"><div><p className="eyebrow">SEARCH QUERY VOLUME</p><h2 id="keyword-volume-heading">关键词搜索量</h2></div><div className="volume-actions"><a className="secondary-button" download="keyword-search-volume-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}>下载搜索量模板</a><label className="secondary-button" htmlFor="keyword-volume-file">{uploading ? "正在导入…" : "上传关键词搜索量"}</label></div></div>
    <input id="keyword-volume-file" className="sr-only" aria-label="上传关键词搜索量" type="file" accept=".csv,.xlsx,.xls" disabled={!loaded || !!error || uploading} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void onUpload(file); }} />
    <div className="volume-help"><strong>搜索量在哪里看？</strong> Amazon 后台 → 品牌 → 品牌分析 → 搜索分析 → 搜索查询绩效（Search Query Performance）。搜索量是所选周期的搜索次数；Top Search Terms 的 ABA 搜索频率排名不是次数。<a href="https://sell.amazon.com/blog/brand-analytics" target="_blank" rel="noreferrer">查看官方说明</a><br />默认按天展示真实单日数据。上传 CSV / XLSX / XLS；日模板中统计周期填 day（天），日期填实际统计日期；也可填写相同的开始/结束日期。范围填 market（市场查询次数）或 asin（明确的商品范围数据），来源必须与原始数据一致。周/月/季度报告仍按 week / month / quarter 和完整起止日期保存，不平均拆分为日数据；市场搜索量跨 ASIN 不累加。</div>
    {!loaded ? <p role="status">正在加载关键词数据…</p> : !rows.length ? <p className="volume-empty">尚无真实搜索量。请上传搜索查询绩效数据；仅有 ABA 排名不能绘制搜索次数。</p> : null}
    <div className="volume-filters">
      <label>统计周期<select aria-label="搜索量统计周期" value={period} onChange={(event) => setPeriod(event.currentTarget.value as SearchVolumePeriod)}><option value="day">天</option><option value="week">周（原报告）</option><option value="month">月（原报告）</option><option value="quarter">季度（原报告）</option></select></label>
      <label>ASIN<select aria-label="搜索量 ASIN" value={asin} onChange={(event) => setAsin(event.currentTarget.value)}><option value="">全部 ASIN</option>{[...new Set(rows.flatMap((row) => row.asin ? [row.asin] : []))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>数据来源<select aria-label="搜索量来源" value={source} onChange={(event) => setSource(event.currentTarget.value)}><option value="">全部来源（独立曲线）</option>{[...new Set(rows.map((row) => row.source))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>统计范围<select aria-label="搜索量范围" value={scope} onChange={(event) => setScope(event.currentTarget.value as typeof scope)}><option value="">全部范围（独立曲线）</option><option value="market">市场</option><option value="asin">ASIN 商品范围</option></select></label>
      <label>开始日期<input aria-label="搜索量开始日期" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.currentTarget.value)} /></label>
      <label>结束日期<input aria-label="搜索量结束日期" type="date" value={dateTo} onChange={(event) => setDateTo(event.currentTarget.value)} /></label>
    </div>
    <fieldset className="volume-keywords"><legend>选择关键词（可多选）</legend><button type="button" className="table-action-button" onClick={() => setExcludedTerms([])}>全选关键词</button><button type="button" className="table-action-button" onClick={() => setExcludedTerms(keywords.map(([term]) => term))}>清空关键词选择</button>{keywords.map(([term, label]) => <label key={term}><input type="checkbox" aria-label={`选择关键词 ${label}`} checked={!excludedTerms.includes(term)} onChange={(event) => { const checked = event.currentTarget.checked; setExcludedTerms((current) => checked ? current.filter((item) => item !== term) : [...current, term]); }} />{label}</label>)}</fieldset>
    <p className="analytics-note">图表与明细使用同一筛选。{daily ? "按自然日筛选，与同关键词、来源和范围的前一天比较；缺少前一天数据时显示未知，不改用最近一次记录或填 0。" : "仅保留开始、结束日期都在筛选范围内的完整报告周期；上期比较需同关键词、来源、范围和周期，缺少可比上期不当作 0。"}</p>
    {dateFrom && dateTo && dateFrom > dateTo ? <p role="alert">搜索量开始日期不能晚于结束日期。</p> : null}
    <div className="volume-kpi-grid" aria-label="搜索量摘要"><article>已选关键词<strong>{analytics.summary.keywords}</strong></article><article>{daily ? "有效日记录数" : "有效周期数"}<strong>{analytics.summary.observedPeriods}</strong></article><article>未提供搜索量<strong>{analytics.summary.missingPeriods}</strong></article><article>{daily ? "冲突日记录数" : "冲突周期数"}<strong>{analytics.summary.conflictPeriods}</strong></article></div>
    {analytics.warnings.length ? <ul className="volume-warnings">{analytics.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    <VolumeChart series={analytics.series} daily={daily} />
    <div className="table-scroll"><table aria-label={daily ? "搜索量每日明细" : "搜索量周期明细"}><thead><tr><th>关键词</th><th>{daily ? "日期" : "报告区间"}</th><th>周期</th><th>范围 / ASIN</th><th>来源</th><th>{daily ? "当日搜索量（次）" : "搜索量（次）"}</th><th>{daily ? "前一天搜索量" : "上期搜索量"}</th><th>{daily ? "较前一天变化" : "较上期变化"}</th></tr></thead><tbody>{details.map(({ series, point }) => <tr key={`${series.id}:${point.periodStart}`}><th scope="row">{series.keyword}</th><td>{point.periodStart}{series.period === "day" ? "" : ` 至 ${point.periodEnd}`}</td><td>{grain[series.period]}</td><td>{series.scope === "market" ? "市场（跨 ASIN 不累加）" : series.asin}</td><td>{series.source}</td><td>{point.conflict ? "冲突，待核对" : count(point.searchVolume)}</td><td>{count(point.previousVolume)}</td><td>{change(point, series.period)}</td></tr>)}</tbody></table></div>
    {loaded && rows.length > 0 && !details.length ? <p className="volume-empty">{daily ? "筛选范围内没有真实单日搜索量；周/月/季度报告不会拆分为日数据。" : "筛选范围内没有完整统计周期。"}</p> : null}
  </section>;
}
