"use client";

import type { InventoryRiskStatus } from "../calc/inventory-risk";
import type { PlanInventorySummary } from "../integration/plan-inventory";
import type { SizeCode } from "../domain/types";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

const statusLabels: Record<InventoryRiskStatus, string> = {
  complete: "正常",
  attention: "积压关注",
  risk: "风险",
  insufficient: "数据不足",
};

function quantity(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export interface InventoryRiskPanelProps {
  summary: PlanInventorySummary;
}

export function InventoryRiskPanel({ summary }: InventoryRiskPanelProps) {
  return (
    <section className="panel inventory-risk-panel-v2" aria-labelledby="inventory-risk-v2-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">INVENTORY RISK</p><h2 id="inventory-risk-v2-heading">库存风险</h2></div>
        <span className={`status-badge status-${summary.status}`}>{statusLabels[summary.status]}</span>
      </div>
      <div className="table-scroll">
        <table className="risk-table">
          <thead><tr><th scope="col">尺码</th><th scope="col">状态</th><th scope="col">预计售罄日</th><th scope="col">可售库存</th><th scope="col">未来可售</th><th scope="col">季末库存</th><th scope="col">积压率</th><th scope="col">说明</th></tr></thead>
          <tbody>{sizes.map((size) => {
            const risk = summary.bySize[size].risk;
            return <tr key={size} className={`risk-table__row risk-table__row--${risk.status}`}>
              <th scope="row">{size}</th><td><span className={`status-badge status-${risk.status}`}>{statusLabels[risk.status]}</span></td>
              <td>{risk.expectedStockoutDate ?? "—"}</td><td>{quantity(risk.availableInventory)}</td><td>{quantity(risk.futureAvailableInventory)}</td>
              <td>{quantity(risk.projectedEndingInventory)}</td><td>{percent(risk.overstockRate)}</td><td>{risk.explanation}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
