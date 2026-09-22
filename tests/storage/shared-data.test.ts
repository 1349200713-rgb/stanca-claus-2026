import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryIdbFactory } from "./memory-idb";

let client: typeof import("../../src/storage/db");
let server: typeof import("../../src/server/store");
let route: typeof import("../../app/api/data/route");
let cookie: string;
let secondCookie: string;
const date = "2026-11-24";
const updatedAt = "2026-11-24T10:00:00Z";
const daily = { key: "daily:one", date, action: "Review ads", risk: "", tomorrowPlan: "", status: "未完成" as const, updatedAt };
const inbound = { size: "L" as const, units: 10, expectedArrivalDate: date, updatedAt };
const business = { key: "sales:one", date, asin: "ASIN", sku: "SKU", size: "L" as const, units: 5, sales: 100 };
const log = { key: "import:one", filename: "sales.csv", importedAt: updatedAt, reportKind: "business" as const, rowCount: 1, issueCount: 0, duplicateCount: 0, action: "insert" as const };

async function send(body: unknown, session = cookie) {
  return route.POST(new Request("http://shared.test/api/data", {
    method: "POST", headers: { cookie: session, "content-type": "application/json", origin: "http://shared.test" }, body: JSON.stringify(body),
  }));
}

async function readFromSecondComputer(store: string) {
  const response = await route.GET(new Request(`http://shared.test/api/data?store=${store}`, { headers: { cookie: secondCookie } }));
  expect(response.status).toBe(200);
  return (await response.json()).records;
}

beforeAll(async () => {
  vi.stubEnv("SANTA_OPS_DATA_DIR", mkdtempSync(join(tmpdir(), "santa-sync-test-")));
  vi.stubEnv("SANTA_OPS_PASSWORD", "test-only-password");
  vi.stubGlobal("window", { location: { hostname: "shared.test", reload() {} } });
  vi.stubGlobal("indexedDB", createMemoryIdbFactory());
  server = await import("../../src/server/store");
  route = await import("../../app/api/data/route");
  client = await import("../../src/storage/db");
  cookie = `santa_ops_session=${server.createSession()}`;
  secondCookie = `santa_ops_session=${server.createSession()}`;
  // Keep the real client, API and SQLite storage; replace only HTTP transport.
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const request = new Request(new URL(input, "http://shared.test"), {
      ...init, headers: { ...init?.headers, cookie, origin: "http://shared.test" },
    });
    return request.method === "POST" ? route.POST(request) : route.GET(request);
  });
});

beforeEach(() => server.clearRecords());
afterAll(async () => {
  await client.closeOpsDbForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("shared storage across separate sessions", () => {
  test("daily operations save and delete are visible to a second computer", async () => {
    await client.opsDb.saveDailyOperation(daily);
    expect(await readFromSecondComputer("dailyOps")).toEqual([daily]);
    await client.opsDb.saveDailyOperation({ ...daily, action: "Updated action" });
    expect(await readFromSecondComputer("dailyOps")).toMatchObject([{ action: "Updated action" }]);
    await client.opsDb.deleteDailyOperation(daily.key);
    expect(await readFromSecondComputer("dailyOps")).toEqual([]);
  });

  test("inbound entries save and delete are shared", async () => {
    await client.opsDb.saveInboundEntry(inbound);
    expect(await readFromSecondComputer("inbound")).toEqual([{ ...inbound, key: "inbound:L" }]);
    await client.opsDb.deleteInboundEntry(inbound);
    expect(await readFromSecondComputer("inbound")).toEqual([]);
  });

  test("inventory and promotion plan edits are shared", async () => {
    const inventory = { key: "inventory:one", date, size: "L" as const, fbaAvailable: 20, reserved: 0, unfulfillable: 0, sourceImportKey: "one" };
    const promotion = { key: "promotion:one", date, note: "Updated", updatedAt };
    await client.opsDb.replaceInventorySnapshots([inventory]);
    await client.opsDb.replacePromotionPlanOverrides([promotion]);
    expect(await readFromSecondComputer("inventory")).toEqual([inventory]);
    expect(await readFromSecondComputer("promotionPlan")).toEqual([promotion]);
  });

  test("import retains binary evidence byte-for-byte", async () => {
    const bytes = new Uint8Array([0, 255, 128, 65]).buffer;
    await client.opsDb.commitImport("business", [business], log, { bytes, rawRows: [{ SKU: "SKU" }] });
    const artifacts = await client.opsDb.list("rawImports");
    expect(artifacts).toHaveLength(1);
    expect(Array.from(new Uint8Array(artifacts[0].bytes))).toEqual([0, 255, 128, 65]);
    expect(await readFromSecondComputer("business")).toEqual([business]);
  });

  test("evidence-only imports also retain their original file", async () => {
    await client.opsDb.archiveImportEvidence(log, { bytes: new Uint8Array([20, 30]).buffer, rawRows: [] });
    const [artifact] = await client.opsDb.list("rawImports");
    expect(artifact).toBeDefined();
    expect(Array.from(new Uint8Array(artifact.bytes))).toEqual([20, 30]);
  });

  test("duplicate insert is atomic across every record", async () => {
    const result = await send({ store: "business", mode: "insert", records: [business, business] });
    expect(result.status).toBe(409);
    expect(await readFromSecondComputer("business")).toEqual([]);
  });

  test("failed import rolls back records as well as evidence", async () => {
    server.writeRecords("imports", [log], "insert");
    await expect(client.opsDb.commitImport("business", [business], log)).rejects.toThrow();
    expect(await readFromSecondComputer("business")).toEqual([]);
  });

  test("migration merge preserves newer server records and is repeatable", async () => {
    server.writeRecords("dailyOps", [{ ...daily, action: "New server data" }], "insert");
    const payload = { operations: [{ store: "dailyOps", mode: "merge", records: [daily, { ...daily, key: "daily:two" }] }] };
    const first = await send(payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ written: 1, skipped: 1 });
    const second = await send(payload);
    expect(await second.json()).toMatchObject({ written: 0, skipped: 2 });
    expect(await readFromSecondComputer("dailyOps")).toMatchObject([{ action: "New server data" }, { key: "daily:two" }]);
  });

  test("unrecognized stores and malformed batches cannot write records", async () => {
    expect((await send({ store: "arbitrary", records: [business] })).status).toBe(400);
    expect((await send({ operations: [{ store: "business", records: [business] }, { store: "dailyOps", records: [{}] }] })).status).toBe(400);
    expect(await readFromSecondComputer("business")).toEqual([]);
  });

  test("anonymous clients cannot read or write business records", async () => {
    expect((await send({ store: "business", records: [business] }, "")).status).toBe(401);
    expect((await route.GET(new Request("http://shared.test/api/data?store=business"))).status).toBe(401);
  });

  test("cross-origin writes are rejected even with a valid session", async () => {
    const response = await route.POST(new Request("http://shared.test/api/data", {
      method: "POST", headers: { cookie, origin: "https://unrelated.test", "content-type": "application/json" },
      body: JSON.stringify({ store: "business", records: [business] }),
    }));
    expect(response.status).toBe(403);
    expect(await readFromSecondComputer("business")).toEqual([]);
  });

  test("localhost uses the shared database too", async () => {
    const hostname = window.location.hostname;
    window.location.hostname = "localhost";
    try {
      await client.opsDb.saveDailyOperation(daily);
      expect(await readFromSecondComputer("dailyOps")).toEqual([daily]);
    } finally { window.location.hostname = hostname; }
  });

  test("legacy browser migration keeps server data and preserves source bytes", async () => {
    const request = indexedDB.open("santa-ops", 5);
    request.onupgradeneeded = () => {
      for (const name of ["business", "ads", "manual", "imports", "mappings", "rawImports", "rawRows", "derivedResults", "activePlan", "planChanges", "inventory", "inbound", "promotionPlan", "dailyOps"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "key" });
      }
    };
    const local = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = local.transaction(["dailyOps", "rawImports"], "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    transaction.objectStore("dailyOps").put(daily);
    transaction.objectStore("rawImports").put({ key: "legacy:file", bytes: new Uint8Array([0, 255, 16]).buffer });
    await done;
    server.writeRecords("dailyOps", [{ ...daily, action: "Latest server version" }], "insert");
    expect(await client.migrateLocalDataToServer()).toEqual({ ok: true, written: 1, skipped: 1 });
    expect(await readFromSecondComputer("dailyOps")).toMatchObject([{ action: "Latest server version" }]);
    const [artifact] = await client.opsDb.list("rawImports");
    expect(Array.from(new Uint8Array(artifact.bytes))).toEqual([0, 255, 16]);
    expect(await client.migrateLocalDataToServer()).toMatchObject({ written: 0, skipped: 2 });
    local.close();
  });
});
