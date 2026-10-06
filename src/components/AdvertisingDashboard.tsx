"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AdRecord } from "../domain/types";
import type { PrimaryMapping } from "../data/plan";
import { advertisingDateRange, advertisingRatio, buildAdvertisingAnalytics, defaultAdvertisingThresholds, type AdvertisingMetrics, type AdvertisingThresholds, type AdvertisingAnalytics } from "../integration/advertising-analytics";

export interface AdvertisingDashboardProps {
  records: readonly AdRecord[];
  mappings: readonly PrimaryMapping[];
  loaded: boolean;
  error?: string;
  targetAcos: number;
  onBack: () => void;
  onRefresh?: () => Promise<void>;
  onOpenManual?: () => void;
  onOpenImport?: () => void;
  onEditRecord?: (record: AdRecord) => void;
  children?: ReactNode;
}
const money = (value: number | null | undefined) => value == null ? "未知" : `US$${value.toFixed(2)}`;
const percent = (value: number | null | undefined) => value == null ? "未知" : `${(value * 100).toFixed(2)}%`;
const integer = (value: number | null | undefined) => value == null ? "未知" : value.toLocaleString("en-US");
const normalize = (value?: string) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
type Preset = "7" | "14" | "30" | "all" | "custom";

function AdvertisingTrend({ title, trends, series, percentage = false }: {
  title: string;
  trends: AdvertisingAnalytics["trends"];
  series: { key: keyof AdvertisingMetrics; label: string; color: string }[];
  percentage?: boolean;
}) {
  const values = trends.flatMap((row) => series.map((item) => row[item.key])).filter((value): value is number => value !== null);
  const max = Math.max(...values, percentage ? 0.01 : 1);
  const first = trends.length ? Date.parse(trends[0].date) : 0;
  const last = trends.length ? Date.parse(trends[trends.length - 1].date) : 0;
  const x = (date: string) => first === last ? 390 : 60 + ((Date.parse(date) - first) / (last - first)) * 660;
  const y = (value: number) => 145 - (value / max) * 110;
  return <section className="panel ad-dashboard-chart" aria-label={title}>
    <h3>{title}</h3>
    <ul className="ad-dashboard-chart-legend">{series.map((item) => <li key={item.key}><span className="ad-dashboard-chart-swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>
    {!values.length ? <p className="analytics-note">暂无可信趋势数据。</p> : <svg className="ad-dashboard-chart-svg" viewBox="0 0 760 180" role="img" aria-label={`${title}，仅显示实际记录日期，未知值断开`}>
      <title>{title}；按实际日期展示，缺失与排除的数据不填零。</title>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1="60" x2="720" y1={y(max * fraction)} y2={y(max * fraction)} stroke="currentColor" opacity="0.12" /><text x="5" y={y(max * fraction) + 4} className="ad-dashboard-chart-axis">{percentage ? percent(max * fraction) : money(max * fraction)}</text></g>)}
      {series.map((item) => {
        const segments: string[][] = [[]];
        for (const row of trends) {
          const value = row[item.key];
          if (value === null) { if (segments[segments.length - 1].length) segments.push([]); }
          else segments[segments.length - 1].push(`${x(row.date)},${y(value)}`);
        }
        return <g key={item.key} stroke={item.color} fill={item.color}>
          {segments.filter((segment) => segment.length > 1).map((segment, index) => <polyline key={index} points={segment.join(" ")} fill="none" strokeWidth="2.5" />)}
          {trends.filter((row) => row[item.key] !== null).map((row) => <circle key={row.date} cx={x(row.date)} cy={y(row[item.key]!)} r="3"><title>{row.date} · {item.label}：{percentage ? percent(row[item.key]) : money(row[item.key])}</title></circle>)}
        </g>;
      })}
      <text x="60" y="172" className="ad-dashboard-chart-axis">{trends[0]?.date}</text>
      {trends.length > 1 ? <text x="720" y="172" textAnchor="end" className="ad-dashboard-chart-axis">{trends[trends.length - 1]?.date}</text> : null}
    </svg>}
  </section>;
}

export function AdvertisingDashboard({ records, mappings, loaded, error, targetAcos, onBack, onRefresh, onOpenManual, onOpenImport, onEditRecord, children }: AdvertisingDashboardProps) {
  const [preset, setPreset] = useState<Preset>("7");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [campaign, setCampaign] = useState("");
  const [asin, setAsin] = useState("");
  const [sku, setSku] = useState("");
  const [adjusted, setAdjusted] = useState<"all" | "yes" | "no" | "unknown">("all");
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [thresholds, setThresholds] = useState(() => defaultAdvertisingThresholds(targetAcos));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const range = useMemo(() => preset === "custom" ? { startDate: customStart || undefined, endDate: customEnd || undefined } : advertisingDateRange(records, preset), [records, preset, customStart, customEnd]);
  const invalidRange = Boolean(range.startDate && range.endDate && range.startDate > range.endDate);
  const analytics = useMemo(() => buildAdvertisingAnalytics(records, mappings, { ...range, campaign, asin, sku, adjusted }, thresholds), [records, mappings, range, campaign, asin, sku, adjusted, thresholds]);
  const anomalyIds = new Set(analytics.anomalies.map((anomaly) => anomaly.rowId));
  const detailRows = analytics.filteredRows.filter((row) => !onlyAnomalies || anomalyIds.has(row.id)).sort((a, b) => b.record.date.localeCompare(a.record.date) || a.record.campaign.localeCompare(b.record.campaign));
  const campaigns = [...new Set(records.map((record) => record.campaign))].sort();
  const asins = [...new Set([...mappings.map((mapping) => mapping.asin), ...records.map((record) => record.asin)].filter((value): value is string => Boolean(value)))].sort();
  const skus = [...new Set([...mappings.map((mapping) => mapping.sku), ...records.map((record) => record.sku)].filter((value): value is string => Boolean(value)))].sort();
  const dataError = error || refreshError;
  const updateThreshold = (field: keyof AdvertisingThresholds, value: string, fraction = false) => {
    const number = Number(value);
    const sample = field === "minClicks" || field === "minImpressions";
    if (!value.trim() || !Number.isFinite(number) || number < (sample ? 1 : 0) || (sample && !Number.isSafeInteger(number))) return;
    setThresholds((current) => ({ ...current, [field]: fraction ? number / 100 : number }));
  };
  async function refresh() {
    if (!onRefresh) return;
    setRefreshing(true); setRefreshError("");
    try { await onRefresh(); }
    catch (cause) { setRefreshError(cause instanceof Error ? cause.message : "广告数据刷新失败，请重试。"); }
    finally { setRefreshing(false); }
  }
  const metrics: { label: string; key: keyof AdvertisingMetrics; format: (value: number | null) => string; note?: string }[] = [
    { label: "总成本", key: "spend", format: money }, { label: "广告销售额", key: "adSales", format: money }, { label: "广告订单", key: "adOrders", format: integer },
    { label: "展示量", key: "impressions", format: integer, note: `${analytics.coverage.impressions}/${analytics.coverage.records} 条已提供${analytics.coverage.impressions < analytics.coverage.records ? " · 已知小计" : ""}` },
    { label: "点击量", key: "clicks", format: integer, note: `${analytics.coverage.clicks}/${analytics.coverage.records} 条已提供${analytics.coverage.clicks < analytics.coverage.records ? " · 已知小计" : ""}` },
    { label: "CPC", key: "cpc", format: money, note: "总成本 / 点击量" }, { label: "点击率 CTR", key: "ctr", format: percent, note: "点击量 / 展示量" },
    { label: "广告转化率", key: "cvr", format: percent, note: "广告订单 / 点击量" }, { label: "ACOS", key: "acos", format: percent, note: `目标 ${percent(thresholds.targetAcos)}` },
    { label: "ROAS", key: "roas", format: (value) => value === null ? "未知" : value.toFixed(2), note: "广告销售额 / 总成本" },
  ];

  return <main className="dashboard-shell promotion-shell ad-dashboard-shell">
    <header className="ad-dashboard-header">
      <div><p className="eyebrow">ADVERTISING ANALYTICS</p><h1>广告数据看板</h1><p className="ad-dashboard-range-label">按广告归因数据分析 · 金额单位 USD</p></div>
      <div className="ad-dashboard-actions"><button type="button" onClick={onBack}>返回总览</button>{onRefresh ? <button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "正在刷新…" : "刷新广告数据"}</button> : null}{onOpenManual ? <button type="button" onClick={onOpenManual}>手动录入广告</button> : null}{onOpenImport ? <button type="button" onClick={onOpenImport}>导入广告报告</button> : null}</div>
    </header>
    {children}
    {dataError ? <section className="panel ad-dashboard-notice" role="alert"><h2>广告数据读取失败</h2><p>{dataError}</p><p>未把读取失败当作零广告花费；请刷新重试。</p></section> : !loaded ? <p className="panel ad-dashboard-notice" role="status">正在加载广告数据…</p> : !records.length ? <p className="panel ad-dashboard-notice">暂无广告数据。请先手动录入或导入广告报告。</p> : <>
      <section className="panel ad-dashboard-filters" aria-labelledby="advertising-filter-heading">
        <div className="ad-dashboard-section-heading"><h2 id="advertising-filter-heading">分析范围</h2><span>{analytics.filteredRows.length} 条记录 · {analytics.trustedRows.length} 条可信</span></div>
        <div className="analytics-filter-grid">
          <label>日期范围<select aria-label="广告日期范围" value={preset} onChange={(event) => { const next = event.currentTarget.value as Preset; if (next === "custom") { setCustomStart(range.startDate ?? ""); setCustomEnd(range.endDate ?? ""); } setPreset(next); }}><option value="7">最近 7 天</option><option value="14">最近 14 天</option><option value="30">最近 30 天</option><option value="all">全部记录</option><option value="custom">自定义</option></select></label>
          <label>开始日期<input aria-label="广告开始日期" type="date" disabled={preset !== "custom"} value={range.startDate ?? ""} onChange={(event) => setCustomStart(event.currentTarget.value)} /></label>
          <label>结束日期<input aria-label="广告结束日期" type="date" disabled={preset !== "custom"} value={range.endDate ?? ""} onChange={(event) => setCustomEnd(event.currentTarget.value)} /></label>
          <label>广告活动<select aria-label="广告活动筛选" value={campaign} onChange={(event) => setCampaign(event.currentTarget.value)}><option value="">全部活动</option>{campaigns.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>ASIN<select aria-label="广告ASIN筛选" value={asin} onChange={(event) => setAsin(event.currentTarget.value)}><option value="">全部 ASIN / 活动汇总</option>{asins.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>SKU<select aria-label="广告SKU筛选" value={sku} onChange={(event) => setSku(event.currentTarget.value)}><option value="">全部 SKU / 活动汇总</option>{skus.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>是否调整<select aria-label="广告调整状态筛选" value={adjusted} onChange={(event) => setAdjusted(event.currentTarget.value as typeof adjusted)}><option value="all">全部状态</option><option value="yes">已调整</option><option value="no">未调整</option><option value="unknown">未记录</option></select></label>
        </div>
        <p className="analytics-note">快捷日期以最新已记录日期为终点；日期、活动、ASIN / SKU 和调整状态同步作用于指标、趋势与异常。活动汇总不会按尺码分摊。</p>
        {invalidRange ? <p role="alert">开始日期不能晚于结束日期。</p> : null}
      </section>
      {!analytics.filteredRows.length ? <p className="panel ad-dashboard-notice">当前筛选下没有广告记录。</p> : null}
      <section className="ad-dashboard-kpis" aria-label="广告关键指标">{metrics.map((metric) => <dl key={metric.key} className="ad-dashboard-kpi" aria-label={`${metric.label}指标`}><dt>{metric.label}</dt><dd>{metric.format(analytics.metrics[metric.key])}</dd><dd className="ad-dashboard-kpi-note">{metric.note ?? "筛选内可信记录合计"}</dd></dl>)}</section>
      <div className="ad-dashboard-notice analytics-note">
        <p>比率由同口径原始分子 / 分母加权计算，不平均逐行比率。分母为 0 显示未知；搜索首页首位展示份额仅在记录级展示，不提供缺少分母的加权汇总。</p>
        {analytics.coverage.traffic < analytics.coverage.records ? <p>部分记录缺少流量：已知点击 / 展示量仅为小计，相关总比率显示未知，不混用完整花费与部分点击。</p> : null}
        <p>广告订单与销售额可能存在归因延迟。近期异常是人工核查线索，不能据此判断调整造成了提升或下降。</p>
        {analytics.excluded.count ? <p role="status">已排除 {analytics.excluded.count} 条疑似重叠、重复、映射冲突或无效记录，原记录花费小计 {money(analytics.excluded.spend)}。该金额可能重复，不代表实际损失；历史仍保留在明细。</p> : null}
      </div>
      <details className="panel ad-dashboard-thresholds"><summary>异常阈值与样本门槛</summary><p className="analytics-note">ACOS 初始目标来自当前计划；其余是可调整的建议默认值，不是平台标准。以下规则逐条记录判断，不对小样本强行报警。</p><div className="ad-dashboard-threshold-grid analytics-filter-grid">
        <label>ACOS 目标（%）<input aria-label="ACOS目标阈值（%）" type="number" min="0" step="0.1" value={Number((thresholds.targetAcos * 100).toFixed(4))} onChange={(event) => updateThreshold("targetAcos", event.currentTarget.value, true)} /></label>
        <label>ACOS 最低花费（USD）<input aria-label="ACOS最低花费（USD）" type="number" min="0" step="1" value={thresholds.acosMinSpend} onChange={(event) => updateThreshold("acosMinSpend", event.currentTarget.value)} /></label>
        <label>无订单 / 销售花费（USD）<input aria-label="无订单花费阈值（USD）" type="number" min="0" step="1" value={thresholds.noOrdersSpend} onChange={(event) => updateThreshold("noOrdersSpend", event.currentTarget.value)} /></label>
        <label>最少点击量<input aria-label="异常最少点击量" type="number" min="1" step="1" value={thresholds.minClicks} onChange={(event) => updateThreshold("minClicks", event.currentTarget.value)} /></label>
        <label>CTR 最少展示量<input aria-label="CTR最少展示量" type="number" min="1" step="1" value={thresholds.minImpressions} onChange={(event) => updateThreshold("minImpressions", event.currentTarget.value)} /></label>
        <label>CTR 下限（%）<input aria-label="CTR下限阈值（%）" type="number" min="0" step="0.1" value={Number((thresholds.lowCtr * 100).toFixed(4))} onChange={(event) => updateThreshold("lowCtr", event.currentTarget.value, true)} /></label>
        <label>广告转化率下限（%）<input aria-label="广告转化率下限阈值（%）" type="number" min="0" step="0.1" value={Number((thresholds.lowCvr * 100).toFixed(4))} onChange={(event) => updateThreshold("lowCvr", event.currentTarget.value, true)} /></label>
        <label>CPC 上限（USD）<input aria-label="CPC上限阈值（USD）" type="number" min="0" step="0.1" value={thresholds.highCpc} onChange={(event) => updateThreshold("highCpc", event.currentTarget.value)} /></label>
      </div><button type="button" onClick={() => setThresholds(defaultAdvertisingThresholds(targetAcos))}>恢复建议阈值</button></details>
      <section aria-labelledby="advertising-trend-heading"><h2 id="advertising-trend-heading">每日趋势</h2><p className="analytics-note">只展示有记录的日期，不补造未来日期或无记录日期；被排除的整日数据保持未知断点。</p><div className="ad-dashboard-trend-grid">
        <AdvertisingTrend title="花费与广告销售额" trends={analytics.trends} series={[{ key: "spend", label: "总成本", color: "#b66a36" }, { key: "adSales", label: "广告销售额", color: "#2563a8" }]} />
        <AdvertisingTrend title="ACOS 与流量转化" trends={analytics.trends} percentage series={[{ key: "acos", label: "ACOS", color: "#b66a36" }, { key: "ctr", label: "点击率", color: "#2563a8" }, { key: "cvr", label: "广告转化率", color: "#4b7a61" }]} />
      </div><details className="panel"><summary>查看每日趋势数据</summary><div className="table-scroll"><table aria-label="广告每日趋势数据"><thead><tr><th>日期</th><th>可信记录</th><th>已排除</th><th>总成本</th><th>广告销售额</th><th>广告订单</th><th>点击量（已知）</th><th>展示量（已知）</th><th>CPC</th><th>点击率</th><th>广告转化率</th><th>ACOS</th><th>ROAS</th></tr></thead><tbody>{analytics.trends.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.records}</td><td>{day.excluded}</td><td>{money(day.spend)}</td><td>{money(day.adSales)}</td><td>{integer(day.adOrders)}</td><td>{integer(day.clicks)}</td><td>{integer(day.impressions)}</td><td>{money(day.cpc)}</td><td>{percent(day.ctr)}</td><td>{percent(day.cvr)}</td><td>{percent(day.acos)}</td><td>{day.roas?.toFixed(2) ?? "未知"}</td></tr>)}</tbody></table></div></details></section>
      <section className="panel" aria-labelledby="advertising-anomaly-heading"><div className="ad-dashboard-section-heading"><h2 id="advertising-anomaly-heading">广告异常清单</h2><span className="ad-dashboard-anomaly-summary">{anomalyIds.size} 条异常记录 · {analytics.anomalies.length} 项信号</span></div><p className="analytics-note">“高 / 注意”表示核查优先级。缺失数据、排除记录和样本不足单独列为数据待核，不混入表现异常。</p><div className="table-scroll"><table aria-label="广告异常清单"><thead><tr><th>日期</th><th>广告活动</th><th>异常</th><th>实际值</th><th>阈值 / 样本门槛</th><th>原因与建议动作</th><th>优先级</th></tr></thead><tbody>{analytics.anomalies.map((item) => <tr key={item.id}><td>{item.date}</td><th scope="row">{item.campaign}</th><td>{item.label}</td><td>{item.actual}</td><td>{item.threshold}</td><td>{item.reason}</td><td><span className={`ad-dashboard-severity ad-dashboard-severity--${item.severity}`}>{item.severity === "risk" ? "高" : "注意"}</span></td></tr>)}</tbody></table></div>{!analytics.anomalies.length ? <p>当前筛选下没有表现异常。</p> : null}</section>
      <details className="panel ad-dashboard-quality"><summary>数据待核 / 样本不足（{analytics.dataIssues.length} 项）</summary><p className="analytics-note">不是表现异常。映射仅依据显式 ASIN / SKU；未映射商品不会被推断为某个尺码。</p><div className="table-scroll"><table aria-label="广告数据质量清单"><thead><tr><th>日期</th><th>广告活动</th><th>类型</th><th>是否排除</th><th>原因</th></tr></thead><tbody>{analytics.dataIssues.map((item) => <tr key={item.id}><td>{item.date}</td><th scope="row">{item.campaign}</th><td>{item.kind === "insufficient-sample" ? "样本不足" : item.kind === "missing-data" ? "缺少数据" : "数据待核"}</td><td>{item.excluded ? "是" : "否"}</td><td>{item.reason}</td></tr>)}</tbody></table></div>{!analytics.dataIssues.length ? <p>当前筛选未发现数据质量或样本提示。</p> : null}</details>
      <section className="panel" aria-labelledby="advertising-record-heading">
        <div className="ad-dashboard-section-heading"><h2 id="advertising-record-heading">广告记录明细</h2><label className="ad-dashboard-record-controls"><input type="checkbox" aria-label="只看异常记录" checked={onlyAnomalies} onChange={(event) => setOnlyAnomalies(event.currentTarget.checked)} />只看异常记录</label></div>
        <p className="analytics-note">“只看异常”仅过滤下表，不改变上方指标、趋势或分析范围。点击左侧“手动修改”可修改原记录，保存后更新指标和异常。</p>
        <div className="table-scroll"><table aria-label="广告记录明细"><thead><tr><th className="record-edit-column">操作</th><th>日期</th><th>广告活动名称</th><th>ASIN / SKU / 尺码</th><th>展示量</th><th>点击量</th><th>点击率</th><th>总成本</th><th>CPC</th><th>购买量（广告订单）</th><th>销售额</th><th>ACOS</th><th>ROAS</th><th>广告转化率</th><th>搜索首页首位展示份额</th><th>是否调整</th><th>数据状态</th></tr></thead><tbody>{detailRows.map((item) => {
          const record = item.record;
          return <tr key={item.id}>
            <td className="record-edit-column"><button type="button" className="table-action-button" disabled={!loaded || Boolean(dataError) || !onEditRecord} aria-label={`手动修改广告 ${record.campaign} ${record.date}`} onClick={() => onEditRecord?.(record)}>手动修改</button></td>
            <td>{record.date}</td><th scope="row">{record.campaign}</th><td>{item.mapping.asin || "—"}<br />{item.mapping.sku || "—"}<br />{item.mapping.size ?? (item.mapping.status === "summary" ? "活动汇总" : item.mapping.status === "conflict" ? "映射冲突" : "未映射")}</td><td>{integer(record.impressions)}</td><td>{integer(record.clicks)}</td><td>{percent(advertisingRatio(record.clicks, record.impressions))}</td><td>{money(record.spend)}</td><td>{money(advertisingRatio(record.spend, record.clicks))}</td><td>{integer(record.adOrders)}</td><td>{money(record.adSales)}</td><td>{percent(advertisingRatio(record.spend, record.adSales))}</td><td>{advertisingRatio(record.adSales, record.spend)?.toFixed(2) ?? "未知"}</td><td>{percent(advertisingRatio(record.adOrders, record.clicks))}</td><td>{percent(record.topOfSearchImpressionShare)}</td><td>{record.adjusted === undefined ? "未记录" : record.adjusted ? "是" : "否"}</td>
            <td className="ad-dashboard-row-status">{item.excluded ? "已排除 · 数据待核" : anomalyIds.has(item.id) ? "表现异常" : item.qualityReasons.length ? "含数据 / 样本提示" : "未触发异常"}<details><summary>核查说明</summary>{item.qualityReasons.length ? <ul>{item.qualityReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p>显式商品：{normalize(record.asin) || normalize(record.sku) || "无（活动汇总）"}；未发现数据质量问题。</p>}</details></td>
          </tr>;
        })}</tbody></table></div>{onlyAnomalies && !detailRows.length ? <p>没有符合当前筛选的异常记录。</p> : null}
      </section>
    </>}
  </main>;
}
export default AdvertisingDashboard;
