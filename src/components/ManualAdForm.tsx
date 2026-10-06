"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PrimaryMapping } from "../data/plan";
import type { AdRecord } from "../domain/types";
import { opsDb } from "../storage/db";

const normalize = (value?: string) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const money = (value?: number) => value === undefined ? "—" : `US$${value.toFixed(2)}`;
const percent = (value?: number) => value === undefined ? "—" : `${(value * 100).toFixed(2)}%`;
const ratio = (numerator?: number, denominator?: number) => numerator === undefined || denominator === undefined || denominator === 0 ? undefined : numerator / denominator;
const optionalNumber = (value: string) => value.trim() ? Number(value) : undefined;

interface AdDraft {
  date: string;
  campaign: string;
  asin: string;
  sku: string;
  spend: string;
  adSales: string;
  adOrders: string;
  clicks: string;
  impressions: string;
  topShare: string;
  adjusted: string;
}

function matches(row: AdRecord, draft: AdDraft): boolean {
  if (row.date !== draft.date || normalize(row.campaign) !== normalize(draft.campaign)) return false;
  if (!row.asin && !row.sku) return true;
  return normalize(row.asin) === normalize(draft.asin) && normalize(row.sku) === normalize(draft.sku);
}

function emptyDraft(date?: string): AdDraft {
  return { date: date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), campaign: "", asin: "", sku: "", spend: "", adSales: "", adOrders: "", clicks: "", impressions: "", topShare: "", adjusted: "" };
}

function recordDraft(row: AdRecord): AdDraft {
  return { date: row.date, campaign: row.campaign, asin: row.asin ?? "", sku: row.sku ?? "", spend: String(row.spend), adSales: String(row.adSales), adOrders: String(row.adOrders), clicks: row.clicks === undefined ? "" : String(row.clicks), impressions: row.impressions === undefined ? "" : String(row.impressions), topShare: row.topOfSearchImpressionShare === undefined ? "" : String(Number((row.topOfSearchImpressionShare * 100).toFixed(6))), adjusted: row.adjusted === undefined ? "" : row.adjusted ? "yes" : "no" };
}

function revision(row: AdRecord): string {
  return JSON.stringify([row.date, row.campaign, row.asin, row.sku, row.marketplace, row.spend, row.adSales, row.adOrders, row.clicks, row.impressions, row.topOfSearchImpressionShare, row.adjusted, row.cpc, row.ctr, row.cvr, row.acos, row.roas, row.source, row.updatedAt]);
}

function importLogKey(updatedAt: string): string {
  return `manual-ads:${updatedAt}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function ManualAdForm({ mappings, records, loaded, onSaved, initialRecord, initialDate, onCancel }: {
  mappings: readonly PrimaryMapping[];
  records: readonly AdRecord[];
  loaded: boolean;
  onSaved: (record: AdRecord) => void | Promise<void>;
  initialRecord?: AdRecord;
  initialDate?: string;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<AdDraft>(() => initialRecord ? recordDraft(initialRecord) : emptyDraft(initialDate));
  const [selectedRecord, setSelectedRecord] = useState(initialRecord);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectedKey = selectedRecord?.key;
  useEffect(() => {
    heading.current?.focus(); heading.current?.scrollIntoView?.({ block: "start" });
  }, [selectedKey, initialDate]);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingExisting, setPendingExisting] = useState<AdRecord>();
  const existing = selectedRecord ?? pendingExisting ?? records.find((row) => matches(row, draft));
  const dayRows = records.filter((row) => row.date === draft.date);
  const spend = optionalNumber(draft.spend);
  const adSales = optionalNumber(draft.adSales);
  const adOrders = optionalNumber(draft.adOrders);
  const clicks = optionalNumber(draft.clicks);
  const impressions = optionalNumber(draft.impressions);
  const cpc = ratio(spend, clicks);
  const ctr = ratio(clicks, impressions);
  const cvr = ratio(adOrders, clicks);
  const acos = ratio(spend, adSales);
  const roas = ratio(adSales, spend);

  function update(field: keyof AdDraft, value: string) {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "asin" || field === "sku") {
        const mapped = mappings.find((item) => normalize(item[field]) === normalize(value));
        if (mapped) { next.asin = mapped.asin; next.sku = mapped.sku; }
      }
      return next;
    });
    setConfirmed(false); setPendingExisting(undefined); setError(""); setMessage("");
  }

  function edit(row: AdRecord) {
    setSelectedRecord(row); setDraft(recordDraft(row));
    setConfirmed(false); setPendingExisting(undefined); setError(""); setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || saving) return;
    setError(""); setMessage("");
    const date = new Date(`${draft.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== draft.date) { setError("请填写有效的广告日期。"); return; }
    const campaign = draft.campaign.trim().replace(/\s+/g, " ");
    if (!campaign) { setError("请填写广告活动名称。"); return; }
    if (spend === undefined || !Number.isFinite(spend) || spend < 0 || adSales === undefined || !Number.isFinite(adSales) || adSales < 0) { setError("总成本和广告销售额必须填写非负金额，实际为零请填写 0。"); return; }
    if (adOrders === undefined || !Number.isSafeInteger(adOrders) || adOrders < 0 || [clicks, impressions].some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) { setError("购买量、点击量和展示量必须是非负整数；未统计的点击量、展示量可留空。"); return; }
    if (clicks !== undefined && impressions !== undefined && clicks > impressions) { setError("点击量不能大于展示量，请检查填写的报表口径。"); return; }
    const topShare = optionalNumber(draft.topShare);
    if (topShare !== undefined && (!Number.isFinite(topShare) || topShare < 0 || topShare > 100)) { setError("搜索首页首位展示份额必须为 0 到 100 之间的百分比。"); return; }
    const mappedAsin = mappings.find((item) => normalize(item.asin) === normalize(draft.asin));
    const mappedSku = mappings.find((item) => normalize(item.sku) === normalize(draft.sku));
    if ((mappedAsin && draft.sku && normalize(mappedAsin.sku) !== normalize(draft.sku)) || (mappedSku && draft.asin && normalize(mappedSku.asin) !== normalize(draft.asin))) { setError("ASIN 和 SKU 必须属于同一商品。"); return; }
    setSaving(true);
    try {
      const current = await opsDb.list("ads");
      const previous = selectedRecord ? current.find((row) => row.key === selectedRecord.key) : current.find((row) => matches(row, draft));
      if (selectedRecord && !previous) { setError("原广告记录已不存在，请刷新后重新选择，不会自动新增。"); return; }
      if (selectedRecord && previous && revision(previous) !== revision(selectedRecord)) { setError("原广告记录已变更，请刷新后重新选择，避免覆盖其他修改。"); return; }
      if (selectedRecord && current.some((row) => row.key !== selectedRecord.key && (matches(row, draft) || (!draft.asin && !draft.sku && row.date === draft.date && normalize(row.campaign) === normalize(campaign))))) { setError("修改后的日期、活动和商品与另一条记录重叠，请检查后再保存。"); return; }
      if (!selectedRecord && previous && confirmed && (!existing || existing.key !== previous.key || revision(existing) !== revision(previous))) { setPendingExisting(previous); setConfirmed(false); setError("已有广告数据已变更，请核对最新金额并重新确认覆盖。"); return; }
      if (!previous && !draft.asin && !draft.sku && current.some((row) => row.date === draft.date && normalize(row.campaign) === normalize(campaign))) { setError("该活动已有商品明细，请填写 ASIN / SKU 编辑对应记录，避免重复计入活动汇总。"); return; }
      if (previous && !confirmed) { setPendingExisting(previous); setError("该日期和广告活动已有数据，请确认覆盖后保存。"); return; }
      const asin = draft.asin.trim().toUpperCase();
      const sku = draft.sku.trim().toUpperCase();
      const updatedAt = new Date().toISOString();
      const record: AdRecord = {
        ...previous,
        key: previous?.key ?? `ads:${draft.date}:${normalize(campaign)}${asin ? `:${normalize(asin)}` : ""}${sku ? `:${normalize(sku)}` : ""}`,
        date: draft.date, marketplace: "US", campaign, asin: asin || undefined, sku: sku || undefined,
        spend, adSales, adOrders, clicks, impressions, cpc, ctr, cvr, acos, roas,
        topOfSearchImpressionShare: topShare === undefined ? undefined : topShare / 100,
        adjusted: draft.adjusted === "" ? undefined : draft.adjusted === "yes", source: "manual", updatedAt,
      };
      await opsDb.commitImport("ads", [record], { key: importLogKey(updatedAt), filename: "手动广告录入", importedAt: updatedAt, reportKind: "ads", rowCount: 1, issueCount: 0, duplicateCount: previous ? 1 : 0, action: previous ? "replace" : "insert" });
      if (selectedRecord) setSelectedRecord(record);
      setPendingExisting(undefined); setConfirmed(false);
      setMessage(`${record.date} · ${record.campaign} 广告数据已保存。`);
      try { await onSaved(record); }
      catch { setError("广告数据已保存，但页面刷新失败；请刷新页面核对，不要重复新增。"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { setSaving(false); }
  }

  return <section className="panel manual-sales-panel manual-ad-panel" aria-labelledby="manual-ad-heading">
    <div className="panel-heading"><div><p className="eyebrow">ADVERTISING DATA ENTRY</p><h2 id="manual-ad-heading" tabIndex={-1} ref={heading}>{selectedRecord ? "手动修改广告数据" : "手动录入广告数据"}</h2></div><span className="panel-meta">金额：美元 USD</span></div>
    <p className="manual-sales-note">每次填写一个广告活动的单日数据。ASIN / SKU 选填，关联后可按商品统计。购买量、销售额填写广告归因数据；CPC、点击率、转化率、ACOS 和 ROAS 自动计算。</p>
    {selectedRecord ? <p className="manual-sales-note">正在修改 {selectedRecord.date} · {selectedRecord.campaign} 的原记录；保存后重新计算指标，不重复新增。</p> : null}
    <form onSubmit={(event) => void save(event)} noValidate><fieldset className="manual-form" disabled={!loaded || saving}>
      <label>时间<input aria-label="广告日期" type="date" value={draft.date} onChange={(event) => update("date", event.currentTarget.value)} required /></label>
      <label>广告活动名称<input aria-label="广告活动名称" list="ad-campaign-options" value={draft.campaign} onChange={(event) => update("campaign", event.currentTarget.value)} required /><datalist id="ad-campaign-options">{[...new Set(records.map((row) => row.campaign))].map((name) => <option key={name} value={name} />)}</datalist></label>
      <label>ASIN（选填）<input aria-label="广告ASIN（选填）" list="ad-asin-options" value={draft.asin} onChange={(event) => update("asin", event.currentTarget.value)} /><datalist id="ad-asin-options">{mappings.map((item) => <option key={item.asin} value={item.asin}>{item.size}</option>)}</datalist></label>
      <label>SKU（选填）<input aria-label="广告SKU（选填）" list="ad-sku-options" value={draft.sku} onChange={(event) => update("sku", event.currentTarget.value)} /><datalist id="ad-sku-options">{mappings.map((item) => <option key={item.sku} value={item.sku}>{item.size}</option>)}</datalist></label>
      <label>展示量（选填）<input aria-label="展示量（选填）" type="number" min="0" step="1" value={draft.impressions} onChange={(event) => update("impressions", event.currentTarget.value)} /></label>
      <label>点击量（选填）<input aria-label="点击量（选填）" type="number" min="0" step="1" value={draft.clicks} onChange={(event) => update("clicks", event.currentTarget.value)} /></label>
      <label>总成本（USD）<input aria-label="广告花费（USD）" type="number" min="0" step="0.01" value={draft.spend} onChange={(event) => update("spend", event.currentTarget.value)} required /></label>
      <label>购买量（广告订单）<input aria-label="广告订单（单）" type="number" min="0" step="1" value={draft.adOrders} onChange={(event) => update("adOrders", event.currentTarget.value)} required /></label>
      <label>销售额（USD）<input aria-label="广告销售额（USD）" type="number" min="0" step="0.01" value={draft.adSales} onChange={(event) => update("adSales", event.currentTarget.value)} required /></label>
      <label>搜索结果首页首位展示量份额（%）<input aria-label="搜索首页首位展示份额（%）" type="number" min="0" max="100" step="0.01" value={draft.topShare} onChange={(event) => update("topShare", event.currentTarget.value)} /></label>
      <label>是否调整<select aria-label="是否调整" value={draft.adjusted} onChange={(event) => update("adjusted", event.currentTarget.value)}><option value="">未记录</option><option value="yes">是</option><option value="no">否</option></select></label>
      <div className="ad-calculated-metrics" aria-label="广告自动计算指标"><span>点击率 <strong>{percent(ctr)}</strong></span><span>CPC <strong>{money(cpc)}</strong></span><span>ACOS <strong>{percent(acos)}</strong></span><span>ROAS <strong>{roas === undefined ? "—" : roas.toFixed(2)}</strong></span><span>转化率 <strong>{percent(cvr)}</strong></span></div>
      {existing ? <label className="manual-checkbox manual-sales-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />确认覆盖已有总成本 {money(existing.spend)} / 销售额 {money(existing.adSales)}</label> : null}
      <button type="submit">{saving ? "正在保存…" : "保存广告数据"}</button>
      {selectedRecord || onCancel ? <button type="button" className="secondary-button" onClick={() => { setSelectedRecord(undefined); setDraft(emptyDraft(initialDate)); setConfirmed(false); setPendingExisting(undefined); setError(""); setMessage(""); onCancel?.(); }}>{selectedRecord ? "取消修改" : "关闭录入"}</button> : null}
    </fieldset></form>
    {error ? <p role="alert" className="manual-sales-error">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    <div className="table-scroll"><table aria-label="当日广告活动数据"><thead><tr><th className="record-edit-column">操作</th><th>时间</th><th>广告活动名称</th><th>ASIN / SKU</th><th>展示量</th><th>点击量</th><th>点击率</th><th>总成本</th><th>CPC</th><th>购买量</th><th>销售额</th><th>ACOS</th><th>ROAS</th><th>转化率</th><th>搜索结果首页首位展示量份额</th><th>是否调整</th></tr></thead><tbody>{dayRows.map((row) => <tr key={row.key}><td className="record-edit-column"><button type="button" className="table-action-button" disabled={!loaded || saving} aria-label={`编辑广告 ${row.campaign} ${row.date}`} onClick={() => edit(row)}>手动修改</button></td><td>{row.date}</td><th scope="row">{row.campaign}</th><td>{row.asin || "—"}<br />{row.sku || "—"}</td><td>{row.impressions ?? "—"}</td><td>{row.clicks ?? "—"}</td><td>{percent(row.ctr ?? ratio(row.clicks, row.impressions))}</td><td>{money(row.spend)}</td><td>{money(row.cpc ?? ratio(row.spend, row.clicks))}</td><td>{row.adOrders}</td><td>{money(row.adSales)}</td><td>{percent(row.acos ?? ratio(row.spend, row.adSales))}</td><td>{(row.roas ?? ratio(row.adSales, row.spend))?.toFixed(2) ?? "—"}</td><td>{percent(row.cvr ?? ratio(row.adOrders, row.clicks))}</td><td>{percent(row.topOfSearchImpressionShare)}</td><td>{row.adjusted === undefined ? "未记录" : row.adjusted ? "是" : "否"}</td></tr>)}</tbody></table></div>
    {!dayRows.length ? <p className="manual-sales-note">该日期暂无广告数据。</p> : null}
  </section>;
}
