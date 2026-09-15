import { describe, expect, test } from "vitest";
import { parseInboundRows } from "../../src/import/inbound-parser";

describe("inbound parser", () => {
  test("parses shipment cadence rows and carries merged-cell values down", () => {
    const result = parseInboundRows([
      { 货件号: "FBA19MSY9TRD", 单价: "13.3/KG", 发货时效: "9.3号快开船；开始25-30天", ASIN: "B0CFPR34MH", 品名: "XL码 5JUN-RD 圣诞服9件套", SKU: "A022-XXX-09-0B500", 发货量: "15", 预计到仓时间: "10月5号" },
      { 货件号: "", 单价: "", 发货时效: "", ASIN: "B0CFQ3THBZ", 品名: "XXL码 5JUN-RD 圣诞服9件套", SKU: "A022-XXX-09-0C100", 发货量: "80", 预计到仓时间: "" },
    ], { defaultYear: 2026, updatedAt: "2026-09-10T08:00:00.000Z" });

    expect(result.fatal).toBe(false);
    expect(result.reportKind).toBe("inbound");
    expect(result.records).toMatchObject([
      {
        fbaNumber: "FBA19MSY9TRD",
        unitPrice: "13.3/KG",
        sku: "A022-XXX-09-0B500",
        asin: "B0CFPR34MH",
        productName: "XL码 5JUN-RD 圣诞服9件套",
        size: "XL",
        units: 15,
        shipDate: "2026-09-03",
        expectedArrivalDate: "2026-10-05",
      },
      {
        fbaNumber: "FBA19MSY9TRD",
        unitPrice: "13.3/KG",
        sku: "A022-XXX-09-0C100",
        asin: "B0CFQ3THBZ",
        productName: "XXL码 5JUN-RD 圣诞服9件套",
        size: "2XL",
        units: 80,
        shipDate: "2026-09-03",
        expectedArrivalDate: "2026-10-05",
      },
    ]);
  });
});
