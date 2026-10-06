// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { KeywordVolumePanel } from "../../src/components/KeywordVolumePanel";
import type { SearchVolumeSnapshot } from "../../src/domain/keyword-volume";
import { parseKeywordVolumeReport } from "../../src/import/keyword-volume-parser";

afterEach(cleanup);
const day = (date: string, searchVolume: number | null, keyword = "santa costume"): SearchVolumeSnapshot => ({
  id: `keyword-volume:day:${date}:${keyword}`, kind: "search-volume", marketplace: "US", keywordId: keyword, keyword,
  scope: "market", source: "每日原始记录", period: "day", periodStart: date, periodEnd: date, searchVolume, updatedAt: "2026-10-06T00:00:00Z",
});
const week: SearchVolumeSnapshot = { ...day("2026-10-04", 777), id: "keyword-volume:weekly", period: "week", periodStart: "2026-09-28", periodEnd: "2026-10-04" };
const panel = (rows: SearchVolumeSnapshot[]) => render(<KeywordVolumePanel rows={rows} loaded onUpload={async () => undefined} />);

test("defaults to daily observations and never redistributes a weekly total into days", () => {
  panel([day("2026-10-04", 100), day("2026-10-05", 120), week]);
  expect((screen.getByLabelText("搜索量统计周期") as HTMLSelectElement).value).toBe("day");
  const table = screen.getByRole("table", { name: "搜索量每日明细" });
  expect(table.textContent).toContain("2026-10-05");
  expect(table.textContent).not.toContain("777");
  expect(within(table).getByRole("columnheader", { name: "日期" })).toBeTruthy();
  expect(within(table).getByRole("columnheader", { name: "当日搜索量（次）" })).toBeTruthy();
  expect(within(table).getByRole("columnheader", { name: "前一天搜索量" })).toBeTruthy();
  expect(within(table).getByRole("row", { name: /santa costume 2026-10-05/ }).textContent).toContain("+20.0%");
  expect(table.textContent).not.toContain("2026-10-05 至 2026-10-05");
  fireEvent.change(screen.getByLabelText("搜索量统计周期"), { target: { value: "week" } });
  expect(screen.getByRole("table", { name: "搜索量周期明细" }).textContent).toContain("777");
});

test("daily date and keyword filters update the table and plot without filling missing days", () => {
  panel([day("2026-10-01", 100), day("2026-10-03", 120), day("2026-10-03", 800, "santa hat")]);
  fireEvent.click(screen.getByLabelText("选择关键词 santa hat"));
  fireEvent.change(screen.getByLabelText("搜索量开始日期"), { target: { value: "2026-10-03" } });
  fireEvent.change(screen.getByLabelText("搜索量结束日期"), { target: { value: "2026-10-03" } });
  const table = screen.getByRole("table", { name: "搜索量每日明细" });
  expect(table.textContent).not.toContain("2026-10-01");
  expect(table.textContent).not.toContain("santa hat");
  const row = within(table).getByRole("row", { name: /santa costume 2026-10-03/ });
  expect(row.textContent).toContain("缺少前一天数据");
  expect(row.textContent).not.toContain("+20.0%");
  const chart = screen.getByRole("img", { name: "关键词每日搜索量趋势图" });
  expect(chart.querySelectorAll("circle")).toHaveLength(1);
  expect(chart.textContent).not.toContain("santa hat");
});

test("the downloadable daily template is accepted by the actual parser when a row is added", () => {
  panel([]);
  const link = screen.getByRole("link", { name: "下载搜索量模板" }) as HTMLAnchorElement;
  const template = decodeURIComponent(link.getAttribute("href")!.split(",").slice(1).join(","));
  const csv = `${template}santa costume,B0CFPYYPRN,day,2026-10-06,25,market,每日原始记录\n`;
  const parsed = parseKeywordVolumeReport(new TextEncoder().encode(csv).buffer, "daily.csv", "2026-10-06T00:00:00Z");
  expect(parsed.issues).toEqual([]);
  expect(parsed.records).toMatchObject([{ period: "day", periodStart: "2026-10-06", periodEnd: "2026-10-06", searchVolume: 25 }]);
});
