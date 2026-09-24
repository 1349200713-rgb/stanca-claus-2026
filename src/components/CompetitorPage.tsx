"use client";

import { useEffect, useMemo, useState } from "react";
import type { ServerImportBatch, UpsertResult } from "../../db/ops-repository";
import type { CompetitorSnapshot } from "../domain/linkage";
import { parseCompetitorReport } from "../import/competitor-parser";
import { buildCompetitorAnalytics } from "../integration/competitor-analytics";
import { createHttpOpsRepository } from "../storage/http-ops-repository";
import { TrendChart } from "./TrendChart";

interface CompetitorRepository {
  list(resource: "competitors", filter: { marketplace: "US" }): Promise<CompetitorSnapshot[]>;
  upsertBatch(resource: "competitors", records: readonly CompetitorSnapshot[], batch: ServerImportBatch): Promise<UpsertResult>;
  delete(resource: "competitors", stableKey: string): Promise<void>;
}

const defaultRepository = createHttpOpsRepository() as unknown as CompetitorRepository;
const value = (input: number | null | undefined, suffix = "") => input == null ? "—" : `${input.toLocaleString()}${suffix}`;
const money = (input: number | null | undefined) => input == null ? "—" : `US$${input.toFixed(2)}`;
const average = (values: (number | null | undefined)[]) => {
  const available = values.filter((item): item is number => item != null);
  return available.length ? available.reduce((sum, item) => sum + item, 0) / available.length : null;
};

export function CompetitorPage({ repository = defaultRepository, onBack }: { repository?: CompetitorRepository; onBack: () => void }) {
  const [rows, setRows] = useState<CompetitorSnapshot[]>([]);
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState("");
  const [asinFilter, setAsinFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const refresh = () => repository.list("competitors", { marketplace: "US" }).then(setRows).catch((error) => setMessage(error instanceof Error ? error.message : "无法读取竞品数据"));
  useEffect(() => { void refresh(); }, []);
  const latestDate = rows.reduce((latest, row) => row.date > latest ? row.date : latest, "");
  const analytics = useMemo(() => buildCompetitorAnalytics(rows, latestDate || "9999-12-31"), [rows, latestDate]);
  const competitorOptions = useMemo(() => [...new Map(rows.map((row) => [row.competitorAsin, `${row.brand ?? row.competitorAsin}${row.isOwnProduct ? "（自有）" : ""}`])).entries()], [rows]);
  const sizeOptions = useMemo(() => [...new Set(rows.map((row) => row.size).filter((size): size is string => Boolean(size)))], [rows]);
  const filteredRows = useMemo(() => rows.filter((row) => (!dateFilter || row.date === dateFilter) && (!asinFilter || row.competitorAsin === asinFilter) && (!sizeFilter || row.size === sizeFilter)).toSorted((a, b) => b.date.localeCompare(a.date) || a.competitorAsin.localeCompare(b.competitorAsin) || (a.size ?? "").localeCompare(b.size ?? "")), [rows, dateFilter, asinFilter, sizeFilter]);
  const chartRows = useMemo(() => {
    const byDate = new Map<string, CompetitorSnapshot[]>();
    filteredRows.forEach((row) => byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]));
    return [...byDate.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([date, snapshots]) => ({
      date: date.slice(5),
      price: average(snapshots.map((row) => row.price)),
      effectivePrice: average(snapshots.map((row) => row.effectivePrice)),
      categoryRank: average(snapshots.map((row) => row.categoryRank)),
      subcategoryRank: average(snapshots.map((row) => row.subcategoryRank)),
      rating: average(snapshots.map((row) => row.rating)),
    }));
  }, [filteredRows]);

  async function upload(file: File | undefined) {
    if (!file) return;
    const importedAt = new Date().toISOString();
    const parsed = parseCompetitorReport(await file.arrayBuffer(), file.name, importedAt);
    setIssues(parsed.issues);
    if (!parsed.records.length) { setMessage("没有可保存的竞品记录"); return; }
    const result = await repository.upsertBatch("competitors", parsed.records, { id: `competitor:${importedAt}`, filename: file.name, importedAt });
    setMessage(`竞品数据已保存：新增 ${result.inserted}，更新 ${result.updated}`);
    await refresh();
  }

  return <main className="dashboard-shell promotion-shell">
    <header className="dashboard-header"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">CP</span><div><p className="brand-kicker">COMPETITOR TRACKING</p><h1>竞品跟踪</h1><p className="as-of">价格、促销、评价与BSR每日变化</p></div></div><button className="secondary-button" type="button" onClick={onBack}>返回经营驾驶舱</button></header>
    <section className="competitor-kpi-grid" aria-label="竞品核心指标">
      <article className="kpi-card"><p className="kpi-card__label">跟踪竞品数</p><p className="kpi-card__value">{analytics.summary.tracked}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">异常提醒</p><p className="kpi-card__value">{analytics.summary.alerts}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">竞品最低到手价</p><p className="kpi-card__value">{money(analytics.summary.lowestCompetitorPrice)}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">自有最低到手价</p><p className="kpi-card__value">{money(analytics.summary.ownEffectivePrice)}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">竞品与自有价差</p><p className="kpi-card__value">{money(analytics.summary.priceGap)}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">促销变化</p><p className="kpi-card__value">{analytics.summary.promotionChanges}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">最新数据日期</p><p className="kpi-card__value">{latestDate || "—"}</p></article>
    </section>
    <section className="panel competitor-filter-panel" aria-label="竞品筛选">
      <label>日期<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.currentTarget.value)} /></label>
      <label>品牌 / ASIN<select value={asinFilter} onChange={(event) => setAsinFilter(event.currentTarget.value)}><option value="">全部</option>{competitorOptions.map(([asin, label]) => <option key={asin} value={asin}>{label} / {asin}</option>)}</select></label>
      <label>尺码<select value={sizeFilter} onChange={(event) => setSizeFilter(event.currentTarget.value)}><option value="">全部</option>{sizeOptions.map((size) => <option key={size}>{size}</option>)}</select></label>
      <button type="button" className="secondary-button" onClick={() => { setDateFilter(""); setAsinFilter(""); setSizeFilter(""); }}>清除筛选</button>
    </section>
    <section className="trend-grid competitor-trend-grid" aria-label="竞品趋势图表">
      <TrendChart title="页面售价 / 优惠后价格" rows={chartRows} series={[{ key: "price", label: "页面售价", color: "#526277", axis: "price" }, { key: "effectivePrice", label: "优惠后价格", color: "#9f1d28", axis: "price" }]} />
      <TrendChart title="大类 / 小类排名" rows={chartRows} series={[{ key: "categoryRank", label: "大类排名", color: "#526277", axis: "value" }, { key: "subcategoryRank", label: "小类排名", color: "#9f1d28", axis: "value" }]} />
      <TrendChart title="评分走势" rows={chartRows} series={[{ key: "rating", label: "评分", color: "#b1822f", axis: "value" }]} />
    </section>
    <section className="panel promotion-table-panel"><div className="panel-heading"><div><p className="eyebrow">IMPORT & DETAIL</p><h2>竞品每日明细</h2></div><label className="secondary-button" htmlFor="competitor-file">上传竞品数据</label></div>
      <input id="competitor-file" className="sr-only" aria-label="上传竞品数据" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void upload(event.currentTarget.files?.[0])} />
      {message ? <p role="status">{message}</p> : null}{issues.length ? <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      <div className="table-scroll competitor-detail-table"><table aria-label="竞品每日明细"><thead><tr><th>日期</th><th>类型</th><th>品牌 / ASIN</th><th>尺码</th><th>页面售价</th><th>优惠后价格</th><th>Coupon</th><th>CODE</th><th>Prime Savings</th><th>评分</th><th>大类排名</th><th>小类排名</th><th>颜色/款式</th><th>备注</th><th>链接</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.id} className={row.isOwnProduct ? "competitor-own-row" : undefined}><th>{row.date}</th><td>{row.isOwnProduct ? "自有基准" : "竞品"}</td><td><strong>{row.brand ?? "—"}</strong><br />{row.competitorAsin}</td><td>{row.size ?? "—"}</td><td>{money(row.price)}</td><td>{money(row.effectivePrice)}</td><td>{row.couponPercent != null ? `${row.couponPercent}%` : row.couponAmount != null ? money(row.couponAmount) : "—"}</td><td>{value(row.codePercent, "%")}</td><td>{row.primeSavings || "—"}</td><td>{value(row.rating)}</td><td>{value(row.categoryRank)}</td><td>{value(row.subcategoryRank ?? row.bsrRank)}</td><td>{row.colorStyle || "—"}</td><td>{row.note || "—"}</td><td>{row.source ? <a href={row.source} target="_blank" rel="noreferrer">打开</a> : "—"}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ALERTS</p><h2>竞品动态提醒</h2></div></div>{analytics.alerts.length ? <ul className="action-list">{analytics.alerts.map((alert) => <li key={alert.id} className={alert.severity === "risk" ? "status-risk" : "status-attention"}><strong>{alert.competitorAsin}</strong><span>{alert.detail}</span></li>)}</ul> : <p>暂无竞品异常。</p>}</section>
  </main>;
}
