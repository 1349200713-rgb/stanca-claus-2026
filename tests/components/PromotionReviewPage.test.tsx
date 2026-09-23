// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PromotionReviewPage } from "../../src/components/PromotionReviewPage";

describe("PromotionReviewPage", () => {
  test("keeps original charts and adds funnel charts with operation events", () => {
    render(<PromotionReviewPage
      ads={[]}
      business={[]}
      overrides={[]}
      operations={[{ key: "op-1", date: "2026-10-02", action: "启动广告", risk: "", tomorrowPlan: "", status: "已完成", note: "", updatedAt: "2026-10-02T00:00:00Z" }]}
      startDate="2026-10-02"
      endDate="2026-10-02"
      onBack={() => undefined}
    />);

    for (const title of [
      "计划销量 vs 实际销量", "计划广告 vs 实际广告", "目标ACOS vs 实际ACOS", "计划销售额 vs 实际销售额",
      "曝光量 / 点击量", "访问量 / 订单量", "CTR / CVR", "CPC / 广告花费", "ACOS / TACOS",
    ]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    for (const range of ["7日", "14日", "30日", "自定义"]) expect(screen.getByRole("button", { name: range })).toBeTruthy();
    expect(screen.getAllByText("启动广告").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/暂无数据/).length).toBeGreaterThan(0);
  });
});
