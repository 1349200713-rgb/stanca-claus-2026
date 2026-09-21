import * as XLSX from "xlsx";
import type { DailyOperationRecord } from "../domain/planning";

type Row = Record<string, unknown>;

const aliases = {
  date: ["日期", "date", "操作日期"],
  action: ["动作", "action", "当日动作", "操作", "工作记录"],
  risk: ["风险", "risk", "问题与风险"],
  tomorrowPlan: ["明日计划", "tomorrow plan", "次日计划", "明日工作计划"],
  status: ["状态", "status", "完成状态"],
  note: ["备注", "note", "说明"],
} as const;

export interface DailyOperationsParseResult {
  records: DailyOperationRecord[];
  skipped: number;
}

function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function read(row: Row, field: keyof typeof aliases): string {
  const header = Object.keys(row).find((candidate) => aliases[field].some((alias) => canonical(candidate) === canonical(alias)));
  return header ? text(row[header]) : "";
}

function isHeader(value: unknown, field: keyof typeof aliases): boolean {
  return aliases[field].some((alias) => canonical(text(value)) === canonical(alias));
}

function rowsFromSheet(sheet: XLSX.WorkSheet): { rows: Row[]; extraColumns: string[] } | undefined {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  const headerIndex = matrix.findIndex((row) => row.some((value) => isHeader(value, "date")) && row.some((value) => isHeader(value, "action")));
  if (headerIndex < 0) return undefined;

  const seen = new Map<string, number>();
  const extraColumns: string[] = [];
  const headers = matrix[headerIndex].map((value, index) => {
    const label = text(value);
    if (!label) {
      const key = `__extra_${index}`;
      extraColumns.push(key);
      return key;
    }
    const count = seen.get(label) ?? 0;
    seen.set(label, count + 1);
    return count === 0 ? label : `${label}_${count}`;
  });

  const rows = matrix.slice(headerIndex + 1)
    .filter((values) => values.some((value) => text(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  return { rows, extraColumns };
}

function validDate(year: number, month: number, day: number): string | undefined {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateValue(value: string): string | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const parsed = XLSX.SSF.parse_date_code(Number(value));
    if (parsed) return validDate(parsed.y, parsed.m, parsed.d);
  }
  const normalized = value.replace(/[年月/.]/g, "-").replace(/[日号]/g, "");
  const full = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const monthDayYear = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  const short = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (full) return validDate(Number(full[1]), Number(full[2]), Number(full[3]));
  if (monthDayYear) {
    const rawYear = Number(monthDayYear[3]);
    return validDate(rawYear < 100 ? 2000 + rawYear : rawYear, Number(monthDayYear[1]), Number(monthDayYear[2]));
  }
  if (short) return validDate(2026, Number(short[1]), Number(short[2]));
  return undefined;
}

function operationKey(date: string, index: number): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `daily-op:${date}:import-${index}:${suffix}`;
}

export function parseDailyOperationsFile(bytes: ArrayBuffer, filename: string, now = new Date().toISOString()): DailyOperationsParseResult {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xlsx", "xls"].includes(extension)) throw new Error("仅支持 CSV、XLSX 或 XLS 文件");

  const workbook = extension === "csv"
    ? XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: false })
    : XLSX.read(bytes, { type: "array", raw: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return { records: [], skipped: 0 };
  const extracted = rowsFromSheet(firstSheet);
  if (!extracted) return { records: [], skipped: 0 };
  const { rows, extraColumns } = extracted;
  const records: DailyOperationRecord[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const date = dateValue(read(row, "date"));
    const action = read(row, "action");
    if (!date || !action) {
      skipped += 1;
      return;
    }
    const rawStatus = read(row, "status");
    const baseNote = read(row, "note");
    const extraNotes = extraColumns.map((column) => text(row[column])).filter(Boolean);
    const note = [baseNote, ...extraNotes].filter(Boolean).join("\n");
    records.push({
      key: operationKey(date, index),
      date,
      action,
      risk: read(row, "risk"),
      tomorrowPlan: read(row, "tomorrowPlan"),
      status: !rawStatus.includes("未完成") && (rawStatus.includes("完成") || canonical(rawStatus) === "completed") ? "已完成" : "未完成",
      note,
      updatedAt: now,
    });
  });

  return { records, skipped };
}
