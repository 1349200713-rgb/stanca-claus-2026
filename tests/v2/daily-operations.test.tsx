// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import Dashboard from "../../app/page";
import { parseDailyOperationsFile } from "../../src/import/daily-operations-parser";
import { configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

function csvFile(name: string, csv: string): File {
  const report = new File([csv], name, { type: "text/csv" });
  Object.defineProperty(report, "arrayBuffer", { value: async () => new TextEncoder().encode(csv).buffer });
  return report;
}

afterEach(async () => {
  cleanup();
  history.replaceState(null, "", "/");
  await resetOpsDbForTests();
});

describe("daily operations page", () => {
  test("finds a lower header row and maps the user's workbook columns", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["santa claus costume ", "", "", "", "", "", ""],
      ["日期", "工作记录", "完成状态", "问题与风险", "明日工作计划", "备注", ""],
      [46223, "确认备货数量", "未完成:待采购反馈", "交期风险", "联系采购", "采购周期", "补充说明"],
      [46224, "分析尺码占比", "已完成", "", "确认采购比例", "尺码表", ""],
      [46225, "", "已完成", "", "", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    const result = parseDailyOperationsFile(bytes, "工作簿1.xlsx", "2026-09-18T00:00:00.000Z");

    expect(result.skipped).toBe(1);
    expect(result.records).toMatchObject([
      {
        date: "2026-07-20",
        action: "确认备货数量",
        status: "未完成",
        risk: "交期风险",
        tomorrowPlan: "联系采购",
        note: "采购周期\n补充说明",
      },
      {
        date: "2026-07-21",
        action: "分析尺码占比",
        status: "已完成",
        tomorrowPlan: "确认采购比例",
        note: "尺码表",
      },
    ]);
  });

  test("saves a note without requiring or displaying a time", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "每日操作" }));

    expect(await screen.findByRole("heading", { name: "每日操作记录" })).toBeTruthy();
    expect(screen.queryByLabelText("时间")).toBeNull();

    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText("动作"), { target: { value: "提高核心词预算" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "午后复查" } });
    fireEvent.click(screen.getByRole("button", { name: "保存每日操作" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("每日操作已保存"));
    expect(await opsDb.listDailyOperations()).toMatchObject([{
      date: "2026-10-02",
      action: "提高核心词预算",
      note: "午后复查",
    }]);

    const table = screen.getByRole("table", { name: "每日操作记录表" });
    expect(table.classList.contains("daily-operations-table")).toBe(true);
    expect(within(table).queryByRole("columnheader", { name: "时间" })).toBeNull();
    expect(within(table).getByRole("columnheader", { name: "备注" })).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "2026-10-02" }).classList.contains("daily-operation-date")).toBe(true);
    expect(within(table).getByText("午后复查")).toBeTruthy();
  });

  test("imports valid csv rows, reports invalid rows, and keeps existing records", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "每日操作" }));
    await screen.findByRole("heading", { name: "每日操作记录" });

    fireEvent.change(screen.getByLabelText("动作"), { target: { value: "原有记录" } });
    fireEvent.click(screen.getByRole("button", { name: "保存每日操作" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("每日操作已保存"));

    fireEvent.change(screen.getByLabelText("导入每日操作"), {
      target: { files: [csvFile("每日操作.csv", [
        "日期,动作,风险,明日计划,状态,备注",
        "2026-10-03,降低竞价,点击成本偏高,观察转化,未完成,核心词",
        "错误日期,无效记录,,,,",
      ].join("\n"))] },
    });

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("成功导入 1 条，跳过 1 条"));
    expect(await opsDb.listDailyOperations()).toHaveLength(2);
    expect(await opsDb.listDailyOperations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "原有记录" }),
      expect.objectContaining({ date: "2026-10-03", action: "降低竞价", note: "核心词", status: "未完成" }),
    ]));
    expect(screen.getByRole("table", { name: "每日操作记录表" }).textContent).toContain("降低竞价");
  });
});
