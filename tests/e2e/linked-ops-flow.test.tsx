// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import Dashboard from "../../app/page";
import { configureOpsDbForTests, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

afterEach(async () => { cleanup(); history.replaceState(null, "", "/"); await resetOpsDbForTests(); });

describe("linked operations navigation", () => {
  test("persists global filters and module in the URL", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    render(<Dashboard />);
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getAllByLabelText("尺码")[0], { target: { value: "XL" } });
    fireEvent.click(screen.getByRole("button", { name: "关键词排名" }));
    await screen.findByRole("heading", { name: "关键词排名" });
    await waitFor(() => expect(location.search).toContain("page=keywords"));
    expect(location.search).toContain("startDate=2026-10-01");
    expect(location.search).toContain("size=XL");
  });
});
