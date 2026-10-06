// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { KeywordRankingPage } from "../../src/components/KeywordRankingPage";
import type { DailyOperationRecord } from "../../src/domain/planning";
import type { SearchVolumeSnapshot } from "../../src/domain/keyword-volume";
import type { KeywordRankSnapshot } from "../../src/domain/linkage";
afterEach(cleanup);
test("shows keyword KPIs, ranks, and import control", async () => {
  const repository = { list: async () => [{ id: "k", marketplace: "US" as const, date: "2026-10-02", keywordId: "santa-costume", keyword: "santa costume", asin: "B0CFPYYPRN", organicRank: 8, organicStatus: "ranked" as const, abaRank: 12, adRank: null, adStatus: "notIndexed" as const, updatedAt: "x" }], upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} />);
  expect(await screen.findByRole("heading", { name: "关键词排名" })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("table", { name: "关键词每日排名" }).textContent).toContain("santa costume"));
  expect(screen.getByRole("table", { name: "ABA搜索排名" }).textContent).toContain("12");
  expect(screen.getByRole("table", { name: "关键词每日排名" }).textContent).not.toContain("12");
  expect(screen.getByLabelText("上传关键词排名")).toBeTruthy();
  expect(screen.getByText("前10名关键词")).toBeTruthy();
});

test("turns a keyword alert into a prefilled daily operation", async () => {
  const rows = [8, 19].map((organicRank, index) => ({ id: `k${index}`, marketplace: "US" as const, date: `2026-10-${String(9 + index).padStart(2, "0")}`, keywordId: "santa-costume", keyword: "santa costume", asin: "B0CFPYYPRN", organicRank, organicStatus: "ranked" as const, adRank: null, adStatus: "missing" as const, updatedAt: "x" }));
  const repository = { list: async () => rows, upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
  let created: DailyOperationRecord | undefined;
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} onCreateOperation={(record) => { created = record; }} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成操作" }));
  expect(created).toMatchObject({ date: "2026-10-10", asin: "B0CFPYYPRN", keywordId: "santa-costume", priority: "高", sourceAlertId: "rank:k1" });
});

const volume = (overrides: Partial<SearchVolumeSnapshot> = {}): SearchVolumeSnapshot => ({ id: "keyword-volume:fixture", kind: "search-volume", marketplace: "US", keywordId: "santa-costume", keyword: "santa costume", asin: "B0CFPYYPRN", scope: "market", source: "Amazon SQP", period: "week", periodStart: "2026-09-28", periodEnd: "2026-10-04", searchVolume: 120, updatedAt: "x", ...overrides });
const rankRow: KeywordRankSnapshot = { id: "keyword:US:2026-10-04:B0CFPYYPRN:santa-costume", marketplace: "US", date: "2026-10-04", keywordId: "santa-costume", keyword: "santa costume", asin: "B0CFPYYPRN", organicRank: 8, organicStatus: "ranked", abaRank: 42, adRank: 11, adStatus: "ranked", updatedAt: "x" };

function rankingRepository(rows: KeywordRankSnapshot[]) {
  return { list: async () => rows, upsertBatch: async () => ({ inserted: 0, updated: 0, skipped: 0 }), delete: async () => undefined };
}

function abaRow(date: string, abaRank: number, keyword = "santa costume", overrides: Partial<KeywordRankSnapshot> = {}): KeywordRankSnapshot {
  return { ...rankRow, id: `aba:${date}:${keyword}:${abaRank}`, date, keyword, keywordId: keyword, organicRank: null, organicStatus: "missing", adRank: null, adStatus: "missing", abaRank, ...overrides };
}

test("keeps ABA-only observations out of product rows and product KPIs", async () => {
  render(<KeywordRankingPage repository={rankingRepository([
    rankRow, abaRow("2026-10-06", 50493), abaRow("2025-10-06", 41817),
    abaRow("2026-10-04", 800, "ABA-only keyword"),
  ])} onBack={() => undefined} />);
  const aba = await screen.findByRole("table", { name: "ABA搜索排名" });
  await within(aba).findByRole("cell", { name: "50,493" });
  expect(within(aba).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "日期（月日）", "关键词", "2026 搜索排名", "2025 搜索排名", "2026 / 2025 排名差异",
  ]);
  expect(aba.textContent).not.toContain("B0CFPYYPRN");
  const product = screen.getByRole("table", { name: "关键词每日排名" });
  expect(within(product).getAllByRole("row")).toHaveLength(2);
  expect(product.textContent).not.toContain("ABA-only keyword");
  expect(within(product).queryByRole("columnheader", { name: /ABA/ })).toBeNull();
  const metrics = screen.getByLabelText("关键词核心指标");
  expect(metrics.textContent).toContain("核心关键词数1");
  expect(metrics.textContent).toContain("前10名关键词1");
  expect(screen.getByRole("region", { name: "ABA 搜索排名" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "商品关键词排名" })).toBeTruthy();
});

test.each([
  { current: 50493, previous: 41817, want: "后退 8,676 名" },
  { current: 41817, previous: 50493, want: "提前 8,676 名" },
  { current: 41817, previous: 41817, want: "持平" },
])("shows rank direction, not search-volume growth, for $current versus $previous", async ({ current, previous, want }) => {
  render(<KeywordRankingPage repository={rankingRepository([abaRow("2026-10-04", current), abaRow("2025-10-04", previous)])} onBack={() => undefined} />);
  const table = await screen.findByRole("table", { name: "ABA搜索排名" });
  expect(await within(table).findByRole("cell", { name: want })).toBeTruthy();
  expect(within(table).getAllByRole("row")).toHaveLength(2);
});

test("does not fabricate a year comparison from another day or keyword", async () => {
  render(<KeywordRankingPage repository={rankingRepository([
    abaRow("2026-10-04", 50493), abaRow("2025-10-03", 41817), abaRow("2025-10-04", 900, "santa hat"),
  ])} onBack={() => undefined} />);
  const table = await screen.findByRole("table", { name: "ABA搜索排名" });
  const row = await within(table).findByRole("row", { name: /10-04 santa costume/ });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["santa costume", "50,493", "未录入", "未录入"]);
  expect(within(table).queryByText(/提前|后退|持平/)).toBeNull();
});

test("coalesces identical ABA ranks across ASINs and flags conflicting ranks without calculating a difference", async () => {
  render(<KeywordRankingPage repository={rankingRepository([
    abaRow("2026-10-04", 50493), abaRow("2026-10-04", 50493, " Santa Costume ", { id: "duplicate", asin: "B0OTHER123" }),
    abaRow("2025-10-04", 41817), abaRow("2025-10-04", 40000, "santa costume", { asin: "B0OTHER123" }),
  ])} onBack={() => undefined} />);
  const table = await screen.findByRole("table", { name: "ABA搜索排名" });
  const row = await within(table).findByRole("row", { name: /10-04 santa costume/ });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["santa costume", "50,493", "数据冲突", "待核对"]);
  expect(within(table).getAllByRole("row")).toHaveLength(2);
});

test("ABA keyword and date filters never filter product ranking rows and can be reset", async () => {
  render(<KeywordRankingPage repository={rankingRepository([
    rankRow, abaRow("2026-10-03", 50), abaRow("2025-10-03", 100), abaRow("2026-10-04", 900, "santa hat"),
  ])} onBack={() => undefined} />);
  const table = await screen.findByRole("table", { name: "ABA搜索排名" });
  await within(table).findByRole("cell", { name: "提前 50 名" });
  fireEvent.change(screen.getByLabelText("ABA关键词"), { target: { value: "santa costume" } });
  expect(table.textContent).not.toContain("santa hat");
  fireEvent.change(screen.getByLabelText("ABA开始日期（月日）"), { target: { value: "10-04" } });
  expect(table.textContent).not.toContain("10-03");
  const product = screen.getByRole("table", { name: "关键词每日排名" });
  expect(product.textContent).toContain("santa costume");
  expect(product.textContent).toContain("11");
  fireEvent.change(screen.getByLabelText("ABA结束日期（月日）"), { target: { value: "10-03" } });
  expect(screen.getByText("开始日期不能晚于结束日期。" )).toBeTruthy();
  expect(within(table).queryByRole("cell", { name: "42" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重置ABA筛选" }));
  expect(table.textContent).toContain("santa hat");
  expect(table.textContent).toContain("10-03");
});

test("ignores invalid ABA ranks and impossible dates instead of presenting false year comparisons", async () => {
  render(<KeywordRankingPage repository={rankingRepository([
    abaRow("2026-10-04", 42), abaRow("2025-10-04", 0),
    abaRow("2026-02-30", 100, "invalid-date"), abaRow("2024-10-04", 100, "wrong-year"),
    abaRow("2026-10-04", -2, "negative"), abaRow("2026-10-04", 1.5, "fraction"),
  ])} onBack={() => undefined} />);
  const table = await screen.findByRole("table", { name: "ABA搜索排名" });
  const row = await within(table).findByRole("row", { name: /10-04 santa costume/ });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["santa costume", "42", "未录入", "未录入"]);
  expect(within(table).getAllByRole("row")).toHaveLength(2);
});

test.each([
  { label: "zero organic page", fields: { organicPage: 0, organicPosition: 2 } },
  { label: "organic position without page", fields: { organicPosition: 2 } },
  { label: "ad page without position", fields: { adPage: 2 } },
  { label: "fractional ad position", fields: { adPage: 2, adPosition: 1.5 } },
  { label: "legacy page only", fields: { page: 3 } },
])("later ABA observation with $label cannot replace the latest product KPI snapshot", async ({ fields }) => {
  render(<KeywordRankingPage repository={rankingRepository([rankRow, abaRow("2026-10-06", 50493, "santa costume", { ...fields, keywordId: rankRow.keywordId })])} onBack={() => undefined} />);
  await within(screen.getByRole("table", { name: "ABA搜索排名" })).findByRole("cell", { name: "50,493" });
  expect(within(screen.getByRole("table", { name: "关键词每日排名" })).getAllByRole("row")).toHaveLength(2);
  const metrics = screen.getByLabelText("关键词核心指标");
  expect(metrics.textContent).toContain("前10名关键词1");
  expect(metrics.textContent).toContain("首页关键词1");
});

test.each([
  { label: "coherent organic position", fields: { organicPage: 3, organicPosition: 2 }, want: "第3页第2位" },
  { label: "coherent ad position", fields: { adPage: 2, adPosition: 5 }, want: "第2页第5位" },
  { label: "explicit not-indexed organic status", fields: { organicStatus: "notIndexed" as const }, want: "未收录" },
])("retains actual product evidence with $label even alongside ABA rank", async ({ fields, want }) => {
  render(<KeywordRankingPage repository={rankingRepository([abaRow("2026-10-06", 50493, "santa costume", fields)])} onBack={() => undefined} />);
  const table = screen.getByRole("table", { name: "关键词每日排名" });
  expect(await within(table).findByRole("cell", { name: want })).toBeTruthy();
  expect(screen.getByLabelText("关键词核心指标").textContent).toContain("核心关键词数1");
});

test("displays organic and ad page positions separately from total ranks and ABA rank", async () => {
  const row = { ...rankRow, organicRank: 18, abaRank: 12345, adRank: 7, organicPage: 3, organicPosition: 2, adPage: 1, adPosition: 4 };
  render(<KeywordRankingPage repository={rankingRepository([row])} onBack={() => undefined} />);
  const table = screen.getByRole("table", { name: "关键词每日排名" });
  const renderedRow = await within(table).findByRole("row", { name: /santa costume/ });
  expect(within(renderedRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "B0CFPYYPRN", "santa costume", "18", "第3页第2位", "7", "第1页第4位", "—",
  ]);
  expect(within(table).getByRole("columnheader", { name: "自然位置" })).toBeTruthy();
  expect(within(table).getByRole("columnheader", { name: "广告位置" })).toBeTruthy();
  expect(within(table).getByRole("columnheader", { name: "来源说明" })).toBeTruthy();
});

test("position-only observations do not become total ranks or qualify for top10 or first-page KPIs", async () => {
  const row = { ...rankRow, organicRank: null, organicStatus: "missing" as const, adRank: null, adStatus: "missing" as const, abaRank: null, organicPage: 1, organicPosition: 2, adPage: 3, adPosition: 4, page: 99 };
  render(<KeywordRankingPage repository={rankingRepository([row])} onBack={() => undefined} />);
  const table = screen.getByRole("table", { name: "关键词每日排名" });
  const renderedRow = await within(table).findByRole("row", { name: /santa costume/ });
  expect(within(renderedRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "B0CFPYYPRN", "santa costume", "—", "第1页第2位", "—", "第3页第4位", "—",
  ]);
  const metrics = screen.getByLabelText("关键词核心指标");
  expect(within(metrics).getByText("前10名关键词").parentElement?.textContent).toBe("前10名关键词0");
  expect(within(metrics).getByText("首页关键词").parentElement?.textContent).toBe("首页关键词0");
});

test.each([
  { label: "missing page", page: undefined, position: 2 },
  { label: "missing position", page: 3, position: undefined },
  { label: "null page", page: null, position: 2 },
  { label: "null position", page: 3, position: null },
  { label: "zero page", page: 0, position: 2 },
  { label: "zero position", page: 3, position: 0 },
  { label: "negative page", page: -1, position: 2 },
  { label: "negative position", page: 3, position: -1 },
  { label: "fractional page", page: 1.5, position: 2 },
  { label: "fractional position", page: 3, position: 2.5 },
  { label: "NaN page", page: Number.NaN, position: 2 },
  { label: "NaN position", page: 3, position: Number.NaN },
  { label: "infinite page", page: Number.POSITIVE_INFINITY, position: 2 },
  { label: "infinite position", page: 3, position: Number.POSITIVE_INFINITY },
])("does not display a page position with $label", async ({ page, position }) => {
  const row = { ...rankRow, organicPage: page, organicPosition: position, adPage: page, adPosition: position };
  render(<KeywordRankingPage repository={rankingRepository([row])} onBack={() => undefined} />);
  const table = screen.getByRole("table", { name: "关键词每日排名" });
  const renderedRow = await within(table).findByRole("row", { name: /santa costume/ });
  expect(within(renderedRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "B0CFPYYPRN", "santa costume", "8", "—", "11", "—", "—",
  ]);
});

test("shows the complete provenance note as text rather than a source link or injected markup", async () => {
  const note = "来源：月度报告.xlsx / 9月关键词 / F12；<img src=x onerror=alert(1)>";
  const row = { ...rankRow, note, source: "javascript:alert(1)" };
  render(<KeywordRankingPage repository={rankingRepository([row])} onBack={() => undefined} />);
  const table = screen.getByRole("table", { name: "关键词每日排名" });
  expect(await within(table).findByRole("cell", { name: note })).toBeTruthy();
  expect(within(table).queryByText("javascript:alert(1)")).toBeNull();
  expect(within(table).queryByRole("link")).toBeNull();
  expect(within(table).queryByRole("img")).toBeNull();
});

test.each([
  { label: "absent", note: undefined, source: "C:\\reports\\keywords.xlsx" },
  { label: "empty", note: "", source: "https://example.com/keyword-evidence" },
  { label: "whitespace-only", note: "   ", source: "javascript:alert(1)" },
])("falls back to plain-text source when provenance note is $label", async ({ note, source }) => {
  render(<KeywordRankingPage repository={rankingRepository([{ ...rankRow, note, source }])} onBack={() => undefined} />);
  const table = screen.getByRole("table", { name: "关键词每日排名" });
  expect(await within(table).findByRole("cell", { name: source })).toBeTruthy();
  expect(within(table).queryByRole("link")).toBeNull();
});

test("keeps legacy page-only records without positions or source evidence blank", async () => {
  render(<KeywordRankingPage repository={rankingRepository([{ ...rankRow, page: 3 }])} onBack={() => undefined} />);
  const table = screen.getByRole("table", { name: "关键词每日排名" });
  const renderedRow = await within(table).findByRole("row", { name: /santa costume/ });
  expect(within(renderedRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "B0CFPYYPRN", "santa costume", "8", "—", "11", "—", "—",
  ]);
});

test("separates search volume records from organic and ABA ranking analytics", async () => {
  const repository = { list: async () => [rankRow, volume({ keyword: "volume-only keyword", keywordId: "volume-only" })], upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} />);
  await screen.findByRole("heading", { name: "关键词搜索量" });
  fireEvent.change(screen.getByLabelText("搜索量统计周期"), { target: { value: "week" } });
  await waitFor(() => expect(screen.getByRole("table", { name: "搜索量周期明细" }).textContent).toContain("120"));
  expect(screen.getByRole("table", { name: "关键词每日排名" }).textContent).not.toContain("volume-only keyword");
  expect(screen.getByRole("table", { name: "ABA搜索排名" }).textContent).toContain("42");
  expect(screen.getByLabelText("关键词核心指标").textContent).toContain("核心关键词数1");
});

test("volume-only upload cannot replace an existing ranking record", async () => {
  const stored = new Map<string, KeywordRankSnapshot | SearchVolumeSnapshot>([[rankRow.id, rankRow]]);
  const repository = { list: async () => [...stored.values()], upsertBatch: async (_resource: "keywords", records: readonly (KeywordRankSnapshot | SearchVolumeSnapshot)[]) => { records.forEach((record) => stored.set(record.id, record)); return { inserted: records.length, updated: 0, skipped: 0 }; }, delete: async () => undefined };
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} />);
  const csv = "关键词,ASIN,统计周期,开始日期,结束日期,搜索量,统计范围,来源\nsanta costume,B0CFPYYPRN,week,2026-09-28,2026-10-04,120,market,Amazon SQP";
  const file = { name: "volume.csv", arrayBuffer: async () => new TextEncoder().encode(csv).buffer } as File;
  fireEvent.change(await screen.findByLabelText("上传关键词搜索量"), { target: { files: [file] } });
  await waitFor(() => expect(stored.size).toBe(2));
  expect(stored.get(rankRow.id)).toEqual(rankRow);
  const added = [...stored.values()].find((record) => "kind" in record);
  expect(added).toMatchObject({ kind: "search-volume", searchVolume: 120 });
  expect(added?.id.startsWith("keyword-volume:")).toBe(true);
  expect(screen.getByRole("table", { name: "ABA搜索排名" }).textContent).toContain("42");
});

test("all volume sections follow keyword, ASIN, interval and date filters", async () => {
  const rows = [volume(), volume({ id: "keyword-volume:v2", keyword: "santa hat", keywordId: "santa-hat", searchVolume: 250 }), volume({ id: "keyword-volume:v3", keyword: "other asin", keywordId: "other-asin", asin: "B0OTHER123", scope: "asin", searchVolume: 300 }), volume({ id: "keyword-volume:v4", period: "month", periodStart: "2026-10-01", periodEnd: "2026-10-31", searchVolume: 900 })];
  const repository = { list: async () => rows, upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} />);
  fireEvent.change(screen.getByLabelText("搜索量统计周期"), { target: { value: "week" } });
  await waitFor(() => expect(screen.getByRole("table", { name: "搜索量周期明细" }).textContent).toContain("250"));
  fireEvent.click(screen.getByLabelText("选择关键词 santa hat"));
  fireEvent.click(screen.getByLabelText("选择关键词 other asin"));
  fireEvent.change(screen.getByLabelText("搜索量 ASIN"), { target: { value: "B0CFPYYPRN" } });
  const table = screen.getByRole("table", { name: "搜索量周期明细" });
  expect(table.textContent).toContain("120");
  expect(table.textContent).not.toContain("250");
  expect(table.textContent).not.toContain("300");
  fireEvent.change(screen.getByLabelText("搜索量统计周期"), { target: { value: "month" } });
  expect(table.textContent).toContain("900");
  expect(table.textContent).not.toContain("120");
  fireEvent.change(screen.getByLabelText("搜索量开始日期"), { target: { value: "2026-10-15" } });
  expect(table.textContent).not.toContain("900");
  expect(screen.getByText("筛选范围内没有完整统计周期。" )).toBeTruthy();
});

test("shows refresh failures separately and keeps last-loaded ranking data", async () => {
  let reads = 0;
  const repository = { list: async () => { if (++reads > 1) throw new Error("读取失败"); return [rankRow]; }, upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} />);
  await waitFor(() => expect(screen.getByRole("table", { name: "关键词每日排名" }).textContent).toContain("santa costume"));
  fireEvent.click(screen.getByRole("button", { name: "刷新关键词数据" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("读取失败"));
  expect(screen.getByRole("table", { name: "关键词每日排名" }).textContent).toContain("santa costume");
});
