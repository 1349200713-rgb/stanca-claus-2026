import { afterEach, describe, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createSqliteOpsRepository } from "../../db/ops-sqlite";
import { configureOpsRepositoryForTests } from "../../db/ops-server";
import { GET, POST } from "../../app/api/ops/[resource]/route";

const databases: DatabaseSync[] = [];

afterEach(() => {
  configureOpsRepositoryForTests(undefined);
  databases.splice(0).forEach((database) => database.close());
  delete process.env.SANTA_OPS_API_TOKEN;
});

function setup() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  configureOpsRepositoryForTests(createSqliteOpsRepository(database));
  process.env.SANTA_OPS_API_TOKEN = "test-secret";
}

describe("operations resource API", () => {
  test("rejects unauthenticated writes", async () => {
    setup();
    const response = await POST(new Request("http://local/api/ops/competitors", { method: "POST", body: "{}" }), { params: Promise.resolve({ resource: "competitors" }) });
    expect(response.status).toBe(401);
  });

  test("writes and reads a validated resource batch", async () => {
    setup();
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const response = await POST(new Request("http://local/api/ops/competitors", {
      method: "POST",
      headers,
      body: JSON.stringify({ records: [{ id: "row-1", marketplace: "US", date: "2026-10-02", competitorAsin: "B012345678", price: 55.99 }], importBatch: { id: "batch-1", filename: "competitors.xlsx", importedAt: "2026-10-02T01:00:00.000Z" } }),
    }), { params: Promise.resolve({ resource: "competitors" }) });
    expect(response.status).toBe(201);

    const list = await GET(new Request("http://local/api/ops/competitors?marketplace=US", { headers }), { params: Promise.resolve({ resource: "competitors" }) });
    expect(await list.json()).toMatchObject({ records: [{ id: "row-1", price: 55.99 }] });
  });

  test("rejects unknown resources and malformed batches", async () => {
    setup();
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const unknown = await GET(new Request("http://local/api/ops/nope", { headers }), { params: Promise.resolve({ resource: "nope" }) });
    expect(unknown.status).toBe(404);
    const malformed = await POST(new Request("http://local/api/ops/competitors", { method: "POST", headers, body: JSON.stringify({ records: [] }) }), { params: Promise.resolve({ resource: "competitors" }) });
    expect(malformed.status).toBe(400);
  });
});
