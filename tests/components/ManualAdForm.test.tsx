// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ManualAdForm } from "../../src/components/ManualAdForm";
import { loadPlan } from "../../src/data/plan";
import type { AdRecord } from "../../src/domain/types";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const plan = loadPlan();
const old: AdRecord = { key: "ads:2026-10-04:santa", date: "2026-10-04", campaign: "Santa", spend: 10, adSales: 50, adOrders: 1 };

beforeEach(() => configureOpsDbForTests(createMemoryIdbFactory()));
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await resetOpsDbForTests(); });

function form(records: AdRecord[] = []) {
  render(<ManualAdForm mappings={plan.primaryMappings} records={records} loaded onSaved={() => undefined} />);
  fireEvent.change(screen.getByLabelText("广告日期"), { target: { value: "2026-10-04" } });
  fireEvent.change(screen.getByLabelText("广告活动名称"), { target: { value: "Santa" } });
  fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("广告销售额（USD）"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("广告订单（单）"), { target: { value: "2" } });
}

test("records search placement share and adjustment status and preserves unknown traffic as missing", async () => {
  vi.stubGlobal("crypto", undefined);
  form();
  fireEvent.change(screen.getByLabelText("搜索首页首位展示份额（%）"), { target: { value: "12.5" } });
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await screen.findByText(/广告数据已保存/);
  const rows = await opsDb.list("ads");
  expect(rows).toMatchObject([{ spend: 20, adSales: 100, adOrders: 2, acos: 0.2, roas: 5, topOfSearchImpressionShare: 0.125 }]);
  expect(rows[0].adjusted).toBeUndefined();
  expect(rows[0].clicks).toBeUndefined();
  expect(rows[0].impressions).toBeUndefined();
  expect(rows[0].cpc).toBeUndefined();
  expect(rows[0].cvr).toBeUndefined();
});

test("saves and reloads a manual adjustment record without changing campaign metrics or duplicating its row", async () => {
  await opsDb.insert("ads", [old]);
  const props = { mappings: plan.primaryMappings, records: [old], loaded: true, onSaved: () => undefined, initialRecord: old };
  render(<ManualAdForm {...props} />);
  fireEvent.change(screen.getByLabelText("调整日期"), { target: { value: "2026-10-08" } });
  fireEvent.change(screen.getByLabelText("调整内容"), { target: { value: "预算由5美元改为8美元，竞价改为固定" } });
  fireEvent.change(screen.getByLabelText("调整备注"), { target: { value: "明日复盘" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await screen.findByText(/广告数据已保存/);
  const saved = await opsDb.list("ads");
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ ...old, adjusted: true, adjustmentRecord: { date: "2026-10-08", content: "预算由5美元改为8美元，竞价改为固定", note: "明日复盘" } });
  cleanup();
  render(<ManualAdForm {...props} records={saved} initialRecord={saved[0]} />);
  expect((screen.getByLabelText("调整内容") as HTMLTextAreaElement).value).toBe("预算由5美元改为8美元，竞价改为固定");
  expect((screen.getByLabelText("调整备注") as HTMLInputElement).value).toBe("明日复盘");
});

test("updates an imported campaign only after confirmation and does not count it twice", async () => {
  await opsDb.insert("ads", [old]);
  form([old]);
  fireEvent.change(screen.getByLabelText("广告ASIN（选填）"), { target: { value: "B0CFPR34MH" } });
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await screen.findByRole("alert");
  expect(await opsDb.list("ads")).toEqual([old]);
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await screen.findByText(/广告数据已保存/);
  expect(await opsDb.list("ads")).toHaveLength(1);
  expect(await opsDb.list("ads")).toMatchObject([{ key: old.key, asin: "B0CFPR34MH", sku: "A022-XXX-09-0B500", spend: 20 }]);
});

test("rejects invalid placement shares and fractional purchases without saving", async () => {
  form();
  fireEvent.change(screen.getByLabelText("搜索首页首位展示份额（%）"), { target: { value: "101" } });
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  expect(screen.getByRole("alert").textContent).toContain("0 到 100");
  fireEvent.change(screen.getByLabelText("搜索首页首位展示份额（%）"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("广告订单（单）"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  expect(screen.getByRole("alert").textContent).toContain("非负整数");
  expect(await opsDb.list("ads")).toEqual([]);
});

test("edits and displays saved campaign metadata with all requested columns", async () => {
  const row = { ...old, impressions: 1000, clicks: 10, topOfSearchImpressionShare: 0.125, adjusted: true };
  await opsDb.insert("ads", [row]);
  form([row]);
  fireEvent.click(screen.getByRole("button", { name: /编辑广告/ }));
  expect((screen.getByLabelText("搜索首页首位展示份额（%）") as HTMLInputElement).value).toBe("12.5");
  expect((screen.getByLabelText("调整内容") as HTMLTextAreaElement).value).toBe("");
  expect(screen.getByRole("table", { name: "当日广告活动数据" }).textContent).toContain("已调整（旧记录无内容）");
  const table = screen.getByRole("table", { name: "当日广告活动数据" });
  expect(table.textContent).toContain("ACOS");
  expect(table.textContent).toContain("ROAS");
  expect(table.textContent).toContain("搜索结果首页首位展示量份额");
  fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await waitFor(async () => expect(await opsDb.list("ads")).toMatchObject([{ key: old.key, spend: 15, topOfSearchImpressionShare: 0.125, adjusted: true }]));
});

test("preloads an explicitly selected record and keeps its key when changing its identity", async () => {
  const row = { ...old, impressions: 1000, clicks: 10, ctr: 0.99, topOfSearchImpressionShare: 0.125, adjusted: true };
  await opsDb.insert("ads", [row]);
  const saved = vi.fn();
  render(<ManualAdForm mappings={plan.primaryMappings} records={[row]} loaded initialRecord={row} onSaved={saved} />);
  expect((screen.getByLabelText("广告日期") as HTMLInputElement).value).toBe(row.date);
  expect((screen.getByLabelText("广告活动名称") as HTMLInputElement).value).toBe(row.campaign);
  expect((screen.getByLabelText("搜索首页首位展示份额（%）") as HTMLInputElement).value).toBe("12.5");
  fireEvent.change(screen.getByLabelText("广告日期"), { target: { value: "2026-10-05" } });
  fireEvent.change(screen.getByLabelText("广告活动名称"), { target: { value: "Santa Revised" } });
  fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await screen.findByText(/广告数据已保存/);
  const rows = await opsDb.list("ads");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ key: old.key, date: "2026-10-05", campaign: "Santa Revised", spend: 15, cpc: 1.5, ctr: 0.01, acos: 0.3, roas: 50 / 15, topOfSearchImpressionShare: 0.125, adjusted: true });
  expect(saved).toHaveBeenCalledTimes(1);
});

test("cancel discards the edit without writing a record or import log", async () => {
  await opsDb.insert("ads", [old]);
  const cancel = vi.fn();
  render(<ManualAdForm mappings={plan.primaryMappings} records={[old]} loaded initialRecord={old} onSaved={vi.fn()} onCancel={cancel} />);
  fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "999" } });
  fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(await opsDb.list("ads")).toEqual([old]);
  expect(await opsDb.list("imports")).toEqual([]);
});

test("rejects an edit that would collide with a different stored record", async () => {
  const other = { ...old, key: "another-key", campaign: "Other" };
  await opsDb.insert("ads", [old, other]);
  render(<ManualAdForm mappings={plan.primaryMappings} records={[old, other]} loaded initialRecord={old} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("广告活动名称"), { target: { value: "Other" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  expect((await screen.findByRole("alert")).textContent).toContain("另一条");
  expect(await opsDb.list("ads")).toEqual([old, other]);
});

test("rejects a stale selected record instead of silently overwriting newer data", async () => {
  await opsDb.insert("ads", [{ ...old, spend: 77 }]);
  render(<ManualAdForm mappings={plan.primaryMappings} records={[old]} loaded initialRecord={old} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  expect((await screen.findByRole("alert")).textContent).toContain("已变更");
  expect(await opsDb.list("ads")).toMatchObject([{ spend: 77 }]);
});

test("does not recreate a selected record that has been removed", async () => {
  render(<ManualAdForm mappings={plan.primaryMappings} records={[old]} loaded initialRecord={old} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  expect((await screen.findByRole("alert")).textContent).toContain("不存在");
  expect(await opsDb.list("ads")).toEqual([]);
});

test("can open a selected day without inventing campaign data", () => {
  render(<ManualAdForm mappings={plan.primaryMappings} records={[old]} loaded initialDate={old.date} onSaved={vi.fn()} />);
  expect((screen.getByLabelText("广告日期") as HTMLInputElement).value).toBe(old.date);
  expect((screen.getByLabelText("广告花费（USD）") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /编辑广告/ }));
  expect(screen.getByRole("heading", { name: "手动修改广告数据" })).toBeTruthy();
});

test("new-entry mode can record a second day without silently editing the first day", async () => {
  form();
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await screen.findByText(/广告数据已保存/);
  fireEvent.change(screen.getByLabelText("广告日期"), { target: { value: "2026-10-05" } });
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await waitFor(async () => expect(await opsDb.list("ads")).toHaveLength(2));
  expect((await opsDb.list("ads")).map((row) => row.date).sort()).toEqual(["2026-10-04", "2026-10-05"]);
});

test("requires fresh confirmation if a matched campaign changed since it was displayed", async () => {
  await opsDb.insert("ads", [{ ...old, spend: 77 }]);
  form([old]);
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  expect((await screen.findByRole("alert")).textContent).toContain("已变更");
  expect(await opsDb.list("ads")).toMatchObject([{ spend: 77 }]);
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖已有总成本 US\$77.00/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await screen.findByText(/广告数据已保存/);
  expect(await opsDb.list("ads")).toMatchObject([{ key: old.key, spend: 20 }]);
  expect(await opsDb.list("ads")).toHaveLength(1);
});
