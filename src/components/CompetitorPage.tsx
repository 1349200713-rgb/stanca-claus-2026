"use client";

import { useEffect, useMemo, useState } from "react";
import type { ServerImportBatch, UpsertResult } from "../../db/ops-repository";
import type { CompetitorSnapshot } from "../domain/linkage";
import { parseCompetitorReport } from "../import/competitor-parser";
import { buildCompetitorAnalytics } from "../integration/competitor-analytics";
import { createHttpOpsRepository } from "../storage/http-ops-repository";

interface CompetitorRepository {
  list(resource: "competitors", filter: { marketplace: "US" }): Promise<CompetitorSnapshot[]>;
  upsertBatch(resource: "competitors", records: readonly CompetitorSnapshot[], batch: ServerImportBatch): Promise<UpsertResult>;
  delete(resource: "competitors", stableKey: string): Promise<void>;
}

const defaultRepository = createHttpOpsRepository() as unknown as CompetitorRepository;
const value = (input: number | null | undefined, suffix = "") => input == null ? "—" : `${input.toLocaleString()}${suffix}`;

export function CompetitorPage({ repository = defaultRepository, onBack }: { repository?: CompetitorRepository; onBack: () => void }) {
  const [rows, setRows] = useState<CompetitorSnapshot[]>([]);
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const refresh = () => repository.list("competitors", { marketplace: "US" }).then(setRows).catch((error) => setMessage(error instanceof Error ? error.message : "无法读取竞品数据"));
  useEffect(() => { void refresh(); }, []);
  const latestDate = rows.reduce((latest, row) => row.date > latest ? row.date : latest, "");
  const analytics = useMemo(() => buildCompetitorAnalytics(rows, latestDate || "9999-12-31"), [rows, latestDate]);

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
    <section className="promotion-kpi-grid" aria-label="竞品核心指标">
      <article className="kpi-card"><p className="kpi-card__label">跟踪竞品数</p><p className="kpi-card__value">{analytics.summary.tracked}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">异常提醒</p><p className="kpi-card__value">{analytics.summary.alerts}</p></article>
      <article className="kpi-card"><p className="kpi-card__label">最新数据日期</p><p className="kpi-card__value">{latestDate || "—"}</p></article>
    </section>
    <section className="panel promotion-table-panel"><div className="panel-heading"><div><p className="eyebrow">IMPORT & DETAIL</p><h2>竞品每日明细</h2></div><label className="secondary-button" htmlFor="competitor-file">上传竞品数据</label></div>
      <input id="competitor-file" className="sr-only" aria-label="上传竞品数据" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void upload(event.currentTarget.files?.[0])} />
      {message ? <p role="status">{message}</p> : null}{issues.length ? <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      <div className="table-scroll"><table aria-label="竞品每日明细"><thead><tr><th>日期</th><th>竞品ASIN</th><th>品牌/品名</th><th>价格</th><th>优惠</th><th>评分</th><th>评论数</th><th>BSR</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><th>{row.date}</th><td>{row.competitorAsin}</td><td>{[row.brand, row.productName].filter(Boolean).join(" / ") || "—"}</td><td>{row.price == null ? "—" : `US$${row.price.toFixed(2)}`}</td><td>{value(row.couponPercent, "%")}</td><td>{value(row.rating)}</td><td>{value(row.reviewCount)}</td><td>{value(row.bsrRank)}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ALERTS</p><h2>竞品动态提醒</h2></div></div>{analytics.alerts.length ? <ul className="action-list">{analytics.alerts.map((alert) => <li key={alert.id} className={alert.severity === "risk" ? "status-risk" : "status-attention"}><strong>{alert.competitorAsin}</strong><span>{alert.detail}</span></li>)}</ul> : <p>暂无竞品异常。</p>}</section>
  </main>;
}
