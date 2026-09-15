import { expectTypeOf, test } from "vitest";
import type { BusinessRecord, PlanRow, SizeCode } from "../../src/domain/types";

test("core records keep date, size and numeric values typed", () => {
  expectTypeOf<SizeCode>().toEqualTypeOf<"L" | "XL" | "2XL" | "3XL">();
  expectTypeOf<BusinessRecord["date"]>().toEqualTypeOf<string>();
  expectTypeOf<BusinessRecord["units"]>().toEqualTypeOf<number>();
  expectTypeOf<PlanRow["plannedUnits"]>().toEqualTypeOf<number>();
});
