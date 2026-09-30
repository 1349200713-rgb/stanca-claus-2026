import type { InventoryRiskStatus } from "../calc/inventory-risk";
import type { PlanInventorySummary } from "../integration/plan-inventory";
import type { SizeCode } from "../domain/types";

const sizes: SizeCode[] = ["L", "XL", "2XL", "3XL"];

function displayUnits(value: number | null | undefined): string {
  return value == null ? "—" : String(value);
}

function totalUnits(values: Array<number | null | undefined>): string {
  return values.some((value) => value == null) ? "—" : String(values.reduce<number>((total, value) => total + (value ?? 0), 0));
}

function statusLabel(status: InventoryRiskStatus): string {
  if (status === "complete") return "正常";
  if (status === "risk") return "异常";
  if (status === "attention") return "关注";
  return "数据不完整";
}

function statusClass(status: InventoryRiskStatus): string {
  if (status === "complete") return "status-complete";
  if (status === "risk") return "status-risk";
  return "status-attention";
}

export function SizeInventoryOverview({ summary }: { summary: PlanInventorySummary }) {
  return (
    <section className="panel size-inventory-overview">
      <div className="panel-heading">
        <div><p className="eyebrow">SIZE INVENTORY OVERVIEW</p><h2>尺码库存总览</h2></div>
        <p className="panel-meta">正在接收/预留取自库存报告 Reserved 字段；在途取自未签收货件。</p>
      </div>
      <div className="table-scroll">
        <table aria-label="尺码库存总览">
          <thead><tr><th scope="col">尺码</th><th scope="col">FBA 可售</th><th scope="col">正在接收/预留</th><th scope="col">在途</th><th scope="col">可用总量</th><th scope="col">最近到货</th><th scope="col">状态</th></tr></thead>
          <tbody>
            {sizes.map((size) => {
              const row = summary.bySize[size];
              const snapshot = row.inventorySnapshot;
              const fbaAvailable = snapshot?.fbaAvailable;
              const reserved = snapshot?.reserved;
              const inbound = row.inbound?.units;
              return <tr key={size} className={`size-inventory-overview__row--${row.risk.status}`}>
                <th scope="row">{size}</th>
                <td>{displayUnits(fbaAvailable)}</td>
                <td>{displayUnits(reserved)}</td>
                <td>{displayUnits(inbound)}</td>
                <td><strong>{totalUnits([fbaAvailable, reserved, inbound])}</strong></td>
                <td>{row.inbound?.expectedArrivalDate ?? "—"}</td>
                <td><span className={`status-badge ${statusClass(row.risk.status)}`}>{statusLabel(row.risk.status)}</span></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
