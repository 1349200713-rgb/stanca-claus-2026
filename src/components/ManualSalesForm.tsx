"use client";

import { useState, type FormEvent } from "react";
import type { PrimaryMapping } from "../data/plan";
import type { BusinessRecord } from "../domain/types";
import { opsDb } from "../storage/db";

const discountMethods = ["无折扣", "Coupon百分比", "Coupon金额", "优惠码", "Prime专享折扣", "Deal", "多种折扣", "其他"];
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const dollars = (value?: number) => value === undefined ? "—" : `US$${value.toFixed(2)}`;

interface SalesDraft {
  date: string;
  asin: string;
  sku: string;
  units: string;
  sales: string;
  sellingPrice: string;
  discountMethod: string;
  discountDetails: string;
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function matches(row: BusinessRecord, draft: SalesDraft): boolean {
  return row.date === draft.date && Boolean(draft.sku) && (normalize(row.sku) === normalize(draft.sku) || (!row.sku && normalize(row.asin) === normalize(draft.asin)));
}

export function ManualSalesForm({ mappings, records, loaded, onSaved }: {
  mappings: readonly PrimaryMapping[];
  records: readonly BusinessRecord[];
  loaded: boolean;
  onSaved: (record: BusinessRecord) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<SalesDraft>(() => ({ date: today(), asin: "", sku: "", units: "", sales: "", sellingPrice: "", discountMethod: "无折扣", discountDetails: "" }));
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingExisting, setPendingExisting] = useState<BusinessRecord>();
  const mapping = mappings.find((item) => normalize(item.asin) === normalize(draft.asin) && normalize(item.sku) === normalize(draft.sku));
  const existing = pendingExisting ?? records.find((row) => matches(row, draft));
  const dayRows = records.filter((row) => row.date === draft.date).toSorted((a, b) => a.size.localeCompare(b.size));

  function update(field: keyof SalesDraft, value: string) {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "asin" || field === "sku") {
        const selected = mappings.find((item) => normalize(item[field]) === normalize(value));
        if (selected) { next.asin = selected.asin; next.sku = selected.sku; }
      }
      return next;
    });
    setConfirmed(false);
    setPendingExisting(undefined);
    setMessage("");
    setError("");
  }

  function edit(row: BusinessRecord) {
    const selected = mappings.find((item) => normalize(item.sku) === normalize(row.sku) || normalize(item.asin) === normalize(row.asin));
    setDraft({ date: row.date, asin: selected?.asin ?? row.asin, sku: selected?.sku ?? row.sku, units: String(row.units), sales: String(row.sales), sellingPrice: row.sellingPrice === undefined ? "" : String(row.sellingPrice), discountMethod: row.discountMethod ?? "无折扣", discountDetails: row.discountDetails ?? "" });
    setConfirmed(false);
    setPendingExisting(undefined);
    setMessage("");
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const units = Number(draft.units);
    const sales = Number(draft.sales);
    const sellingPrice = Number(draft.sellingPrice);
    if (!mapping) { setError("请选择有效的 ASIN / SKU，二者必须属于同一商品。"); return; }
    const parsedDate = new Date(`${draft.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== draft.date) { setError("请填写有效日期。"); return; }
    if (!draft.units.trim() || !Number.isSafeInteger(units) || units < 0) { setError("销量必须是非负整数，未出单请填写 0。"); return; }
    if (!draft.sales.trim() || !Number.isFinite(sales) || sales < 0 || !draft.sellingPrice.trim() || !Number.isFinite(sellingPrice) || sellingPrice < 0) { setError("销售额和售价必须填写非负金额。"); return; }
    if (!units && sales > 0) { setError("销量为 0 时，销售额应为 0。"); return; }

    setSaving(true);
    try {
      const currentRows = await opsDb.list("business");
      const previous = currentRows.find((row) => matches(row, draft));
      if (previous && !confirmed) {
        setPendingExisting(previous);
        setError("该日期和商品已有数据，请确认覆盖后保存。");
        return;
      }
      const updatedAt = new Date().toISOString();
      const record: BusinessRecord = {
        ...previous,
        key: previous?.key ?? `business:${draft.date}:${normalize(mapping.sku)}`,
        date: draft.date, marketplace: "US", asin: mapping.asin, sku: mapping.sku, size: mapping.size,
        units, sales, sellingPrice, discountMethod: draft.discountMethod,
        discountDetails: draft.discountDetails.trim(), source: "manual", updatedAt,
      };
      await opsDb.commitImport("business", [record], {
        key: `manual-sales:${updatedAt}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        filename: "手动销量录入", importedAt: updatedAt, reportKind: "business",
        rowCount: 1, issueCount: 0, duplicateCount: previous ? 1 : 0, action: previous ? "replace" : "insert",
      });
      await onSaved(record);
      setPendingExisting(undefined);
      setConfirmed(false);
      setMessage(`${record.date} · ${record.size} 已保存：销量 ${record.units} 件，销售额 ${dollars(record.sales)}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel manual-sales-panel" aria-labelledby="manual-sales-heading">
    <div className="panel-heading"><div><p className="eyebrow">DAILY SALES ENTRY</p><h2 id="manual-sales-heading">手动录入销量</h2></div><span className="panel-meta">金额：美元 USD</span></div>
    <p className="manual-sales-note">每次填写一个商品的当日总销量和总销售额。选择 ASIN 或 SKU 自动关联尺码；售价为当日页面单价，销售额按实际成交金额填写。</p>
    <form onSubmit={(event) => void save(event)} noValidate>
      <fieldset className="manual-form" disabled={saving || !loaded}>
        <label>日期<input aria-label="销售日期" type="date" value={draft.date} onChange={(event) => update("date", event.currentTarget.value)} required /></label>
        <label>销售ASIN<input aria-label="销售ASIN" list="sales-asin-options" value={draft.asin} onChange={(event) => update("asin", event.currentTarget.value)} placeholder="输入或选择 ASIN" required /><datalist id="sales-asin-options">{mappings.map((item) => <option key={item.asin} value={item.asin}>{item.size}</option>)}</datalist></label>
        <label>销售SKU<input aria-label="销售SKU" list="sales-sku-options" value={draft.sku} onChange={(event) => update("sku", event.currentTarget.value)} placeholder="输入或选择 SKU" required /><datalist id="sales-sku-options">{mappings.map((item) => <option key={item.sku} value={item.sku}>{item.size}</option>)}</datalist></label>
        <label>销量（件）<input aria-label="销量（件）" type="number" min="0" step="1" value={draft.units} onChange={(event) => update("units", event.currentTarget.value)} required /></label>
        <label>销售额（USD）<input aria-label="销售额（USD）" type="number" min="0" step="0.01" value={draft.sales} onChange={(event) => update("sales", event.currentTarget.value)} required /></label>
        <label>售价（USD / 件）<input aria-label="售价（USD / 件）" type="number" min="0" step="0.01" value={draft.sellingPrice} onChange={(event) => update("sellingPrice", event.currentTarget.value)} required /></label>
        <label>折扣方式<select aria-label="折扣方式" value={draft.discountMethod} onChange={(event) => update("discountMethod", event.currentTarget.value)}>{discountMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
        <label>折扣说明（选填）<input aria-label="折扣说明（选填）" value={draft.discountDetails} onChange={(event) => update("discountDetails", event.currentTarget.value)} placeholder="例如 Coupon 10% + CODE 5%" /></label>
        <p className="manual-sales-product">尺码：{mapping?.size ?? "请先选择商品"}</p>
        {existing ? <label className="manual-checkbox manual-sales-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />确认覆盖已有销量 {existing.units} 件 / 销售额 {dollars(existing.sales)}</label> : null}
        <button type="submit">{saving ? "正在保存…" : "保存销量"}</button>
      </fieldset>
    </form>
    {error ? <p className="manual-sales-error" role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className="table-scroll"><table aria-label="当日销量录入记录"><thead><tr><th>日期</th><th>尺码</th><th>ASIN</th><th>SKU</th><th>销量</th><th>销售额</th><th>售价</th><th>折扣方式 / 说明</th><th>操作</th></tr></thead><tbody>{dayRows.map((row) => <tr key={row.key}><td>{row.date}</td><td>{row.size}</td><td>{row.asin || "—"}</td><td>{row.sku || "—"}</td><td>{row.units}</td><td>{dollars(row.sales)}</td><td>{dollars(row.sellingPrice)}</td><td>{row.discountMethod ?? "未记录"}{row.discountDetails ? ` · ${row.discountDetails}` : ""}</td><td><button type="button" className="table-action-button" disabled={saving} onClick={() => edit(row)} aria-label={`编辑销量 ${row.size} ${row.date}`}>编辑</button></td></tr>)}</tbody></table></div>
    {!dayRows.length ? <p className="manual-sales-note">该日期暂无销量记录。</p> : null}
  </section>;
}
