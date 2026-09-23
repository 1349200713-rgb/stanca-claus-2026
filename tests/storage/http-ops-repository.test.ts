import { describe, expect, test } from "vitest";
import { createHttpOpsRepository } from "../../src/storage/http-ops-repository";

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
});
