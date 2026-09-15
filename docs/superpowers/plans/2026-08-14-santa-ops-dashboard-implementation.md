# 2026 圣诞服每日经营驾驶舱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地运行的 2026 圣诞服经营网站，导入业务和广告报告后自动对比计划与实际，展示销售、利润、库存、广告和积压风险。

**Architecture:** 使用 React 单页应用，计划基准以工作簿提取后的静态 JSON 初始化，用户导入的数据标准化后保存到浏览器 IndexedDB。纯函数模块负责指标和风险计算，页面组件只负责筛选、展示和导入交互，图表使用 Recharts。

**Tech Stack:** TypeScript、React、Vite/Vinext Sites starter、Vitest、Testing Library、Recharts、SheetJS `xlsx`、IndexedDB。

## Global Constraints

- 首期本地运行，不包含登录、云数据库、多人协作或自动登录亚马逊。
- 不修改源工作簿；工作簿仅作为计划、成本、SKU/ASIN 映射和历史资料来源。
- 计划总量必须为 3000 件，覆盖 L、XL、2XL、3XL。
- 保留第一版首页布局和折线图；销售额/均价、毛利润/毛利率、广告花费/ACOS 均使用折线图。
- 绿色表示完成/达标，红色表示未完成/风险，黄色仅表示关注；状态必须同时显示文字。
- 缺失值不得当作零；重复导入不得无提示重复累计。
- 原始导入记录、清洗记录和计算结果分离，保证可追溯。

## File Structure

- `santa-ops/app/page.tsx`：页面组合、筛选状态和导入入口。
- `santa-ops/app/globals.css`：已确认的驾驶舱布局、状态色和响应式样式。
- `santa-ops/app/layout.tsx`：站点标题和描述。
- `santa-ops/src/domain/types.ts`：计划、经营记录、广告记录、指标和风险类型。
- `santa-ops/src/data/plan-2026.json`：从工作簿提取的计划、成本、目标和 SKU/ASIN 映射。
- `santa-ops/src/data/plan.ts`：加载并校验计划基准。
- `santa-ops/src/import/report-parser.ts`：业务/广告报告识别、标准化和校验。
- `santa-ops/src/import/dedupe.ts`：业务主键和重复导入决策。
- `santa-ops/src/calc/metrics.ts`：日、周、累计和尺码指标。
- `santa-ops/src/calc/risk.ts`：红黄绿状态和异常清单。
- `santa-ops/src/storage/db.ts`：IndexedDB 读写、替换和清空。
- `santa-ops/src/components/`：KPI、折线图、库存风险、导入面板、行动清单。
- `santa-ops/tests/`：单元、组件和完整流程测试。

---

### Task 1: 建立应用与领域模型

**Files:**
- Create: `santa-ops/` through the Sites initializer
- Create: `santa-ops/src/domain/types.ts`
- Create: `santa-ops/tests/domain/types.test.ts`
- Modify: `santa-ops/package.json`

**Interfaces:**
- Produces: `SizeCode`, `PlanRow`, `BusinessRecord`, `AdRecord`, `ManualRecord`, `MetricSnapshot`, `RiskSignal`.

- [ ] **Step 1: 初始化站点并加入测试、图表和报表依赖**

Run the Sites initializer once against `santa-ops`, preserve its package manager, then add `vitest`, `@testing-library/react`, `jsdom`, `recharts`, and `xlsx` with the same package manager.

- [ ] **Step 2: 写领域类型编译测试**

```ts
import { expectTypeOf, test } from "vitest";
import type { BusinessRecord, PlanRow, SizeCode } from "../src/domain/types";

test("core records keep date, size and numeric values typed", () => {
  expectTypeOf<SizeCode>().toEqualTypeOf<"L" | "XL" | "2XL" | "3XL">();
  expectTypeOf<BusinessRecord["date"]>().toEqualTypeOf<string>();
  expectTypeOf<BusinessRecord["units"]>().toEqualTypeOf<number>();
  expectTypeOf<PlanRow["plannedUnits"]>().toEqualTypeOf<number>();
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm vitest run tests/domain/types.test.ts`
Expected: FAIL because `src/domain/types.ts` does not exist.

- [ ] **Step 4: 实现领域类型**

```ts
export type SizeCode = "L" | "XL" | "2XL" | "3XL";
export type Status = "complete" | "attention" | "risk";
export interface PlanRow { date: string; size: SizeCode; plannedUnits: number; targetPrice: number; targetMargin: number; targetAcos: number; unitProductCost: number; unitInboundCost: number; unitFbaFee: number; commissionRate: number; }
export interface BusinessRecord { key: string; date: string; asin: string; sku: string; size: SizeCode; units: number; sales: number; refunds: number; fbaAvailable?: number; reserved?: number; unfulfillable?: number; }
export interface AdRecord { key: string; date: string; campaign: string; spend: number; adSales: number; adOrders: number; clicks?: number; impressions?: number; }
export interface ManualRecord { date: string; size: SizeCode; inbound: number; inventoryAdjustment: number; event?: string; issue?: string; action?: string; actionComplete: boolean; }
export interface MetricSnapshot { plannedUnits: number; actualUnits: number; unitVariance: number; completionRate: number | null; sales: number; plannedSales: number; salesVariance: number; averagePrice: number | null; grossProfit: number; grossMargin: number | null; adSpend: number; adSales: number; acos: number | null; availableInventory: number | null; projectedEndingInventory: number | null; overstockRate: number | null; daysToStockout: number | null; }
export interface RiskSignal { id: string; label: string; status: Status; detail: string; }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run tests/domain/types.test.ts`
Expected: PASS.

### Task 2: 提取并校验 2026 计划基准

**Files:**
- Create: `work/dashboard_analysis/extract_plan.mjs`
- Create: `santa-ops/src/data/plan-2026.json`
- Create: `santa-ops/src/data/plan.ts`
- Create: `santa-ops/tests/data/plan.test.ts`

**Interfaces:**
- Consumes: source workbook sheets `目标&假设`, `利润规划表`, `2026采购-fba到货周期`, `listing`.
- Produces: `loadPlan(): PlanModel` and `PlanModel` with `rows`, `skuMap`, `thresholds`, `seasonEnd`.

- [ ] **Step 1: 写计划完整性测试**

```ts
import { describe, expect, test } from "vitest";
import { loadPlan } from "../../src/data/plan";

describe("2026 plan", () => {
  test("contains exactly 3000 units across four sizes", () => {
    const plan = loadPlan();
    expect(plan.sizeTotals).toEqual({ L: 520, XL: 1600, "2XL": 550, "3XL": 330 });
    expect(Object.values(plan.sizeTotals).reduce((a, b) => a + b, 0)).toBe(3000);
  });
  test("maps every primary ASIN and SKU to a size", () => {
    const plan = loadPlan();
    expect(Object.values(plan.skuMap)).not.toContain(undefined);
    expect(new Set(Object.values(plan.skuMap))).toEqual(new Set(["L", "XL", "2XL", "3XL"]));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/data/plan.test.ts`
Expected: FAIL because plan data and loader do not exist.

- [ ] **Step 3: 使用 artifact-tool 只读提取工作簿计划数据**

The script must import the source workbook, inspect the four named sheets, normalize Excel dates to ISO dates, and write JSON containing the verified size totals `{L:520, XL:1600, 2XL:550, 3XL:330}`, ASIN/SKU mapping, cost assumptions, daily/weekly plan rows, and target thresholds. It must throw when the total is not 3000 or a primary ASIN/SKU lacks a size.

- [ ] **Step 4: 实现计划加载与运行时校验**

```ts
import raw from "./plan-2026.json";
import type { PlanRow, SizeCode } from "../domain/types";

export interface PlanModel { rows: PlanRow[]; sizeTotals: Record<SizeCode, number>; skuMap: Record<string, SizeCode>; thresholds: { completionRed: number; overstockYellow: number; overstockRed: number }; seasonEnd: string; }
export function loadPlan(): PlanModel {
  const plan = raw as PlanModel;
  const total = Object.values(plan.sizeTotals).reduce((sum, value) => sum + value, 0);
  if (total !== 3000) throw new Error(`计划总量应为3000，当前为${total}`);
  for (const size of ["L", "XL", "2XL", "3XL"] as const) if (!plan.sizeTotals[size]) throw new Error(`缺少${size}计划`);
  return plan;
}
```

- [ ] **Step 5: 运行提取脚本和测试**

Run: bundled Node runtime with `work/dashboard_analysis/extract_plan.mjs`, then `pnpm vitest run tests/data/plan.test.ts`.
Expected: JSON generated and tests PASS.

### Task 3: 实现报告识别、标准化与去重

**Files:**
- Create: `santa-ops/src/import/report-parser.ts`
- Create: `santa-ops/src/import/dedupe.ts`
- Create: `santa-ops/tests/import/report-parser.test.ts`
- Create: `santa-ops/tests/fixtures/business.csv`
- Create: `santa-ops/tests/fixtures/ads.csv`

**Interfaces:**
- Consumes: `ArrayBuffer`, filename, `PlanModel.skuMap`.
- Produces: `parseReport(input, filename, skuMap): ParseResult`; `findDuplicates(existing, incoming): DuplicateResult`.

- [ ] **Step 1: 写解析和异常测试**

```ts
import { describe, expect, test } from "vitest";
import { parseRows } from "../../src/import/report-parser";

const map = { "A022-XXX-09-0B500": "XL", B0CFPR34MH: "XL" } as const;
describe("report parser", () => {
  test("normalizes a business row", () => {
    const result = parseRows([{ Date: "2026-11-30", SKU: "A022-XXX-09-0B500", ASIN: "B0CFPR34MH", Units: "12", Sales: "$506.16" }], "business", map);
    expect(result.records[0]).toMatchObject({ date: "2026-11-30", size: "XL", units: 12, sales: 506.16 });
  });
  test("keeps unknown sku out of formal totals", () => {
    const result = parseRows([{ Date: "2026-11-30", SKU: "UNKNOWN", Units: "2", Sales: "80" }], "business", map);
    expect(result.records).toHaveLength(0);
    expect(result.issues[0].code).toBe("UNMAPPED_SKU");
  });
  test("rejects missing required columns", () => {
    const result = parseRows([{ SKU: "A022-XXX-09-0B500" }], "business", map);
    expect(result.fatal).toBe(true);
    expect(result.issues.map(i => i.field)).toContain("Date");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/import/report-parser.test.ts`
Expected: FAIL because parser does not exist.

- [ ] **Step 3: 实现列别名、金额、日期、SKU 映射和问题记录**

`parseRows` must accept common English and Chinese aliases, return `{records, issues, fatal}`, create deterministic keys from date plus business identifiers, and never coerce blank numeric cells to zero unless the source explicitly contains `0`.

- [ ] **Step 4: 实现去重决策**

```ts
export function findDuplicates<T extends { key: string }>(existing: T[], incoming: T[]) {
  const oldKeys = new Set(existing.map(row => row.key));
  return { unique: incoming.filter(row => !oldKeys.has(row.key)), duplicates: incoming.filter(row => oldKeys.has(row.key)) };
}
```

- [ ] **Step 5: 运行解析测试**

Run: `pnpm vitest run tests/import/report-parser.test.ts`
Expected: PASS for normalized, missing-column, unmapped-SKU and duplicate cases.

### Task 4: 实现经营指标与风险计算

**Files:**
- Create: `santa-ops/src/calc/metrics.ts`
- Create: `santa-ops/src/calc/risk.ts`
- Create: `santa-ops/tests/calc/metrics.test.ts`
- Create: `santa-ops/tests/calc/risk.test.ts`

**Interfaces:**
- Consumes: plan rows, business records, ad records, manual records, date range and optional size.
- Produces: `calculateMetrics(input): MetricSnapshot`; `evaluateRisks(metrics, targets, trend): RiskSignal[]`.

- [ ] **Step 1: 写指标口径测试**

```ts
import { expect, test } from "vitest";
import { calculateMetrics } from "../../src/calc/metrics";

test("calculates plan variance, price, profit and ACOS", () => {
  const result = calculateMetrics({ plannedUnits: 100, targetPrice: 40, units: 80, sales: 3440, refunds: 100, productCost: 1200, inboundCost: 200, fbaFee: 640, commission: 516, adSpend: 300, adSales: 1000, discount: 0 });
  expect(result.completionRate).toBeCloseTo(0.8);
  expect(result.unitVariance).toBe(-20);
  expect(result.averagePrice).toBeCloseTo(43);
  expect(result.acos).toBeCloseTo(0.3);
  expect(result.grossProfit).toBe(484);
  expect(result.grossMargin).toBeCloseTo(484 / 3440);
});

test("returns null for undefined ratios", () => {
  const result = calculateMetrics({ plannedUnits: 0, targetPrice: 40, units: 0, sales: 0, refunds: 0, productCost: 0, inboundCost: 0, fbaFee: 0, commission: 0, adSpend: 10, adSales: 0, discount: 0 });
  expect(result.averagePrice).toBeNull();
  expect(result.grossMargin).toBeNull();
  expect(result.acos).toBeNull();
});
```

- [ ] **Step 2: 写风险阈值测试并确认失败**

Test completion below 90% as red, overstock above 15% as yellow, above 25% as red, target-exceeding ACOS as red, and three consecutive deteriorating days as an anomaly. Run both test files; expect module-not-found failures.

- [ ] **Step 3: 实现指标纯函数**

Implement the exact formulas from the design spec, returning `null` for undefined ratios and keeping currency numbers unrounded internally.

- [ ] **Step 4: 实现风险纯函数**

Use `complete`, `attention`, and `risk` statuses. Evaluate size-level risks independently; a project aggregate must not hide a size-level signal.

- [ ] **Step 5: 运行计算测试**

Run: `pnpm vitest run tests/calc`
Expected: all metric, null handling, threshold and trend tests PASS.

### Task 5: 实现本地存储与导入面板

**Files:**
- Create: `santa-ops/src/storage/db.ts`
- Create: `santa-ops/src/components/ImportPanel.tsx`
- Create: `santa-ops/tests/storage/db.test.ts`
- Create: `santa-ops/tests/components/ImportPanel.test.tsx`

**Interfaces:**
- Consumes: parsed business/ad/manual records and duplicate decisions.
- Produces: `opsDb.list`, `opsDb.insert`, `opsDb.replace`, `opsDb.clear`; `ImportPanel` callbacks after successful import.

- [ ] **Step 1: 写存储和导入交互测试**

Test that records survive a reload, duplicate rows open a replace/ignore decision, fatal column errors prevent saving, and unmapped SKUs appear in a visible issue list.

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/storage tests/components/ImportPanel.test.tsx`
Expected: FAIL because storage and component do not exist.

- [ ] **Step 3: 实现 IndexedDB 存储**

Create stores `business`, `ads`, `manual`, `imports`, and `mappings`. Each import log includes filename, importedAt, rowCount, issueCount and action (`insert` or `replace`).

- [ ] **Step 4: 实现导入面板**

The panel accepts `.csv`, `.xlsx`, and `.xls`, shows report type, valid rows, issue rows and duplicates before saving, and offers explicit “忽略重复” and “替换旧记录” actions. Fatal errors disable the save button.

- [ ] **Step 5: 运行存储和组件测试**

Run: `pnpm vitest run tests/storage tests/components/ImportPanel.test.tsx`
Expected: PASS.

### Task 6: 实现已确认的驾驶舱界面

**Files:**
- Modify: `santa-ops/app/page.tsx`
- Modify: `santa-ops/app/globals.css`
- Modify: `santa-ops/app/layout.tsx`
- Create: `santa-ops/src/components/KpiCard.tsx`
- Create: `santa-ops/src/components/TrendChart.tsx`
- Create: `santa-ops/src/components/InventoryRisk.tsx`
- Create: `santa-ops/src/components/ActionList.tsx`
- Create: `santa-ops/tests/components/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `MetricSnapshot[]`, `RiskSignal[]`, import callbacks, date/size filters.
- Produces: responsive dashboard with KPI cards, three retained line-chart groups, inventory risks and action list.

- [ ] **Step 1: 写首页内容和颜色语义测试**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Dashboard from "../../app/page";

test("renders the agreed dashboard sections", () => {
  render(<Dashboard />);
  expect(screen.getByText("销量完成率")).toBeInTheDocument();
  expect(screen.getByText("计划销量 vs 实际销量")).toBeInTheDocument();
  expect(screen.getByText("销售额 / 均价走势")).toBeInTheDocument();
  expect(screen.getByText("毛利润 / 毛利率")).toBeInTheDocument();
  expect(screen.getByText("广告花费 / ACOS")).toBeInTheDocument();
  expect(screen.getByText("库存与积压风险")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/components/Dashboard.test.tsx`
Expected: FAIL because the starter page lacks dashboard content.

- [ ] **Step 3: 实现首页组合与筛选**

Keep the first approved layout: top filters/import, five KPI cards, plan-vs-actual main chart, inventory risk panel, three trend panels, and action list. Filters include date range, daily/weekly/cumulative mode, and all/L/XL/2XL/3XL.

- [ ] **Step 4: 实现折线图和事件标记**

`TrendChart` must use Recharts, accept multiple series with separate currency/percentage axes, preserve null gaps, and render promotion/Deal/price-change events as labeled reference lines.

- [ ] **Step 5: 实现颜色与响应式样式**

Use semantic classes: `.status-complete` green, `.status-risk` red, `.status-attention` yellow. Preserve readable labels at desktop widths and stack panels below 900px without horizontal scrolling.

- [ ] **Step 6: 运行组件测试和生产构建**

Run: `pnpm vitest run tests/components` and `pnpm build`.
Expected: all tests PASS and build exits 0.

### Task 7: 完整流程验收与交付

**Files:**
- Create: `santa-ops/tests/e2e/daily-ops-flow.test.tsx`
- Create: `santa-ops/public/sample-business-report.csv`
- Create: `santa-ops/public/sample-ad-report.csv`
- Create: `santa-ops/README.md`

**Interfaces:**
- Consumes: full application.
- Produces: verified local dashboard, sample import files and Chinese update instructions.

- [ ] **Step 1: 写完整流程测试**

Test import of sample business and ad files, duplicate replacement, XL filter, cumulative view, red completion status, green completed action, retained line-chart headings, and refresh persistence.

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/e2e/daily-ops-flow.test.tsx`
Expected: FAIL until all integration wiring is complete.

- [ ] **Step 3: 完成页面与数据层接线**

Wire startup loading, import commits, filter recalculation, risk evaluation, import freshness and data completeness into `app/page.tsx`. Do not add cloud or account features.

- [ ] **Step 4: 编写中文使用说明和样例报告**

Document first startup, daily import, duplicate handling, manual entry, filter usage, data reset and source workbook location. Sample reports must contain L/XL/2XL/3XL rows and produce at least one green, one red and one yellow status.

- [ ] **Step 5: 运行完整验证**

Run: `pnpm vitest run`, `pnpm build`, then start the local development server and verify the page loads without console errors. Check totals: plan 3000; sizes 520/1600/550/330; sample business/advertising sums reconcile; no horizontal overflow at desktop width.

- [ ] **Step 6: 交付本地网站**

Keep the site local as requested. Provide the running local URL and the user-facing `santa-ops/README.md`; do not deploy or publish externally.
