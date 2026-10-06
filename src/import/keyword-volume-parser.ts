import * as XLSX from "xlsx";
import { isSearchVolumeSnapshot, type SearchVolumePeriod, type SearchVolumeSnapshot } from "../domain/keyword-volume";

const aliases = {
  keyword: ["关键词", "keyword", "search query", "search term"],
  asin: ["asin", "我方asin", "产品asin"],
  period: ["统计周期", "周期", "period", "reporting period", "report period"],
  date: ["日期", "date"],
  start: ["开始日期", "起始日期", "start date", "period start", "periodstart", "reporting start"],
  end: ["结束日期", "end date", "period end", "periodend", "reporting end"],
  volume: ["搜索量", "搜索次数", "search volume", "search query volume", "searchvolume"],
  scope: ["统计范围", "范围", "scope", "reporting scope"],
  source: ["来源", "数据来源", "source"],
};

const header = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const findKey = (row: Record<string, unknown>, names: string[]) => Object.keys(row).find((key) => names.includes(header(key)));
const field = (row: Record<string, unknown>, names: string[]) => { const key = findKey(row, names); return key === undefined ? undefined : row[key]; };

function periodValue(value: unknown): SearchVolumePeriod | null {
  const normalized = text(value).toLowerCase();
  if (["day", "daily", "日", "天", "日度"].includes(normalized)) return "day";
  if (["week", "weekly", "周", "周度"].includes(normalized)) return "week";
  if (["month", "monthly", "月", "月度"].includes(normalized)) return "month";
  if (["quarter", "quarterly", "季", "季度"].includes(normalized)) return "quarter";
  return null;
}

function scopeValue(value: unknown): "market" | "asin" | null {
  const normalized = text(value).toLowerCase();
  if (["market", "marketplace", "市场", "全市场"].includes(normalized)) return "market";
  if (["asin", "product", "产品", "商品"].includes(normalized)) return "asin";
  return null;
}

function isoDate(value: unknown): string | null {
  // CSV raw cells retain integer date serials as strings; never coerce decimal/scientific notation.
  const serialNumber = typeof value === "number" ? value : /^\d+$/.test(text(value)) ? Number(text(value)) : null;
  if (serialNumber !== null && (!Number.isSafeInteger(serialNumber) || serialNumber < 1)) return null;
  const serial = serialNumber !== null ? XLSX.SSF.parse_date_code(serialNumber) : null;
  const dateText = serial ? `${String(serial.y).padStart(4, "0")}-${String(serial.m).padStart(2, "0")}-${String(serial.d).padStart(2, "0")}` : text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const date = new Date(`${dateText}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateText ? dateText : null;
}

const hasValue = (value: unknown) => value !== undefined && value !== null && !(typeof value === "string" && !value.trim());

function countValue(value: unknown): { valid: boolean; count: number | null } {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return { valid: true, count: null };
  if (typeof value !== "string" && typeof value !== "number") return { valid: false, count: null };
  const normalized = text(value);
  if (!/^\d+$/.test(normalized) && !/^\d{1,3}(,\d{3})+$/.test(normalized)) return { valid: false, count: null };
  const count = Number(normalized.replace(/,/g, ""));
  return { valid: Number.isSafeInteger(count) && count >= 0, count };
}

function keywordId(keyword: string): string {
  const normalized = keyword.trim().toLowerCase();
  return normalized.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || encodeURIComponent(normalized);
}

export function parseKeywordVolumeRows(rows: Record<string, unknown>[], updatedAt = new Date().toISOString()): { records: SearchVolumeSnapshot[]; issues: string[] } {
  const records = new Map<string, SearchVolumeSnapshot>();
  const conflicts = new Set<string>();
  const issues: string[] = [];
  rows.forEach((row, index) => {
    const label = `第${index + 2}行`;
    if (findKey(row, aliases.volume) === undefined) { issues.push(`${label}：缺少真实搜索量列，ABA搜索排名不能作为搜索量`); return; }
    const keyword = text(field(row, aliases.keyword));
    const asin = text(field(row, aliases.asin)).toUpperCase();
    const period = periodValue(field(row, aliases.period));
    const scope = scopeValue(field(row, aliases.scope));
    const explicitStart = field(row, aliases.start);
    const explicitEnd = field(row, aliases.end);
    let periodStart = isoDate(explicitStart);
    let periodEnd = isoDate(explicitEnd);
    if (!keyword) { issues.push(`${label}：关键词不能为空`); return; }
    if (!period || !scope) { issues.push(`${label}：统计周期必须明确为日/周/月/季度，统计范围必须明确为market或asin`); return; }
    const dateValue = field(row, aliases.date);
    if (period === "day" && hasValue(dateValue)) {
      const date = isoDate(dateValue);
      if (!date || (hasValue(explicitStart) && periodStart !== date) || (hasValue(explicitEnd) && periodEnd !== date)) {
        issues.push(`${label}：单日日期无效或与显式开始/结束日期冲突，日周期必须为同一天`);
        return;
      }
      periodStart = date;
      periodEnd = date;
    }
    if (!periodStart || !periodEnd || periodEnd < periodStart) { issues.push(`${label}：开始日期或结束日期无效，结束日期不得早于开始日期`); return; }
    if ((asin && !/^[A-Z0-9]{10}$/.test(asin)) || (scope === "asin" && !asin)) { issues.push(`${label}：ASIN无效，ASIN统计范围必须填写ASIN`); return; }
    const { valid, count } = countValue(field(row, aliases.volume));
    if (!valid) { issues.push(`${label}：搜索量必须是非负安全整数或留空，不接受百分比或格式错误的数字`); return; }
    const source = text(field(row, aliases.source)) || "uploaded";
    if (!text(field(row, aliases.source))) issues.push(`${label}：未注明来源，已标记为uploaded，请核实来源；不会自动归属Amazon`);
    // Encode the full keyword, not its rank slug, so punctuation cannot collide.
    const dimensions = ["US", keyword.toLowerCase(), source, scope, asin, period, periodStart, periodEnd];
    const record: SearchVolumeSnapshot = {
      id: `keyword-volume:${dimensions.map(encodeURIComponent).join(":")}`,
      kind: "search-volume", marketplace: "US", keywordId: keywordId(keyword), keyword,
      ...(asin ? { asin } : {}), scope, source, period, periodStart, periodEnd, searchVolume: count, updatedAt,
    };
    if (!isSearchVolumeSnapshot(record)) { issues.push(`${label}：统计区间与周期不匹配，日需起止同一天，周需完整7天，月/季度需完整日历月/季度`); return; }
    if (conflicts.has(record.id)) return;
    const previous = records.get(record.id);
    if (previous && previous.searchVolume !== null && count !== null && previous.searchVolume !== count) {
      records.delete(record.id);
      conflicts.add(record.id);
      issues.push(`${label}：同一关键词、来源、范围和统计区间的搜索量冲突，已排除整组记录`);
      return;
    }
    if (!previous || (previous.searchVolume === null && count !== null)) records.set(record.id, record);
  });
  return { records: [...records.values()], issues };
}

export function parseKeywordVolumeReport(input: ArrayBuffer, filename: string, updatedAt?: string): { records: SearchVolumeSnapshot[]; issues: string[] } {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xlsx", "xls"].includes(extension)) return { records: [], issues: [`不支持的文件：${filename}`] };
  try {
    // raw prevents CSV coercion from accepting scientific notation or malformed counts.
    const workbook = XLSX.read(input, { type: "array", raw: true, ...(extension === "csv" ? { codepage: 65001 } : {}) });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return { records: [], issues: [`文件没有可读取的工作表：${filename}`] };
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
    if (!rows.length) return { records: [], issues: [`文件没有可导入的数据行：${filename}`] };
    return parseKeywordVolumeRows(rows, updatedAt);
  } catch {
    return { records: [], issues: [`无法读取搜索量文件，请检查格式或文件是否损坏：${filename}`] };
  }
}
