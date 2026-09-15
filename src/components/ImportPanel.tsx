"use client";

import { useState } from "react";
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
}

function importKey(importedAt: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `import:${importedAt}:${suffix}`;
}

export function ImportPanel({ plan, inventorySnapshotDate, onImported }: ImportPanelProps) {
  const [preview, setPreview] = useState<Preview>();
  const [duplicateAction, setDuplicateAction] = useState<"ignore" | "replace">();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setMessage(undefined);
    setDuplicateAction(undefined);
    const fallbackKind: ReportKind = inventoryKindFromFilename(file.name) ? "inventory" : reportKindFromFilename(file.name);

    try {
      const bytes = await file.arrayBuffer();
      const inbound = isInboundReport(bytes);
      const inventory = !inbound && isInventoryReport(bytes, file.name);
      const result = inbound
        ? parseInboundReport(bytes, file.name, { defaultYear: 2026, updatedAt: new Date().toISOString() })
        : inventory
        ? parseInventoryReport(bytes, file.name, plan, {
          fallbackDate: inventorySnapshotDate ?? new Date().toISOString().slice(0, 10),
          sourceImportKey: "",
        })
        : parseReport(bytes, file.name, plan);
      const kind = result.reportKind;
      const incoming = result.records as FormalRecord[];
      if (kind === "inbound") {
        setPreview({ filename: file.name, kind, bytes, result, unique: incoming, duplicates: [], comparisons: [] });
        return;
      }
      const existing = kind === "business"
        ? await opsDb.list("business")
        : kind === "ads"
          ? await opsDb.list("ads")
          : await opsDb.listInventorySnapshots();
      const { unique, duplicates, comparisons } = findDuplicates(existing as KeyedFormalRecord[], incoming as KeyedFormalRecord[]);
      setPreview({ filename: file.name, kind, bytes, result, unique, duplicates, comparisons });
    } catch (error) {
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
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = !preview || preview.result.fatal || saving || (preview.duplicates.length > 0 && !duplicateAction);
  const issueRowCount = preview ? new Set(preview.result.issues.map((issue) => issue.row).filter((row): row is number => row !== undefined)).size : 0;

  return (
    <section aria-labelledby="import-panel-heading">
      <h2 id="import-panel-heading">导入报告</h2>
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
