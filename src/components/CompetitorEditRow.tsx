"use client";

import type { CompetitorSnapshot } from "../domain/linkage";

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

export function competitorRecord(row: CompetitorSnapshot, draft: CompetitorEditDraft): CompetitorSnapshot {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(Date.parse(`${draft.date}T00:00:00Z`))) throw new Error("日期格式不正确");
  const asin = draft.competitorAsin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error("ASIN必须为10位字母或数字");
  return {
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
    reviewCount: optionalNumber(draft.reviewCount, "评论数"),
    categoryRank: optionalNumber(draft.categoryRank, "大类排名"),
    subcategoryRank: optionalNumber(draft.subcategoryRank, "小类排名"),
    colorStyle: draft.colorStyle.trim() || undefined,
    note: draft.note.trim() || undefined,
    source: draft.source.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
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
  const input = (field: keyof CompetitorEditDraft, label: string, type = "text", step?: string) => <label>{label}<input aria-label={`编辑${label}`} type={type} step={step} value={draft[field]} onChange={(event) => onChange({ ...draft, [field]: event.currentTarget.value })} /></label>;
  return <tr className="competitor-edit-row"><td colSpan={16}><div className="competitor-edit-grid">
    {input("date", "日期", "date")}{input("brand", "品牌")}{input("productName", "品名")}{input("competitorAsin", "ASIN")}{input("size", "尺码")}
    {input("price", "页面售价", "number", "0.01")}{input("effectivePrice", "优惠后价格", "number", "0.01")}{input("couponPercent", "Coupon比例", "number", "0.01")}{input("couponAmount", "Coupon金额", "number", "0.01")}
    {input("codePercent", "CODE比例", "number", "0.01")}{input("codePrice", "CODE价格", "number", "0.01")}{input("primeSavings", "Prime Savings")}{input("rating", "评分", "number", "0.1")}
    {input("reviewCount", "评论数", "number", "1")}{input("categoryRank", "大类排名", "number", "1")}{input("subcategoryRank", "小类排名", "number", "1")}{input("colorStyle", "颜色/款式")}{input("note", "备注")}{input("source", "链接", "url")}
  </div><div className="competitor-edit-actions"><span>{row.isOwnProduct ? "自有基准" : "竞品"}</span><button type="button" className="primary-button" disabled={busy} onClick={onSave}>保存竞品记录</button><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消编辑</button></div></td></tr>;
}
