// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ManualSalesForm } from "../../src/components/ManualSalesForm";
import { loadPlan } from "../../src/data/plan";
import type { BusinessRecord } from "../../src/domain/types";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const plan = loadPlan();
const old: BusinessRecord = { key: "business:2026-10-04:a022-xxx-09-0b500", date: "2026-10-04", asin: "B0CFPR34MH", sku: "A022-XXX-09-0B500", size: "XL", units: 2, sales: 100, sessions: 30, refunds: 0, discounts: 0 };

beforeEach(() => configureOpsDbForTests(createMemoryIdbFactory()));
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetOpsDbForTests(); });

function form(records: BusinessRecord[] = []) {
  const onSaved = vi.fn();
  render(<ManualSalesForm mappings={plan.primaryMappings} records={records} loaded onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("销售日期"), { target: { value: "2026-10-04" } });
  fireEvent.change(screen.getByLabelText("销售ASIN"), { target: { value: "b0cfpr34mh" } });
  fireEvent.change(screen.getByLabelText("销量（件）"), { target: { value: "8" } });
  fireEvent.change(screen.getByLabelText("销售额（USD）"), { target: { value: "400" } });
  fireEvent.change(screen.getByLabelText("售价（USD / 件）"), { target: { value: "59.99" } });
  fireEvent.change(screen.getByLabelText("折扣方式"), { target: { value: "Coupon百分比" } });
  fireEvent.change(screen.getByLabelText("折扣说明（选填）"), { target: { value: "10%" } });
  return onSaved;
}

test("saves daily totals, price, discount and mapped product to the shared business store", async () => {
  vi.stubGlobal("crypto", undefined);
  const onSaved = form();
  expect((screen.getByLabelText("销售SKU") as HTMLInputElement).value).toBe(old.sku);
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(await opsDb.list("business")).toMatchObject([{ date: old.date, asin: old.asin, sku: old.sku, size: "XL", units: 8, sales: 400, sellingPrice: 59.99, discountMethod: "Coupon百分比", discountDetails: "10%", source: "manual" }]);
  expect(await opsDb.list("imports")).toMatchObject([{ filename: "手动销量录入", rowCount: 1, action: "insert" }]);
});

test("requires explicit overwrite and retains imported traffic and financial fields", async () => {
  await opsDb.insert("business", [old]);
  const onSaved = form([old]);
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  await screen.findByRole("alert");
  expect(await opsDb.list("business")).toEqual([old]);
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(await opsDb.list("business")).toMatchObject([{ key: old.key, units: 8, sales: 400, sessions: 30, refunds: 0, discounts: 0 }]);
  expect(await opsDb.list("business")).toHaveLength(1);
});

test("finds an existing ASIN-only report and a newly loaded record before saving", async () => {
  const asinOnly = { ...old, key: `business:${old.date}:b0cfpr34mh`, sku: "" };
  await opsDb.insert("business", [asinOnly]);
  const onSaved = form();
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  await screen.findByText("该日期和商品已有数据，请确认覆盖后保存。");
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(await opsDb.list("business")).toMatchObject([{ key: asinOnly.key, sku: old.sku, units: 8 }]);
  expect(await opsDb.list("business")).toHaveLength(1);
});

test("rejects fractional quantities and unmapped products without writing", async () => {
  form();
  fireEvent.change(screen.getByLabelText("销量（件）"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  expect(screen.getByRole("alert").textContent).toContain("非负整数");
  fireEvent.change(screen.getByLabelText("销量（件）"), { target: { value: "8" } });
  fireEvent.change(screen.getByLabelText("销售SKU"), { target: { value: "UNKNOWN" } });
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  expect(screen.getByRole("alert").textContent).toContain("同一商品");
  expect(await opsDb.list("business")).toEqual([]);
});

test("records an observed zero-sales day and displays storage errors without success", async () => {
  const onSaved = form();
  fireEvent.change(screen.getByLabelText("销量（件）"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("销售额（USD）"), { target: { value: "0" } });
  const failedWrite = vi.spyOn(opsDb, "commitImport").mockRejectedValueOnce(new Error("网络连接失败"));
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  expect((await screen.findByRole("alert")).textContent).toContain("网络连接失败");
  expect(onSaved).not.toHaveBeenCalled();
  failedWrite.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "保存销量" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(await opsDb.list("business")).toMatchObject([{ units: 0, sales: 0 }]);
});
