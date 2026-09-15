// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { PromotionPage } from "../../src/components/PromotionPage";
import { parsePromotionPlanReport } from "../../src/import/promotion-plan-parser";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

function file(name: string, csv: string): File {
  const report = new File([csv], name, { type: "text/csv" });
  Object.defineProperty(report, "arrayBuffer", { value: async () => new TextEncoder().encode(csv).buffer });
  return report;
}

function workbookFile(name: string, rows: Record<string, string | number>[]): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Sheet1");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const report = new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(report, "arrayBuffer", { value: async () => bytes });
  return report;
}

afterEach(async () => {
  cleanup();
  await resetOpsDbForTests();
});

describe("promotion plan import", () => {
  test("parses Chinese daily promotion plan fields by date", async () => {
    const result = parsePromotionPlanReport(
      new TextEncoder().encode("日期,阶段,目标日销,目标ACOS,目标价格,站外计划,操作重点,测评计划,服务商,测评数量,备注\n2026-09-03,准备期,5,ACOS≤45%,$59.99,站外预热,检查Listing,补评2单,服务商A,2,重点日").buffer,
      "推广计划.csv",
    );

    expect(result.fatal).toBe(false);
    expect(result.records).toEqual([{
      key: "promotion-plan:2026-09-03",
      date: "2026-09-03",
      phase: "准备期",
      targetDailyUnits: 5,
      targetAcos: "ACOS≤45%",
      targetPrice: "$59.99",
      offsitePlan: "站外预热",
      operationFocus: "检查Listing",
      reviewPlan: "补评2单",
      serviceProvider: "服务商A",
      reviewQuantity: 2,
      note: "重点日",
      updatedAt: expect.any(String),
    }]);
  });

  test("uploads an xlsx promotion plan and overrides the matching daily row", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<PromotionPage ads={[]} business={[]} manual={[]} startDate="2026-10-02" endDate="2026-10-03" onBack={() => undefined} />);

    fireEvent.change(screen.getByLabelText("上传/更新推广计划"), {
      target: { files: [workbookFile("推广计划.xlsx", [
        { 日期: "2026-10-02", 阶段: "自定义准备", 目标日销: 6, 目标ACOS: "ACOS≤45%", 目标价格: "$58.99", 站外计划: "站外预热", 操作重点: "优化主图", 测评计划: "补评2单", 服务商: "服务商A", 测评数量: 2 },
      ])] },
    });

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("推广计划已更新 1 天"));
    expect(await opsDb.listPromotionPlanOverrides()).toMatchObject([{ date: "2026-10-02", phase: "自定义准备", targetDailyUnits: 6 }]);
    expect(await opsDb.list("imports")).toMatchObject([{ filename: "推广计划.xlsx", reportKind: "promotionPlan", rowCount: 1 }]);
    expect(await opsDb.list("rawImports")).toHaveLength(1);
    expect(await opsDb.list("rawRows")).toMatchObject([{ values: { 日期: "2026-10-02", 阶段: "自定义准备" } }]);

    const table = screen.getByRole("table", { name: "每日推广作战表" });
    within(table).getByRole("row", { name: /2026-10-02/ });
    expect((screen.getByLabelText("2026-10-02 阶段") as HTMLInputElement).value).toBe("自定义准备");
    expect((screen.getByLabelText("2026-10-02 目标日销") as HTMLInputElement).value).toBe("6");
    expect((screen.getByLabelText("2026-10-02 站外计划") as HTMLTextAreaElement).value).toBe("站外预热");
    expect((screen.getByLabelText("2026-10-02 服务商") as HTMLInputElement).value).toBe("服务商A");
  });

  test("archives every promotion plan upload instead of only keeping the current plan", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<PromotionPage ads={[]} business={[]} manual={[]} startDate="2026-10-02" endDate="2026-10-03" onBack={() => undefined} />);

    fireEvent.change(screen.getByLabelText("上传/更新推广计划"), {
      target: { files: [file("推广计划-第一版.csv", "日期,阶段,目标日销\n2026-10-02,第一版,3")] },
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("推广计划已更新 1 天"));

    fireEvent.change(screen.getByLabelText("上传/更新推广计划"), {
      target: { files: [file("推广计划-第二版.csv", "日期,阶段,目标日销\n2026-10-03,第二版,4")] },
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("推广计划已更新 1 天"));

    expect(await opsDb.listPromotionPlanOverrides()).toMatchObject([
      { date: "2026-10-02", phase: "第一版", targetDailyUnits: 3 },
      { date: "2026-10-03", phase: "第二版", targetDailyUnits: 4 },
    ]);
    expect(await opsDb.list("imports")).toMatchObject([
      { filename: "推广计划-第一版.csv", reportKind: "promotionPlan" },
      { filename: "推广计划-第二版.csv", reportKind: "promotionPlan" },
    ]);
    expect(await opsDb.list("rawImports")).toHaveLength(2);
    expect(await opsDb.list("rawRows")).toHaveLength(2);
  });

  test("shows import issues and does not save rows without valid dates", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<PromotionPage ads={[]} business={[]} manual={[]} startDate="2026-09-03" endDate="2026-09-04" onBack={() => undefined} />);

    fireEvent.change(screen.getByLabelText("上传/更新推广计划"), {
      target: { files: [file("推广计划.csv", "阶段,目标日销\n准备期,6")] },
    });

    await waitFor(() => expect(screen.getByText(/Missing required column: date/)).toBeTruthy());
    expect(await opsDb.listPromotionPlanOverrides()).toEqual([]);
  });

  test("finds a lower header row and expands weekly promotion rows into daily overrides", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["推广计划与每周尺码销量"],
      ["单位：件"],
      ["说明行"],
      ["开始日期", "结束日期", "阶段", "周销量目标", "L周销量", "XL周销量", "2XL周销量", "3XL周销量", "目标日销", "目标转化率", "目标广告订单占比", "ACOS目标", "预计售价", "计划利润（扣推广预提）", "站外", "操作重点", "评价与售后", "计划期末剩余", "计划广告额度", "计划销售额", "广告日均额度", "计划推广预提"],
      ["09/25", "10/01", "冷启动测试", 7, 2, 3, 1, 1, 1, "3%-5%", "25%-30%", "ACOS≤50%", "59.99", "$100", "站外预热", "开自动广告", "补评价：3单", 2993, "$20", "$420", "$3", "$30"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    const result = parsePromotionPlanReport(bytes, "推广计划与周销量分析.xlsx", "2026-09-07T00:00:00.000Z");

    expect(result.fatal).toBe(false);
    expect(result.records).toHaveLength(7);
    expect(result.records[0]).toMatchObject({
      date: "2026-09-25",
      phase: "冷启动测试",
      weeklyTargetUnits: 7,
      lWeeklyUnits: 2,
      xlWeeklyUnits: 3,
      twoXlWeeklyUnits: 1,
      threeXlWeeklyUnits: 1,
      targetDailyUnits: 1,
      targetConversionRate: "3%-5%",
      targetAdOrderShare: "25%-30%",
      targetAcos: "ACOS≤50%",
      targetPrice: "59.99",
      plannedProfit: "$100",
      plannedEndingInventory: 2993,
      plannedAdBudget: "$20",
      plannedSales: "$420",
      dailyAdBudget: "$3",
      plannedPromotionReserve: "$30",
      offsitePlan: "站外预热",
      operationFocus: "开自动广告",
      reviewPlan: "补评价：3单",
    });
    expect(result.records.at(-1)).toMatchObject({ date: "2026-10-01", phase: "冷启动测试", targetDailyUnits: 1 });
  });

  test("ignores summary and note rows below the dated promotion plan", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["圣诞服推广计划｜10月2日启动调整版"],
      ["开始日期", "结束日期", "阶段", "周销量目标", "目标日销", "站外"],
      ["10/02", "10/08", "启动测试", 21, 3, "站外预热"],
      ["计划合计", "", "", 3000, "", ""],
      ["调整说明：首周10/2—10/8；实际区手填，未填不显示0业绩。", "", "", "", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    const result = parsePromotionPlanReport(bytes, "圣诞服推广计划-10月2日启动调整版.xlsx", "2026-09-07T00:00:00.000Z");

    expect(result.fatal).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(7);
    expect(result.records[0]).toMatchObject({ date: "2026-10-02", phase: "启动测试", targetDailyUnits: 3, offsitePlan: "站外预热" });
  });

  test("lets operators edit and save daily promotion plan fields", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.replacePromotionPlanOverrides([{
      key: "promotion-plan:2026-10-02",
      date: "2026-10-02",
      phase: "启动测试",
      targetDailyUnits: 3,
      offsitePlan: "站外预热",
      updatedAt: "2026-09-07T00:00:00.000Z",
    }]);

    render(<PromotionPage ads={[]} business={[]} manual={[]} startDate="2026-10-02" endDate="2026-10-02" onBack={() => undefined} />);

    const targetInput = await screen.findByLabelText("2026-10-02 目标日销");
    expect(screen.getByRole("table", { name: "每日推广作战表" }).textContent).toContain("10月2号");
    fireEvent.change(targetInput, { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("2026-10-02 服务商"), { target: { value: "服务商B" } });
    fireEvent.change(screen.getByLabelText("2026-10-02 站外推广出单"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "保存计划修改" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("计划修改已保存 1 天"));
    expect(await opsDb.listPromotionPlanOverrides()).toMatchObject([{ date: "2026-10-02", targetDailyUnits: 8, serviceProvider: "服务商B", offsiteOrders: 12 }]);
  });
});
