import { beforeAll, describe, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

let server: typeof import("../../src/server/store");
let route: typeof import("../../app/api/ops/[resource]/route");
let configureRepository: typeof import("../../db/ops-server").configureOpsRepositoryForTests;
let createRepository: typeof import("../../db/ops-sqlite").createSqliteOpsRepository;
let sessionCookie: string;
let writeCookie: string;

beforeAll(async () => {
  vi.stubEnv("SANTA_OPS_DATA_DIR", mkdtempSync(join(tmpdir(), "santa-ops-session-auth-")));
  vi.stubEnv("SANTA_OPS_PASSWORD", "test-access-password");
  vi.stubEnv("SANTA_OPS_OPERATION_PASSWORD", "test-operation-password");
  delete process.env.SANTA_OPS_API_TOKEN;
  server = await import("../../src/server/store");
  route = await import("../../app/api/ops/[resource]/route");
  ({ configureOpsRepositoryForTests: configureRepository } = await import("../../db/ops-server"));
  ({ createSqliteOpsRepository: createRepository } = await import("../../db/ops-sqlite"));
  configureRepository(createRepository(new DatabaseSync(":memory:")));
  sessionCookie = `santa_ops_session=${server.createSession()}`;
  writeCookie = `santa_ops_write=${server.createOperationSession()}`;
});

describe("operations API browser-session authorization", () => {
  test("lets a signed-in browser read operations data", async () => {
    const response = await route.GET(new Request("http://shared.test/api/ops/competitors", {
      headers: { cookie: sessionCookie },
    }), { params: Promise.resolve({ resource: "competitors" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ records: [] });
  });

  test("requires operation authorization before a signed-in browser can upload", async () => {
    const request = (cookie: string) => new Request("http://shared.test/api/ops/competitors", {
      method: "POST",
      headers: { cookie, origin: "http://shared.test", "content-type": "application/json" },
      body: JSON.stringify({
        records: [{ id: "row-1", marketplace: "US", date: "2026-09-14", competitorAsin: "B012345678", price: 55.99 }],
        importBatch: { id: "batch-1", filename: "competitors.xlsx", importedAt: "2026-09-24T01:00:00.000Z" },
      }),
    });

    const locked = await route.POST(request(sessionCookie), { params: Promise.resolve({ resource: "competitors" }) });
    expect(locked.status).toBe(428);

    const unlocked = await route.POST(request(`${sessionCookie}; ${writeCookie}`), { params: Promise.resolve({ resource: "competitors" }) });
    expect(unlocked.status).toBe(201);
  });
});
