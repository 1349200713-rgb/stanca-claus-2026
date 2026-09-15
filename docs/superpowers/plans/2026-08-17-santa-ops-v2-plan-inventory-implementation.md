# Santa Ops V2 计划与库存中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有本地经营驾驶舱中增加简化的计划与库存页面，支持2900–3100件日计划、库存报告、在途维护和库存风险联动。

**Architecture:** 保留现有经营驾驶舱和IndexedDB数据层，新增计划/库存领域模块与独立页面状态。计划、库存和在途分别保存，风险使用纯函数计算；首页通过统一的计划库存摘要接口读取最新生效数据，不直接访问编辑表单状态。

**Tech Stack:** TypeScript、React、Vinext/Vite、Vitest、Testing Library、Recharts、SheetJS `xlsx`、IndexedDB。

## Global Constraints

- 第一版经营驾驶舱布局、四组折线图、业务/广告导入、筛选和手工行动功能保持不变。
- 第二版只新增“计划与库存”页面和必要的首页状态信息。
- 计划总量2900–3100件（含边界）可以保存；2899和3101必须禁止保存。
- L、XL、2XL、3XL数量可以灵活调整，不强制保持520/1600/550/330。
- 缺失库存、在途、到仓日期或销量不得转换为零。
- 近7日平均销量必须有7个自然日数据，否则风险显示“数据不足”。
- 黄色表示积压率>15%且<=25%；红色表示积压率>25%或到仓日晚于预计售罄日；数据不足使用中性样式。
- 所有数据保存在浏览器IndexedDB，不新增云端、账号、多人协作或自动后台抓取。
- 库存导入保留原始文件、原始行、标准化记录和导入日志。

## File Structure

- `src/domain/planning.ts`：日计划、计划修改记录、库存快照和在途类型。
- `src/calc/daily-plan.ts`：从周权重生成日计划、总量和范围验证。
- `src/calc/inventory-risk.ts`：库存、售罄、积压和到仓风险纯函数。
- `src/import/inventory-parser.ts`：库存报告字段识别和标准化。
- `src/storage/db.ts`：新增计划、库存、在途存储和原始导入证据。
- `src/integration/plan-inventory.ts`：组装当前计划、最新库存、近7日销售与风险摘要。
- `src/components/PlanInventoryPage.tsx`：第二版页面组合。
- `src/components/DailyPlanEditor.tsx`：日计划编辑表。
- `src/components/InventoryEditor.tsx`：库存和在途编辑区。
- `src/components/InventoryRiskPanel.tsx`：四尺码风险展示。
- `app/page.tsx`：增加本地页面导航和首页摘要，不改原图表布局。
- `tests/v2/`：第二版领域、组件和完整流程测试。

---

### Task 1: 计划与库存领域模型和持久化

**Files:**
- Create: `santa-ops/src/domain/planning.ts`
- Modify: `santa-ops/src/storage/db.ts`
- Create: `santa-ops/tests/v2/planning-storage.test.ts`

**Interfaces:**
- Produces: `DailyPlanRow`, `ActivePlan`, `PlanChange`, `InventorySnapshot`, `InboundEntry`.
- Produces storage methods: `getActivePlan()`, `saveActivePlan(plan, change)`, `listInventorySnapshots()`, `replaceInventorySnapshots(rows)`, `getInboundEntries()`, `saveInboundEntry(entry)`.

- [ ] **Step 1: 写失败测试**

```ts
test("persists active plan and the latest change metadata", async () => {
  await db.saveActivePlan(
    { id: "plan-2026", rows: [{ date: "2026-11-01", size: "XL", units: 50 }], totalUnits: 3000, updatedAt: "2026-08-17T00:00:00.000Z" },
    { id: "change-1", changedAt: "2026-08-17T00:00:00.000Z", reason: "调整旺季节奏", beforeTotal: 3010, afterTotal: 3000 },
  );
  expect((await db.getActivePlan())?.totalUnits).toBe(3000);
  expect((await db.list("planChanges"))[0].reason).toBe("调整旺季节奏");
});

test("keeps blank inbound and inventory values unknown", async () => {
  await db.saveInboundEntry({ size: "L", expectedArrivalDate: null, units: null, updatedAt: "2026-08-17T00:00:00.000Z" });
  expect((await db.getInboundEntries())[0].units).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/v2/planning-storage.test.ts`
Expected: FAIL because types/stores/methods do not exist.

- [ ] **Step 3: 实现类型和IndexedDB升级**

```ts
export interface DailyPlanRow { date: string; size: SizeCode; units: number; }
export interface ActivePlan { id: "plan-2026"; rows: DailyPlanRow[]; totalUnits: number; updatedAt: string; }
export interface PlanChange { id: string; changedAt: string; reason: string; beforeTotal: number; afterTotal: number; }
export interface InventorySnapshot { key: string; date: string; size: SizeCode; fbaAvailable: number; reserved: number | null; unfulfillable: number | null; sourceImportKey: string; }
export interface InboundEntry { size: SizeCode; units: number | null; expectedArrivalDate: string | null; updatedAt: string; }
```

Add IndexedDB stores `activePlan`, `planChanges`, `inventory`, and `inbound`; migration must preserve all V1 stores and data.

- [ ] **Step 4: 运行测试和类型检查**

Run: `pnpm vitest run tests/v2/planning-storage.test.ts && pnpm typecheck`
Expected: PASS.

### Task 2: 日度计划生成、校验和编辑器

**Files:**
- Create: `santa-ops/src/calc/daily-plan.ts`
- Create: `santa-ops/src/components/DailyPlanEditor.tsx`
- Create: `santa-ops/tests/v2/daily-plan.test.ts`
- Create: `santa-ops/tests/v2/DailyPlanEditor.test.tsx`

**Interfaces:**
- Consumes: existing weekly plan weights and optional current `ActivePlan`.
- Produces: `generateDailyPlan(weeklyRows): DailyPlanRow[]`, `summarizePlan(rows): PlanSummary`, `validatePlan(rows): PlanValidation`.
- `DailyPlanEditor` emits `onSave(rows, reason)` only for valid plans.

- [ ] **Step 1: 写边界和拆分失败测试**

```ts
test.each([[2900, true], [3100, true], [2899, false], [3101, false]])("validates %i units", (total, valid) => {
  expect(validatePlan([{ date: "2026-11-01", size: "XL", units: total }]).valid).toBe(valid);
});

test("splits weekly units into integer daily rows without changing the weekly total", () => {
  const rows = generateDailyPlan([{ weekStart: "2026-11-02", size: "L", units: 70 }]);
  expect(rows).toHaveLength(7);
  expect(rows.reduce((sum, row) => sum + row.units, 0)).toBe(70);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run tests/v2/daily-plan.test.ts tests/v2/DailyPlanEditor.test.tsx`
Expected: FAIL because generator/editor do not exist.

- [ ] **Step 3: 实现纯函数**

`generateDailyPlan` divides each weekly integer by seven, assigns the remainder one unit at a time from Monday forward, and preserves each weekly size total exactly. `summarizePlan` returns total, variance from 3000, per-size totals and shares. `validatePlan` rejects non-integers, negatives, invalid dates, unknown sizes and totals outside 2900–3100.

- [ ] **Step 4: 实现编辑器**

The editor renders date rows with four numeric inputs, live totals/shares/variance, reason input, green valid state and red invalid state. Save is disabled until rows are valid and reason is nonblank.

- [ ] **Step 5: 运行组件和类型测试**

Run: `pnpm vitest run tests/v2/daily-plan.test.ts tests/v2/DailyPlanEditor.test.tsx && pnpm typecheck`
Expected: PASS including 2900/3100 boundaries and save blocking.

### Task 3: 库存报告解析与在途编辑

**Files:**
- Create: `santa-ops/src/import/inventory-parser.ts`
- Modify: `santa-ops/src/components/ImportPanel.tsx`
- Create: `santa-ops/src/components/InventoryEditor.tsx`
- Create: `santa-ops/tests/v2/inventory-parser.test.ts`
- Create: `santa-ops/tests/v2/InventoryEditor.test.tsx`
- Create: `santa-ops/tests/fixtures/inventory.csv`

**Interfaces:**
- Consumes: CSV/XLSX/XLS bytes and existing size mapping.
- Produces: `parseInventoryReport(input, filename, mapping): InventoryParseResult`.
- `InventoryEditor` consumes latest snapshots/inbound and emits validated inbound saves.

- [ ] **Step 1: 写报告解析失败测试**

```ts
test("maps an Amazon inventory row and preserves optional missingness", () => {
  const result = parseInventoryRows([{ "seller-sku": "A022-XXX-09-0B500", "afn-fulfillable-quantity": "120", "afn-reserved-quantity": "" }], mapping);
  expect(result.records[0]).toMatchObject({ size: "XL", fbaAvailable: 120, reserved: null });
});

test("fatal-errors when SKU/ASIN or fulfillable quantity column is absent", () => {
  expect(parseInventoryRows([{ other: "1" }], mapping).fatal).toBe(true);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run tests/v2/inventory-parser.test.ts tests/v2/InventoryEditor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: 实现库存列识别和重复预览接线**

Recognize common Amazon aliases for seller SKU, ASIN, fulfillable, reserved, unfulfillable and snapshot date. Header content determines report kind before filename. Reuse V1 raw artifact/raw row/import log transaction and old-vs-new duplicate preview; formal records go to `inventory`.

- [ ] **Step 4: 实现在途编辑器**

Four size rows show latest inventory and editable inbound/arrival fields. Reject negative/noninteger inbound and invalid dates. Blank inbound/date stays null.

- [ ] **Step 5: 运行解析、组件和回归测试**

Run: `pnpm vitest run tests/v2/inventory-parser.test.ts tests/v2/InventoryEditor.test.tsx tests/components/ImportPanel.test.tsx && pnpm typecheck`
Expected: PASS.

### Task 4: 库存风险和计划库存摘要

**Files:**
- Create: `santa-ops/src/calc/inventory-risk.ts`
- Create: `santa-ops/src/integration/plan-inventory.ts`
- Create: `santa-ops/tests/v2/inventory-risk.test.ts`
- Create: `santa-ops/tests/v2/plan-inventory-integration.test.ts`

**Interfaces:**
- Produces: `calculateInventoryRisk(input): InventoryRiskResult` and `buildPlanInventorySummary(input): PlanInventorySummary`.

- [ ] **Step 1: 写风险失败测试**

```ts
test("returns insufficient when fewer than seven calendar days are present", () => {
  expect(calculateInventoryRisk({ salesByDate: sixDays, fbaAvailable: 100, reserved: 0, unfulfillable: 0, inbound: 0, arrivalDate: null, remainingPlan: 80 }).status).toBe("insufficient");
});

test.each([[0.16, "attention"], [0.25, "attention"], [0.26, "risk"]])("maps overstock %f", (rate, status) => {
  expect(statusForOverstock(rate)).toBe(status);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run tests/v2/inventory-risk.test.ts tests/v2/plan-inventory-integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: 实现风险纯函数**

Require seven distinct consecutive dates; calculate available inventory only when FBA/reserved/unfulfillable are known, future inventory only when inbound is known, and arrival-delay risk only when arrival date and stockout date are both known. Return explicit inputs/explanation with every result.

- [ ] **Step 4: 实现摘要集成**

For each size, select latest formal inventory snapshot, current inbound, seven-day business sales and remaining active plan. Evaluate all four sizes independently; aggregate status is red if any size red, yellow if none red and any yellow, neutral if any required aggregate data is missing, otherwise green.

- [ ] **Step 5: 运行风险测试与第一版回归**

Run: `pnpm vitest run tests/v2/inventory-risk.test.ts tests/v2/plan-inventory-integration.test.ts tests/calc tests/e2e/daily-ops-flow.test.tsx && pnpm typecheck`
Expected: PASS.

### Task 5: 计划库存页面、首页联动和最终验收

**Files:**
- Create: `santa-ops/src/components/PlanInventoryPage.tsx`
- Create: `santa-ops/src/components/InventoryRiskPanel.tsx`
- Modify: `santa-ops/app/page.tsx`
- Modify: `santa-ops/app/globals.css`
- Modify: `santa-ops/README.md`
- Create: `santa-ops/tests/v2/PlanInventoryPage.test.tsx`
- Create: `santa-ops/tests/v2/v2-flow.test.tsx`

**Interfaces:**
- Consumes Tasks 1–4 storage/calculation/integration interfaces.
- Produces local two-page navigation and dashboard linkage.

- [ ] **Step 1: 写页面和完整流程失败测试**

Test navigation between `经营驾驶舱` and `计划与库存`, saving a 2900 plan, rejecting 2899, reloading persisted plan, importing inventory, saving inbound, showing insufficient data, and updating dashboard plan series without changing the four V1 line-chart headings.

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run tests/v2/PlanInventoryPage.test.tsx tests/v2/v2-flow.test.tsx`
Expected: FAIL.

- [ ] **Step 3: 实现页面组合和导航**

Use local React navigation state rather than adding a router. The dashboard remains the default view. `PlanInventoryPage` loads/initializes the plan, saves validated changes, shows inventory dates, renders four size risks and returns to dashboard.

- [ ] **Step 4: 实现首页摘要**

Add plan updated time, inventory snapshot date, incomplete-data notice and link to plan/inventory. Feed active plan rows into the existing plan chart/completion calculations. Do not reorder or replace V1 KPI/cards/charts.

- [ ] **Step 5: 更新中文使用说明**

Document daily plan editing, 2900–3100 range, inventory report import, inbound entry, risk definitions, local storage and unchanged V1 behavior.

- [ ] **Step 6: 运行完整验证**

Run: `pnpm vitest run --exclude tests/rendered-html.test.mjs`, `pnpm typecheck`, `pnpm lint`, `pnpm plan:check`, and `pnpm test`.
Expected: all application tests pass; typecheck/lint/plan check exit 0; production build and 2 Node renderer tests pass.

- [ ] **Step 7: 本地页面验证**

Start the existing local server and verify: both pages load; desktop and narrow widths have no horizontal overflow; the four original line charts remain; plan boundaries and insufficient-data states are visible; no console/framework errors.
