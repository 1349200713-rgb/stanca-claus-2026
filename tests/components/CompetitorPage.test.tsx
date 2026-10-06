// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CompetitorPage } from "../../src/components/CompetitorPage";
import type { CompetitorSnapshot } from "../../src/domain/linkage";
import { createHttpOpsRepository } from "../../src/storage/http-ops-repository";
import type { ServerImportBatch } from "../../db/ops-repository";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const sisrol: CompetitorSnapshot = {
  id: "competitor:US:2026-10-02:B012345678:XL", marketplace: "US", date: "2026-10-02",
  competitorAsin: "B012345678", brand: "SISROL", productName: "Santa suit", size: "XL",
  price: 49.99, effectivePrice: null, couponPercent: 10, codePercent: 5,
  primeSavings: "Prime 5%", rating: 4.5, reviewCount: 120, categoryRank: 1200,
  subcategoryRank: 88, bsrRank: 88, estimatedUnits: 12, stockStatus: "In stock",
  dealActive: false, colorStyle: "Red", note: "imported observation",
  source: "https://amazon.com/dp/B012345678", updatedAt: "2026-10-02T01:00:00Z",
};

function competitorBoundary(initial: CompetitorSnapshot[], options: { saveFailure?: string; refreshFailure?: string; saveGate?: Promise<void> } = {}) {
  const records = initial.map((record) => ({ ...record }));
  const writes: { records: CompetitorSnapshot[]; importBatch: ServerImportBatch }[] = [];
  const requests: Request[] = [];
  let reads = 0;
  const repository = createHttpOpsRepository({
    fetch: async (input) => {
      const request = input as Request;
      requests.push(request);
      if (request.method === "GET") {
        reads += 1;
        if (reads > 1 && options.refreshFailure) return Response.json({ error: options.refreshFailure }, { status: 503 });
        return Response.json({ records });
      }
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/ops/competitors") {
        throw new Error(`Unexpected competitor request: ${request.method} ${request.url}`);
      }
      const body = await request.json() as { records: CompetitorSnapshot[]; importBatch: ServerImportBatch };
      writes.push(body);
      if (options.saveFailure) return Response.json({ error: options.saveFailure }, { status: 403 });
      if (options.saveGate) await options.saveGate;
      for (const record of body.records) {
        const index = records.findIndex((existing) => existing.id === record.id);
        if (index < 0) records.push(record);
        else records[index] = record;
      }
      return Response.json({ inserted: 0, updated: body.records.length, skipped: 0 });
    },
  }) as unknown as NonNullable<Parameters<typeof CompetitorPage>[0]["repository"]>;
  return { repository, writes, requests, records: () => records, reads: () => reads };
}

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

    fireEvent.click(await screen.findByRole("button", { name: "手动修改 North XL 2026-10-02" }));
    fireEvent.change(screen.getByLabelText("编辑页面售价"), { target: { value: "52.5" } });
    fireEvent.change(screen.getByLabelText("编辑备注"), { target: { value: "price test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(saved).toMatchObject({ id: "one", price: 52.5, note: "price test", competitorAsin: "B012345678" }));
    expect(await screen.findByText("竞品记录已更新")).toBeTruthy();
    expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).toContain("US$52.50");
  });

  test("opens the selected record from a left-side action in a prefilled form outside the horizontal table", async () => {
    vi.stubGlobal("prompt", () => { throw new Error("Native prompt must not open for editing"); });
    const boundary = competitorBoundary([sisrol]);
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);

    const action = await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" });
    expect(action.textContent).toBe("手动修改");
    expect(action.closest("tr")?.firstElementChild?.contains(action)).toBe(true);
    fireEvent.click(action);

    const form = screen.getByRole("form", { name: "手动修改竞品记录" });
    expect(form.closest(".table-scroll")).toBeNull();
    expect((within(form).getByLabelText("编辑品牌") as HTMLInputElement).value).toBe("SISROL");
    expect((within(form).getByLabelText("编辑日期") as HTMLInputElement).value).toBe("2026-10-02");
    expect((within(form).getByLabelText("编辑优惠后价格") as HTMLInputElement).value).toBe("");
    expect(within(form).getByRole("button", { name: "保存修改" })).toBeTruthy();
    expect(within(form).getByRole("button", { name: "取消" })).toBeTruthy();
    expect(boundary.writes).toHaveLength(0);
  });

  test("updates the same id and refreshes KPIs while preserving other records and unknown effective prices", async () => {
    const other = { ...sisrol, id: "other", competitorAsin: "B098765432", brand: "Other", price: 60, effectivePrice: 55 };
    const boundary = competitorBoundary([sisrol, other]);
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    fireEvent.change(screen.getByLabelText("编辑页面售价"), { target: { value: "52.5" } });
    fireEvent.change(screen.getByLabelText("编辑备注"), { target: { value: "checked manually" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("竞品记录已更新")).toBeTruthy();
    expect(boundary.writes).toHaveLength(1);
    expect(boundary.writes[0].records).toHaveLength(1);
    expect(boundary.writes[0].records[0]).toMatchObject({
      id: "competitor:US:2026-10-02:B012345678:XL", price: 52.5, effectivePrice: null,
      note: "checked manually", source: "https://amazon.com/dp/B012345678", bsrRank: 88,
      estimatedUnits: 12, stockStatus: "In stock", dealActive: false, couponPercent: 10,
    });
    expect(boundary.writes[0].importBatch.source).toBe("manual-edit");
    expect(boundary.records()).toHaveLength(2);
    expect(boundary.records().find((record) => record.id === "other")).toEqual(other);
    expect(boundary.reads()).toBe(2);
    expect(screen.queryByRole("form", { name: "手动修改竞品记录" })).toBeNull();
    const lowestPrice = screen.getByText("竞品最低到手价").closest("article");
    expect(lowestPrice?.textContent).toContain("US$52.50");
  });

  test("brings the selected editor into keyboard focus above the table", async () => {
    const boundary = competitorBoundary([sisrol]);
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    const form = screen.getByRole("form", { name: "手动修改竞品记录" });
    const heading = within(form).getByRole("heading", { name: "手动修改：SISROL / XL / 2026-10-02" });
    expect(document.activeElement).toBe(heading);
    expect(boundary.writes).toHaveLength(0);
  });

  test("cancel discards the draft without writing or changing the original business record", async () => {
    const boundary = competitorBoundary([sisrol]);
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    fireEvent.change(screen.getByLabelText("编辑页面售价"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("form", { name: "手动修改竞品记录" })).toBeNull();
    expect(boundary.writes).toHaveLength(0);
    expect(boundary.records()).toEqual([sisrol]);
    fireEvent.click(screen.getByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    expect((screen.getByLabelText("编辑页面售价") as HTMLInputElement).value).toBe("49.99");
  });

  test("saving an unchanged form does not write a new timestamp or import batch", async () => {
    const boundary = competitorBoundary([sisrol]);
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.queryByRole("form", { name: "手动修改竞品记录" })).toBeNull());
    expect(boundary.writes).toHaveLength(0);
    expect(boundary.records()).toEqual([sisrol]);
  });

  test("a failed save keeps the original record and the edited draft available to retry", async () => {
    const boundary = competitorBoundary([sisrol], { saveFailure: "无权保存此次修改" });
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    fireEvent.change(screen.getByLabelText("编辑备注"), { target: { value: "retry this note" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("无权保存此次修改")).toBeTruthy();
    expect(boundary.records()).toEqual([sisrol]);
    expect((screen.getByLabelText("编辑备注") as HTMLInputElement).value).toBe("retry this note");
    expect((screen.getByRole("button", { name: "保存修改" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("table", { name: "竞品每日明细" }).textContent).toContain("imported observation");
    expect(screen.queryByText("竞品记录已更新")).toBeNull();
  });

  test("distinguishes a saved record from a failed follow-up refresh without submitting it again", async () => {
    const boundary = competitorBoundary([sisrol], { refreshFailure: "竞品读取接口离线" });
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    fireEvent.change(screen.getByLabelText("编辑备注"), { target: { value: "saved once" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    const notice = await screen.findByText(/已保存，但刷新失败/);
    expect(notice.textContent).toContain("竞品读取接口离线");
    expect(boundary.writes).toHaveLength(1);
    expect(boundary.records()[0].note).toBe("saved once");
    expect(screen.queryByText("竞品记录已更新")).toBeNull();
    expect(screen.queryByRole("form", { name: "手动修改竞品记录" })).toBeNull();
  });

  test("cannot delete a business record while its save request is still pending", async () => {
    let finishSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
    let confirmations = 0;
    vi.stubGlobal("confirm", () => { confirmations += 1; return true; });
    const boundary = competitorBoundary([sisrol], { saveGate });
    render(<CompetitorPage repository={boundary.repository} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "手动修改 SISROL XL 2026-10-02" }));
    fireEvent.change(screen.getByLabelText("编辑备注"), { target: { value: "pending save" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByRole("button", { name: "保存中…" });

    try {
      const remove = screen.getByRole("button", { name: "删除 SISROL XL 2026-10-02" }) as HTMLButtonElement;
      expect(remove.disabled).toBe(true);
      fireEvent.click(remove);
      expect(confirmations).toBe(0);
      expect(boundary.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
      expect(boundary.records()).toEqual([sisrol]);
    } finally { finishSave(); }
    await screen.findByText("竞品记录已更新");
    expect(boundary.records()).toHaveLength(1);
    expect(boundary.records()[0].note).toBe("pending save");
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
