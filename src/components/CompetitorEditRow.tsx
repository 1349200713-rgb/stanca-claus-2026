"use client";

import type { CompetitorSnapshot } from "../domain/linkage";
import { useEffect, useRef } from "react";

type EditableNumber = "price" | "effectivePrice" | "couponPercent" | "couponAmount" | "codePercent" | "codePrice" | "rating" | "reviewCount" | "categoryRank" | "subcategoryRank";
type EditableText = "date" | "brand" | "productName" | "competitorAsin" | "size" | "primeSavings" | "colorStyle" | "note" | "source";
export type CompetitorEditDraft = Record<EditableNumber | EditableText, string>;

const numericFields: EditableNumber[] = ["price", "effectivePrice", "couponPercent", "couponAmount", "codePercent", "codePrice", "rating", "reviewCount", "categoryRank", "subcategoryRank"];

export function competitorDraft(row: CompetitorSnapshot): CompetitorEditDraft {
  const result = {} as CompetitorEditDraft;
  (["date", "brand", "productName", "competitorAsin", "size", "primeSavings", "colorStyle", "note", "source"] as EditableText[]).forEach((field) => { result[field] = String(row[field] ?? ""); });
  numericFields.forEach((field) => { result[field] = row[field] == null ? "" : String(row[field]); });
  return result;
}

function optionalNumber(value: string, label: string, maximum?: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (maximum != null && parsed > maximum)) throw new Error(`${label}格式不正确`);
  return parsed;
}

function optionalInteger(value: string, label: string, minimum = 0): number | null {
  const parsed = optionalNumber(value, label);
  if (parsed != null && (!Number.isSafeInteger(parsed) || parsed < minimum)) throw new Error(`${label}格式不正确`);
  return parsed;
}

export function competitorRecord(row: CompetitorSnapshot, draft: CompetitorEditDraft): CompetitorSnapshot {
  const date = new Date(`${draft.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== draft.date) throw new Error("日期格式不正确");
  const asin = draft.competitorAsin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error("ASIN必须为10位字母或数字");
  const record: CompetitorSnapshot = {
    ...row,
    date: draft.date,
    competitorAsin: asin,
    brand: draft.brand.trim() || undefined,
    productName: draft.productName.trim() || undefined,
    size: draft.size.trim().toUpperCase() || undefined,
    price: optionalNumber(draft.price, "页面售价"),
    effectivePrice: optionalNumber(draft.effectivePrice, "优惠后价格"),
    couponPercent: optionalNumber(draft.couponPercent, "Coupon比例", 100),
    couponAmount: optionalNumber(draft.couponAmount, "Coupon金额"),
    codePercent: optionalNumber(draft.codePercent, "CODE比例", 100),
    codePrice: optionalNumber(draft.codePrice, "CODE价格"),
    primeSavings: draft.primeSavings.trim() || null,
    rating: optionalNumber(draft.rating, "评分", 5),
    reviewCount: optionalInteger(draft.reviewCount, "评论数"),
    categoryRank: optionalInteger(draft.categoryRank, "大类排名", 1),
    subcategoryRank: optionalInteger(draft.subcategoryRank, "小类排名", 1),
    colorStyle: draft.colorStyle.trim() || undefined,
    note: draft.note.trim() || undefined,
    source: draft.source.trim() || undefined,
  };
  const originalDraft = competitorDraft(row);
  const fields = Object.keys(originalDraft) as (keyof CompetitorEditDraft)[];
  const unchanged = Object.fromEntries(fields.filter((field) => draft[field] === originalDraft[field]).map((field) => [field, row[field]]));
  const preserved = { ...record, ...unchanged };
  if (fields.every((field) => Object.is(preserved[field], row[field]))) return row;
  return { ...preserved, updatedAt: new Date().toISOString() };
}

interface Props {
  row: CompetitorSnapshot;
  draft: CompetitorEditDraft;
  busy: boolean;
  onChange: (draft: CompetitorEditDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function CompetitorEditRow({ row, draft, busy, onChange, onSave, onCancel }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: "start" });
  }, [row.id]);
  const input = (field: keyof CompetitorEditDraft, label: string, type = "text", step?: string) => <label>{label}<input aria-label={`编辑${label}`} type={type} step={step} disabled={busy} value={draft[field]} onChange={(event) => onChange({ ...draft, [field]: event.currentTarget.value })} /></label>;
  return <form className="competitor-edit-panel" aria-label="手动修改竞品记录" noValidate onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="panel-heading"><div><p className="eyebrow">MANUAL EDIT</p><h3 tabIndex={-1} ref={heading}>手动修改：{row.brand ?? row.competitorAsin} / {row.size ?? "无尺码"} / {row.date}</h3></div></div>
    <div className="competitor-edit-grid">
    {input("date", "日期", "date")}{input("brand", "品牌")}{input("productName", "品名")}{input("competitorAsin", "ASIN")}{input("size", "尺码")}
    {input("price", "页面售价", "number", "0.01")}{input("effectivePrice", "优惠后价格", "number", "0.01")}{input("couponPercent", "Coupon比例", "number", "0.01")}{input("couponAmount", "Coupon金额", "number", "0.01")}
    {input("codePercent", "CODE比例", "number", "0.01")}{input("codePrice", "CODE价格", "number", "0.01")}{input("primeSavings", "Prime Savings")}{input("rating", "评分", "number", "0.1")}
    {input("reviewCount", "评论数", "number", "1")}{input("categoryRank", "大类排名", "number", "1")}{input("subcategoryRank", "小类排名", "number", "1")}{input("colorStyle", "颜色/款式")}{input("note", "备注")}{input("source", "链接", "url")}
  </div><div className="competitor-edit-actions"><span>{row.isOwnProduct ? "自有基准" : "竞品"} · 修改原记录，不新增副本；空白数值保持未知</span><button type="submit" className="primary-button" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消</button></div></form>;
}
