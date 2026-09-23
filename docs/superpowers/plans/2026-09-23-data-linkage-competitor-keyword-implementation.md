# Santa Ops Data Linkage, Competitor, and Keyword Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one cloud-backed operating dataset that links sales, inventory, promotion, traffic, competitor, keyword, and daily-action records across computers.

**Architecture:** Keep parsing and calculations as pure TypeScript modules, add a same-origin server repository/API backed by SQLite on the Aliyun Node host, and put a typed `opsRepository` boundary between React pages and persistence. Migrate IndexedDB through an explicit preview/confirm flow, then add competitor and keyword pages and derive review alerts from the common linked dataset.

**Tech Stack:** TypeScript 5.9, React 19, Vinext/Next App Router, Drizzle ORM, SQLite, XLSX, Recharts, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-data-linkage-competitor-keyword-design.md`

## Global Constraints

- Preserve the existing dashboard layout and existing line charts; extend them without replacing the prior interface.
- Treat missing data as `null`/unknown and never silently convert it to zero.
- Use ISO `YYYY-MM-DD`, marketplace `US`, and normalized ASIN/SKU/keyword identifiers.
- Server data is authoritative; IndexedDB remains read-only migration evidence until the user explicitly clears it.
- Every import keeps filename, upload time, raw rows, normalized rows, errors, and insert/update/skip counts.
- All writes are authenticated, transactional, audited, and safe to retry.
- Existing CSV/XLSX/XLS import behavior and the 2900–3100 plan guard must continue to pass.

## Review Focus

- A blank metric must remain missing rather than becoming `0`; add metric and rendering tests in Tasks 1 and 6.
- Rank `0`, blank rank, and “未收录” must normalize to `null + notIndexed`; add parser tests in Task 5.
- A repeated upload for the same composite key must update once and preserve both import batches; add repository/API tests in Tasks 2, 4, and 5.
- An IndexedDB migration interrupted halfway must not mark the migration complete or delete local data; add migration tests in Task 3.
- Future dates and missing source dates must not increase operating anomaly counts; add alert-engine tests in Task 7.

---

### Task 1: Define the linked domain and pure calculations

**Files:**
- Create: `src/domain/linkage.ts`
- Create: `src/calc/funnel-metrics.ts`
- Create: `src/integration/linked-dataset.ts`
- Test: `tests/linkage/funnel-metrics.test.ts`
- Test: `tests/linkage/linked-dataset.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/planning.ts`

**Interfaces:**
- Produces: `ProductIdentity`, `TrafficRecord`, `CompetitorSnapshot`, `KeywordRankSnapshot`, `LinkedFilter`, `FunnelMetrics`.
- Produces: `calculateFunnelMetrics(input): FunnelMetrics` and `buildLinkedDataset(input): LinkedDay[]`.
- Consumes: existing `BusinessRecord`, `AdRecord`, `PromotionPlanOverride`, and `DailyOperationRecord`.

- [ ] **Step 1: Write failing metric tests**

```ts
expect(calculateFunnelMetrics({ impressions: 1000, clicks: 50, sessions: 40, adOrders: 4, totalOrders: 6, spend: 100, adSales: 400, totalSales: 600 })).toMatchObject({
  ctr: 0.05, cpc: 2, cvr: 0.15, adCvr: 0.08, acos: 0.25, tacos: 1 / 6, organicOrders: 2,
});
expect(calculateFunnelMetrics({ impressions: null, clicks: 0, sessions: null, adOrders: 0, totalOrders: null, spend: 0, adSales: null, totalSales: null }).ctr).toBeNull();
expect(calculateFunnelMetrics({ impressions: 0, clicks: 0, sessions: 0, adOrders: 0, totalOrders: 0, spend: 0, adSales: 0, totalSales: 0 }).ctr).toBe(0);
```

- [ ] **Step 2: Run the focused tests and confirm missing modules fail**

Run: `pnpm vitest run tests/linkage/funnel-metrics.test.ts tests/linkage/linked-dataset.test.ts`

Expected: FAIL because the linkage modules do not exist.

- [ ] **Step 3: Implement exact domain contracts and guarded division**

```ts
export interface LinkedFilter { startDate: string; endDate: string; marketplace: "US"; asin?: string; sku?: string; size?: SizeCode; keywordId?: string; competitorAsin?: string }
export interface FunnelMetrics { ctr: number | null; cpc: number | null; cvr: number | null; adCvr: number | null; acos: number | null; tacos: number | null; organicOrders: number | null; conflicts: string[] }
const ratio = (n: number | null, d: number | null) => n === null || d === null ? null : d === 0 ? (n === 0 ? 0 : null) : n / d;
```

`buildLinkedDataset` must join only normalized matching dimensions; it must expose unmapped ad rows separately instead of assigning them to every ASIN.

- [ ] **Step 4: Run Task 1 tests and typecheck**

Run: `pnpm vitest run tests/linkage/funnel-metrics.test.ts tests/linkage/linked-dataset.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/domain src/calc/funnel-metrics.ts src/integration/linked-dataset.ts tests/linkage
git commit -m "feat: define linked operating dataset"
```

### Task 2: Add authenticated cloud repository, SQLite schema, and resource API

**Files:**
- Modify: `db/schema.ts`
- Create: `db/ops-repository.ts`
- Create: `db/ops-sqlite.ts`
- Create: `src/server/ops-auth.ts`
- Create: `src/server/ops-validation.ts`
- Create: `app/api/ops/[resource]/route.ts`
- Create: `app/api/ops/imports/route.ts`
- Create: `tests/server/ops-repository.test.ts`
- Create: `tests/server/ops-api.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: `OpsRepository.list(resource, filter)`, `upsertBatch(resource, records, importBatch)`, `delete(resource, id)`, and `health()`.
- Produces: JSON endpoints `GET/POST/DELETE /api/ops/:resource` and `POST /api/ops/imports`.
- Consumes: Task 1 domain types.

- [ ] **Step 1: Write repository transaction and idempotency tests**

```ts
await repo.upsertBatch("competitors", [snapshot], firstImport);
await repo.upsertBatch("competitors", [{ ...snapshot, price: 55.99 }], secondImport);
expect(await repo.list("competitors", filter)).toHaveLength(1);
expect((await repo.list("competitors", filter))[0].price).toBe(55.99);
expect(await repo.listImports()).toHaveLength(2);
await expect(repo.upsertBatch("keywords", [invalid], failedImport)).rejects.toThrow();
expect(await repo.listImports()).toHaveLength(2);
```

- [ ] **Step 2: Run server tests and confirm failure**

Run: `pnpm vitest run tests/server/ops-repository.test.ts tests/server/ops-api.test.ts`

Expected: FAIL because the repository and routes do not exist.

- [ ] **Step 3: Define normalized tables and indexes**

Create tables for `products`, `business_records`, `ad_records`, `traffic_records`, `inventory_snapshots`, `inbound_entries`, `promotion_plans`, `competitor_snapshots`, `keywords`, `keyword_rank_snapshots`, `daily_operations`, `alerts`, `import_batches`, `import_rows`, and `audit_events`.

Every dated fact table includes `marketplace`, ISO `date`, `createdAt`, and `updatedAt`; add unique indexes matching the composite keys in the spec. Store raw upload bytes outside the database under ignored `data/imports/<batch-id>/` and store the SHA-256 and relative path in `import_batches`.

- [ ] **Step 4: Implement authentication, validation, and transactional routes**

```ts
export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  await requireOpsSession(request);
  const { resource } = await context.params;
  const payload = validateResourceWrite(resource, await request.json());
  const result = await getOpsRepository().upsertBatch(resource, payload.records, payload.importBatch);
  return Response.json(result, { status: 201 });
}
```

Reuse the deployment's current access session when available. If the host does not supply an authenticated user header, require an HttpOnly same-origin session established from `SANTA_OPS_PASSWORD_HASH`; never expose the password or database path to client code.

- [ ] **Step 5: Add storage exclusions and deterministic test database setup**

Add `/data/`, `*.sqlite`, `*.sqlite-wal`, and `*.sqlite-shm` to `.gitignore`. Test with a temporary database and remove it after each test.

- [ ] **Step 6: Run server, type, and lint checks**

Run: `pnpm vitest run tests/server/ops-repository.test.ts tests/server/ops-api.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add db src/server app/api package.json pnpm-lock.yaml .gitignore tests/server
git commit -m "feat: add cloud operations repository"
```

### Task 3: Add the client repository boundary and safe IndexedDB migration

**Files:**
- Create: `src/storage/ops-repository.ts`
- Create: `src/storage/http-ops-repository.ts`
- Create: `src/storage/local-migration.ts`
- Create: `src/components/DataMigrationPanel.tsx`
- Test: `tests/storage/http-ops-repository.test.ts`
- Test: `tests/storage/local-migration.test.ts`
- Modify: `src/storage/db.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: client-side `opsRepository` matching the server repository's resource methods.
- Produces: `previewLocalMigration()` and `migrateLocalData(selection)`.
- Consumes: Task 2 API and existing `opsDb` as read-only migration input.

- [ ] **Step 1: Write failing API-client and migration tests**

```ts
expect(await previewLocalMigration()).toMatchObject({ business: 1, ads: 1, conflicts: [] });
await expect(migrateLocalData(selection)).rejects.toThrow("network");
expect(await opsDb.list("business")).toEqual([localBusiness]);
expect(await migrationState()).toEqual({ completed: false });
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm vitest run tests/storage/http-ops-repository.test.ts tests/storage/local-migration.test.ts`

- [ ] **Step 3: Implement typed HTTP methods and migration state machine**

Use states `idle → previewing → ready → migrating → complete|failed`. Submit resources in dependency order: products, plans, business/ads/traffic, inventory/inbound, promotion, daily operations. A batch failure leaves IndexedDB untouched and records the failed resource for retry.

- [ ] **Step 4: Replace direct page persistence gradually**

Change `loadOpsData`, promotion saves, inventory saves, and daily-operation saves to call `opsRepository`. Retain `opsDb` only inside import preview/migration compatibility code until every resource has moved.

- [ ] **Step 5: Add migration UI with explicit confirmation**

Show record counts, conflicts, destination, progress, completion, and “本机数据仍保留” copy. Do not add an automatic clear action.

- [ ] **Step 6: Run migration and existing storage regression tests**

Run: `pnpm vitest run tests/storage tests/v2/planning-storage.test.ts tests/e2e/daily-ops-flow.test.tsx && pnpm typecheck`

- [ ] **Step 7: Commit Task 3**

```bash
git add src/storage src/components/DataMigrationPanel.tsx app/page.tsx tests/storage
git commit -m "feat: migrate operating data to cloud storage"
```

### Task 4: Build competitor import, maintenance, trends, and alerts

**Files:**
- Create: `src/import/competitor-parser.ts`
- Create: `src/integration/competitor-analytics.ts`
- Create: `src/components/CompetitorPage.tsx`
- Create: `tests/import/competitor-parser.test.ts`
- Create: `tests/integration/competitor-analytics.test.ts`
- Create: `tests/components/CompetitorPage.test.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `parseCompetitorReport(buffer, filename)`, `buildCompetitorAnalytics(rows, asOfDate)`, and `CompetitorPage`.
- Consumes: `opsRepository`, `CompetitorSnapshot`, global filter, and shared `TrendChart`.

- [ ] **Step 1: Write failing parser tests for aliases, blanks, and duplicate keys**

```ts
expect(result.records[0]).toMatchObject({ date: "2026-10-02", marketplace: "US", competitorAsin: "B012345678", price: 49.99, couponPercent: 10, bsrRank: 1200 });
expect(result.records[1]).toMatchObject({ rating: null, reviewCount: null, estimatedUnits: null });
```

- [ ] **Step 2: Write failing analytics and UI tests**

Test 5% price-drop, new coupon, 20% BSR improvement, edit persistence, delete confirmation, filters, and a duplicate upload updating exactly one formal row.

- [ ] **Step 3: Implement parser and analytics**

Accept Chinese and English aliases for date, ASIN, price, coupon, rating, reviews, BSR, estimated units, stock, source, and note. Reject missing date or ASIN. Keep blank numeric values `null`.

- [ ] **Step 4: Implement CompetitorPage**

Add KPI cards, editable detail table, import preview/result, price/discount trend, inverse BSR trend, rating/review trend, and comparison panel. Use text plus color for alerts.

- [ ] **Step 5: Add navigation and run tests**

Run: `pnpm vitest run tests/import/competitor-parser.test.ts tests/integration/competitor-analytics.test.ts tests/components/CompetitorPage.test.tsx && pnpm typecheck`

- [ ] **Step 6: Commit Task 4**

```bash
git add src/import/competitor-parser.ts src/integration/competitor-analytics.ts src/components/CompetitorPage.tsx app tests/import tests/integration tests/components
git commit -m "feat: add competitor tracking"
```

### Task 5: Build keyword ranking import, maintenance, charts, and heatmap

**Files:**
- Create: `src/import/keyword-rank-parser.ts`
- Create: `src/integration/keyword-analytics.ts`
- Create: `src/components/KeywordRankingPage.tsx`
- Create: `src/components/KeywordRankHeatmap.tsx`
- Test: `tests/import/keyword-rank-parser.test.ts`
- Test: `tests/integration/keyword-analytics.test.ts`
- Test: `tests/components/KeywordRankingPage.test.tsx`
- Modify: `src/components/TrendChart.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `parseKeywordRankReport`, `buildKeywordAnalytics`, `KeywordRankingPage`, and inverse rank-axis support in `TrendChart`.
- Consumes: `KeywordRankSnapshot`, competitor ranks, global filter, and `opsRepository`.

- [ ] **Step 1: Write failing normalization tests**

```ts
expect(parseRank("8")).toEqual({ rank: 8, status: "ranked" });
expect(parseRank("未收录")).toEqual({ rank: null, status: "notIndexed" });
expect(parseRank("0")).toEqual({ rank: null, status: "notIndexed" });
expect(parseRank("")).toEqual({ rank: null, status: "missing" });
```

- [ ] **Step 2: Write failing analytics/UI tests**

Test single-day drop 5/10, three observed-day decline, front-page/top-10 counts, separate organic/ad ranks, inverse axis, broken lines across missing dates, and filter persistence.

- [ ] **Step 3: Implement parser and analytics**

Normalize keyword whitespace/case into `keywordId`, retain display text, and never infer a rank from page number alone. Calculate changes only between observed snapshots.

- [ ] **Step 4: Implement keyword page and heatmap**

Add import/manual CRUD, KPIs, table, organic/ad dual lines, competitor comparison, and an accessible heatmap whose cells include text/ARIA labels, not color alone.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/import/keyword-rank-parser.test.ts tests/integration/keyword-analytics.test.ts tests/components/KeywordRankingPage.test.tsx && pnpm typecheck`

```bash
git add src/import/keyword-rank-parser.ts src/integration/keyword-analytics.ts src/components/KeywordRankingPage.tsx src/components/KeywordRankHeatmap.tsx src/components/TrendChart.tsx app tests
git commit -m "feat: add keyword ranking tracking"
```

### Task 6: Extend business/ad imports and promotion review with traffic funnel metrics

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/import/report-parser.ts`
- Modify: `src/integration/promotion-analytics.ts`
- Modify: `src/components/PromotionReviewPage.tsx`
- Modify: `src/components/PromotionPage.tsx`
- Test: `tests/import/report-parser.test.ts`
- Create: `tests/integration/promotion-funnel.test.ts`
- Create: `tests/components/PromotionReviewPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 funnel metrics and linked dataset; Task 5 keyword snapshots.
- Produces: promotion rows with impressions, clicks, sessions, orders, CTR, CPC, total/ad CVR, ACOS, TACOS, and organic orders.

- [ ] **Step 1: Add failing parser and missing/zero tests**

Add fixtures with Amazon aliases for sessions, page views, impressions, clicks, total orders, ad orders, ad sales, and total sales. Assert blanks remain `undefined/null`, explicit zeros remain zero, and unmapped campaigns are listed separately.

- [ ] **Step 2: Add failing review-page tests**

Assert seven chart groups, 7/14/30/custom range controls, ASIN/SKU/size/keyword filtering, event markers, and “尚未导入” rather than a zero line for missing actuals.

- [ ] **Step 3: Implement parser and analytics extensions**

Compute all ratios through `calculateFunnelMetrics`; do not trust spreadsheet-provided percentage fields when numerator and denominator are available. Preserve source percentages only for reconciliation warnings.

- [ ] **Step 4: Extend the review interface without removing existing charts**

Keep the four original chart cards. Add traffic/funnel and keyword correlation cards below them, compact blank space for missing series, and surface metric definitions in accessible help text.

- [ ] **Step 5: Run promotion regressions and commit**

Run: `pnpm vitest run tests/import/report-parser.test.ts tests/integration/promotion-funnel.test.ts tests/components/PromotionReviewPage.test.tsx tests/v2/promotion-plan-import.test.tsx && pnpm typecheck`

```bash
git add src/domain/types.ts src/import/report-parser.ts src/integration/promotion-analytics.ts src/components/PromotionPage.tsx src/components/PromotionReviewPage.tsx tests
git commit -m "feat: link traffic funnel to promotion review"
```

### Task 7: Add global filters, data health, dashboard summaries, and action effectiveness

**Files:**
- Create: `src/components/OpsNavigation.tsx`
- Create: `src/components/GlobalFilterProvider.tsx`
- Create: `src/components/DataHealthPanel.tsx`
- Create: `src/integration/alert-engine.ts`
- Create: `src/integration/action-effectiveness.ts`
- Modify: `src/components/DailyOperationsPage.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/integration/alert-engine.test.ts`
- Test: `tests/integration/action-effectiveness.test.ts`
- Create: `tests/e2e/linked-ops-flow.test.tsx`

**Interfaces:**
- Produces: shared navigation/filter context, `evaluateAlerts(linked, now)`, and `compareActionWindows(action, linked)`.
- Consumes: all prior linked resources.

- [ ] **Step 1: Write failing alert tests**

```ts
expect(evaluateAlerts(rows, new Date("2026-10-10T00:00:00Z"))).toEqual(expect.arrayContaining([
  expect.objectContaining({ type: "keyword-rank-drop", severity: "risk", asin: "B0CFPYYPRN", keywordId: "santa-costume" }),
]));
expect(evaluateAlerts(futureOnlyRows, new Date("2026-10-10T00:00:00Z"))).toEqual([]);
expect(evaluateAlerts(missingSourceRows, new Date("2026-10-10T00:00:00Z"))).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "sales-miss" })]));
```

- [ ] **Step 2: Write failing closed-loop e2e test**

Import a keyword drop, click “生成操作”, verify date/ASIN/keyword/risk are prefilled, complete the action, import three later days, and assert the history displays the 3-day rank/traffic/CTR/CPC/CVR/sales comparison.

- [ ] **Step 3: Implement shared navigation and filter state**

Use URL query parameters for `page`, dates, ASIN, SKU, size, keyword, and competitor ASIN so deep links and browser refresh preserve context. Keep current button styling and add active state.

- [ ] **Step 4: Implement data health and alert engine**

Show last successful import, coverage, missing expected dates, unmapped records, failures, and stale sources. Alerts run only on dates not later than `now` and only when all required inputs are observed.

- [ ] **Step 5: Implement operation creation and effectiveness windows**

Extend daily operations with category, priority, owner, due date, links, source alert, baseline, 3-day result, 7-day result, and effect status. Use observed dates, not calendar placeholders, and show remaining wait time where appropriate.

- [ ] **Step 6: Add dashboard keyword/competitor summaries and verify full flow**

Show only the highest-priority items plus “查看全部”. Clicking an item opens its page with exact filter query parameters.

Run: `pnpm vitest run tests/integration/alert-engine.test.ts tests/integration/action-effectiveness.test.ts tests/e2e/linked-ops-flow.test.tsx tests/e2e/daily-ops-flow.test.tsx && pnpm typecheck && pnpm lint`

- [ ] **Step 7: Commit Task 7**

```bash
git add src/components src/integration app tests
git commit -m "feat: close the linked operations loop"
```

### Task 8: Backups, deployment migration, and end-to-end verification

**Files:**
- Create: `scripts/backup-ops-db.ps1`
- Create: `scripts/restore-ops-db.ps1`
- Create: `docs/deployment/aliyun-data-migration.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `pnpm ops:backup`, `pnpm ops:verify-backup`, documented restore procedure, and deployment checklist.
- Consumes: the Task 2 database path from `SANTA_OPS_DB_PATH`.

- [ ] **Step 1: Add a failing rendered-HTML/navigation test**

Assert the production render contains the seven module labels and no framework error page. Add an API health request that expects authenticated success and unauthenticated rejection.

- [ ] **Step 2: Implement atomic backup and restore scripts**

The backup script must create a consistent SQLite backup, SHA-256 manifest, timestamped filename, and prune only verified backups older than the configured retention period. The restore script must refuse to overwrite the live database unless the service is stopped and a pre-restore backup succeeds.

- [ ] **Step 3: Document the safe deployment order**

Document: backup current site/data, deploy code, create schema, start service, verify health, migrate one browser, compare counts, verify from a second computer, then schedule daily backups. Include rollback to the prior code revision and database backup.

- [ ] **Step 4: Run the complete verification suite**

Run: `pnpm vitest run --exclude tests/rendered-html.test.mjs`

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm plan:check`

Run: `pnpm test`

Expected: all commands PASS.

- [ ] **Step 5: Perform browser checks before deployment**

Verify desktop and narrow viewport: migration panel; all seven navigation entries; global filters persist; competitor and keyword imports; missing-vs-zero labels; inverse rank chart; original dashboard charts; no table text overlap; keyboard focus; red/green states also have text.

- [ ] **Step 6: Commit Task 8**

```bash
git add scripts docs/deployment README.md package.json tests/rendered-html.test.mjs
git commit -m "ops: add cloud data backup and deployment checks"
```

## Final Release Gate

- Create a verified database backup before touching the Aliyun service.
- Deploy to a staging port first and verify API, UI, imports, migration preview, and rollback.
- Migrate one browser and reconcile record counts by resource.
- Open the staging URL from a second computer and verify identical data.
- Switch production traffic only after the old dashboard, all new modules, and the full test suite pass.
- Keep the pre-release application and database backup until at least one complete 7-day effectiveness window has been observed.
