// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PromotionPage } from "../../src/components/PromotionPage";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const original = { key: "campaign-original", date: "2026-10-04", campaign: "Santa", spend: 10, adSales: 50, adOrders: 1 };
beforeEach(() => configureOpsDbForTests(createMemoryIdbFactory()));
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await resetOpsDbForTests(); });

test("the daily edit action opens original campaigns for that day, never edits the aggregate", async () => {
  await opsDb.insert("ads", [original]);
  const refresh = vi.fn();
  const view = render(<PromotionPage ads={[original]} business={[]} manual={[]} startDate="2026-10-04" endDate="2026-10-05" onBack={() => undefined} onAdsChanged={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "修改当日广告 2026-10-04" }));
  expect((screen.getByLabelText("广告日期") as HTMLInputElement).value).toBe("2026-10-04");
  fireEvent.click(within(screen.getByRole("table", { name: "当日广告活动数据" })).getByRole("button", { name: /编辑广告 Santa/ }));
  fireEvent.change(screen.getByLabelText("广告花费（USD）"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /确认覆盖/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存广告数据" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  const rows = await opsDb.list("ads");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ key: original.key, spend: 15 });
  view.rerender(<PromotionPage ads={rows} business={[]} manual={[]} startDate="2026-10-04" endDate="2026-10-05" onBack={() => undefined} onAdsChanged={refresh} />);
  const daily = screen.getByRole("table", { name: "每日推广作战表" });
  expect(within(daily).getByRole("row", { name: /2026-10-04/ }).textContent).toContain("US$15");
  fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
  expect(screen.queryByRole("heading", { name: "手动修改广告数据" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "修改当日广告 2026-10-05" }));
  expect((screen.getByLabelText("广告日期") as HTMLInputElement).value).toBe("2026-10-05");
  expect(screen.getByText("该日期暂无广告数据。")).toBeTruthy();
});

test("cancelled operation authorization is reported when saving a plan instead of an unhandled rejection", async () => {
  render(<PromotionPage ads={[]} business={[]} manual={[]} startDate="2026-10-04" endDate="2026-10-04" onBack={() => undefined} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "保存计划修改" }) as HTMLButtonElement).disabled).toBe(false));
  vi.spyOn(opsDb, "replacePromotionPlanOverrides").mockRejectedValue(new Error("已取消操作密码验证"));
  fireEvent.click(screen.getByRole("button", { name: "保存计划修改" }));
  await screen.findByText("已取消操作密码验证");
});

test("unloaded or failed ad reads are shown as unknown rather than zero spend", () => {
  const view = render(<PromotionPage ads={[]} business={[]} manual={[]} loaded={false} startDate="2026-10-04" endDate="2026-10-04" onBack={() => undefined} />);
  const spend = within(screen.getByRole("region", { name: "推广核心指标" })).getByText("广告花费").closest("article")!;
  expect(spend.textContent).toContain("加载中");
  expect(spend.textContent).not.toContain("US$0");
  view.rerender(<PromotionPage ads={[]} business={[]} manual={[]} error="连接失败" startDate="2026-10-04" endDate="2026-10-04" onBack={() => undefined} />);
  expect(spend.textContent).toContain("读取失败");
  expect((screen.getByRole("button", { name: "修改当日广告 2026-10-04" }) as HTMLButtonElement).disabled).toBe(true);
});
