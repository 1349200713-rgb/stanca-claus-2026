import { afterEach, describe, expect, test } from "vitest";
import { opsDb, configureOpsDbForTests, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "./memory-idb";
import { migrationState, migrateLocalData, previewLocalMigration, resetMigrationStateForTests } from "../../src/storage/local-migration";

afterEach(async () => {
  await resetOpsDbForTests();
  resetMigrationStateForTests();
});

describe("local cloud migration", () => {
  test("previews local record counts without changing them", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", [{ key: "one", date: "2026-10-02", asin: "A", sku: "S", size: "L", units: 1, sales: 10 }]);
    expect(await previewLocalMigration()).toMatchObject({ business: 1, ads: 0, dailyOps: 0 });
    expect(await opsDb.list("business")).toHaveLength(1);
  });

  test("keeps local data and incomplete state when a cloud write fails", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const localBusiness = { key: "one", date: "2026-10-02", asin: "A", sku: "S", size: "L" as const, units: 1, sales: 10 };
    await opsDb.insert("business", [localBusiness]);
    const target = { upsertBatch: async () => { throw new Error("network"); } };
    await expect(migrateLocalData({ resources: ["business"], target })).rejects.toThrow("network");
    expect(await opsDb.list("business")).toEqual([localBusiness]);
    expect(migrationState()).toMatchObject({ completed: false, failedResource: "business" });
  });
});
