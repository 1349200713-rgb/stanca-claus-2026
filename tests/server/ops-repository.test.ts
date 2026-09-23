import { afterEach, describe, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createSqliteOpsRepository } from "../../db/ops-sqlite";

const databases: DatabaseSync[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

function repository() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  return createSqliteOpsRepository(database);
}

describe("SQLite operations repository", () => {
  test("upserts one formal row while preserving every import batch", async () => {
    const repo = repository();
    const snapshot = { id: "US:2026-10-02:B012345678", marketplace: "US", date: "2026-10-02", competitorAsin: "B012345678", price: 59.99 };

    await repo.upsertBatch("competitors", [snapshot], { id: "import-1", filename: "one.xlsx", importedAt: "2026-10-02T01:00:00.000Z" });
    await repo.upsertBatch("competitors", [{ ...snapshot, price: 55.99 }], { id: "import-2", filename: "two.xlsx", importedAt: "2026-10-02T02:00:00.000Z" });

    expect(await repo.list("competitors", { marketplace: "US", startDate: "2026-10-02", endDate: "2026-10-02" })).toEqual([{ ...snapshot, price: 55.99 }]);
    expect(await repo.listImports()).toHaveLength(2);
  });

  test("rolls back formal rows and import log when any row lacks a stable key", async () => {
    const repo = repository();
    await expect(repo.upsertBatch("keywords", [{ date: "2026-10-02" }], { id: "failed", filename: "bad.xlsx", importedAt: "2026-10-02T01:00:00.000Z" })).rejects.toThrow("stable key");
    expect(await repo.list("keywords", {})).toEqual([]);
    expect(await repo.listImports()).toEqual([]);
  });

  test("filters server records by shared product dimensions", async () => {
    const repo = repository();
    await repo.upsertBatch("business", [
      { key: "a", marketplace: "US", date: "2026-10-02", asin: "A", sku: "SKU-A", units: 1 },
      { key: "b", marketplace: "US", date: "2026-10-03", asin: "B", sku: "SKU-B", units: 2 },
    ], { id: "business-1", filename: "business.csv", importedAt: "2026-10-03T01:00:00.000Z" });

    expect(await repo.list("business", { marketplace: "US", asin: "B" })).toMatchObject([{ key: "b", units: 2 }]);
  });
});
