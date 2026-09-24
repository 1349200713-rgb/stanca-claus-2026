// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CompetitorPage } from "../../src/components/CompetitorPage";
import type { CompetitorSnapshot } from "../../src/domain/linkage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("CompetitorPage", () => {
  test("loads cloud snapshots and displays competitor KPIs and details", async () => {
    const repository = { list: async () => [{ id: "one", marketplace: "US" as const, date: "2026-10-02", competitorAsin: "B012345678", brand: "North", size: "XL", price: 49.99, effectivePrice: 44.99, couponPercent: 10, rating: 4.5, categoryRank: 1200, subcategoryRank: 88, updatedAt: "2026-10-02T01:00:00Z" }], upsertBatch: async () => ({ inserted: 1, updated: 0, skipped: 0 }), delete: async () => undefined };
    render(<CompetitorPage repository={repository} onBack={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "竞品跟踪" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).toContain("B012345678"));
    expect(screen.getByText("跟踪竞品数")).toBeTruthy();
    expect(screen.getByLabelText("上传竞品数据")).toBeTruthy();
    expect(screen.getByLabelText("竞品筛选").textContent).toContain("尺码");
    expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).toContain("优惠后价格");
    expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).toContain("小类排名");
  });

  test("edits a detail row, saves it to the cloud repository, and refreshes the dashboard", async () => {
    let saved: CompetitorSnapshot | undefined;
    const original = { id: "one", marketplace: "US" as const, date: "2026-10-02", competitorAsin: "B012345678", brand: "North", size: "XL", price: 49.99, effectivePrice: 44.99, couponPercent: 10, codePercent: 5, primeSavings: "Prime 5%", rating: 4.5, categoryRank: 1200, subcategoryRank: 88, colorStyle: "Red", note: "old", source: "https://amazon.com/dp/B012345678", updatedAt: "2026-10-02T01:00:00Z" };
    const repository = {
      list: async () => [saved ? { ...original, ...saved } : original],
      upsertBatch: async (_resource: "competitors", records: readonly CompetitorSnapshot[]) => { saved = records[0]; return { inserted: 0, updated: 1, skipped: 0 }; },
      delete: async () => undefined,
    };
    render(<CompetitorPage repository={repository} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 North XL 2026-10-02" }));
    fireEvent.change(screen.getByLabelText("编辑页面售价"), { target: { value: "52.5" } });
    fireEvent.change(screen.getByLabelText("编辑备注"), { target: { value: "price test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存竞品记录" }));

    await waitFor(() => expect(saved).toMatchObject({ id: "one", price: 52.5, note: "price test", competitorAsin: "B012345678" }));
    expect(await screen.findByText("竞品记录已更新")).toBeTruthy();
    expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).toContain("US$52.50");
  });

  test("deletes a detail row after confirmation and refreshes the dashboard", async () => {
    vi.stubGlobal("confirm", () => true);
    let removed = "";
    let rows: CompetitorSnapshot[] = [{ id: "remove-me", marketplace: "US", date: "2026-10-02", competitorAsin: "B012345678", brand: "North", size: "XL", price: 49.99, updatedAt: "2026-10-02T01:00:00Z" }];
    const repository = {
      list: async () => rows,
      upsertBatch: async () => ({ inserted: 0, updated: 0, skipped: 0 }),
      delete: async (_resource: "competitors", key: string) => { removed = key; rows = []; },
    };
    render(<CompetitorPage repository={repository} onBack={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 North XL 2026-10-02" }));

    await waitFor(() => expect(removed).toBe("remove-me"));
    expect(await screen.findByText("竞品记录已删除")).toBeTruthy();
    expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).not.toContain("B012345678");
  });
});
