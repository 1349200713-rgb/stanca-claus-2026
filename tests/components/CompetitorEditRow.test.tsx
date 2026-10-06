import { describe, expect, test } from "vitest";
import { competitorDraft, competitorRecord } from "../../src/components/CompetitorEditRow";
import type { CompetitorSnapshot } from "../../src/domain/linkage";

const original: CompetitorSnapshot = {
  id: "imported-id", marketplace: "US", date: "2026-10-02", competitorAsin: "B012345678",
  brand: "SISROL", price: 49.99, effectivePrice: null, bsrRank: 88,
  source: "https://amazon.com/dp/B012345678", updatedAt: "2026-10-02T01:00:00Z",
};

describe("competitor manual edit validation", () => {
  test.each(["2026-02-30", "2026-04-31", "2025-02-29"])("rejects the impossible calendar date %s", (date) => {
    expect(() => competitorRecord(original, { ...competitorDraft(original), date })).toThrow(/日期/);
    expect(original.date).toBe("2026-10-02");
  });

  test.each([
    { field: "reviewCount", value: "1.5" },
    { field: "categoryRank", value: "0" }, { field: "categoryRank", value: "2.5" },
    { field: "subcategoryRank", value: "0" }, { field: "subcategoryRank", value: "3.5" },
  ] as const)("rejects $field=$value because counts need whole numbers and ranks start at one", ({ field, value }) => {
    expect(() => competitorRecord(original, { ...competitorDraft(original), [field]: value })).toThrow(/格式不正确/);
  });

  test("accepts an observed zero review count without accepting zero ranks", () => {
    const record = competitorRecord(original, { ...competitorDraft(original), reviewCount: "0" });
    expect(record.reviewCount).toBe(0);
    expect(record.id).toBe("imported-id");
  });

  test("a note-only edit preserves absent fields, the original id, and the recorded null effective price", () => {
    const record = competitorRecord(original, { ...competitorDraft(original), note: "verified" });
    expect(record).toMatchObject({ id: "imported-id", effectivePrice: null, bsrRank: 88, note: "verified" });
    expect(record.reviewCount).toBeUndefined();
    expect(record.couponAmount).toBeUndefined();
    expect(record.source).toBe("https://amazon.com/dp/B012345678");
  });

  test("an unchanged draft retains the business record timestamp", () => {
    expect(competitorRecord(original, competitorDraft(original))).toEqual(original);
  });
});
