"use client";

import { useState } from "react";
import type { DailyOperationRecord } from "../domain/planning";
import { opsDb } from "../storage/db";

export interface DailyOperationsPageProps {
  operations: readonly DailyOperationRecord[];
  defaultDate: string;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
}

function operationKey(date: string, time: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `daily-op:${date}:${time}:${suffix}`;
}

export function DailyOperationsPage({ operations, defaultDate, onBack, onChanged }: DailyOperationsPageProps) {
  const [message, setMessage] = useState<string>();
  const sorted = [...operations].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const date = String(form.get("date") ?? defaultDate);
    const time = String(form.get("time") ?? "");
    const record: DailyOperationRecord = {
      key: operationKey(date, time),
      date,
      time,
      action: String(form.get("action") ?? ""),
      risk: String(form.get("risk") ?? ""),
      tomorrowPlan: String(form.get("tomorrowPlan") ?? ""),
      status: String(form.get("status") ?? "未完成") as DailyOperationRecord["status"],
      updatedAt: new Date().toISOString(),
    };
    await opsDb.saveDailyOperation(record);
    formElement.reset();
    setMessage("每日操作已保存");
    await onChanged();
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
          <p className="as-of">记录时间、动作、风险、明日计划</p>
        </div></div>
        <button className="secondary-button" type="button" onClick={onBack}>返回推广作战看板</button>
      </header>
      <section className="panel manual-panel" aria-labelledby="daily-operation-form-heading">
        <div className="panel-heading"><div><p className="eyebrow">ACTION LOG</p><h2 id="daily-operation-form-heading">新增每日操作</h2></div><span className="panel-meta">本地保存</span></div>
        <form className="manual-form" onSubmit={(event) => void save(event)}>
          <label>日期<input name="date" aria-label="日期" type="date" defaultValue={defaultDate} required /></label>
          <label>时间<input name="time" aria-label="时间" type="time" required /></label>
          <label>动作<input name="action" aria-label="动作" required /></label>
          <label>风险<input name="risk" aria-label="风险" /></label>
          <label>明日计划<input name="tomorrowPlan" aria-label="明日计划" /></label>
          <label>状态<select name="status" aria-label="状态" defaultValue="未完成"><option>未完成</option><option>已完成</option></select></label>
          <button type="submit">保存每日操作</button>
        </form>
        {message ? <p role="status">{message}</p> : null}
      </section>
      <section className="panel promotion-table-panel" aria-labelledby="daily-operation-table-heading">
        <div className="panel-heading"><div><p className="eyebrow">HISTORY</p><h2 id="daily-operation-table-heading">操作历史</h2></div><span className="panel-meta">{sorted.length} 条</span></div>
        <div className="table-scroll">
          <table aria-label="每日操作记录表">
            <thead><tr><th scope="col">日期</th><th scope="col">时间</th><th scope="col">动作</th><th scope="col">风险</th><th scope="col">明日计划</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
            <tbody>{sorted.map((record) => (
              <tr key={record.key}>
                <th scope="row">{record.date}</th><td>{record.time}</td><td>{record.action}</td><td>{record.risk || "—"}</td><td>{record.tomorrowPlan || "—"}</td><td>{record.status}</td><td><button type="button" onClick={() => void remove(record.key)}>删除</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
