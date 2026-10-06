// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthGate } from "../../src/components/AuthGate";
import { opsDb } from "../../src/storage/db";
import { createHttpOpsRepository } from "../../src/storage/http-ops-repository";

type Client = "db" | "http";
type Result = { ok: true } | { ok: false; error: Error };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(client: Client, options: { retryStatus?: number; initialStatus?: number; delayedVerification?: boolean } = {}) {
  const requests: { path: string; body: string }[] = [];
  const record = { key: "ads:one", id: "competitor-one", date: "2026-10-06", campaign: "Santa", spend: 20, adSales: 100, adOrders: 2 };
  let authorized = false;
  let finishVerification: (() => void) | undefined;
  const transport: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), "http://localhost"), init);
    const path = new URL(request.url).pathname;
    const body = await request.text();
    requests.push({ path, body });
    if (path === "/api/auth/operation") {
      if (JSON.parse(body).password !== "correct") return Response.json({ error: "操作密码不正确" }, { status: 401 });
      if (options.delayedVerification) await new Promise<void>((resolve) => { finishVerification = resolve; });
      authorized = true;
      return Response.json({ ok: true });
    }
    if (!authorized) return Response.json({ error: "需要操作密码" }, { status: options.initialStatus ?? 428 });
    if (options.retryStatus) return Response.json({ error: "仍需操作密码" }, { status: options.retryStatus });
    return Response.json(client === "db" ? { ok: true, written: 1, skipped: 0 } : { inserted: 1, updated: 0, skipped: 0 });
  };
  vi.stubGlobal("fetch", transport);
  vi.spyOn(window, "prompt").mockImplementation(() => { throw new Error("prompt() is not supported"); });
  const repository = createHttpOpsRepository({ fetch: transport });
  const save = () => client === "db"
    ? opsDb.replace("ads", [record])
    : repository.upsertBatch("competitors", [record], { id: "edit-one", filename: "页面手动编辑", importedAt: "2026-10-06T00:00:00Z" });
  const start = () => save().then<Result, Result>(() => ({ ok: true }), (error: Error) => ({ ok: false, error }));
  const view = render(<AuthGate><button type="button">原保存按钮</button><p>尚未保存的草稿</p></AuthGate>);
  const businessRequests = () => requests.filter((request) => request.path !== "/api/auth/operation");
  return { record, requests, start, view, businessRequests, finishVerification: () => finishVerification?.() };
}

async function startSave(context: ReturnType<typeof fixture>) {
  let result!: Promise<Result>;
  await act(async () => { result = context.start(); });
  await screen.findByRole("dialog", { name: "操作密码验证" });
  return { result };
}

function submitPassword(value = "correct") {
  fireEvent.change(screen.getByLabelText("操作密码"), { target: { value } });
  fireEvent.submit(screen.getByLabelText("操作密码").closest("form")!);
}

describe.each<Client>(["db", "http"])("%s page-native operation authorization", (client) => {
  // A reintroduced native prompt or a retry before successful authorization must fail this test.
  test("saves through the page password dialog even when native prompt throws", async () => {
    const context = fixture(client);
    const { result } = await startSave(context);
    expect(context.businessRequests()).toHaveLength(1);
    expect(context.requests).toHaveLength(1);
    submitPassword();
    await act(async () => { expect(await result).toEqual({ ok: true }); });
    expect(context.requests.map((request) => request.path)).toEqual([
      client === "db" ? "/api/data" : "/api/ops/competitors",
      "/api/auth/operation",
      client === "db" ? "/api/data" : "/api/ops/competitors",
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Resolving rather than rejecting dismissal would silently save the record.
  test("cancels without authorization or another write and restores focus", async () => {
    const context = fixture(client);
    const originalButton = screen.getByRole("button", { name: "原保存按钮" });
    originalButton.focus();
    const { result } = await startSave(context);
    expect(document.activeElement).toBe(screen.getByLabelText("操作密码"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { expect(await result).toMatchObject({ ok: false, error: { message: "取消操作" } }); });
    expect(context.requests).toHaveLength(1);
    expect(screen.getByText("尚未保存的草稿")).toBeTruthy();
    expect(document.activeElement).toBe(originalButton);
  });

  test("keeps a wrong password error in the dialog without retrying the business write", async () => {
    const context = fixture(client);
    const { result } = await startSave(context);
    submitPassword("wrong");
    expect((await screen.findByRole("alert")).textContent).toContain("操作密码不正确");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(context.businessRequests()).toHaveLength(1);
    submitPassword();
    await act(async () => { expect(await result).toEqual({ ok: true }); });
    expect(context.businessRequests()).toHaveLength(2);
  });

  test("retries a rejected write only once even if the retry also returns 428", async () => {
    const context = fixture(client, { retryStatus: 428 });
    const { result } = await startSave(context);
    submitPassword();
    await act(async () => { expect(await result).toMatchObject({ ok: false, error: { message: "仍需操作密码" } }); });
    expect(context.businessRequests()).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("retries the captured payload rather than later mutations to the caller record", async () => {
    const context = fixture(client);
    const { result } = await startSave(context);
    context.record.spend = 99;
    submitPassword();
    await act(async () => { expect(await result).toEqual({ ok: true }); });
    const writes = context.businessRequests();
    expect(writes[1].body).toBe(writes[0].body);
    expect(JSON.parse(writes[1].body).operations?.[0].records[0].spend ?? JSON.parse(writes[1].body).records[0].spend).toBe(20);
  });

  test("ignores verification that completes after cancellation", async () => {
    const context = fixture(client, { delayedVerification: true });
    const { result } = await startSave(context);
    submitPassword();
    await waitFor(() => expect(context.requests).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { expect(await result).toMatchObject({ ok: false }); });
    await act(async () => { context.finishVerification(); });
    expect(context.businessRequests()).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("rejects the waiting write when the password dialog unmounts", async () => {
    const context = fixture(client);
    const { result } = await startSave(context);
    context.view.unmount();
    expect(await result).toMatchObject({ ok: false, error: { message: "取消操作" } });
    expect(context.requests).toHaveLength(1);
  });

  test("rejects overlapping authorization without replacing the original waiting write", async () => {
    const context = fixture(client);
    const { result } = await startSave(context);
    let overlap!: Result;
    await act(async () => { overlap = await context.start(); });
    expect(overlap).toMatchObject({ ok: false });
    expect(!overlap.ok && overlap.error.message).toContain("其他操作");
    submitPassword();
    await act(async () => { expect(await result).toEqual({ ok: true }); });
    expect(context.businessRequests()).toHaveLength(3);
  });

  test("does not open the password dialog for a non-428 error", async () => {
    const context = fixture(client, { initialStatus: 403 });
    let result!: Result;
    await act(async () => { result = await context.start(); });
    expect(result).toMatchObject({ ok: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(context.requests).toHaveLength(1);
  });

  test("prevents duplicate password submissions while validation is pending", async () => {
    const context = fixture(client, { delayedVerification: true });
    const { result } = await startSave(context);
    submitPassword();
    submitPassword();
    await waitFor(() => expect(context.requests).toHaveLength(2));
    expect((screen.getByRole("button", { name: "验证中…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { context.finishVerification(); expect(await result).toEqual({ ok: true }); });
    expect(context.requests).toHaveLength(3);
  });

  test("Escape cancels before any password submission", async () => {
    const context = fixture(client);
    const { result } = await startSave(context);
    fireEvent.keyDown(screen.getByLabelText("操作密码"), { key: "Escape" });
    await act(async () => { expect(await result).toMatchObject({ ok: false, error: { message: "取消操作" } }); });
    expect(context.requests).toHaveLength(1);
  });
});
