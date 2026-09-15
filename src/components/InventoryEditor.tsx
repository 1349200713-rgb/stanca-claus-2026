"use client";

import { useEffect, useState } from "react";
import type { SizeCode } from "../domain/types";
import type { InboundEntry, InventorySnapshot } from "../domain/planning";
import { opsDb } from "../storage/db";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

interface ShipmentDraft {
  fbaNumber: string;
  unitPrice: string;
  asin: string;
  sku: string;
  productName: string;
  units: string;
  shipDate: string;
  expectedArrivalDate: string;
}

export interface InventoryEditorProps {
  inventory: readonly InventorySnapshot[];
  inbound: readonly InboundEntry[];
  updatedAt: string;
  onSaved?: (entry: InboundEntry) => void | Promise<void>;
  locale?: "en" | "zh";
}

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

function latestBySize(inventory: readonly InventorySnapshot[], size: SizeCode): InventorySnapshot | undefined {
  return inventory.filter((snapshot) => snapshot.size === size).reduce<InventorySnapshot | undefined>(
    (latest, snapshot) => (!latest || snapshot.date > latest.date ? snapshot : latest),
    undefined,
  );
}

function emptyShipmentDraft(): ShipmentDraft {
  return { fbaNumber: "", unitPrice: "", asin: "", sku: "", productName: "", units: "", shipDate: "", expectedArrivalDate: "" };
}

function sizeFromProductName(productName: string): SizeCode {
  const normalized = productName.trim().toUpperCase();
  if (/^(3XL|XXXL)\b|^(3XL|XXXL)码/.test(normalized)) return "3XL";
  if (/^(2XL|XXL)\b|^(2XL|XXL)码/.test(normalized)) return "2XL";
  if (/^XL\b|^XL码/.test(normalized)) return "XL";
  return "L";
}

function summarizeBySku(inbound: readonly InboundEntry[]): Array<{ sku: string; productLabel: string; units: number }> {
  const totals = new Map<string, { productLabel: string; units: number }>();
  for (const entry of inbound) {
    if (!entry.sku || entry.units == null) continue;
    const current = totals.get(entry.sku);
    const productLabel = entry.productName?.trim() || entry.size;
    totals.set(entry.sku, {
      productLabel: current?.productLabel ?? productLabel,
      units: (current?.units ?? 0) + entry.units,
    });
  }
  return [...totals.entries()]
    .map(([sku, summary]) => ({ sku, productLabel: summary.productLabel, units: summary.units }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
}

function summarizeByArrival(inbound: readonly InboundEntry[]): Array<{ arrivalDate: string; items: Array<{ productName: string; units: number }> }> {
  const groups = new Map<string, Map<string, number>>();
  for (const entry of inbound) {
    if (!entry.productName || entry.units == null) continue;
    const arrivalDate = entry.expectedArrivalDate ?? "未填写到货时间";
    const dateGroup = groups.get(arrivalDate) ?? new Map<string, number>();
    dateGroup.set(entry.productName, (dateGroup.get(entry.productName) ?? 0) + entry.units);
    groups.set(arrivalDate, dateGroup);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([arrivalDate, items]) => ({
      arrivalDate,
      items: [...items.entries()]
        .map(([productName, units]) => ({ productName, units }))
        .sort((left, right) => left.productName.localeCompare(right.productName)),
    }));
}

export function InventoryEditor({ inventory, inbound, updatedAt, onSaved, locale = "en" }: InventoryEditorProps) {
  const [savedInbound, setSavedInbound] = useState<InboundEntry[]>(() => [...inbound]);
  const [shipmentDraft, setShipmentDraft] = useState<ShipmentDraft>(emptyShipmentDraft);
  const [savingShipment, setSavingShipment] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const zh = locale === "zh";
  const skuSummary = summarizeBySku(savedInbound);
  const skuSummaryTotal = skuSummary.reduce((total, row) => total + row.units, 0);
  const arrivalSummary = summarizeByArrival(savedInbound);

  const reloadSavedInbound = async () => {
    const latestInbound = await opsDb.getInboundEntries();
    setSavedInbound(latestInbound);
    return latestInbound;
  };

  useEffect(() => {
    let live = true;
    setSavedInbound([...inbound]);
    void opsDb.getInboundEntries()
      .then((latestInbound) => { if (live) setSavedInbound(latestInbound); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [inbound]);

  const updateShipment = (field: keyof ShipmentDraft, value: string) => {
    setShipmentDraft((current) => ({ ...current, [field]: value }));
    setMessage(undefined);
  };

  const saveShipment = async () => {
    const units = Number(shipmentDraft.units);
    if (!shipmentDraft.fbaNumber.trim()) {
      setMessage({ kind: "error", text: zh ? "FBA单号不能为空" : "FBA number is required" });
      return;
    }
    if (!shipmentDraft.sku.trim()) {
      setMessage({ kind: "error", text: zh ? "SKU不能为空" : "SKU is required" });
      return;
    }
    if (!Number.isInteger(units) || units < 0) {
      setMessage({ kind: "error", text: zh ? "数量必须是非负整数" : "Quantity must be a nonnegative whole number" });
      return;
    }
    if (shipmentDraft.shipDate && !isIsoDate(shipmentDraft.shipDate)) {
      setMessage({ kind: "error", text: zh ? "开船时间必须是有效日期" : "Ship date must be a valid ISO date" });
      return;
    }
    if (shipmentDraft.expectedArrivalDate && !isIsoDate(shipmentDraft.expectedArrivalDate)) {
      setMessage({ kind: "error", text: zh ? "到货时间必须是有效日期" : "Arrival date must be a valid ISO date" });
      return;
    }
    const entry: InboundEntry = {
      size: sizeFromProductName(shipmentDraft.productName),
      units,
      expectedArrivalDate: shipmentDraft.expectedArrivalDate || null,
      updatedAt,
      fbaNumber: shipmentDraft.fbaNumber.trim(),
      unitPrice: shipmentDraft.unitPrice.trim(),
      asin: shipmentDraft.asin.trim(),
      sku: shipmentDraft.sku.trim(),
      productName: shipmentDraft.productName.trim(),
      shipDate: shipmentDraft.shipDate || null,
    };
    setSavingShipment(true);
    setMessage(undefined);
    try {
      await opsDb.saveInboundEntry(entry);
      await reloadSavedInbound();
      await onSaved?.(structuredClone(entry));
      setShipmentDraft((current) => ({
        ...emptyShipmentDraft(),
        unitPrice: current.unitPrice,
        asin: current.asin,
        sku: current.sku,
        productName: current.productName,
        shipDate: current.shipDate,
        expectedArrivalDate: current.expectedArrivalDate,
      }));
      setMessage({ kind: "success", text: zh ? "发货明细已保存" : "Shipment line saved" });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : zh ? "发货明细保存失败" : "Unable to save shipment line" });
    } finally {
      setSavingShipment(false);
    }
  };

  const shipmentLabel = (entry: InboundEntry) => `${entry.fbaNumber ?? entry.size} ${entry.sku ?? entry.productName ?? ""}`.trim();

  const removeShipment = async (entry: InboundEntry, action: "received" | "deleted") => {
    const label = shipmentLabel(entry);
    const confirmText = action === "received"
      ? (zh ? `确认收到 ${label}？收到后将从在途中移除。` : `Mark ${label} as received? It will be removed from inbound.`)
      : (zh ? `确认删除 ${label}？删除后将从在途中移除。` : `Delete ${label}? It will be removed from inbound.`);
    if (!globalThis.confirm?.(confirmText)) return;
    setSavingShipment(true);
    setMessage(undefined);
    try {
      await opsDb.deleteInboundEntry(entry);
      await reloadSavedInbound();
      await onSaved?.(structuredClone(entry));
      setMessage({ kind: "success", text: action === "received" ? (zh ? "货件已标记收到" : "Shipment marked received") : (zh ? "货件已删除" : "Shipment deleted") });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : zh ? "货件操作失败" : "Shipment update failed" });
    } finally {
      setSavingShipment(false);
    }
  };

  return (
    <section aria-labelledby="inventory-editor-heading">
      <h2 id="inventory-editor-heading">{zh ? "库存与在途" : "Inventory and inbound"}</h2>
      <div className="inbound-entry-grid">
        <label>{zh ? "FBA单号" : "FBA number"}<input aria-label={zh ? "FBA单号" : "FBA number"} value={shipmentDraft.fbaNumber} onChange={(event) => updateShipment("fbaNumber", event.currentTarget.value)} /></label>
        <label>{zh ? "单价" : "Unit price"}<input aria-label={zh ? "单价" : "Unit price"} value={shipmentDraft.unitPrice} onChange={(event) => updateShipment("unitPrice", event.currentTarget.value)} placeholder="13.3/KG" /></label>
        <label>ASIN<input aria-label="ASIN" value={shipmentDraft.asin} onChange={(event) => updateShipment("asin", event.currentTarget.value)} /></label>
        <label>SKU<input aria-label="SKU" value={shipmentDraft.sku} onChange={(event) => updateShipment("sku", event.currentTarget.value)} /></label>
        <label>{zh ? "品名" : "Product name"}<input aria-label={zh ? "品名" : "Product name"} value={shipmentDraft.productName} onChange={(event) => updateShipment("productName", event.currentTarget.value)} /></label>
        <label>{zh ? "数量" : "Quantity"}<input aria-label={zh ? "数量" : "Quantity"} type="number" min="0" step="1" value={shipmentDraft.units} onChange={(event) => updateShipment("units", event.currentTarget.value)} /></label>
        <label>{zh ? "开船时间" : "Ship date"}<input aria-label={zh ? "开船时间" : "Ship date"} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={shipmentDraft.shipDate} onChange={(event) => updateShipment("shipDate", event.currentTarget.value)} /></label>
        <label>{zh ? "到货时间" : "Arrival date"}<input aria-label={zh ? "到货时间" : "Arrival date"} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={shipmentDraft.expectedArrivalDate} onChange={(event) => updateShipment("expectedArrivalDate", event.currentTarget.value)} /></label>
        <button type="button" disabled={savingShipment} onClick={() => void saveShipment()}>{zh ? "保存发货明细" : "Save shipment line"}</button>
      </div>

      <div className="table-scroll inbound-shipment-table">
        <table aria-label={zh ? "发货明细" : "Shipment lines"}>
          <thead>
            <tr>
              <th scope="col">{zh ? "FBA单号" : "FBA number"}</th>
              <th scope="col">{zh ? "单价" : "Unit price"}</th>
              <th scope="col">ASIN</th>
              <th scope="col">SKU</th>
              <th scope="col">{zh ? "品名" : "Product name"}</th>
              <th scope="col">{zh ? "数量" : "Quantity"}</th>
              <th scope="col">{zh ? "开船时间" : "Ship date"}</th>
              <th scope="col">{zh ? "到货时间" : "Arrival date"}</th>
              <th scope="col">{zh ? "操作" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {savedInbound.filter((entry) => entry.sku || entry.fbaNumber).map((entry, index) => (
              <tr key={`${entry.fbaNumber ?? "legacy"}:${entry.sku ?? entry.size}:${entry.shipDate ?? ""}:${index}`}>
                <td>{entry.fbaNumber ?? "—"}</td>
                <td>{entry.unitPrice ?? "—"}</td>
                <td>{entry.asin || "—"}</td>
                <td>{entry.sku ?? "—"}</td>
                <td>{entry.productName ?? "—"}</td>
                <td>{entry.units ?? "—"}</td>
                <td>{entry.shipDate ?? "—"}</td>
                <td>{entry.expectedArrivalDate ?? "—"}</td>
                <td>
                  <div className="shipment-action-buttons">
                    <button type="button" disabled={savingShipment} onClick={() => void removeShipment(entry, "received")} aria-label={`${zh ? "收到" : "Received"} ${shipmentLabel(entry)}`}>{zh ? "收到" : "Received"}</button>
                    <button type="button" disabled={savingShipment} onClick={() => void removeShipment(entry, "deleted")} aria-label={`${zh ? "删除" : "Delete"} ${shipmentLabel(entry)}`}>{zh ? "删除" : "Delete"}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-scroll inbound-summary-table">
        <table aria-label={zh ? "到货节奏汇总" : "Arrival cadence summary"}>
          <thead><tr><th scope="col">{zh ? "到货时间" : "Arrival date"}</th><th scope="col">{zh ? "尺码/品名数量" : "Product quantities"}</th></tr></thead>
          <tbody>
            {arrivalSummary.length ? arrivalSummary.map((group) => (
              <tr key={group.arrivalDate}>
                <th scope="row">{group.arrivalDate}</th>
                <td>
                  <ul className="arrival-summary-list">
                    {group.items.map((item) => <li key={item.productName}><span>{item.productName}</span><strong>{item.units}</strong></li>)}
                  </ul>
                </td>
              </tr>
            )) : <tr><td colSpan={2}>{zh ? "暂无到货节奏数据" : "No arrival cadence yet"}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="table-scroll inbound-summary-table">
        <table aria-label={zh ? "SKU在途汇总" : "SKU inbound summary"}>
          <thead><tr><th scope="col">SKU</th><th scope="col">{zh ? "尺码/品名" : "Size / product"}</th><th scope="col">{zh ? "在途数量汇总" : "Inbound total"}</th></tr></thead>
          <tbody>
            {skuSummary.length ? (
              <>
                {skuSummary.map((row) => <tr key={row.sku}><th scope="row">{row.sku}</th><td>{row.productLabel}</td><td>{row.units}</td></tr>)}
                <tr className="summary-total-row"><th scope="row" colSpan={2}>{zh ? "所有尺码合计" : "All sizes total"}</th><td>{skuSummaryTotal}</td></tr>
              </>
            ) : <tr><td colSpan={3}>{zh ? "暂无发货明细" : "No shipment lines yet"}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="table-scroll inventory-snapshot-table">
      <table aria-label={zh ? "库存快照参考" : "Inventory snapshot reference"}>
        <thead>
          <tr>
            <th scope="col">{zh ? "尺码" : "Size"}</th>
            <th scope="col">{zh ? "最新快照日期" : "Latest snapshot date"}</th>
            <th scope="col">{zh ? "FBA 可售" : "FBA available"}</th>
            <th scope="col">{zh ? "预留" : "Reserved"}</th>
            <th scope="col">{zh ? "不可售" : "Unfulfillable"}</th>
          </tr>
        </thead>
        <tbody>
          {sizes.map((size) => {
            const snapshot = latestBySize(inventory, size);
            return (
              <tr key={size}>
                <th scope="row">{size}</th>
                <td>{snapshot?.date ?? "—"}</td>
                <td>{snapshot?.fbaAvailable ?? "—"}</td>
                <td>{snapshot?.reserved ?? "—"}</td>
                <td>{snapshot?.unfulfillable ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {message && <p role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
    </section>
  );
}
