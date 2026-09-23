// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { KeywordRankingPage } from "../../src/components/KeywordRankingPage";
afterEach(cleanup);
test("shows keyword KPIs, ranks, and import control", async () => {
  const repository = { list: async () => [{ id: "k", marketplace: "US" as const, date: "2026-10-02", keywordId: "santa-costume", keyword: "santa costume", asin: "B0CFPYYPRN", organicRank: 8, organicStatus: "ranked" as const, adRank: null, adStatus: "notIndexed" as const, updatedAt: "x" }], upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
  render(<KeywordRankingPage repository={repository} onBack={() => undefined} />);
  expect(await screen.findByRole("heading", { name: "关键词排名" })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("table", { name: "关键词每日排名" }).textContent).toContain("santa costume"));
  expect(screen.getByLabelText("上传关键词排名")).toBeTruthy();
  expect(screen.getByText("前10名关键词")).toBeTruthy();
});
