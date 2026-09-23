"use client";

import { useState } from "react";

const labels: Record<string, string> = {
  business: "业务数据",
  ads: "广告数据",
  inventory: "库存数据",
  inbound: "在途货件",
  promotion: "推广计划",
  dailyOps: "每日操作",
};

export function DataMigrationPanel(props: { preview: () => Promise<Record<string, number>>; migrate: () => Promise<void> }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true);
    try { setCounts(await props.preview()); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法读取本机数据"); }
    finally { setBusy(false); }
  }

  async function migrate() {
    setBusy(true);
    try { await props.migrate(); setMessage("复制完成，本机数据仍已保留。"); }
    catch (error) { setMessage(`复制失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }

  return <section className="panel migration-panel" aria-labelledby="migration-heading">
    <div className="panel-heading"><div><p className="eyebrow">DATA MIGRATION</p><h2 id="migration-heading">迁移本机数据</h2></div><span className="panel-meta">安全复制，不自动删除</span></div>
    {!counts ? <button type="button" disabled={busy} onClick={() => void preview()}>检查本机数据</button> : <>
      <ul>{Object.entries(counts).map(([resource, count]) => <li key={resource}>{labels[resource] ?? resource}：{count} 条</li>)}</ul>
      <p>迁移完成后，本机数据仍会保留。</p>
      <button type="button" disabled={busy} onClick={() => void migrate()}>确认复制到云端</button>
    </>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
