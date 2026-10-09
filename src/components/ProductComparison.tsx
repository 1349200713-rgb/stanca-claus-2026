"use client";
import { Fragment, useMemo, useState } from "react";
import type { ProductPerformanceRecord } from "../domain/product-performance";
import { buildProductComparison, productAdvice, type ProductMetric, type ProductComparisonDay } from "../integration/product-performance-analytics";
import { ProductAdvertisingCharts } from "./ProductAdvertisingCharts";

const labels: Record<ProductMetric, string> = { units: "销量", sales: "净销售额", grossProfit: "结算毛利润", spend: "广告花费", adSales: "广告销售额", adOrders: "广告订单", adUnits: "广告销量", clicks: "点击", impressions: "展示", sessions: "Sessions", price: "售价（总价）", fbaAvailable: "FBA可售", rating: "评分", acos: "ACOS", tacos: "TACOS", cpc: "CPC", ctr: "CTR", cvr: "广告CVR", roas: "ROAS", grossMargin: "结算毛利率" };
const percentages = new Set<ProductMetric>(["acos", "tacos", "ctr", "cvr", "grossMargin"]);
const monetary = new Set<ProductMetric>(["sales", "grossProfit", "spend", "adSales", "price", "cpc"]);
const groups: Record<string, ProductMetric[]> = { "核心表现": ["units", "sales", "spend", "adOrders", "adSales", "acos", "tacos", "cvr", "cpc"], "流量效率": ["impressions", "clicks", "ctr", "sessions", "adOrders", "cvr", "cpc", "roas"], "利润与库存": ["units", "sales", "grossProfit", "grossMargin", "price", "fbaAvailable", "rating"] };
function format(key: ProductMetric, value: number | null | undefined): string {
  if (value == null) return "未知";
  if (percentages.has(key)) return `${(value * 100).toFixed(2)}%`;
  if (monetary.has(key)) return `$${value.toFixed(2)}`;
  return value.toLocaleString("en-US", { maximumFractionDigits: key === "roas" || key === "rating" ? 2 : 0 });
}
function delta(key: ProductMetric, current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null) return "不可比";
  const change = current - previous;
  if (percentages.has(key)) return `${change > 0 ? "+" : ""}${(change * 100).toFixed(2)}pp`;
  const absolute = `${change > 0 ? "+" : ""}${format(key, change)}`;
  return previous === 0 ? `${absolute}（去年为0）` : `${absolute} (${change > 0 ? "+" : ""}${(change / Math.abs(previous) * 100).toFixed(1)}%)`;
}
function recentRange(end: string, dayCount: number) {
  const first = new Date(`${end}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - dayCount + 1);
  return { start: ["2026-01-01", first.toISOString().slice(0, 10)].sort().at(-1)!, end };
}
function initialRange(records: readonly ProductPerformanceRecord[]) {
  const latest = [...records].filter((record) => record.date.startsWith("2026-")).sort((a, b) => b.date.localeCompare(a.date))[0];
  const dates = latest?.sourceFilename?.match(/2026-\d{2}-\d{2}/g);
  const today = new Date();
  const end = latest?.date ?? `2026-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return dates?.length === 2 && dates[0] <= dates[1] ? { start: dates[0], end: dates[1] } : recentRange(end, 7);
}
function ComparisonChart({ days, metric, showPrevious }: { days: ProductComparisonDay[]; metric: ProductMetric; showPrevious: boolean }) {
  const values = days.flatMap((day) => [day.current?.[metric], ...(showPrevious ? [day.previous?.[metric]] : [])]).filter((value): value is number => value != null);
  if (!values.length) return <p className="analytics-note">该指标尚无可绘制的数据。</p>;
  const min = Math.min(0, ...values), max = percentages.has(metric) ? Math.max(0.001, ...values) * 1.1 : Math.max(1, ...values);
  const x = (index: number) => days.length === 1 ? 480 : 65 + index * 815 / (days.length - 1);
  const y = (value: number) => 160 - (value - min) * 130 / (max - min);
  return <svg viewBox="0 0 960 205" className="product-comparison-chart" role="img" aria-label={`${labels[metric]}每日同比趋势，缺失日期断开`}>
    <title>{labels[metric]}，2026蓝色实线，2025灰色虚线；缺数据不补零。</title>
    {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1="65" x2="900" y1={y(min + fraction * (max - min))} y2={y(min + fraction * (max - min))} stroke="#dce5ee" /><text x="2" y={y(min + fraction * (max - min)) + 4}>{format(metric, min + fraction * (max - min))}</text></g>)}
    {(["previous", "current"] as const).filter((year) => year === "current" || showPrevious).map((year) => <g key={year} stroke={year === "current" ? "#2563a8" : "#7b8796"} fill={year === "current" ? "#2563a8" : "#7b8796"}>
      {days.map((day, i) => {
        const value = day[year]?.[metric], prior = days[i - 1]?.[year]?.[metric];
        if (value == null) return null;
        return <g key={day.date}>{prior != null ? <line x1={x(i - 1)} x2={x(i)} y1={y(prior)} y2={y(value)} strokeWidth="2.5" strokeDasharray={year === "previous" ? "6 5" : undefined} /> : null}<circle cx={x(i)} cy={y(value)} r="4"><title>{year === "current" ? "2026" : "2025"}-{day.date.slice(5)} {format(metric, value)}</title></circle></g>;
      })}
    </g>)}
    {days.filter((_, index) => index % Math.max(1, Math.ceil(days.length / 8)) === 0 || index === days.length - 1).map((day) => <text key={day.date} x={x(days.indexOf(day))} y="193" textAnchor="middle">{day.date.slice(5)}</text>)}
  </svg>;
}

export function ProductComparison({ records, targetAcos }: { records: readonly ProductPerformanceRecord[]; targetAcos: number }) {
  const [selectedScope, setScope] = useState<ProductPerformanceRecord["scope"]>();
  const currentYearRecords = records.filter((record) => record.date.startsWith("2026-"));
  const availableRecords = currentYearRecords.length ? currentYearRecords : records;
  const scope = selectedScope ?? (availableRecords.some((record) => record.scope === "parent") ? "parent" : availableRecords[0]?.scope ?? "parent");
  const [selectedCurrent, setSelectedCurrent] = useState("");
  const [selectedPrevious, setSelectedPrevious] = useState<string | undefined>();
  const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [group, setGroup] = useState("核心表现"); const [metric, setMetric] = useState<ProductMetric>("spend");
  const [collapsed, setCollapsed] = useState(false);
  const [preset, setPreset] = useState<"day" | "7" | "14" | "custom">("custom");
  const [showPrevious, setShowPrevious] = useState(true);
  const [chartYear, setChartYear] = useState<"current" | "previous">("current");
  const [efficiency, setEfficiency] = useState<"acos" | "roas">("acos");
  const [detailFilter, setDetailFilter] = useState("all");
  const scoped = useMemo(() => records.filter((record) => record.scope === scope), [records, scope]);
  const currentAsins = [...new Set(scoped.filter((record) => record.date.startsWith("2026-")).map((record) => record.asin))].sort();
  const previousAsins = [...new Set(scoped.filter((record) => record.date.startsWith("2025-")).map((record) => record.asin))].sort();
  const currentAsin = currentAsins.includes(selectedCurrent) ? selectedCurrent : currentAsins[0] ?? "";
  const previousAsin = selectedPrevious ?? (previousAsins.includes(currentAsin) ? currentAsin : "");
  const defaults = initialRange(scoped.filter((record) => record.asin === currentAsin));
  const latestActual = scoped.filter((record) => record.asin === currentAsin && record.date.startsWith("2026-")).map((record) => record.date).sort().at(-1) ?? defaults.end;
  const activeRange = preset === "7" || preset === "14" ? recentRange(latestActual, Number(preset)) : { start: start || defaults.start, end: end || defaults.end };
  const startDate = activeRange.start, endDate = activeRange.end;
  const data = useMemo(() => buildProductComparison(records, { startDate, endDate, currentAsin, previousAsin, scope }), [records, startDate, endDate, currentAsin, previousAsin, scope]);
  const filteredDays = data.days.filter((day) => detailFilter === "all" || detailFilter === "recorded" && Boolean(day.current || day.previous) || detailFilter === "paired" && Boolean(day.current && day.previous) || detailFilter === "review" && Boolean(day.conflict || day.current && (day.current.grossProfit != null && day.current.grossProfit < 0 || day.current.clicks != null && day.current.clicks >= 20 && (day.current.adOrders === 0 || day.current.acos != null && day.current.acos > targetAcos))));
  function choosePreset(value: typeof preset) {
    setPreset(value);
    if (value === "custom") { setStart(startDate); setEnd(endDate); return; }
    const range = recentRange(latestActual, value === "day" ? 1 : Number(value));
    setStart(range.start); setEnd(range.end);
  }
  function chooseDate(value: string, boundary: "start" | "end") {
    if (preset === "day") { setStart(value); setEnd(value); }
    else { setStart(boundary === "start" ? value : startDate); setEnd(boundary === "end" ? value : endDate); setPreset("custom"); }
  }
  const keys = groups[group];
  const invalid = data.days.length === 0;
  const chartDays = data.days.map((day) => filteredDays.includes(day) ? day : { ...day, current: null, previous: null });
  return <section className="product-comparison" aria-labelledby="product-comparison-title">
    <div className="panel product-comparison-filters">
      <div className="product-comparison-heading"><div><p className="eyebrow">DAILY YEAR-OVER-YEAR</p><h2 id="product-comparison-title">2025 vs 2026 每日产品表现</h2></div><span className="product-comparison-source">领星产品表现 · USD · 按同月同日对齐</span></div>
      <div className="product-period-toolbar"><div className="product-comparison-tabs" role="group" aria-label="日期快捷筛选">{([['day', '日'], ['7', '最近7天'], ['14', '最近14天'], ['custom', '自定义日期']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={preset === value} onClick={() => choosePreset(value)}>{label}</button>)}</div><label><input type="checkbox" checked={showPrevious} onChange={(event) => setShowPrevious(event.currentTarget.checked)} />对比2025同期趋势</label></div>
      <div className="analytics-filter-grid">
        <label>数据粒度<select aria-label="产品表现数据粒度" value={scope} onChange={(event) => { setScope(event.currentTarget.value as typeof scope); setSelectedCurrent(""); setSelectedPrevious(undefined); }}><option value="parent">父ASIN汇总</option><option value="asin">ASIN明细</option></select></label>
        <label>2026商品<select aria-label="2026对比ASIN" value={currentAsin} onChange={(event) => { setSelectedCurrent(event.currentTarget.value); setSelectedPrevious(undefined); }}><option value="">尚未导入</option>{currentAsins.map((asin) => <option key={asin}>{asin}</option>)}</select></label>
        <label>2025对照商品<select aria-label="2025对比ASIN" value={previousAsin} onChange={(event) => setSelectedPrevious(event.currentTarget.value)}><option value="">请选择去年链接</option>{previousAsins.map((asin) => <option key={asin}>{asin}</option>)}</select></label>
        <label>开始日期<input aria-label="同比开始日期" type="date" min="2026-01-01" max="2026-12-31" value={startDate} onChange={(event) => chooseDate(event.currentTarget.value, "start")} /></label>
        <label>结束日期<input aria-label="同比结束日期" type="date" min="2026-01-01" max="2026-12-31" value={endDate} onChange={(event) => chooseDate(event.currentTarget.value, "end")} /></label>
      </div>
      <p className="analytics-note">“日/最近7天/最近14天”以最新已录入日（{latestActual}）为终点，日模式也可手动选择某一天。日期筛选采用2026日历，自动对照2025同月同日。不同ASIN需手动选择对照。父ASIN数据不分摊尺码，也不叠加广告活动数据。</p>
      {!records.length ? <p role="status">请导入领星“产品表现日详情”报表。2025数据未导入前，差异显示不可比。</p> : null}
      {invalid ? <p role="alert">请选择2026年有效日期，开始日期不能晚于结束日期。</p> : <p className="product-comparison-coverage">2026已录入 {data.currentDays}/{data.days.length} 天 · 2025已录入 {data.previousDays}/{data.days.length} 天 · 同期可比 {data.pairedDays} 天</p>}
    </div>
    {!invalid && <>
      <div className="product-comparison-kpis">{(["units", "sales", "spend", "adOrders", "acos", "grossProfit"] as ProductMetric[]).map((key) => <dl key={key}><dt>{labels[key]}</dt><dd className="product-kpi-current">2026 <strong>{format(key, data.current[key])}</strong></dd><dd>2025 <strong>{format(key, data.previous[key])}</strong></dd><dd className="product-kpi-delta">同日可比差异 {delta(key, data.comparableCurrent[key], data.comparablePrevious[key])}</dd></dl>)}</div>
      <p className="analytics-note">上方金额与数量为所选日期范围内已录入日期合计，不受下方明细状态筛选影响，缺日不填零；差异只用两年都有记录的日期。比率由原始分子/分母重算，分母为0显示未知。库存和售价为期末快照，不累加。</p>
      <div className="product-detail-toolbar"><label>图表与明细筛选<select aria-label="同比明细筛选" value={detailFilter} onChange={(event) => setDetailFilter(event.currentTarget.value)}><option value="all">全部日期（显示缺日）</option><option value="recorded">有记录日期</option><option value="paired">仅两年可比日期</option><option value="review">亏损 / 广告待核日期</option></select></label><span>当前匹配 {filteredDays.length} 天</span></div>
      <details className="panel product-comparison-trend" open><summary>每日同比趋势</summary><div className="product-comparison-chart-controls"><label>查看指标<select aria-label="同比趋势指标" value={metric} onChange={(event) => setMetric(event.currentTarget.value as ProductMetric)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span className="product-year-key product-year-key--current">2026 实线</span>{showPrevious ? <span className="product-year-key">2025 虚线</span> : null}</div><ComparisonChart days={chartDays} metric={metric} showPrevious={showPrevious} /></details>
      <div className="product-ad-chart-toolbar"><h3>广告图表化分析</h3><label>图表年份<select aria-label="广告图表年份" value={chartYear} onChange={(event) => setChartYear(event.currentTarget.value as typeof chartYear)}><option value="current">2026</option><option value="previous">2025同期</option></select></label><label>广告效果指标<select aria-label="广告效果指标" value={efficiency} onChange={(event) => setEfficiency(event.currentTarget.value as typeof efficiency)}><option value="acos">ACOS</option><option value="roas">ROAS</option></select></label></div>
      <ProductAdvertisingCharts days={chartDays} year={chartYear} efficiency={efficiency} />
      <div className="panel product-comparison-daily"><div className="product-comparison-heading"><h3>每日对比与分析建议</h3><button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? "展开每日对比" : "折叠每日对比"}</button></div>
        {!collapsed && <><div className="product-detail-toolbar"><div className="product-comparison-tabs" role="group" aria-label="每日对比指标分组">{Object.keys(groups).map((name) => <button key={name} type="button" aria-pressed={group === name} onClick={() => setGroup(name)}>{name}</button>)}</div></div>
          <p className="analytics-note">差异 = 2026 − 2025；pp表示百分点。花费上升不直接判定好坏。建议基于本地规则和计划ACOS目标，未自动操作投放；新导入数据会重新计算。</p>
          {!filteredDays.length ? <p role="status">当前明细筛选没有匹配日期。</p> : null}
          <div className="table-scroll product-comparison-scroll"><table aria-label="2025与2026每日产品表现对比"><thead><tr><th className="product-sticky-date">日期</th><th>年份</th>{keys.map((key) => <th key={key}>{labels[key]}</th>)}<th className="product-advice-heading">分析建议</th></tr></thead><tbody>{filteredDays.map((day) => <Fragment key={day.date}>{(["current", "previous", "difference"] as const).map((year, index) => <tr key={year} className={`product-year-row product-year-row--${year}`}>
            {index === 0 && <th rowSpan={3} scope="rowgroup" className="product-sticky-date">{day.date.slice(5)}</th>}<th scope="row">{year === "current" ? "2026" : year === "previous" ? "2025" : "差异"}</th>
            {keys.map((key) => <td key={key}>{year === "difference" ? delta(key, day.current?.[key], day.previous?.[key]) : day[year] ? format(key, day[year]![key]) : "未录入"}</td>)}
            {index === 0 && <td rowSpan={3} className="product-advice-cell"><ul>{productAdvice(day, targetAcos).map((advice) => <li key={advice}>{advice}</li>)}</ul>{day.record?.adOperations ? <p>广告操作记录：{day.record.adOperations}</p> : null}{day.record?.listingOperations ? <p>Listing操作记录：{day.record.listingOperations}</p> : null}</td>}
          </tr>)}</Fragment>)}</tbody></table></div>
        </>}
      </div>
    </>}
  </section>;
}
