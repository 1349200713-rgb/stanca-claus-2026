import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const origin = "http://127.0.0.1:3011";
let server: typeof import("../../src/server/store");
let sessionRoute: typeof import("../../app/api/auth/session/route");
let operationRoute: typeof import("../../app/api/auth/operation/route");
let dataRoute: typeof import("../../app/api/data/route");
let opsRoute: typeof import("../../app/api/ops/[resource]/route");

beforeAll(async () => {
  vi.stubEnv("SANTA_OPS_DATA_DIR", mkdtempSync(join(tmpdir(), "santa-local-access-test-")));
  vi.stubEnv("SANTA_OPS_PASSWORD", "test-access-password");
  vi.stubEnv("SANTA_OPS_OPERATION_PASSWORD", "test-operation-password");
  vi.stubEnv("SANTA_OPS_API_TOKEN", "");
  vi.stubEnv("SANTA_OPS_PROXY_SECRET", "");
  server = await import("../../src/server/store");
  sessionRoute = await import("../../app/api/auth/session/route");
  operationRoute = await import("../../app/api/auth/operation/route");
  dataRoute = await import("../../app/api/data/route");
  opsRoute = await import("../../app/api/ops/[resource]/route");
  const { configureOpsRepositoryForTests } = await import("../../db/ops-server");
  const { createSqliteOpsRepository } = await import("../../db/ops-sqlite");
  configureOpsRepositoryForTests(createSqliteOpsRepository(new DatabaseSync(":memory:")));
});
beforeEach(() => vi.stubEnv("SANTA_OPS_LOCAL_PASSWORDLESS_ORIGIN", ""));
afterAll(() => vi.unstubAllEnvs());

function sessionRequest(url = origin, headers: HeadersInit = {}) {
  const requestHeaders = new Headers({ host: new URL(url).host });
  new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));
  return new Request(`${url}/api/auth/session`, { headers: requestHeaders });
}
async function localCookie() {
  vi.stubEnv("SANTA_OPS_LOCAL_PASSWORDLESS_ORIGIN", origin);
  const response = await sessionRoute.GET(sessionRequest());
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toMatch(/^santa_ops_session=/);
  return cookie!;
}

describe("local-only passwordless access", () => {
  test("keeps password login as the default even for localhost", async () => {
    const response = await sessionRoute.GET(sessionRequest());
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("issues a real read session only at the explicitly configured local origin", async () => {
    vi.stubEnv("SANTA_OPS_LOCAL_PASSWORDLESS_ORIGIN", origin);
    const response = await sessionRoute.GET(sessionRequest(origin, { host: "127.0.0.1:3011", origin }));
    expect(await response.json()).toEqual({ authenticated: true, localPasswordless: true });
    const cookie = response.headers.get("set-cookie")!;
    const token = cookie.split(";")[0].split("=")[1];
    expect(server.isValidSession(token)).toBe(true);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const read = await dataRoute.GET(new Request(`${origin}/api/data?store=dailyOps`, { headers: { cookie } }));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ records: [] });
    const opsRead = await opsRoute.GET(new Request(`${origin}/api/ops/competitors`, { headers: { cookie } }), { params: Promise.resolve({ resource: "competitors" }) });
    expect(opsRead.status).toBe(200);
    expect(await opsRead.json()).toEqual({ records: [] });
  });

  test("reuses an existing valid local session instead of creating one on every refresh", async () => {
    const cookie = await localCookie();
    const response = await sessionRoute.GET(sessionRequest(origin, { cookie }));
    expect(await response.json()).toEqual({ authenticated: true, localPasswordless: true });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("does not grant a new local session when the Host header is missing", async () => {
    vi.stubEnv("SANTA_OPS_LOCAL_PASSWORDLESS_ORIGIN", origin);
    const response = await sessionRoute.GET(new Request(`${origin}/api/auth/session`));
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test.each([
    ["public host", "https://shared.test", origin, {}],
    ["another local port", "http://127.0.0.1:3012", origin, {}],
    ["lookalike host", "http://localhost.attacker.test:3011", origin, {}],
    ["public opt-in origin", "https://shared.test", "https://shared.test", {}],
    ["invalid opt-in", origin, "not-a-url", {}],
    ["opt-in with a path", origin, `${origin}/dashboard`, {}],
    ["opt-in with credentials", origin, "http://user:password@127.0.0.1:3011", {}],
    ["opt-in with query", origin, `${origin}?enabled=1`, {}],
    ["opt-in with fragment", origin, `${origin}#enabled`, {}],
    ["mismatched host", origin, origin, { host: "shared.test" }],
    ["cross-origin caller", origin, origin, { origin: "https://attacker.test" }],
    ["opaque origin", origin, origin, { origin: "null" }],
    ["empty origin", origin, origin, { origin: "" }],
    ["cross-site browser request", origin, origin, { "sec-fetch-site": "cross-site" }],
    ["same-site browser request", origin, origin, { "sec-fetch-site": "same-site" }],
    ["forwarded proxy host", origin, origin, { "x-forwarded-host": "shared.test" }],
    ["empty forwarded proxy host", origin, origin, { "x-forwarded-host": "" }],
    ["forwarded proxy address", origin, origin, { "x-forwarded-for": "203.0.113.9" }],
    ["forwarded proxy protocol", origin, origin, { "x-forwarded-proto": "https" }],
    ["real proxy address", origin, origin, { "x-real-ip": "203.0.113.9" }],
    ["standard proxy header", origin, origin, { forwarded: "for=203.0.113.9" }],
  ] as const)("does not grant passwordless access for %s", async (_name, url, configured, headers) => {
    vi.stubEnv("SANTA_OPS_LOCAL_PASSWORDLESS_ORIGIN", configured);
    const response = await sessionRoute.GET(sessionRequest(url, headers));
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("allows local saves without an operation password while retaining an access session", async () => {
    const cookie = await localCookie();
    const write = await dataRoute.POST(new Request(`${origin}/api/data`, {
      method: "POST", headers: { cookie, origin, host: "127.0.0.1:3011", "content-type": "application/json" },
      body: JSON.stringify({ store: "dailyOps", records: [{ key: "passwordless-local-write", date: "2026-10-06" }], mode: "insert" }),
    }));
    expect(write.status).toBe(200);
    const opsWrite = await opsRoute.POST(new Request(`${origin}/api/ops/competitors`, {
      method: "POST", headers: { cookie, origin, host: "127.0.0.1:3011", "content-type": "application/json" }, body: JSON.stringify({ records: [{ key: "local-passwordless-competitor", date: "2026-10-07" }], importBatch: { id: "local-passwordless-batch", filename: "manual", importedAt: "2026-10-07T00:00:00Z" } }),
    }), { params: Promise.resolve({ resource: "competitors" }) });
    expect(opsWrite.status).toBe(201);
    const opsRead = await opsRoute.GET(new Request(`${origin}/api/ops/competitors`, { headers: { cookie } }), { params: Promise.resolve({ resource: "competitors" }) });
    expect((await opsRead.json()).records).toContainEqual({ key: "local-passwordless-competitor", date: "2026-10-07" });
    const wrongPassword = await operationRoute.POST(new Request(`${origin}/api/auth/operation`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }),
    }));
    expect(wrongPassword.status).toBe(401);
    expect(server.listRecords("dailyOps")).toContainEqual({ key: "passwordless-local-write", date: "2026-10-06" });
  });

  test.each([
    ["public", "https://shared.test", { host: "shared.test" }],
    ["missing host", origin, {}],
    ["proxy", origin, { host: "127.0.0.1:3011", "x-forwarded-for": "203.0.113.9" }],
    ["cross-site", origin, { host: "127.0.0.1:3011", "sec-fetch-site": "cross-site" }],
  ] as const)("retains operation verification for %s even with a local access cookie", async (_name, url, extra) => {
    const cookie = await localCookie();
    const headers = { cookie, "content-type": "application/json", ...extra };
    const write = await dataRoute.POST(new Request(`${url}/api/data`, { method: "POST", headers, body: JSON.stringify({ store: "dailyOps", records: [] }) }));
    expect(write.status).toBe(428);
    const opsWrite = await opsRoute.POST(new Request(`${url}/api/ops/competitors`, { method: "POST", headers, body: JSON.stringify({ records: [] }) }), { params: Promise.resolve({ resource: "competitors" }) });
    expect(opsWrite.status).toBe(428);
  });

  test("keeps saving available after the correct operation password is entered", async () => {
    const cookie = await localCookie();
    const operation = await operationRoute.POST(new Request(`${origin}/api/auth/operation`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ password: "test-operation-password" }),
    }));
    expect(operation.status).toBe(200);
    const operationCookie = operation.headers.get("set-cookie")?.split(";")[0];
    const write = await dataRoute.POST(new Request(`${origin}/api/data`, {
      method: "POST", headers: { cookie: `${cookie}; ${operationCookie}`, origin, "content-type": "application/json" },
      body: JSON.stringify({ store: "dailyOps", records: [{ key: "allowed-local-write", date: "2026-10-06" }], mode: "insert" }),
    }));
    expect(write.status).toBe(200);
    expect(server.listRecords("dailyOps")).toContainEqual({ key: "allowed-local-write", date: "2026-10-06" });
  });
});
