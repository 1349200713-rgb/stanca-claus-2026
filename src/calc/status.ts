import type { Status } from "../domain/types";

/** Binding target semantics: known failures are risk; attention is reserved for unknown data. */
export function statusForTarget(value: number | null, target: number, higherIsBetter: boolean): Status {
  if (value === null) return "attention";
  return higherIsBetter
    ? value >= target ? "complete" : "risk"
    : value <= target ? "complete" : "risk";
}
