import type { Status } from "../domain/types";

const STATUS_LABELS: Record<Status, string> = {
  complete: "完成",
  attention: "注意",
  risk: "风险",
};

export interface KpiCardProps {
  label: string;
  primaryValue: string;
  comparison: string;
  status: Status;
}

export function KpiCard({ label, primaryValue, comparison, status }: KpiCardProps) {
  return (
    <article className="kpi-card">
      <div className="kpi-card__topline">
        <p className="kpi-card__label" data-testid="kpi-label">{label}</p>
        <span className={`status-badge status-${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      <p className="kpi-card__value">{primaryValue}</p>
      <p className="kpi-card__comparison">{comparison}</p>
    </article>
  );
}
