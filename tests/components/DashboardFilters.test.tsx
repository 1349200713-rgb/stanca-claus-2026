// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  DashboardFilters,
  type DashboardMode,
  type DashboardSize,
} from "../../src/components/DashboardFilters";

afterEach(cleanup);

test("reports size and mode changes through its controlled callbacks", () => {
  const onSizeChange = vi.fn();
  const onModeChange = vi.fn();

  function Harness() {
    const [size, setSize] = useState<DashboardSize>("all");
    const [mode, setMode] = useState<DashboardMode>("daily");
    return (
      <DashboardFilters
        startDate="2026-11-20"
        endDate="2026-11-26"
        size={size}
        mode={mode}
        onStartDateChange={() => undefined}
        onEndDateChange={() => undefined}
        onSizeChange={(next) => {
          onSizeChange(next);
          setSize(next);
        }}
        onModeChange={(next) => {
          onModeChange(next);
          setMode(next);
        }}
      />
    );
  }

  render(<Harness />);
  fireEvent.change(screen.getByLabelText("尺码"), { target: { value: "XL" } });
  fireEvent.click(screen.getByRole("radio", { name: "累计" }));

  expect(onSizeChange).toHaveBeenCalledWith("XL");
  expect(onModeChange).toHaveBeenCalledWith("cumulative");
  expect((screen.getByLabelText("尺码") as HTMLSelectElement).value).toBe("XL");
  expect((screen.getByRole("radio", { name: "累计" }) as HTMLInputElement).checked).toBe(true);
});
