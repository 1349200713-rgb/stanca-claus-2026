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
function isoDate(value: unknown): string | null {
  const serial = typeof value === "number" ? XLSX.SSF.parse_date_code(value) : null;
  const text = serial ? `${serial.y}-${String(serial.m).padStart(2, "0")}-${String(serial.d).padStart(2, "0")}` : value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/); if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3] ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const percent = (value: unknown): number | null => {
  const parsed = number(String(value ?? ""));
  if (parsed == null) return null;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
};

const asinFrom = (...values: unknown[]): string => {
  for (const value of values) {
    const match = String(value ?? "").toUpperCase().match(/\b(B0[A-Z0-9]{8,})\b/);
    if (match) return match[1];
  }
  return "";
};

function sheetRecords(sheet: XLSX.WorkSheet, sheetName: string, updatedAt: string): { records: CompetitorSnapshot[]; issues: string[] } {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => String(cell).trim() === "记录日期"));
  if (headerIndex < 0) return { records: [], issues: [] };
  const headers = matrix[headerIndex].map((cell) => String(cell).trim());
  const link = String(matrix[0]?.[0] ?? "").trim();
  const identity = headerIndex > 1 ? String(matrix[headerIndex - 1]?.[0] ?? "").trim() : "";
  const competitorAsin = asinFrom(identity, link);
  if (!competitorAsin) return { records: [], issues: [`${sheetName}：未识别ASIN`] };
  const brand = identity.includes("|") ? identity.split("|")[0].trim() : sheetName.trim();
  const isOwnProduct = sheetName.trim().toLowerCase() === "ziji";
  const index = (label: string) => headers.indexOf(label);
  const at = (row: unknown[], label: string) => index(label) >= 0 ? row[index(label)] : "";
  const records: CompetitorSnapshot[] = [];
  const issues: string[] = [];
  let carriedDate: string | null = null;
  let carriedRating: number | null = null;
  let carriedCategoryRank: number | null = null;
  let carriedSubcategoryRank: number | null = null;
  matrix.slice(headerIndex + 1).forEach((row, offset) => {
    const rawDate = at(row, "记录日期");
    carriedDate = isoDate(rawDate) ?? carriedDate;
    carriedRating = number(String(at(row, "评分") ?? "")) ?? carriedRating;
    carriedCategoryRank = number(String(at(row, "大类排名") ?? "")) ?? carriedCategoryRank;
    carriedSubcategoryRank = number(String(at(row, "小类目排名") ?? "")) ?? carriedSubcategoryRank;
    const size = String(at(row, "尺码") ?? "").trim().toUpperCase();
    if (!size) return;
    if (!carriedDate) { issues.push(`${sheetName}第${headerIndex + offset + 2}行：日期无效`); return; }
    const price = number(String(at(row, "页面售价 USD") ?? ""));
    const couponPercent = percent(at(row, "Coupon比例"));
    const couponAmount = number(String(at(row, "Coupon金额 USD") ?? ""));
    const codePercent = percent(at(row, "CODE")) ?? percent(at(row, "CODE/Prime"));
    const codePrice = number(String(at(row, "CODE单价 USD") ?? ""));
    const couponPrice = number(String(at(row, "Coupon估算价 USD") ?? ""));
    const effectivePrice = codePrice ?? couponPrice ?? (price == null ? null : couponAmount != null ? Math.max(0, price - couponAmount) : couponPercent != null ? price * (1 - couponPercent / 100) : codePercent != null ? price * (1 - codePercent / 100) : price);
    records.push({
      id: `competitor:US:${carriedDate}:${competitorAsin}:${size}`, marketplace: "US", date: carriedDate, competitorAsin, brand, size, isOwnProduct,
      price, effectivePrice: effectivePrice == null ? null : Math.round(effectivePrice * 100) / 100, couponPercent, couponAmount, codePercent, codePrice,
      primeSavings: String(at(row, "Prime Savings") ?? "").trim() || null, rating: carriedRating, bsrRank: carriedSubcategoryRank,
      categoryRank: carriedCategoryRank, subcategoryRank: carriedSubcategoryRank, colorStyle: String(at(row, "颜色/款式") ?? "").trim() || undefined,
      source: link || undefined, note: String(at(row, "备注") ?? "").trim() || undefined, updatedAt,
    });
  });
  return { records, issues };
}

export function parseCompetitorRows(rows: RawRow[], updatedAt = new Date().toISOString()): { records: CompetitorSnapshot[]; issues: string[] } {
  const records: CompetitorSnapshot[] = [];
  const issues: string[] = [];
  rows.forEach((row, index) => {
    const dateKey = Object.keys(row).find((candidate) => aliases.date.some((name) => candidate.trim().toLowerCase() === name.toLowerCase()));
    const date = isoDate(dateKey ? row[dateKey] : undefined);
    const competitorAsin = read(row, aliases.competitorAsin).toUpperCase();
    if (!date || !/^B0[A-Z0-9]+$/.test(competitorAsin)) { issues.push(`第${index + 2}行：日期或竞品ASIN无效`); return; }
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
  const timestamp = updatedAt ?? new Date().toISOString();
  const structured = workbook.SheetNames.map((name) => sheetRecords(workbook.Sheets[name], name, timestamp));
  const records = structured.flatMap((result) => result.records);
  const issues = structured.flatMap((result) => result.issues);
  if (records.length) return { records, issues };
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return parseCompetitorRows(XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" }), timestamp);
}
