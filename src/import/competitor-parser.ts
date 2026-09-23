import * as XLSX from "xlsx";
import type { CompetitorSnapshot } from "../domain/linkage";

type RawRow = Record<string, unknown>;
const aliases = {
  date: ["日期", "date", "记录日期"], competitorAsin: ["竞品ASIN", "asin", "竞品asin"], brand: ["品牌", "brand"], productName: ["品名", "产品名称", "product name"],
  price: ["价格", "售价", "price"], coupon: ["优惠", "coupon", "优惠券"], rating: ["评分", "rating"], reviewCount: ["评论数", "review count", "reviews"], bsrRank: ["BSR排名", "bsr", "类目排名"], estimatedUnits: ["预计销量", "预估销量", "estimated units"], stockStatus: ["库存状态", "stock"], source: ["来源", "source"], note: ["备注", "note"],
} as const;

const read = (row: RawRow, names: readonly string[]) => {
  const key = Object.keys(row).find((candidate) => names.some((name) => candidate.trim().toLowerCase() === name.toLowerCase()));
  return key ? String(row[key] ?? "").trim() : "";
};
const number = (value: string): number | null => { const parsed = Number(value.replace(/[$,%\s,]/g, "")); return value && Number.isFinite(parsed) ? parsed : null; };

export function parseCompetitorRows(rows: RawRow[], updatedAt = new Date().toISOString()): { records: CompetitorSnapshot[]; issues: string[] } {
  const records: CompetitorSnapshot[] = [];
  const issues: string[] = [];
  rows.forEach((row, index) => {
    const date = read(row, aliases.date);
    const competitorAsin = read(row, aliases.competitorAsin).toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^B0[A-Z0-9]+$/.test(competitorAsin)) { issues.push(`第${index + 2}行：日期或竞品ASIN无效`); return; }
    const coupon = read(row, aliases.coupon);
    records.push({
      id: `competitor:US:${date}:${competitorAsin}`, marketplace: "US", date, competitorAsin,
      brand: read(row, aliases.brand) || undefined, productName: read(row, aliases.productName) || undefined,
      price: number(read(row, aliases.price)), couponPercent: coupon.includes("%") ? number(coupon) : null, couponAmount: coupon && !coupon.includes("%") ? number(coupon) : null,
      rating: number(read(row, aliases.rating)), reviewCount: number(read(row, aliases.reviewCount)), bsrRank: number(read(row, aliases.bsrRank)), estimatedUnits: number(read(row, aliases.estimatedUnits)),
      stockStatus: read(row, aliases.stockStatus) || null, source: read(row, aliases.source) || undefined, note: read(row, aliases.note) || undefined, updatedAt,
    });
  });
  return { records, issues };
}

export function parseCompetitorReport(input: ArrayBuffer, filename: string, updatedAt?: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xlsx", "xls"].includes(extension)) return { records: [], issues: [`不支持的文件：${filename}`] };
  const workbook = XLSX.read(input, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return parseCompetitorRows(XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" }), updatedAt);
}
