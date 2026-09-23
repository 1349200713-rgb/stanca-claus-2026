"use client";

import { useState } from "react";
import type { DailyOperationRecord } from "../domain/planning";
import { parseDailyOperationsFile } from "../import/daily-operations-parser";
import { opsDb } from "../storage/db";

export interface DailyOperationsPageProps {
  operations: readonly DailyOperationRecord[];
  defaultDate: string;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
}

function operationKey(date: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `daily-op:${date}:${suffix}`;
}

export function DailyOperationsPage({ operations, defaultDate, onBack, onChanged }: DailyOperationsPageProps) {
  const [message, setMessage] = useState<string>();
  const sorted = [...operations].sort((a, b) => `${b.date} ${b.updatedAt}`.localeCompare(`${a.date} ${a.updatedAt}`));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const date = String(form.get("date") ?? defaultDate);
    const record: DailyOperationRecord = {
      key: operationKey(date),
      date,
      action: String(form.get("action") ?? ""),
      risk: String(form.get("risk") ?? ""),
      tomorrowPlan: String(form.get("tomorrowPlan") ?? ""),
      status: String(form.get("status") ?? "未完成") as DailyOperationRecord["status"],
      note: String(form.get("note") ?? ""),
      category: String(form.get("category") ?? "其他") as DailyOperationRecord["category"],
      priority: String(form.get("priority") ?? "中") as DailyOperationRecord["priority"],
      owner: String(form.get("owner") ?? "") || undefined,
      dueDate: String(form.get("dueDate") ?? "") || undefined,
      asin: String(form.get("asin") ?? "").trim().toUpperCase() || undefined,
      sku: String(form.get("sku") ?? "").trim().toUpperCase() || undefined,
      keywordId: String(form.get("keywordId") ?? "").trim().toLowerCase() || undefined,
      competitorAsin: String(form.get("competitorAsin") ?? "").trim().toUpperCase() || undefined,
      effectStatus: "待观察",
      updatedAt: new Date().toISOString(),
    };
    await opsDb.saveDailyOperation(record);
    formElement.reset();
    setMessage("每日操作已保存");
    await onChanged();
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = parseDailyOperationsFile(await file.arrayBuffer(), file.name);
      for (const record of result.records) await opsDb.saveDailyOperation(record);
      setMessage(`成功导入 ${result.records.length} 条，跳过 ${result.skipped} 条`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  async function remove(key: string) {
    await opsDb.deleteDailyOperation(key);
    setMessage("每日操作已删除");
    await onChanged();
  }

  return (
    <main className="dashboard-shell promotion-shell">
      <header className="dashboard-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">OP</span><div>
          <p className="brand-kicker">DAILY OPERATION LOG</p><h1>每日操作记录</h1>
          <p className="as-of">记录日期、动作、风险、明日计划与备注</p>
        </div></div>
        <button className="secondary-button" type="button" onClick={onBack}>返回推广作战看板</button>
      </header>
      <section className="panel manual-panel" aria-labelledby="daily-operation-form-heading">
        <div className="panel-heading"><div><p className="eyebrow">ACTION LOG</p><h2 id="daily-operation-form-heading">新增每日操作</h2></div><div><label className="secondary-button" htmlFor="daily-operations-file">导入每日操作</label><input className="sr-only" id="daily-operations-file" aria-label="导入每日操作" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void importFile(event)} /></div></div>
        <form className="manual-form" onSubmit={(event) => void save(event)}>
          <label>日期<input name="date" aria-label="日期" type="date" defaultValue={defaultDate} required /></label>
          <label>动作<input name="action" aria-label="动作" required /></label>
          <label>风险<input name="risk" aria-label="风险" /></label>
          <label>明日计划<input name="tomorrowPlan" aria-label="明日计划" /></label>
          <label>分类<select name="category" aria-label="分类" defaultValue="其他">{["调价", "优惠券", "广告预算", "竞价", "否词", "关键词", "Listing", "站外推广", "测评", "库存", "其他"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>优先级<select name="priority" aria-label="优先级" defaultValue="中"><option>低</option><option>中</option><option>高</option></select></label>
          <label>负责人<input name="owner" aria-label="负责人" /></label>
          <label>截止日期<input name="dueDate" aria-label="截止日期" type="date" /></label>
          <label>关联ASIN<input name="asin" aria-label="关联ASIN" /></label>
          <label>关联SKU<input name="sku" aria-label="关联SKU" /></label>
          <label>关联关键词<input name="keywordId" aria-label="关联关键词" /></label>
          <label>关联竞品ASIN<input name="competitorAsin" aria-label="关联竞品ASIN" /></label>
          <label>状态<select name="status" aria-label="状态" defaultValue="未完成"><option>未完成</option><option>已完成</option></select></label>
          <label>备注<input name="note" aria-label="备注" /></label>
          <button type="submit">保存每日操作</button>
        </form>
        {message ? <p role="status">{message}</p> : null}
      </section>
      <section className="panel promotion-table-panel" aria-labelledby="daily-operation-table-heading">
        <div className="panel-heading"><div><p className="eyebrow">HISTORY</p><h2 id="daily-operation-table-heading">操作历史</h2></div><span className="panel-meta">{sorted.length} 条</span></div>
        <div className="table-scroll">
          <table className="daily-operations-table" aria-label="每日操作记录表">
            <colgroup><col className="daily-operation-date-column" /><col className="daily-operation-action-column" /><col /><col /><col className="daily-operation-status-column" /><col /><col className="daily-operation-controls-column" /></colgroup>
            <thead><tr><th scope="col">日期</th><th scope="col">分类/优先级</th><th scope="col">动作</th><th scope="col">风险</th><th scope="col">明日计划</th><th scope="col">负责人/对象</th><th scope="col">状态/效果</th><th scope="col">备注</th><th scope="col">操作</th></tr></thead>
            <tbody>{sorted.map((record) => (
              <tr key={record.key}>
                <th className="daily-operation-date" scope="row">{record.date}</th><td>{record.category ?? "其他"} / {record.priority ?? "中"}</td><td>{record.action}</td><td>{record.risk || "—"}</td><td>{record.tomorrowPlan || "—"}</td><td>{record.owner || "—"}<br />{record.asin || record.sku || record.keywordId || record.competitorAsin || "—"}</td><td>{record.status}<br />{record.effectStatus ?? "待观察"}</td><td>{record.note || "—"}</td><td><button type="button" onClick={() => void remove(record.key)}>删除</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
