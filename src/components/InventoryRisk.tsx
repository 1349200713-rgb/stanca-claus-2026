import type { RiskSignal, SizeCode, Status } from "../domain/types";

const STATUS_LABELS: Record<Status, string> = {
  complete: "完成",
  attention: "注意",
  risk: "风险",
};

export interface InventoryRiskRow {
  size: SizeCode;
  inventory: number | null;
  daysToStockout: number | null;
  projectedEndingInventory: number | null;
  riskLabel: string;
  status: Status;
}

export interface InventoryRiskProps {
  rows: InventoryRiskRow[];
  aggregateSignals?: RiskSignal[];
}

export function InventoryRisk({ rows, aggregateSignals = [] }: InventoryRiskProps) {
  return (
    <section className="panel inventory-panel" aria-labelledby="inventory-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h2 id="inventory-heading">库存与积压风险</h2>
        </div>
        <span className="panel-meta">按尺码</span>
      </div>
      <div className="inventory-list">
        {rows.map((row) => (
          <article className="inventory-row" key={row.size}>
            <div className="inventory-row__topline">
              <strong>{row.size}</strong>
              <span className={`status-badge status-${row.status}`}>{STATUS_LABELS[row.status]} · {row.riskLabel}</span>
            </div>
            <dl>
              <div><dt>可售库存</dt><dd>{row.inventory ?? "数据不完整"}</dd></div>
              <div><dt>预计售罄</dt><dd>{row.daysToStockout === null ? "数据不完整" : `${row.daysToStockout.toFixed(1)} 天`}</dd></div>
              <div><dt>期末预测</dt><dd>{row.projectedEndingInventory ?? "数据不完整"}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      {aggregateSignals.length ? <ul className="risk-summary" aria-label="聚合风险">
        {aggregateSignals.map((signal) => <li key={signal.id} className={`status-${signal.status}`}><strong>{signal.label}</strong> · {signal.detail}</li>)}
      </ul> : null}
    </section>
  );
}
