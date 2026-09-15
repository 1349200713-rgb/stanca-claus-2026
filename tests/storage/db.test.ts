import { afterEach, describe, expect, test } from "vitest";
import { closeOpsDbForTests, configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import type { BusinessRecord } from "../../src/domain/types";
import { createMemoryIdbFactory } from "./memory-idb";

const first: BusinessRecord = {
  key: "business:2026-11-24:a022",
  date: "2026-11-24",
  asin: "B0CFPR34MH",
  sku: "A022",
  size: "XL",
  units: 8,
  sales: 506.16,
  refunds: 0,
};

afterEach(async () => {
  await resetOpsDbForTests();
});

describe("opsDb", () => {
  test("retains inserted records after a simulated database API reload", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());

    await opsDb.insert("business", [first]);
    await closeOpsDbForTests();

    expect(await opsDb.list("business")).toEqual([first]);
  });

  test("sets up every store on first open and preserves their schema across reload", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const mapping = { key: "mapping:A022", sku: "A022", size: "XL" as const };

    await opsDb.insert("mappings", [mapping]);
    await closeOpsDbForTests();
    await opsDb.insert("business", [first]);

    expect(await opsDb.list("mappings")).toEqual([mapping]);
    expect(await opsDb.list("business")).toEqual([first]);
  });

  test("replaces a same-key record without creating a second row", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());

    await opsDb.insert("business", [first]);
    await opsDb.replace("business", [{ ...first, units: 11, sales: 700 }]);

    expect(await opsDb.list("business")).toEqual([{ ...first, units: 11, sales: 700 }]);
  });

  test("clears one store or every store", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.insert("business", [first]);
    await opsDb.insert("ads", [{ key: "ads:2026-11-24:push", date: "2026-11-24", campaign: "Push", spend: 1, adSales: 2, adOrders: 1 }]);

    await opsDb.clear("business");
    expect(await opsDb.list("business")).toEqual([]);
    expect(await opsDb.list("ads")).toHaveLength(1);

    await opsDb.clear();
    expect(await opsDb.list("ads")).toEqual([]);
  });

  test("does not mutate records supplied to insert or replace", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const input = structuredClone(first);

    await opsDb.insert("business", [input]);
    await opsDb.replace("business", [{ ...input, units: 9 }]);

    expect(input).toEqual(first);
  });

  test("rolls back an aborted duplicate insert rather than persisting a partial transaction", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());

    await expect(opsDb.insert("business", [first, first])).rejects.toThrow();

    expect(await opsDb.list("business")).toEqual([]);
  });

  test("commits formal records and their import log atomically", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const log = { key: "import:duplicate", filename: "business.csv", importedAt: "2026-11-24T00:00:00.000Z", reportKind: "business" as const, rowCount: 1, issueCount: 0, duplicateCount: 0, action: "insert" as const };
    await opsDb.insert("imports", [log]);

    await expect(opsDb.commitImport("business", [first], log)).rejects.toThrow();

    expect(await opsDb.list("business")).toEqual([]);
    expect(await opsDb.list("imports")).toEqual([log]);
  });

  test("stores immutable raw evidence and normalized results with auditable import-log references", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const log = { key: "import:evidence", filename: "business.csv", importedAt: "2026-11-24T00:00:00.000Z", reportKind: "business" as const, rowCount: 1, issueCount: 0, duplicateCount: 0, action: "insert" as const };
    const bytes = new TextEncoder().encode("Date,SKU,Units,Sales\n2026-11-24,A022,8,506.16").buffer;

    await opsDb.commitImport("business", [first], log, {
      bytes,
      rawRows: [{ Date: "2026-11-24", SKU: "A022", Units: "8", Sales: "506.16" }],
    });

    const [storedLog] = await opsDb.list("imports");
    const [artifact] = await opsDb.list("rawImports");
    const [rawRow] = await opsDb.list("rawRows");
    const [derived] = await opsDb.list("derivedResults");
    expect(storedLog).toMatchObject({
      rawArtifactKey: artifact.key,
      rawRowKeys: [rawRow.key],
      derivedResultKeys: [derived.key],
    });
    expect(Array.from(new Uint8Array(artifact.bytes))).toEqual(Array.from(new Uint8Array(bytes)));
    expect(rawRow).toMatchObject({ importKey: log.key, rowNumber: 2, values: { SKU: "A022", Units: "8" } });
    expect(derived).toMatchObject({ importKey: log.key, sourceRecordKey: first.key, record: first });
  });
});
