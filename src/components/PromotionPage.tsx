"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdRecord, BusinessRecord, ManualRecord } from "../domain/types";
import { buildDailyPromotionPlan } from "../data/promotion-plan";
import type { PromotionPlanOverride } from "../domain/planning";
import { parsePromotionPlanReport } from "../import/promotion-plan-parser";
import { opsDb } from "../storage/db";

export interface PromotionPageProps {
  ads: readonly AdRecord[];
  business: readonly BusinessRecord[];
  manual: readonly (ManualRecord & { key?: string })[];
  startDate: string;
  endDate: string;
  onBack: () => void;
  onOpenReview?: () => void;
  onOpenDailyOperations?: () => void;
}

const money = (value: number) => `US$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const quantity = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const ratio = (numerator: number, denominator: number) => denominator === 0 ? null : numerator / denominator;
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const decimal = (value: number | null) => value === null ? "—" : value.toFixed(2);
type PromotionDisplayPlan = ReturnType<typeof buildDailyPromotionPlan>[number] & Partial<PromotionPlanOverride>;
type EditablePromotionField = keyof Pick<PromotionPlanOverride,
  "phase" | "targetDailyUnits" | "targetAcos" | "targetPrice" | "plannedAdBudget" | "plannedSales" | "offsiteOrders" | "serviceProvider" | "reviewOrderNumber" | "reviewQuantity" | "offsitePlan" | "operationFocus" | "reviewPlan" | "weeklyConclusion" | "nextAction"
>;
const numericPromotionFields = new Set<EditablePromotionField>(["targetDailyUnits", "offsiteOrders", "reviewQuantity"]);

function readableCell(value: unknown) {
  return <span className="sr-only">{value === undefined || value === null || value === "" ? "—" : String(value)}</span>;
}

function displayPromotionDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}号`;
}

function importKey(importedAt: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `import:${importedAt}:${suffix}`;
}

function sumAds(rows: readonly AdRecord[]) {
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const adSales = rows.reduce((sum, row) => sum + row.adSales, 0);
  const adOrders = rows.reduce((sum, row) => sum + row.adOrders, 0);
  const clicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
  const impressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
  return {
    spend,
    adSales,
    adOrders,
    clicks,
    impressions,
    acos: ratio(spend, adSales),
    cpc: rows.some((row) => row.cpc !== undefined) ? ratio(rows.reduce((sum, row) => sum + (row.cpc ?? 0) * (row.clicks ?? 1), 0), rows.reduce((sum, row) => sum + (row.clicks ?? (row.cpc === undefined ? 0 : 1)), 0)) : ratio(spend, clicks),
    ctr: rows.some((row) => row.ctr !== undefined) ? ratio(rows.reduce((sum, row) => sum + (row.ctr ?? 0) * (row.impressions ?? 1), 0), rows.reduce((sum, row) => sum + (row.impressions ?? (row.ctr === undefined ? 0 : 1)), 0)) : ratio(clicks, impressions),
    cvr: rows.some((row) => row.cvr !== undefined) ? ratio(rows.reduce((sum, row) => sum + (row.cvr ?? 0) * (row.clicks ?? 1), 0), rows.reduce((sum, row) => sum + (row.clicks ?? (row.cvr === undefined ? 0 : 1)), 0)) : ratio(adOrders, clicks),
  };
}

function recommendation(actualUnits: number, targetUnits: number, ad: ReturnType<typeof sumAds>): string {
  const completion = ratio(actualUnits, targetUnits);
  if (targetUnits === 0) return "停推/售后期：保留低预算防守，避免无效消耗。";
  if (ad.acos !== null && ad.acos > 0.35) return "ACOS偏高：先控竞价、否词、检查转化，再决定是否加预算。";
  if (completion !== null && completion < 0.8 && ad.acos !== null && ad.acos <= 0.3) return "销量落后但ACOS可控：可小幅加预算，并配合站外放量。";
  if (ad.ctr !== null && ad.ctr < 0.003) return "CTR偏低：优先检查主图、标题和核心词相关性。";
  if (ad.cvr !== null && ad.cvr < 0.05) return "CVR偏低：检查价格、Coupon、Review与Listing承接。";
  return "按计划推进，观察广告单与自然单是否同步增长。";
}

export function PromotionPage({ ads, business, manual, startDate, endDate, onBack, onOpenReview, onOpenDailyOperations }: PromotionPageProps) {
  const [overrides, setOverrides] = useState<PromotionPlanOverride[]>([]);
  const [draftOverrides, setDraftOverrides] = useState<PromotionPlanOverride[]>([]);
  const [importMessage, setImportMessage] = useState<string>();
  const [importIssues, setImportIssues] = useState<string[]>([]);

  const refreshPromotionPlan = async () => {
    const saved = await opsDb.listPromotionPlanOverrides();
    setOverrides(saved);
    setDraftOverrides(saved);
  };

  useEffect(() => {
    void refreshPromotionPlan();
  }, []);

  async function handlePromotionPlanFile(file: File | undefined) {
    if (!file) return;
    setImportMessage(undefined);
    setImportIssues([]);
    const bytes = await file.arrayBuffer();
    const result = parsePromotionPlanReport(bytes, file.name);
    if (result.fatal) {
      setImportIssues(result.issues.map((issue) => issue.message));
      return;
    }
    await opsDb.replacePromotionPlanOverrides(result.records);
    const importedAt = new Date().toISOString();
    await opsDb.archiveImportEvidence({
      key: importKey(importedAt),
      filename: file.name,
      importedAt,
      reportKind: "promotionPlan",
      rowCount: result.records.length,
      issueCount: result.issues.length,
      duplicateCount: 0,
      action: "replace",
    }, { bytes, rawRows: result.rawRows });
    await refreshPromotionPlan();
    setImportMessage(`推广计划已更新 ${result.records.length} 天`);
    if (result.issues.length) setImportIssues(result.issues.map((issue) => issue.row ? `第 ${issue.row} 行：${issue.message}` : issue.message));
  }

  function updatePromotionDraft(date: string, field: EditablePromotionField, value: string) {
    setDraftOverrides((current) => {
      const existing = current.find((override) => override.date === date);
      const nextValue = numericPromotionFields.has(field) ? (value.trim() === "" ? undefined : Number(value)) : (value || undefined);
      const updated: PromotionPlanOverride = {
        ...(existing ?? { key: `promotion-plan:${date}`, date, updatedAt: new Date().toISOString() }),
        [field]: Number.isNaN(nextValue) ? undefined : nextValue,
        updatedAt: new Date().toISOString(),
      };
      return [...current.filter((override) => override.date !== date), updated].sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  async function savePromotionPlanEdits() {
    await opsDb.replacePromotionPlanOverrides(draftOverrides);
    setOverrides(draftOverrides);
    setImportMessage(`计划修改已保存 ${draftOverrides.length} 天`);
    setImportIssues([]);
  }

  const overrideByDate = useMemo(() => new Map(draftOverrides.map((override) => [override.date, override])), [draftOverrides]);
  const rows = useMemo(() => buildDailyPromotionPlan()
    .filter((row) => row.date >= startDate && row.date <= endDate)
    .map((plan) => {
      const override = overrideByDate.get(plan.date);
      const mergedPlan: PromotionDisplayPlan = override ? {
        ...plan,
        ...Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined && value !== "")),
      } : plan;
      const dayAds = ads.filter((row) => row.date === plan.date);
      const ad = sumAds(dayAds);
      const actualUnits = business.filter((row) => row.date === mergedPlan.date).reduce((sum, row) => sum + row.units, 0);
      const actions = manual.filter((row) => row.date === mergedPlan.date && (row.action || row.event || row.issue));
      return { ...mergedPlan, ad, actualUnits, completion: ratio(actualUnits, mergedPlan.targetDailyUnits), actions };
    }), [ads, business, manual, overrideByDate, startDate, endDate]);

  const totalAd = sumAds(ads.filter((row) => row.date >= startDate && row.date <= endDate));
  const totalTargetUnits = rows.reduce((sum, row) => sum + row.targetDailyUnits, 0);
  const totalActualUnits = rows.reduce((sum, row) => sum + row.actualUnits, 0);

  return (
    <main className="dashboard-shell promotion-shell">
      <header className="dashboard-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">AD</span><div>
          <p className="brand-kicker">PROMOTION WAR ROOM</p><h1>推广作战看板</h1>
          <p className="as-of">按天展示 · {startDate} 至 {endDate}</p>
        </div></div>
        <div className="dashboard-header-actions">
          {onOpenReview ? <button className="secondary-button" type="button" onClick={onOpenReview}>进入推广复盘图表</button> : null}
          {onOpenDailyOperations ? <button className="secondary-button" type="button" onClick={onOpenDailyOperations}>每日操作</button> : null}
          <button className="secondary-button" type="button" onClick={onBack}>返回经营驾驶舱</button>
        </div>
      </header>

      <section className="promotion-kpi-grid" aria-label="推广核心指标">
        <article><span>计划销量</span><strong>{quantity(totalTargetUnits)}</strong></article>
        <article><span>实际销量</span><strong>{quantity(totalActualUnits)}</strong></article>
        <article><span>广告花费</span><strong>{money(totalAd.spend)}</strong></article>
        <article><span>广告销售额</span><strong>{money(totalAd.adSales)}</strong></article>
        <article><span>广告订单</span><strong>{totalAd.adOrders}</strong></article>
        <article><span>ACOS</span><strong>{percent(totalAd.acos)}</strong></article>
        <article><span>CPC</span><strong>{totalAd.cpc === null ? "—" : `US$${decimal(totalAd.cpc)}`}</strong></article>
        <article><span>CTR</span><strong>{percent(totalAd.ctr)}</strong></article>
        <article><span>CVR</span><strong>{percent(totalAd.cvr)}</strong></article>
      </section>

      <section className="panel promotion-actions-panel" aria-labelledby="promotion-actions-heading">
        <div className="panel-heading"><div><p className="eyebrow">TODAY ACTION</p><h2 id="promotion-actions-heading">当日动作</h2></div><span className="panel-meta">完成绿色 / 未完成红色</span></div>
        <div className="promotion-action-grid">
          <label>日期<input type="date" defaultValue={endDate} /></label>
          <label>动作类型<select defaultValue="加预算"><option>加预算</option><option>降预算</option><option>开广告</option><option>暂停广告</option><option>调竞价</option><option>做站外</option><option>测评</option><option>优化 Listing</option><option>补货提醒</option></select></label>
          <label>对象<input placeholder="ASIN / SKU / Campaign / 尺码" /></label>
          <label>动作内容<input placeholder="例如：核心词预算 +20%" /></label>
          <label>负责人/服务商<input placeholder="服务商或负责人" /></label>
          <label>测评单号<input placeholder="订单号" /></label>
          <label>测评数量<input type="number" /></label>
          <label>站外推广出单<input type="number" /></label>
          <label>完成状态<select defaultValue="未完成"><option>未完成</option><option>完成</option></select></label>
        </div>
      </section>

      <section className="panel promotion-table-panel" aria-labelledby="promotion-daily-heading">
        <div className="panel-heading"><div><p className="eyebrow">DAILY PROMOTION PLAN</p><h2 id="promotion-daily-heading">每日推广计划 × 广告数据</h2></div><span className="panel-meta">来自周度计划复盘 + 亚马逊报表导入</span></div>
        <div className="promotion-plan-import">
          <label className="secondary-button" htmlFor="promotion-plan-file">上传/更新推广计划</label>
          <input
            id="promotion-plan-file"
            aria-label="上传/更新推广计划"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) => void handlePromotionPlanFile(event.currentTarget.files?.[0])}
          />
          <button className="secondary-button" type="button" onClick={() => void savePromotionPlanEdits()}>保存计划修改</button>
          {importMessage && <p role="status">{importMessage}</p>}
          {importIssues.length ? <ul aria-label="推广计划导入问题">{importIssues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul> : null}
        </div>
        <div className="table-scroll">
          <table aria-label="每日推广作战表">
            <colgroup>
              <col className="promotion-col-date" />
              <col className="promotion-col-phase" />
              <col className="promotion-col-small" />
              <col className="promotion-col-small" />
              <col className="promotion-col-small" />
              <col className="promotion-col-money" />
              <col className="promotion-col-money" />
              <col className="promotion-col-small" />
              <col className="promotion-col-money" />
              <col className="promotion-col-money" />
              <col className="promotion-col-money" />
              <col className="promotion-col-small" />
              <col className="promotion-col-small" />
              <col className="promotion-col-small" />
              <col className="promotion-col-small" />
              <col className="promotion-col-small" />
              <col className="promotion-col-small" />
              <col className="promotion-col-medium" />
              <col className="promotion-col-medium" />
              <col className="promotion-col-small" />
              <col className="promotion-col-long" />
              <col className="promotion-col-long" />
              <col className="promotion-col-long" />
              <col className="promotion-col-long" />
              <col className="promotion-col-long" />
            </colgroup>
            <thead><tr><th scope="col">日期</th><th scope="col">阶段</th><th scope="col">目标日销</th><th scope="col">实际销量</th><th scope="col">完成率</th><th scope="col">计划广告</th><th scope="col">计划销售额</th><th scope="col">目标ACOS</th><th scope="col">售价</th><th scope="col">广告花费</th><th scope="col">广告销售额</th><th scope="col">广告订单</th><th scope="col">ACOS</th><th scope="col">CPC</th><th scope="col">CTR</th><th scope="col">CVR</th><th scope="col">站外推广出单</th><th scope="col">服务商</th><th scope="col">测评单号</th><th scope="col">测评数量</th><th scope="col">站外计划</th><th scope="col">操作重点</th><th scope="col">测评计划</th><th scope="col">结论/下步</th><th scope="col">当日建议</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.date}>
                <th scope="row">{readableCell(row.date)}<span className="promotion-date-display" aria-hidden="true">{displayPromotionDate(row.date)}</span></th>
                <td>{readableCell(row.phase)}<input aria-label={`${row.date} 阶段`} value={row.phase ?? ""} onChange={(event) => updatePromotionDraft(row.date, "phase", event.currentTarget.value)} /></td>
                <td>{readableCell(row.targetDailyUnits)}<input aria-label={`${row.date} 目标日销`} type="number" value={row.targetDailyUnits ?? ""} onChange={(event) => updatePromotionDraft(row.date, "targetDailyUnits", event.currentTarget.value)} /></td>
                <td>{row.actualUnits}</td><td>{percent(row.completion)}</td>
                <td>{readableCell(row.plannedAdBudget)}<input aria-label={`${row.date} 计划广告`} value={row.plannedAdBudget ?? ""} onChange={(event) => updatePromotionDraft(row.date, "plannedAdBudget", event.currentTarget.value)} /></td>
                <td>{readableCell(row.plannedSales)}<input aria-label={`${row.date} 计划销售额`} value={row.plannedSales ?? ""} onChange={(event) => updatePromotionDraft(row.date, "plannedSales", event.currentTarget.value)} /></td>
                <td>{readableCell(row.targetAcos)}<input aria-label={`${row.date} 目标ACOS`} value={row.targetAcos ?? ""} onChange={(event) => updatePromotionDraft(row.date, "targetAcos", event.currentTarget.value)} /></td>
                <td>{readableCell(row.targetPrice)}<input aria-label={`${row.date} 售价`} value={row.targetPrice ?? ""} onChange={(event) => updatePromotionDraft(row.date, "targetPrice", event.currentTarget.value)} /></td>
                <td>{money(row.ad.spend)}</td><td>{money(row.ad.adSales)}</td><td>{row.ad.adOrders}</td><td>{percent(row.ad.acos)}</td><td>{row.ad.cpc === null ? "—" : `US$${decimal(row.ad.cpc)}`}</td><td>{percent(row.ad.ctr)}</td><td>{percent(row.ad.cvr)}</td>
                <td>{readableCell(row.offsiteOrders)}<input aria-label={`${row.date} 站外推广出单`} type="number" value={row.offsiteOrders ?? ""} onChange={(event) => updatePromotionDraft(row.date, "offsiteOrders", event.currentTarget.value)} /></td>
                <td>{readableCell(row.serviceProvider)}<input aria-label={`${row.date} 服务商`} value={row.serviceProvider ?? ""} onChange={(event) => updatePromotionDraft(row.date, "serviceProvider", event.currentTarget.value)} /></td>
                <td>{readableCell(row.reviewOrderNumber)}<input aria-label={`${row.date} 测评单号`} value={row.reviewOrderNumber ?? ""} onChange={(event) => updatePromotionDraft(row.date, "reviewOrderNumber", event.currentTarget.value)} /></td>
                <td>{readableCell(row.reviewQuantity)}<input aria-label={`${row.date} 测评数量`} type="number" value={row.reviewQuantity ?? ""} onChange={(event) => updatePromotionDraft(row.date, "reviewQuantity", event.currentTarget.value)} /></td>
                <td>{readableCell(row.offsitePlan)}<textarea aria-label={`${row.date} 站外计划`} value={row.offsitePlan ?? ""} onChange={(event) => updatePromotionDraft(row.date, "offsitePlan", event.currentTarget.value)} /></td>
                <td>{readableCell(row.operationFocus)}<textarea aria-label={`${row.date} 操作重点`} value={row.operationFocus ?? ""} onChange={(event) => updatePromotionDraft(row.date, "operationFocus", event.currentTarget.value)} /></td>
                <td>{readableCell(row.reviewPlan)}<textarea aria-label={`${row.date} 测评计划`} value={row.reviewPlan ?? ""} onChange={(event) => updatePromotionDraft(row.date, "reviewPlan", event.currentTarget.value)} /></td>
                <td>{readableCell([row.weeklyConclusion, row.nextAction].filter(Boolean).join("\n"))}<textarea aria-label={`${row.date} 结论/下步`} value={[row.weeklyConclusion, row.nextAction].filter(Boolean).join("\n")} onChange={(event) => updatePromotionDraft(row.date, "weeklyConclusion", event.currentTarget.value)} /></td>
                <td>{recommendation(row.actualUnits, row.targetDailyUnits, row.ad)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
