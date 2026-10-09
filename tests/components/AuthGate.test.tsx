// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthGate } from "../../src/components/AuthGate";
import { requestOperationAuthorization } from "../../src/storage/operation-authorization";

beforeEach(() => vi.stubEnv("MODE", "production"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("enters the local dashboard without a password form and makes the access mode explicit", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ authenticated: true, localPasswordless: true }));
  render(<AuthGate><h1>测试驾驶舱</h1></AuthGate>);
  await screen.findByRole("heading", { name: "测试驾驶舱" });
  expect(screen.queryByLabelText("访问密码")).toBeNull();
  expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
  expect(screen.getByText("本地免密码 · 可直接保存")).toBeTruthy();
  expect(screen.getByRole("button", { name: "刷新数据" })).toBeTruthy();
});

test("continues showing the password form in the normal unauthenticated mode", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ authenticated: false }));
  render(<AuthGate><h1>测试驾驶舱</h1></AuthGate>);
  await screen.findByLabelText("访问密码");
  expect(screen.queryByRole("heading", { name: "测试驾驶舱" })).toBeNull();
  expect(screen.queryByText("本地免登录 · 保存仍需操作密码")).toBeNull();
});

test("keeps logout available for ordinary authenticated sessions", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ authenticated: true }));
  render(<AuthGate><h1>测试驾驶舱</h1></AuthGate>);
  await screen.findByRole("heading", { name: "测试驾驶舱" });
  expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
  expect(screen.queryByText("本地免登录 · 保存仍需操作密码")).toBeNull();
});

test("keeps the password dialog available if a protected operation explicitly requests authorization", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ authenticated: true, localPasswordless: true }));
  render(<AuthGate><h1>测试驾驶舱</h1></AuthGate>);
  await screen.findByRole("heading", { name: "测试驾驶舱" });
  let suppliedPassword = "";
  let authorization!: Promise<void>;
  await act(async () => { authorization = requestOperationAuthorization(async (password) => { suppliedPassword = password; }); });
  expect(screen.getByRole("dialog", { name: "操作密码验证" })).toBeTruthy();
  expect(suppliedPassword).toBe("");
  fireEvent.change(screen.getByLabelText("操作密码"), { target: { value: "user-entered-password" } });
  fireEvent.click(screen.getByRole("button", { name: "验证并继续保存" }));
  await act(async () => { await authorization; });
  expect(suppliedPassword).toBe("user-entered-password");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("本地免密码 · 可直接保存")).toBeTruthy();
});
