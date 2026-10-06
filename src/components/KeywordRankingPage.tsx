"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServerImportBatch, UpsertResult } from "../../db/ops-repository";
import type { KeywordRankSnapshot } from "../domain/linkage";
import type { DailyOperationRecord } from "../domain/planning";
import { isSearchVolumeSnapshot, type SearchVolumeSnapshot } from "../domain/keyword-volume";
import { parseKeywordRankReport } from "../import/keyword-rank-parser";
import { parseKeywordVolumeReport } from "../import/keyword-volume-parser";
import { buildKeywordAnalytics } from "../integration/keyword-analytics";
import { prepareKeywordVolumeImport } from "../integration/keyword-volume-analytics";
import { createHttpOpsRepository } from "../storage/http-ops-repository";
import { KeywordVolumePanel } from "./KeywordVolumePanel";
import { AbaRankPanel } from "./AbaRankPanel";

type KeywordRecord = KeywordRankSnapshot | SearchVolumeSnapshot;
interface KeywordRepository { list(resource: "keywords", filter: { marketplace: "US" }): Promise<KeywordRecord[]>; upsertBatch(resource: "keywords", records: readonly KeywordRecord[], batch: ServerImportBatch): Promise<UpsertResult>; delete(resource: "keywords", key: string): Promise<void> }
const defaultRepository = createHttpOpsRepository() as unknown as KeywordRepository;
const rank = (value: number | null, status: string) => status === "notIndexed" ? "未收录" : value ?? "—";
const pagePosition = (page: number | null | undefined, position: number | null | undefined) => page != null && position != null && Number.isInteger(page) && Number.isInteger(position) && page > 0 && position > 0 ? `第${page}页第${position}位` : "—";

export function KeywordRankingPage({ repository = defaultRepository, onBack, onCreateOperation }: { repository?: KeywordRepository; onBack: () => void; onCreateOperation?: (record: DailyOperationRecord) => void | Promise<void> }) {
  const [records, setRecords] = useState<KeywordRecord[]>([]); const [message, setMessage] = useState(""); const [issues, setIssues] = useState<string[]>([]);
  const [readError, setReadError] = useState(""); const [loaded, setLoaded] = useState(false); const [uploading, setUploading] = useState(false);
  const refresh = useCallback(async () => { try { setRecords(await repository.list("keywords", { marketplace: "US" })); setReadError(""); } catch (error) { setReadError(error instanceof Error ? error.message : "无法读取关键词数据"); } finally { setLoaded(true); } }, [repository]);
  useEffect(() => {
    let cancelled = false;
    void repository.list("keywords", { marketplace: "US" }).then((next) => { if (!cancelled) { setRecords(next); setReadError(""); } })
      .catch((error) => { if (!cancelled) setReadError(error instanceof Error ? error.message : "无法读取关键词数据"); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [repository]);
  const rows = useMemo(() => records.filter((row): row is KeywordRankSnapshot => !("kind" in row) && typeof row.date === "string" && typeof row.keywordId === "string"), [records]);
  const productRows = useMemo(() => rows.filter((row) => row.abaRank == null || row.organicRank != null || row.adRank != null || row.organicStatus === "notIndexed" || row.adStatus === "notIndexed" || pagePosition(row.organicPage, row.organicPosition) !== "—" || pagePosition(row.adPage, row.adPosition) !== "—"), [rows]);
  const volumes = useMemo(() => records.filter(isSearchVolumeSnapshot), [records]);
  const invalidVolumes = records.filter((row) => "kind" in row && row.kind === "search-volume" && !isSearchVolumeSnapshot(row)).length;
  const latest = productRows.reduce((date, row) => row.date > date ? row.date : date, ""); const analytics = useMemo(() => buildKeywordAnalytics(productRows, latest || "9999-12-31"), [productRows, latest]);
  async function upload(file?: File) { if (!file) return; setUploading(true); setMessage(""); try { const importedAt = new Date().toISOString(); const parsed = parseKeywordRankReport(await file.arrayBuffer(), file.name, importedAt); setIssues(parsed.issues); if (!parsed.records.length) { setMessage("没有可保存的关键词排名"); return; } const result = await repository.upsertBatch("keywords", parsed.records, { id: `keyword:${importedAt}`, filename: file.name, importedAt }); setMessage(`关键词排名已保存：新增 ${result.inserted}，更新 ${result.updated}`); await refresh(); } catch (error) { setMessage(`排名导入失败：${error instanceof Error ? error.message : "请重试"}`); } finally { setUploading(false); } }
  async function uploadVolume(file?: File) {
    if (!file) return;
    setUploading(true); setMessage("");
    try {
      const importedAt = new Date().toISOString();
      const parsed = parseKeywordVolumeReport(await file.arrayBuffer(), file.name, importedAt);
      const current = (await repository.list("keywords", { marketplace: "US" })).filter(isSearchVolumeSnapshot);
      const prepared = prepareKeywordVolumeImport(current, parsed.records);
      setIssues([...parsed.issues, ...prepared.issues]);
      if (!prepared.records.length) { setMessage("没有可保存的搜索量，请检查导入问题。"); return; }
      const result = await repository.upsertBatch("keywords", prepared.records, { id: `keyword-volume:${importedAt}`, filename: file.name, importedAt });
      setMessage(`搜索量已保存：新增 ${result.inserted}，更新 ${result.updated}；已有排名未覆盖。`);
      await refresh();
    } catch (error) { setMessage(`搜索量导入失败：${error instanceof Error ? error.message : "请重试"}`); }
    finally { setUploading(false); }
  }
  return <main className="dashboard-shell promotion-shell keyword-ranking-shell"><header className="dashboard-header"><div className="brand-lockup"><span className="brand-mark">KW</span><div><p className="brand-kicker">KEYWORD INTELLIGENCE</p><h1>关键词排名</h1><p className="as-of">真实搜索量趋势 · 自然排名 / 广告排名 / ABA 排名独立跟踪</p></div></div><div className="volume-actions"><button type="button" className="secondary-button" onClick={() => void refresh()}>刷新关键词数据</button><button type="button" className="secondary-button" onClick={onBack}>返回经营驾驶舱</button></div></header>
    {readError ? <p className="ad-dashboard-notice" role="alert">读取关键词数据失败：{readError}。保留上次读取数据，请刷新重试。</p> : null}
    {invalidVolumes ? <p className="volume-warnings">有 {invalidVolumes} 条无效搜索量记录未参与计算，请核对记录格式。</p> : null}
    {message ? <p className="volume-upload-message" role="status">{message}</p> : null}{issues.length ? <ul className="volume-warnings" aria-label="关键词导入问题">{issues.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
    <AbaRankPanel rows={rows} loaded={loaded} error={readError} />
    <section className="keyword-product-section" aria-labelledby="product-keyword-heading">
    <div className="panel-heading"><div><p className="eyebrow">PRODUCT KEYWORD RANK</p><h2 id="product-keyword-heading">商品关键词排名</h2><p className="analytics-note">自有商品自然排名与广告排名独立记录；ABA 排名不参与以下指标。</p></div></div>
    <section className="promotion-kpi-grid" aria-label="关键词核心指标"><article className="kpi-card"><p className="kpi-card__label">核心关键词数</p><p className="kpi-card__value">{analytics.summary.tracked}</p></article><article className="kpi-card"><p className="kpi-card__label">前10名关键词</p><p className="kpi-card__value">{analytics.summary.top10}</p></article><article className="kpi-card"><p className="kpi-card__label">首页关键词</p><p className="kpi-card__value">{analytics.summary.firstPage}</p></article><article className="kpi-card"><p className="kpi-card__label">下降提醒</p><p className="kpi-card__value">{analytics.alerts.length}</p></article></section>
    <section className="panel promotion-table-panel"><div className="panel-heading"><div><p className="eyebrow">DAILY RANK</p><h2>关键词每日排名</h2></div><label className="secondary-button" htmlFor="keyword-file">上传关键词排名</label></div>
      <p className="analytics-note">自然/广告位置表示页码和页内位置，不等同于总排名；仅有位置的记录不计入前10名和首页关键词。</p>
      <input id="keyword-file" className="sr-only" aria-label="上传关键词排名" type="file" accept=".csv,.xlsx,.xls" disabled={uploading || !loaded || !!readError} onChange={(event) => void upload(event.currentTarget.files?.[0])}/>
      <div className="table-scroll"><table aria-label="关键词每日排名"><thead><tr><th>日期</th><th>ASIN</th><th>关键词</th><th>自然排名</th><th>自然位置</th><th>广告排名</th><th>广告位置</th><th>来源说明</th></tr></thead><tbody>{productRows.map((row) => <tr key={row.id}><th>{row.date}</th><td>{row.asin}</td><td>{row.keyword}</td><td>{rank(row.organicRank, row.organicStatus)}</td><td>{pagePosition(row.organicPage, row.organicPosition)}</td><td>{rank(row.adRank, row.adStatus)}</td><td>{pagePosition(row.adPage, row.adPosition)}</td><td>{row.note?.trim() || row.source?.trim() || "—"}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">RANK ALERTS</p><h2>关键词异常</h2></div></div>{analytics.alerts.length ? <ul className="action-list">{analytics.alerts.map((item) => <li key={item.id} className={item.severity === "risk" ? "status-risk" : "status-attention"}><strong>{item.keywordId}</strong><span>{item.detail}</span>{onCreateOperation ? <button type="button" onClick={() => void onCreateOperation({ key: `daily-op:${item.id}`, date: item.date, action: "检查关键词排名与广告投放", risk: item.detail, tomorrowPlan: "复查排名、流量和转化", status: "未完成", category: "关键词", priority: item.severity === "risk" ? "高" : "中", asin: item.asin, keywordId: item.keywordId, sourceAlertId: item.id, effectStatus: "待观察", updatedAt: new Date().toISOString() })}>生成操作</button> : null}</li>)}</ul> : <p>暂无排名异常。</p>}</section>
    </section>
    <KeywordVolumePanel rows={volumes} loaded={loaded} error={readError} onUpload={uploadVolume} uploading={uploading} />
    </main>;
}
