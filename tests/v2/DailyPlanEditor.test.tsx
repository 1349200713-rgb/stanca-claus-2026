// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DailyPlanEditor } from "../../src/components/DailyPlanEditor";
import type { DailyPlanRow } from "../../src/domain/planning";

afterEach(cleanup);

const validRows: DailyPlanRow[] = [
  { date: "2026-11-02", size: "L", units: 1000 },
  { date: "2026-11-02", size: "XL", units: 1000 },
  { date: "2026-11-02", size: "2XL", units: 500 },
  { date: "2026-11-02", size: "3XL", units: 400 },
];

test("shows live summary values and the invalid state as a controlled editor changes", () => {
  function Harness() {
    const [rows, setRows] = useState(validRows);
    return <DailyPlanEditor rows={rows} onRowsChange={setRows} onSave={() => undefined} />;
  }

  render(<Harness />);

  expect(screen.getByRole("status").getAttribute("data-state")).toBe("valid");
  expect((screen.getByRole("status") as HTMLElement).style.color).toBe("green");
  expect(screen.getByText("Plan total: 2900")).not.toBeNull();
  expect(screen.getByText("Difference from 3000: -100")).not.toBeNull();
  fireEvent.change(screen.getByLabelText("2026-11-02 XL units"), { target: { value: "1201" } });

  expect(screen.getByRole("status").getAttribute("data-state")).toBe("invalid");
  expect((screen.getByRole("status") as HTMLElement).style.color).toBe("red");
  expect(screen.getByText("Plan total: 3101")).not.toBeNull();
});

test("blocks blank adjustment reasons and returns immutable valid rows on save", () => {
  const onSave = vi.fn();
  const rows = structuredClone(validRows);
  render(<DailyPlanEditor rows={rows} onRowsChange={() => undefined} onSave={onSave} />);

  const save = screen.getByRole("button", { name: "Save plan" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Adjustment reason"), { target: { value: "Rebalanced size mix" } });
  expect((save as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(save);

  expect(onSave).toHaveBeenCalledWith(validRows, "Rebalanced size mix");
  const savedRows = onSave.mock.calls[0][0] as DailyPlanRow[];
  expect(savedRows).not.toBe(rows);
  expect(savedRows[0]).not.toBe(rows[0]);
  expect(rows).toEqual(validRows);
});

test("does not save an out-of-range controlled plan", () => {
  const onSave = vi.fn();
  render(<DailyPlanEditor rows={[{ date: "2026-11-02", size: "XL", units: 2899 }]} onRowsChange={() => undefined} onSave={onSave} />);

  fireEvent.change(screen.getByLabelText("Adjustment reason"), { target: { value: "Too low" } });
  expect((screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
});
