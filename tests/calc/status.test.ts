import { describe, expect, it } from "vitest";
import { statusForTarget } from "../../src/calc/status";

describe("statusForTarget", () => {
  it.each([
    [0.9, 0.9, true, "complete"],
    [0.899, 0.9, true, "risk"],
    [0.21, 0.22, true, "risk"],
    [0.22, 0.22, true, "complete"],
    [0.22, 0.22, false, "complete"],
    [0.221, 0.22, false, "risk"],
  ] as const)("classifies %s against %s (higherIsBetter=%s) as %s", (value, target, higherIsBetter, expected) => {
    expect(statusForTarget(value, target, higherIsBetter)).toBe(expected);
  });

  it("reserves attention for missing data", () => {
    expect(statusForTarget(null, 0.9, true)).toBe("attention");
  });
});
