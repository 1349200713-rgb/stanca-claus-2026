import type { KeywordRankSnapshot, RankStatus } from "../domain/linkage";
import * as XLSX from "xlsx";

export function parseRank(value: unknown): { rank: number | null; status: RankStatus } {
  const text = String(value ?? "").trim();
  if (!text) return { rank: null, status: "missing" };
  if (/未收录|未排名|not indexed/i.test(text) || Number(text) === 0) return { rank: null, status: "notIndexed" };
  const rank = Number(text.replace(/,/g, ""));
  return Number.isInteger(rank) && rank > 0 ? { rank, status: "ranked" } : { rank: null, status: "missing" };
}

const pick = (row: Record<string, unknown>, names: string[]) => { const key = Object.keys(row).find((candidate) => names.includes(candidate.trim().toLowerCase())); return key ? String(row[key] ?? "").trim() : ""; };
const keywordId = (keyword: string) => keyword.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
function isoDate(value: unknown): string | null {
  const serial = typeof value === "number" ? XLSX.SSF.parse_date_code(value) : null;
  const text = serial ? `${serial.y}-${String(serial.m).padStart(2, "0")}-${String(serial.d).padStart(2, "0")}` : String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3] ? text : null;
}

export function parseKeywordRankRows(rows: Record<string, unknown>[], updatedAt = new Date().toISOString()) {
  const records: KeywordRankSnapshot[] = []; const issues: string[] = [];
  rows.forEach((row, index) => {
    const dateKey = Object.keys(row).find((candidate) => ["日期", "date"].includes(candidate.trim().toLowerCase())); const date = isoDate(dateKey ? row[dateKey] : undefined); const keyword = pick(row, ["关键词", "keyword"]); const asin = pick(row, ["asin", "我方asin"]).toUpperCase();
    if (!date || !keyword || !/^B0[A-Z0-9]+$/.test(asin)) { issues.push(`第${index + 2}行：日期、关键词或ASIN无效`); return; }
    const organic = parseRank(pick(row, ["自然排名", "organic rank"])); const ad = parseRank(pick(row, ["广告排名", "ad rank"])); const id = keywordId(keyword);
    records.push({ id: `keyword:US:${date}:${asin}:${id}`, marketplace: "US", date, keywordId: id, keyword: keyword.trim(), asin, organicRank: organic.rank, organicStatus: organic.status, adRank: ad.rank, adStatus: ad.status, updatedAt });
  });
  return { records, issues };
}

export function parseKeywordRankReport(input: ArrayBuffer, filename: string, updatedAt?: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xlsx", "xls"].includes(extension)) return { records: [], issues: [`不支持的文件：${filename}`] };
  const workbook = XLSX.read(input, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return parseKeywordRankRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }), updatedAt);
}
