import { beforeAll, describe, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let server: typeof import("../../src/server/store");
let operationRoute: typeof import("../../app/api/auth/operation/route");
let dataRoute: typeof import("../../app/api/data/route");
let sessionCookie: string;

beforeAll(async () => {
  vi.stubEnv("SANTA_OPS_DATA_DIR", mkdtempSync(join(tmpdir(), "santa-operation-password-test-")));
  vi.stubEnv("SANTA_OPS_PASSWORD", "test-access-password");
  vi.stubEnv("SANTA_OPS_OPERATION_PASSWORD", "test-operation-password");
  server = await import("../../src/server/store");
  operationRoute = await import("../../app/api/auth/operation/route");
  dataRoute = await import("../../app/api/data/route");
  sessionCookie = `santa_ops_session=${server.createSession()}`;
});

describe("operation password", () => {
  test("reading remains available but writes require a separate operation session", async () => {
    const read = await dataRoute.GET(new Request("http://shared.test/api/data?store=dailyOps", { headers: { cookie: sessionCookie } }));
    expect(read.status).toBe(200);

    const write = await dataRoute.POST(new Request("http://shared.test/api/data", {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "http://shared.test", "content-type": "application/json" },
      body: JSON.stringify({ store: "dailyOps", records: [{ key: "blocked", date: "2026-11-24" }], mode: "insert" }),
    }));
    expect(write.status).toBe(428);
  });

  test("correct operation password unlocks writes", async () => {
    const response = await operationRoute.POST(new Request("http://shared.test/api/auth/operation", {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ password: "test-operation-password" }),
    }));
    expect(response.status).toBe(200);
    const operationCookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(operationCookie).toMatch(/^santa_ops_write=/);

    const write = await dataRoute.POST(new Request("http://shared.test/api/data", {
      method: "POST",
      headers: { cookie: `${sessionCookie}; ${operationCookie}`, origin: "http://shared.test", "content-type": "application/json" },
      body: JSON.stringify({ store: "dailyOps", records: [{ key: "allowed", date: "2026-11-24" }], mode: "insert" }),
    }));
    expect(write.status).toBe(200);
  });

  test("wrong operation password is rejected", async () => {
    const response = await operationRoute.POST(new Request("http://shared.test/api/auth/operation", {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-operation-password" }),
    }));
    expect(response.status).toBe(401);
  });
});

