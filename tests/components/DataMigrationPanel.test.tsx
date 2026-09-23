// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { DataMigrationPanel } from "../../src/components/DataMigrationPanel";

afterEach(cleanup);

describe("DataMigrationPanel", () => {
  test("requires preview and confirmation before copying local data", async () => {
    let migrations = 0;
    render(<DataMigrationPanel preview={async () => ({ business: 2, ads: 1 })} migrate={async () => { migrations += 1; }} />);
    fireEvent.click(screen.getByRole("button", { name: "检查本机数据" }));
    await screen.findByText("业务数据：2 条");
    expect(screen.getByText("迁移完成后，本机数据仍会保留。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认复制到云端" }));
    await waitFor(() => expect(migrations).toBe(1));
    expect(screen.getByRole("status").textContent).toContain("复制完成");
  });
});
