// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { KeywordRankingPage } from "../../src/components/KeywordRankingPage";
import type { DailyOperationRecord } from "../../src/domain/planning";
afterEach(cleanup);
test("shows keyword KPIs, ranks, and import control", async () => {
  const repository = { list: async () => [{ id: "k", marketplace: "US" as const, date: "2026-10-02", keywordId: "santa-costume", keyword: "santa costume", asin: "B0CFPYYPRN", organicRank: 8, organicStatus: "ranked" as const, adRank: null, adStatus: "notIndexed" as const, updatedAt: "x" }], upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} />);
  expect(await screen.findByRole("heading", { name: "关键词排名" })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("table", { name: "关键词每日排名" }).textContent).toContain("santa costume"));
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
