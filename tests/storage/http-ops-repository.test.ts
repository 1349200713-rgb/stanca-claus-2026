import { afterEach, describe, expect, test, vi } from "vitest";
import { createHttpOpsRepository } from "../../src/storage/http-ops-repository";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP operations repository", () => {
  test("serializes filters and reads records", async () => {
    const requests: Request[] = [];
    const repository = createHttpOpsRepository({
      fetch: async (input) => {
        requests.push(input as Request);
        return Response.json({ records: [{ id: "one" }] });
      },
      authorization: () => "Bearer token",
    });
    expect(await repository.list("competitors", { marketplace: "US", asin: "B0TEST" })).toEqual([{ id: "one" }]);
    expect(requests[0].url).toContain("marketplace=US");
    expect(requests[0].headers.get("authorization")).toBe("Bearer token");
  });

  test("surfaces server errors without pretending a write succeeded", async () => {
    const repository = createHttpOpsRepository({ fetch: async () => Response.json({ error: "denied" }, { status: 401 }), authorization: () => "" });
    await expect(repository.upsertBatch("business", [{ key: "one" }], { id: "batch", filename: "a.csv", importedAt: "2026-10-02T00:00:00.000Z" })).rejects.toThrow("denied");
  });

  test("asks for the operation password and retries an upload rejected with 428", async () => {
    vi.stubGlobal("window", { location: { origin: "http://shared.test" }, prompt: () => "write-password" });
    const requests: Request[] = [];
    const repository = createHttpOpsRepository({
      fetch: async (input) => {
        const request = input as Request;
        requests.push(request);
        if (request.url.endsWith("/api/auth/operation")) return Response.json({ ok: true });
        if (requests.filter((item) => item.url.endsWith("/api/ops/competitors")).length === 1) {
          return Response.json({ error: "需要操作密码" }, { status: 428 });
        }
        return Response.json({ inserted: 1, updated: 0, skipped: 0 });
      },
    });

    await expect(repository.upsertBatch("competitors", [{ id: "one" }], { id: "batch", filename: "a.xlsx", importedAt: "2026-09-24T00:00:00.000Z" })).resolves.toMatchObject({ inserted: 1 });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/ops/competitors",
      "/api/auth/operation",
      "/api/ops/competitors",
    ]);
  });
});
