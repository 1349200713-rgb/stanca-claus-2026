"use client";

import { useRef, useState } from "react";
import type { AdRecord, BusinessRecord } from "../domain/types";
import type { InboundEntry, InventorySnapshot } from "../domain/planning";
import { findDuplicates } from "../import/dedupe";
import { isInboundReport, parseInboundReport, type InboundParseResult } from "../import/inbound-parser";
import { inventoryKindFromFilename, isInventoryReport, parseInventoryReport, type InventoryParseResult } from "../import/inventory-parser";
import { parseReport, reportKindFromFilename, type ParseResult, type SkuMap } from "../import/report-parser";
import { opsDb, type ImportLog } from "../storage/db";

type ReportKind = "business" | "ads" | "inventory" | "inbound";
type FormalRecord = BusinessRecord | AdRecord | InventorySnapshot | InboundEntry;
type KeyedFormalRecord = BusinessRecord | AdRecord | InventorySnapshot;

interface Preview {
  filename: string;
  kind: ReportKind;
  bytes: ArrayBuffer;
  result: ParseResult | InventoryParseResult | InboundParseResult;
  unique: FormalRecord[];
  duplicates: FormalRecord[];
  comparisons: Array<{ key: string; existing: FormalRecord; incoming: FormalRecord }>;
}

export interface ImportPanelProps {
  /** The PlanModel fields required by the parser; no separate skuMap is invented. */
  plan: Pick<SkuMap, "sizeBySku" | "sizeByAsin">;
  /** Date used for inventory rows that omit snapshot-date. */
  inventorySnapshotDate?: string;
  onImported?: () => void | Promise<void>;
  initialReportKind?: ReportKind | "auto";
}

function importKey(importedAt: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `import:${importedAt}:${suffix}`;
}

export function ImportPanel({ plan, inventorySnapshotDate, onImported, initialReportKind = "auto" }: ImportPanelProps) {
  const [preview, setPreview] = useState<Preview>();
  const [duplicateAction, setDuplicateAction] = useState<"ignore" | "replace">();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [reportKind, setReportKind] = useState<ReportKind | "auto">(initialReportKind);
  const [adReportDate, setAdReportDate] = useState("");
  const [selectedFile, setSelectedFile] = useState<File>();
  const previewVersion = useRef(0);

  async function handleFile(file: File | undefined, selectedKind = reportKind, fallbackAdDate = adReportDate) {
    if (!file) return;
    const version = ++previewVersion.current;
    setSelectedFile(file);
    setPreview(undefined);
    setMessage(undefined);
    setDuplicateAction(undefined);
    const fallbackKind: ReportKind = selectedKind !== "auto" ? selectedKind : inventoryKindFromFilename(file.name) ? "inventory" : reportKindFromFilename(file.name);

    try {
      const bytes = await file.arrayBuffer();
      const inbound = selectedKind === "inbound" || (selectedKind === "auto" && isInboundReport(bytes));
      const inventory = selectedKind === "inventory" || (selectedKind === "auto" && !inbound && isInventoryReport(bytes, file.name));
      const result = inbound
        ? parseInboundReport(bytes, file.name, { defaultYear: 2026, updatedAt: new Date().toISOString() })
        : inventory
        ? parseInventoryReport(bytes, file.name, plan, {
          fallbackDate: inventorySnapshotDate ?? new Date().toISOString().slice(0, 10),
          sourceImportKey: "",
        })
        : parseReport(bytes, file.name, plan, { ...(selectedKind === "ads" || selectedKind === "business" ? { reportKind: selectedKind } : {}), fallbackAdDate });
      const kind = result.reportKind;
      const incoming = result.records as FormalRecord[];
      if (kind === "inbound") {
        if (version !== previewVersion.current) return;
        setPreview({ filename: file.name, kind, bytes, result, unique: incoming, duplicates: [], comparisons: [] });
        return;
      }
      const existing = kind === "business"
        ? await opsDb.list("business")
        : kind === "ads"
          ? await opsDb.list("ads")
          : await opsDb.listInventorySnapshots();
      const { unique, duplicates, comparisons } = findDuplicates(existing as KeyedFormalRecord[], incoming as KeyedFormalRecord[]);
      if (version !== previewVersion.current) return;
      setPreview({ filename: file.name, kind, bytes, result, unique, duplicates, comparisons });
    } catch (error) {
      if (version !== previewVersion.current) return;
      setPreview({
        filename: file.name,
        kind: fallbackKind,
        bytes: new ArrayBuffer(0),
        unique: [],
        duplicates: [],
        comparisons: [],
        result: {
          fatal: true,
          reportKind: fallbackKind,
          records: [],
          issues: [{ code: "UNSUPPORTED_FILE", message: error instanceof Error ? error.message : "Unable to read report" }],
          rawRows: [],
        },
      });
    }
  }

  async function save() {
    if (!preview || preview.result.fatal || (preview.duplicates.length > 0 && !duplicateAction)) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const selectedRecords = duplicateAction === "ignore" ? preview.unique : preview.result.records;
      const action: ImportLog["action"] = duplicateAction === "replace" ? "replace" : "insert";
      const importedAt = new Date().toISOString();
      const log: ImportLog = {
        key: importKey(importedAt),
        filename: preview.filename,
        importedAt,
        reportKind: preview.kind,
        rowCount: preview.result.records.length,
        issueCount: preview.result.issues.length,
        duplicateCount: preview.duplicates.length,
        action,
      };
      if (preview.kind === "inbound") {
        for (const record of selectedRecords as InboundEntry[]) await opsDb.saveInboundEntry(record);
        await opsDb.archiveImportEvidence(log, { bytes: preview.bytes, rawRows: preview.result.rawRows });
        setMessage("导入已保存");
        await onImported?.();
        return;
      }
      const records = preview.kind === "inventory"
        ? (selectedRecords as InventorySnapshot[]).map((record) => ({ ...record, sourceImportKey: log.key }))
        : selectedRecords;
      const evidence = { bytes: preview.bytes, rawRows: preview.result.rawRows };
      if (preview.kind === "business") await opsDb.commitImport("business", records as BusinessRecord[], log, evidence);
      else if (preview.kind === "ads") await opsDb.commitImport("ads", records as AdRecord[], log, evidence);
      else await opsDb.commitImport("inventory", records as InventorySnapshot[], log, evidence);
      setMessage("导入已保存");
      await onImported?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = !preview || preview.result.fatal || saving || (preview.duplicates.length > 0 && !duplicateAction);
  const issueRowCount = preview ? new Set(preview.result.issues.map((issue) => issue.row).filter((row): row is number => row !== undefined)).size : 0;

  return (
    <section aria-labelledby="import-panel-heading">
      <h2 id="import-panel-heading">导入报告</h2>
      <div className="report-import-options">
        <label>报告类型<select aria-label="报告类型" value={reportKind} onChange={(event) => { const next = event.currentTarget.value as ReportKind | "auto"; setReportKind(next); void handleFile(selectedFile, next, adReportDate); }}><option value="auto">自动识别</option><option value="business">业务（销量 / 销售额）</option><option value="ads">广告报告</option><option value="inventory">库存报告</option><option value="inbound">在途报告</option></select></label>
        <label>广告报表日期（文件无日期时填写）<input aria-label="广告报表日期" type="date" value={adReportDate} onChange={(event) => { const next = event.currentTarget.value; setAdReportDate(next); void handleFile(selectedFile, reportKind, next); }} /></label>
      </div>
      <p className="manual-sales-note">无日期的单日广告导出可补填报表日期；多日汇总请重新导出按日报表。广告活动开始日期不会作为报表日期。缺失的购买量或销售额须补齐后保存。</p>
      <label htmlFor="report-file">选择报告文件</label>
      <input
        id="report-file"
        aria-label="选择报告文件"
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
      />

      {preview && (
        <div aria-live="polite">
          <h3>导入预览</h3>
          <p>报告类型: {preview.kind === "ads" ? "广告" : preview.kind === "inventory" ? "库存" : preview.kind === "inbound" ? "在途" : "业务"}</p>
          <p>有效行: {preview.result.records.length}</p>
          <p>问题行: {issueRowCount}</p>
          <p>重复记录: {preview.duplicates.length}</p>

          {preview.result.issues.length > 0 && (
            <ul aria-label="导入问题">
              {preview.result.issues.map((issue, index) => <li key={`${issue.code}-${issue.row ?? "global"}-${index}`}>{issue.identifier ? `${issue.message}: ${issue.identifier}` : issue.message}</li>)}
            </ul>
          )}

          {preview.duplicates.length > 0 && !preview.result.fatal && (
            <fieldset>
              <legend>请选择重复记录处理方式</legend>
              <ul className="duplicate-comparison" aria-label="重复记录新旧对比">
                {preview.comparisons.map((comparison, index) => <li key={`${comparison.key}-${index}`}>
                  <code>旧记录：{JSON.stringify(comparison.existing)}</code>
                  <code>新记录：{JSON.stringify(comparison.incoming)}</code>
                </li>)}
              </ul>
              <label>
                <input type="radio" name="duplicate-action" value="ignore" checked={duplicateAction === "ignore"} onChange={() => setDuplicateAction("ignore")} />
                忽略重复
              </label>
              <label>
                <input type="radio" name="duplicate-action" value="replace" checked={duplicateAction === "replace"} onChange={() => setDuplicateAction("replace")} />
                替换旧记录
              </label>
            </fieldset>
          )}
        </div>
      )}

      <button type="button" onClick={() => void save()} disabled={saveDisabled}>保存导入</button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
