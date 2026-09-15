export interface ActionItem {
  id: string;
  issue: string;
  suggestedAction: string;
  completed: boolean;
}

export interface ActionListProps {
  items: ActionItem[];
}

export function ActionList({ items }: ActionListProps) {
  return (
    <section className="panel action-panel" aria-labelledby="actions-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">DAILY ACTIONS</p>
          <h2 id="actions-heading">今日异常与动作</h2>
        </div>
        <span className="panel-meta">{items.filter((item) => item.completed).length}/{items.length} 完成</span>
      </div>
      <ul className="action-list">
        {items.map((item) => (
          <li key={item.id}>
            <span className={`action-check status-${item.completed ? "complete" : "risk"}`} aria-hidden="true">
              {item.completed ? "✓" : "!"}
            </span>
            <div>
              <strong>{item.issue}</strong>
              <p>{item.suggestedAction}</p>
            </div>
            <span className={`status-badge status-${item.completed ? "complete" : "risk"}`}>
              {item.completed ? "已完成" : "待处理"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
