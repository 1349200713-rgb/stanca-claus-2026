import { afterEach, describe, expect, test } from "vitest";
import type { ActivePlan, InboundEntry, InventorySnapshot, PlanChange } from "../../src/domain/planning";
import { closeOpsDbForTests, configureOpsDbForTests, opsDb, resetOpsDbForTests } from "../../src/storage/db";
import { createMemoryIdbFactory } from "../storage/memory-idb";

const schemaV2Stores = ["business", "ads", "manual", "imports", "mappings", "rawImports", "rawRows", "derivedResults"];

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function createPopulatedSchemaV2Database(factory: IDBFactory): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("santa-ops", 2);
    request.onupgradeneeded = () => {
      for (const name of schemaV2Stores) request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const business = { key: "business:2026-11-24:A022", date: "2026-11-24", asin: "B0CFPR34MH", sku: "A022", size: "XL" as const, units: 8, sales: 506.16, refunds: 0 };
  const ads = { key: "ads:2026-11-24:push", date: "2026-11-24", campaign: "Push", spend: 12, adSales: 80, adOrders: 2 };
  const manual = { key: "manual:2026-11-24:XL", date: "2026-11-24", size: "XL" as const, inbound: 7, inboundObserved: true, actionComplete: false };
  const importLog = { key: "import:v2-evidence", filename: "business.csv", importedAt: "2026-11-24T00:00:00.000Z", reportKind: "business" as const, rowCount: 1, issueCount: 0, duplicateCount: 0, action: "insert" as const, rawArtifactKey: "raw-artifact:import:v2-evidence", rawRowKeys: ["raw-row:import:v2-evidence:2"], derivedResultKeys: ["derived:import:v2-evidence:0:business:2026-11-24:A022"] };
  const mapping = { key: "mapping:A022", sku: "A022", size: "XL" as const };
  const artifact = { key: "raw-artifact:import:v2-evidence", importKey: importLog.key, filename: importLog.filename, importedAt: importLog.importedAt, reportKind: "business" as const, byteLength: 4, bytes: new Uint8Array([1, 2, 3, 4]).buffer };
  const rawRow = { key: "raw-row:import:v2-evidence:2", importKey: importLog.key, rowNumber: 2, values: { Date: "2026-11-24", SKU: "A022", Units: "8" } };
  const derived = { key: "derived:import:v2-evidence:0:business:2026-11-24:A022", importKey: importLog.key, reportKind: "business" as const, sourceRecordKey: business.key, record: business };
  const records: Record<string, { key: string }> = { business, ads, manual, imports: importLog, mappings: mapping, rawImports: artifact, rawRows: rawRow, derivedResults: derived };
  const transaction = database.transaction(schemaV2Stores, "readwrite");
  const done = transactionDone(transaction);
  await Promise.all(schemaV2Stores.map((store) => requestValue(transaction.objectStore(store).add(records[store]))));
  await done;
}

const plan: ActivePlan = {
  id: "plan-2026",
  rows: [{ date: "2026-11-24", size: "XL", units: 12 }],
  totalUnits: 12,
  updatedAt: "2026-11-20T09:00:00.000Z",
};

const change: PlanChange = {
  id: "plan-change:2026-11-20T09:00:00.000Z",
  changedAt: "2026-11-20T09:00:00.000Z",
  reason: "Initial operating plan",
  beforeTotal: 0,
  afterTotal: 12,
};

afterEach(async () => {
  await resetOpsDbForTests();
});

describe("planning storage", () => {
  test("saves and reloads the active plan with its latest change metadata", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());

    await opsDb.saveActivePlan(plan, change);
    await closeOpsDbForTests();

    expect(await opsDb.getActivePlan()).toEqual(plan);
    expect(await opsDb.list("planChanges")).toEqual([{ ...change, key: change.id }]);
  });

  test("does not replace the active plan when its change entry cannot be saved", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    await opsDb.saveActivePlan(plan, change);
    const revisedPlan: ActivePlan = { ...plan, totalUnits: 18, updatedAt: "2026-11-21T09:00:00.000Z" };

    await expect(opsDb.saveActivePlan(revisedPlan, { ...change, afterTotal: 18 })).rejects.toThrow();

    expect(await opsDb.getActivePlan()).toEqual(plan);
  });

  test("replaces inventory snapshots by key without duplicate rows", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const snapshot: InventorySnapshot = {
      key: "inventory:2026-11-24:XL",
      date: "2026-11-24",
      size: "XL",
      fbaAvailable: 24,
      reserved: null,
      unfulfillable: null,
      sourceImportKey: "import:business-2026-11-24",
    };

    await opsDb.replaceInventorySnapshots([snapshot]);
    expect(await opsDb.listInventorySnapshots()).toEqual([snapshot]);
    await opsDb.replaceInventorySnapshots([{ ...snapshot, fbaAvailable: 21, reserved: 2 }]);

    expect(await opsDb.listInventorySnapshots()).toEqual([{ ...snapshot, fbaAvailable: 21, reserved: 2 }]);
  });

  test("preserves populated schema-v2 stores and creates V3 planning stores during upgrade", async () => {
    const factory = createMemoryIdbFactory();
    await createPopulatedSchemaV2Database(factory);
    configureOpsDbForTests(factory);

    const [business, ads, manual, imports, mappings, rawImports, rawRows, derivedResults] = await Promise.all([
      opsDb.list("business"),
      opsDb.list("ads"),
      opsDb.list("manual"),
      opsDb.list("imports"),
      opsDb.list("mappings"),
      opsDb.list("rawImports"),
      opsDb.list("rawRows"),
      opsDb.list("derivedResults"),
    ]);

    expect(business).toEqual([{ key: "business:2026-11-24:A022", date: "2026-11-24", asin: "B0CFPR34MH", sku: "A022", size: "XL", units: 8, sales: 506.16, refunds: 0 }]);
    expect(ads).toEqual([{ key: "ads:2026-11-24:push", date: "2026-11-24", campaign: "Push", spend: 12, adSales: 80, adOrders: 2 }]);
    expect(manual).toEqual([{ key: "manual:2026-11-24:XL", date: "2026-11-24", size: "XL", inbound: 7, inboundObserved: true, actionComplete: false }]);
    expect(imports).toEqual([{ key: "import:v2-evidence", filename: "business.csv", importedAt: "2026-11-24T00:00:00.000Z", reportKind: "business", rowCount: 1, issueCount: 0, duplicateCount: 0, action: "insert", rawArtifactKey: "raw-artifact:import:v2-evidence", rawRowKeys: ["raw-row:import:v2-evidence:2"], derivedResultKeys: ["derived:import:v2-evidence:0:business:2026-11-24:A022"] }]);
    expect(mappings).toEqual([{ key: "mapping:A022", sku: "A022", size: "XL" }]);
    expect(rawImports).toEqual([{ key: "raw-artifact:import:v2-evidence", importKey: "import:v2-evidence", filename: "business.csv", importedAt: "2026-11-24T00:00:00.000Z", reportKind: "business", byteLength: 4, bytes: new Uint8Array([1, 2, 3, 4]).buffer }]);
    expect(rawRows).toEqual([{ key: "raw-row:import:v2-evidence:2", importKey: "import:v2-evidence", rowNumber: 2, values: { Date: "2026-11-24", SKU: "A022", Units: "8" } }]);
    expect(derivedResults).toEqual([{ key: "derived:import:v2-evidence:0:business:2026-11-24:A022", importKey: "import:v2-evidence", reportKind: "business", sourceRecordKey: "business:2026-11-24:A022", record: { key: "business:2026-11-24:A022", date: "2026-11-24", asin: "B0CFPR34MH", sku: "A022", size: "XL", units: 8, sales: 506.16, refunds: 0 } }]);
    await expect(Promise.all([
      opsDb.list("activePlan"),
      opsDb.list("planChanges"),
      opsDb.listInventorySnapshots(),
      opsDb.getInboundEntries(),
    ])).resolves.toEqual([[], [], [], []]);
  });

  test("saves and reloads inbound entries for every size", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const entries: InboundEntry[] = [
      { size: "L", units: 10, expectedArrivalDate: "2026-11-28", updatedAt: "2026-11-20T09:00:00.000Z" },
      { size: "XL", units: 11, expectedArrivalDate: "2026-11-29", updatedAt: "2026-11-20T09:00:00.000Z" },
      { size: "2XL", units: 12, expectedArrivalDate: "2026-11-30", updatedAt: "2026-11-20T09:00:00.000Z" },
      { size: "3XL", units: 13, expectedArrivalDate: "2026-12-01", updatedAt: "2026-11-20T09:00:00.000Z" },
    ];

    for (const entry of entries) await opsDb.saveInboundEntry(entry);
    await closeOpsDbForTests();

    expect(await opsDb.getInboundEntries()).toEqual(entries);
  });

  test("preserves blank inbound units and arrival dates as null", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const blankEntry: InboundEntry = { size: "L", units: null, expectedArrivalDate: null, updatedAt: "2026-11-20T09:00:00.000Z" };

    await opsDb.saveInboundEntry(blankEntry);

    expect(await opsDb.getInboundEntries()).toEqual([blankEntry]);
  });

  test("does not mutate planning, inventory, or inbound inputs", async () => {
    configureOpsDbForTests(createMemoryIdbFactory());
    const inputPlan = structuredClone(plan);
    const inputChange = structuredClone(change);
    const inputSnapshot: InventorySnapshot = {
      key: "inventory:2026-11-24:L",
      date: "2026-11-24",
      size: "L",
      fbaAvailable: 15,
      reserved: null,
      unfulfillable: null,
      sourceImportKey: "import:business-2026-11-24",
    };
    const inputInbound: InboundEntry = { size: "L", units: null, expectedArrivalDate: null, updatedAt: "2026-11-20T09:00:00.000Z" };

    await opsDb.saveActivePlan(inputPlan, inputChange);
    await opsDb.replaceInventorySnapshots([inputSnapshot]);
    await opsDb.saveInboundEntry(inputInbound);

    expect(inputPlan).toEqual(plan);
    expect(inputChange).toEqual(change);
    expect(inputSnapshot).toEqual({
      key: "inventory:2026-11-24:L",
      date: "2026-11-24",
      size: "L",
      fbaAvailable: 15,
      reserved: null,
      unfulfillable: null,
      sourceImportKey: "import:business-2026-11-24",
    });
    expect(inputInbound).toEqual({ size: "L", units: null, expectedArrivalDate: null, updatedAt: "2026-11-20T09:00:00.000Z" });
  });
});
