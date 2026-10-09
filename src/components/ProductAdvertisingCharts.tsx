import type { ProductComparisonDay, ProductMetric } from "../integration/product-performance-analytics";

/** Bars share units on the left; the ratio uses the explicitly labelled right axis. */
function MixedChart({ days, year, title, bars, ratio, unit }: { days: ProductComparisonDay[]; year: "current" | "previous"; title: string; bars: { key: ProductMetric; label: string; color: string }[]; ratio: { key: ProductMetric; label: string }; unit: string }) {
  const values = days.flatMap((day) => bars.map((item) => day[year]?.[item.key])).filter((value): value is number => value != null);
  const ratios = days.map((day) => day[year]?.[ratio.key]).filter((value): value is number => value != null);
  const max = Math.max(1, ...values), ratioMax = Math.max(ratio.key === "roas" ? 1 : 0.01, ...ratios);
  const span = 560 / Math.max(1, days.length), width = Math.max(1, Math.min(16, span / 3));
  const x = (i: number) => 60 + span * (i + 0.5);
  const y = (v: number) => 195 - v / max * 140, ry = (v: number) => 195 - v / ratioMax * 140;
  const ratioText = (value: number) => ratio.key === "roas" ? value.toFixed(2) : `${(value * 100).toFixed(1)}%`;
  return <section className="panel product-mixed-chart"><h3>{title}</h3><div className="product-mixed-legend">{bars.map((bar) => <span key={bar.key}><i style={{ background: bar.color }} />{bar.label}</span>)}<span><i className="product-ratio-legend" />{ratio.label}（右轴）</span></div>
    {!values.length && !ratios.length ? <p className="analytics-note">该年份当前范围尚无图表数据。</p> : <svg viewBox="0 0 700 240" role="img" aria-label={`${title}，${year === "current" ? 2026 : 2025}每日数据`}><title>{title}：左轴{unit}，右轴{ratio.label}；缺失不补零。</title>
      <text x="5" y="26">{unit}</text><text x="620" y="26">{ratio.label}</text>
      {[0, 0.5, 1].map((f) => <g key={f}><line x1="60" x2="620" y1={y(max * f)} y2={y(max * f)} stroke="#dce5ee" /><text x="5" y={y(max * f) + 4}>{unit === "USD" ? `$${(max * f).toFixed(0)}` : Math.round(max * f).toLocaleString()}</text><text x="626" y={y(max * f) + 4}>{ratioText(ratioMax * f)}</text></g>)}
      {days.map((day, i) => <g key={day.date}>{bars.map((bar, b) => { const v = day[year]?.[bar.key]; return v == null ? null : <rect key={bar.key} x={x(i) + (b - 1) * width} y={y(v)} width={width - 0.4} height={Math.max(0, 195 - y(v))} fill={bar.color}><title>{day.date.slice(5)} {bar.label} {v}</title></rect>; })}</g>)}
      {days.map((day, i) => { const v = day[year]?.[ratio.key], prior = days[i - 1]?.[year]?.[ratio.key]; return v == null ? null : <g key={day.date}>{prior != null ? <line x1={x(i - 1)} x2={x(i)} y1={ry(prior)} y2={ry(v)} stroke="#d77831" strokeWidth="2" /> : null}<circle cx={x(i)} cy={ry(v)} r="3" fill="#d77831"><title>{day.date.slice(5)} {ratio.label} {ratioText(v)}</title></circle></g>; })}
      {days.map((day, i) => i % Math.max(1, Math.ceil(days.length / 6)) === 0 || i === days.length - 1 ? <text key={day.date} x={x(i)} y="226" textAnchor="middle">{day.date.slice(5)}</text> : null)}
    </svg>}
  </section>;
}
export function ProductAdvertisingCharts({ days, year, efficiency }: { days: ProductComparisonDay[]; year: "current" | "previous"; efficiency: "acos" | "roas" }) {
  return <div className="product-ad-chart-grid">
    <MixedChart title="广告效果" days={days} year={year} bars={[{ key: "spend", label: "广告花费", color: "#3689d4" }, { key: "adSales", label: "广告销售额", color: "#76ae66" }]} ratio={{ key: efficiency, label: efficiency.toUpperCase() }} unit="USD" />
    <MixedChart title="曝光点击" days={days} year={year} bars={[{ key: "impressions", label: "曝光", color: "#3689d4" }, { key: "clicks", label: "点击", color: "#76ae66" }]} ratio={{ key: "ctr", label: "CTR" }} unit="次数" />
  </div>;
}
