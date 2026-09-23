export type OpsPage = "dashboard" | "plan-inventory" | "promotion" | "promotion-review" | "daily-operations" | "competitors" | "keywords";

const items: Array<{ page: OpsPage; label: string }> = [
  { page: "dashboard", label: "经营驾驶舱" },
  { page: "plan-inventory", label: "计划与库存" },
  { page: "promotion", label: "广告推广" },
  { page: "promotion-review", label: "推广复盘图表" },
  { page: "keywords", label: "关键词排名" },
  { page: "competitors", label: "竞品跟踪" },
  { page: "daily-operations", label: "每日操作" },
];

export function OpsNavigation({ current, onNavigate }: { current: OpsPage; onNavigate: (page: OpsPage) => void }) {
  return <nav className="dashboard-module-nav" aria-label="经营模块导航">{items.map((item) => <button key={item.page} className="secondary-button dashboard-plan-link" type="button" aria-current={current === item.page ? "page" : undefined} onClick={() => onNavigate(item.page)}>{item.label}</button>)}</nav>;
}
