// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { CompetitorPage } from "../../src/components/CompetitorPage";

afterEach(cleanup);

describe("CompetitorPage", () => {
  test("loads cloud snapshots and displays competitor KPIs and details", async () => {
    const repository = { list: async () => [{ id: "one", marketplace: "US" as const, date: "2026-10-02", competitorAsin: "B012345678", brand: "North", price: 49.99, couponPercent: 10, rating: 4.5, reviewCount: 120, bsrRank: 1200, updatedAt: "2026-10-02T01:00:00Z" }], upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
    render(<CompetitorPage repository={repository} onBack={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "竞品跟踪" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).toContain("B012345678"));
    expect(screen.getByText("跟踪竞品数")).toBeTruthy();
    expect(screen.getByLabelText("上传竞品数据")).toBeTruthy();
  });
});
