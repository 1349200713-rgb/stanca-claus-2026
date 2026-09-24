import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { parseCompetitorReport, parseCompetitorRows } from "../../src/import/competitor-parser";

describe("competitor report parser", () => {
  test("recognizes Chinese columns and keeps blank measurements unknown", () => {
    const result = parseCompetitorRows([
      { 日期: "2026-10-02", 竞品ASIN: "b012345678", 品牌: "North", 价格: "$49.99", 优惠: "10%", 评分: "4.5", 评论数: "120", BSR排名: "1,200" },
      { 日期: "2026-10-02", 竞品ASIN: "B087654321", 价格: "", 评分: "", 评论数: "", BSR排名: "" },
    ], "2026-10-02T01:00:00.000Z");
    expect(result.records[0]).toMatchObject({ date: "2026-10-02", marketplace: "US", competitorAsin: "B012345678", price: 49.99, couponPercent: 10, bsrRank: 1200 });
    expect(result.records[1]).toMatchObject({ price: null, rating: null, reviewCount: null, bsrRank: null });
    expect(result.issues).toEqual([]);
  });

  test("rejects rows without a valid date or ASIN", () => {
    const result = parseCompetitorRows([{ 日期: "2026-99-99", 竞品ASIN: "B012345678" }], "2026-10-02T01:00:00.000Z");
    expect(result.records).toEqual([]);
    expect(result.issues).toHaveLength(1);
  });

  test("accepts an Excel serial date", () => {
    expect(parseCompetitorRows([{ 日期: 46358, 竞品ASIN: "B012345678" }]).records[0]?.date).toBe("2026-12-02");
  });

  test("imports every competitor worksheet and expands merged dates across size rows", () => {
    const workbook = XLSX.utils.book_new();
    const competitor = XLSX.utils.aoa_to_sheet([
      ["https://www.amazon.com/dp/B077MBK8RM"],
      ["Potalay | B077MBK8RM"],
      ["记录日期", "尺码", "评分", "大类排名", "小类目排名", "页面售价 USD", "Coupon比例", "CODE", "Prime Savings", "CODE单价 USD", "Coupon估算价 USD", "备注", "Coupon金额 USD", "颜色/款式"],
      ["2026-09-14", "L", 4.7, 92906, 220, 89.9, 0.2, "", "", "", 71.92, "", "", "Large"],
      ["", "XL", "", "", "", 99.9, "", 0.1, "", 89.91, "", "促销", "", "X-Large"],
      ["每6行为一个记录日期，以下内容是填写说明"],
    ]);
    competitor["!merges"] = [XLSX.utils.decode_range("A4:A5"), XLSX.utils.decode_range("C4:C5"), XLSX.utils.decode_range("D4:D5"), XLSX.utils.decode_range("E4:E5")];
    XLSX.utils.book_append_sheet(workbook, competitor, "Potalay");
    const own = XLSX.utils.aoa_to_sheet([
      ["https://www.amazon.com/dp/B0CFQ3TMBZ"],
      ["记录日期", "尺码", "评分", "大类排名", "小类目排名", "页面售价 USD", "Coupon比例", "CODE", "Prime Savings", "CODE单价 USD", "Coupon估算价 USD", "备注"],
      ["2026-09-17", "L", 4.4, 731869, 5699, 59.99, "", "", "买2件省15%"],
    ]);
    XLSX.utils.book_append_sheet(workbook, own, "ziji ");

    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const result = parseCompetitorReport(bytes, "竞品记录表.xlsx", "2026-09-18T00:00:00.000Z");

    expect(result.records).toHaveLength(3);
    expect(result.records[1]).toMatchObject({ date: "2026-09-14", competitorAsin: "B077MBK8RM", brand: "Potalay", size: "XL", categoryRank: 92906, subcategoryRank: 220, price: 99.9, codePercent: 10, effectivePrice: 89.91, colorStyle: "X-Large", source: "https://www.amazon.com/dp/B077MBK8RM", isOwnProduct: false });
    expect(result.records[2]).toMatchObject({ competitorAsin: "B0CFQ3TMBZ", size: "L", isOwnProduct: true, primeSavings: "买2件省15%" });
    expect(new Set(result.records.map((row) => row.id)).size).toBe(3);
    expect(result.issues).toEqual([]);
  });
});
