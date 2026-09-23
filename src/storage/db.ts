import type { AdRecord, BusinessRecord, ManualRecord, SizeCode } from "../domain/types";
import type { ActivePlan, DailyOperationRecord, InboundEntry, InventorySnapshot, PlanChange, PromotionPlanOverride } from "../domain/planning";

import { decodeData, encodeData, storeNames, type OpsStore, type WriteOperation, type WriteResult } from "./protocol";
export type { OpsStore } from "./protocol";
type FormalStore = "business" | "ads" | "inventory";

export interface ImportLog {
  key: string;
  filename: string;
  importedAt: string;
  reportKind: "business" | "ads" | "inventory" | "inbound" | "promotionPlan";
  rowCount: number;
  issueCount: number;
  duplicateCount: number;
  action: "insert" | "replace";
  rawArtifactKey?: string;
  rawRowKeys?: string[];
  derivedResultKeys?: string[];
}

export interface ImportEvidence {
  bytes: ArrayBuffer;
  rawRows: Array<Record<string, string>>;
}

export interface RawImportArtifact {
  key: string;
  importKey: string;
  filename: string;
  importedAt: string;
  reportKind: ImportLog["reportKind"];
  byteLength: number;
  bytes: ArrayBuffer;
}

export interface RawImportRow {
  key: string;
  importKey: string;
  rowNumber: number;
  values: Record<string, string>;
}

export interface DerivedResultRecord {
  key: string;
  importKey: string;
  reportKind: "business" | "ads" | "inventory";
  sourceRecordKey: string;
  record: BusinessRecord | AdRecord | InventorySnapshot;
}

export type StoredManualRecord = ManualRecord & { key: string };

export interface MappingRecord {
  key: string;
  sku?: string;
  asin?: string;
  size?: SizeCode;
}

type StoredActivePlan = ActivePlan & { key: string };
type StoredPlanChange = PlanChange & { key: string };
type StoredInboundEntry = InboundEntry & { key: string };

function stripStorageKey<T extends { key: string }>(record: T): Omit<T, "key"> {
  const copy: Partial<T> = structuredClone(record);
  delete copy.key;
  return copy as Omit<T, "key">;
}

function inboundStorageKey(entry: InboundEntry): string {
  const shipmentKey = entry.fbaNumber && entry.sku
    ? `${entry.fbaNumber.trim()}:${entry.sku.trim()}:${entry.shipDate ?? ""}:${entry.expectedArrivalDate ?? ""}`
    : entry.size;
  return `inbound:${shipmentKey}`;
}

interface StoreRecordMap {
  business: BusinessRecord;
  ads: AdRecord;
  manual: StoredManualRecord;
  imports: ImportLog;
  mappings: MappingRecord;
  rawImports: RawImportArtifact;
  rawRows: RawImportRow;
  derivedResults: DerivedResultRecord;
  activePlan: StoredActivePlan;
  planChanges: StoredPlanChange;
  inventory: InventorySnapshot;
  inbound: StoredInboundEntry;
  promotionPlan: PromotionPlanOverride;
  dailyOps: DailyOperationRecord;
}

const databaseName = "santa-ops";
const databaseVersion = 5;
const activePlanKey = "active-plan";

let database: IDBDatabase | undefined;
let opening: Promise<IDBDatabase> | undefined;
let idbFactory: IDBFactory | undefined = globalThis.indexedDB;

let localTestAdapter = false;
function usesServer(): boolean {
  return typeof window !== "undefined" && !localTestAdapter;
}

async function remoteRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", cache: "no-store", ...init });
  if (!response.ok) {
    if (response.status === 401) window.location.reload();
    const body = await response.json().catch(() => ({})) as { error?: string };
    const error = new Error(body.error ?? `服务器请求失败（${response.status}）`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return decodeData<T>(await response.text());
}

function remoteRecords<K extends OpsStore>(store: K): Promise<StoreRecordMap[K][]> {
  return remoteRequest<{ records: StoreRecordMap[K][] }>(`/api/data?store=${encodeURIComponent(store)}`).then((result) => result.records);
}

function remoteWrite(store: OpsStore, records: readonly unknown[], mode: "insert" | "replace"): Promise<void> {
  return remoteBatch([{ store, records, mode }]).then(() => undefined);
}

function remoteBatch(operations: WriteOperation[]): Promise<WriteResult> {
  const request = () => remoteRequest<WriteResult>("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: encodeData({ operations }) });
  return request().catch(async (error: Error & { status?: number }) => {
    if (error.status !== 428 || typeof window === "undefined") throw error;
    const password = window.prompt("请输入操作密码");
    if (!password) throw new Error("取消操作");
    await remoteRequest("/api/auth/operation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return request();
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DOMException("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new DOMException("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new DOMException("IndexedDB transaction aborted"));
  });
}

async function finishWrite(requests: Promise<unknown>[], done: Promise<void>): Promise<void> {
  try {
    await Promise.all(requests);
    await done;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  if (opening) return opening;
  if (!idbFactory) return Promise.reject(new Error("IndexedDB is unavailable in this browser"));

  opening = new Promise((resolve, reject) => {
    const request = idbFactory!.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of storeNames) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      database = request.result;
      opening = undefined;
      resolve(database);
    };
    request.onerror = () => {
      opening = undefined;
      reject(request.error ?? new DOMException("Unable to open IndexedDB"));
    };
  });
  return opening;
}

async function write<K extends OpsStore>(store: K, records: readonly StoreRecordMap[K][], mode: "add" | "put"): Promise<void> {
  if (!records.length) return;
  if (usesServer()) return remoteWrite(store, records, mode === "add" ? "insert" : "replace");
  const db = await openDatabase();
  const transaction = db.transaction(store, "readwrite");
  const objectStore = transaction.objectStore(store);
  const done = transactionDone(transaction);
  const requests = records.map((record) => requestValue(objectStore[mode](structuredClone(record))));
  await finishWrite(requests, done);
}

export const opsDb = {
  async list<K extends OpsStore>(store: K): Promise<StoreRecordMap[K][]> {
    if (usesServer()) return remoteRecords(store);
    const db = await openDatabase();
    const transaction = db.transaction(store, "readonly");
    const records = await requestValue(transaction.objectStore(store).getAll());
    return records as StoreRecordMap[K][];
  },

  insert<K extends OpsStore>(store: K, records: readonly StoreRecordMap[K][]): Promise<void> {
    return write(store, records, "add");
  },

  replace<K extends OpsStore>(store: K, records: readonly StoreRecordMap[K][]): Promise<void> {
    return write(store, records, "put");
  },

  async getActivePlan(): Promise<ActivePlan | undefined> {
    const plans = await opsDb.list("activePlan");
    const plan = plans.find((record) => record.key === activePlanKey);
    if (!plan) return undefined;
    return stripStorageKey(plan);
  },

  async saveActivePlan(plan: ActivePlan, change: PlanChange): Promise<void> {
    if (usesServer()) {
      await remoteBatch([
        { store: "activePlan", records: [{ ...structuredClone(plan), key: activePlanKey }], mode: "replace" },
        { store: "planChanges", records: [{ ...structuredClone(change), key: change.id }], mode: "insert" },
      ]);
      return;
    }
    const db = await openDatabase();
    const transaction = db.transaction(["activePlan", "planChanges"], "readwrite");
    const done = transactionDone(transaction);
    const storedPlan: StoredActivePlan = { ...structuredClone(plan), key: activePlanKey };
    const storedChange: StoredPlanChange = { ...structuredClone(change), key: change.id };
    await finishWrite([
      requestValue(transaction.objectStore("activePlan").put(storedPlan)),
      requestValue(transaction.objectStore("planChanges").add(storedChange)),
    ], done);
  },

  listInventorySnapshots(): Promise<InventorySnapshot[]> {
    return opsDb.list("inventory");
  },

  replaceInventorySnapshots(rows: readonly InventorySnapshot[]): Promise<void> {
    return write("inventory", rows, "put");
  },

  async getInboundEntries(): Promise<InboundEntry[]> {
    const entries = await opsDb.list("inbound");
    return entries.map(stripStorageKey);
  },

  saveInboundEntry(entry: InboundEntry): Promise<void> {
    return write("inbound", [{ ...structuredClone(entry), key: inboundStorageKey(entry) }], "put");
  },

  async deleteInboundEntry(entry: InboundEntry): Promise<void> {
    if (usesServer()) {
      await remoteBatch([{ store: "inbound", deleteKeys: [inboundStorageKey(entry)] }]);
      return;
    }
    const db = await openDatabase();
    const transaction = db.transaction("inbound", "readwrite");
    const done = transactionDone(transaction);
    await finishWrite([requestValue(transaction.objectStore("inbound").delete(inboundStorageKey(entry)))], done);
  },

  listPromotionPlanOverrides(): Promise<PromotionPlanOverride[]> {
    return opsDb.list("promotionPlan");
  },

  replacePromotionPlanOverrides(rows: readonly PromotionPlanOverride[]): Promise<void> {
    return write("promotionPlan", rows, "put");
  },

  listDailyOperations(): Promise<DailyOperationRecord[]> {
    return opsDb.list("dailyOps");
  },

  saveDailyOperation(record: DailyOperationRecord): Promise<void> {
    return write("dailyOps", [record], "put");
  },

  async deleteDailyOperation(key: string): Promise<void> {
    if (usesServer()) {
      await remoteBatch([{ store: "dailyOps", deleteKeys: [key] }]);
      return;
    }
    const db = await openDatabase();
    const transaction = db.transaction("dailyOps", "readwrite");
    const done = transactionDone(transaction);
    await finishWrite([requestValue(transaction.objectStore("dailyOps").delete(key))], done);
  },

  async archiveImportEvidence(log: ImportLog, evidence: ImportEvidence): Promise<void> {
    if (usesServer()) {
      const rawRowKeys = evidence.rawRows.map((_, index) => `raw-row:${log.key}:${index + 2}`);
      await remoteBatch([
        { store: "imports", records: [{ ...structuredClone(log), rawArtifactKey: `raw-artifact:${log.key}`, rawRowKeys, derivedResultKeys: [] }], mode: "insert" },
        { store: "rawImports", records: [{ key: `raw-artifact:${log.key}`, importKey: log.key, filename: log.filename, importedAt: log.importedAt, reportKind: log.reportKind, byteLength: evidence.bytes.byteLength, bytes: evidence.bytes }], mode: "insert" },
        { store: "rawRows", records: evidence.rawRows.map((values, index) => ({ key: rawRowKeys[index], importKey: log.key, rowNumber: index + 2, values })), mode: "insert" },
      ]);
      return;
    }
    const db = await openDatabase();
    const rawArtifactKey = `raw-artifact:${log.key}`;
    const rawRowKeys = evidence.rawRows.map((_, index) => `raw-row:${log.key}:${index + 2}`);
    const committedLog: ImportLog = { ...structuredClone(log), rawArtifactKey, rawRowKeys, derivedResultKeys: [] };
    const transaction = db.transaction(["imports", "rawImports", "rawRows"], "readwrite");
    const done = transactionDone(transaction);
    const requests = [
      requestValue(transaction.objectStore("imports").add(structuredClone(committedLog))),
      requestValue(transaction.objectStore("rawImports").add(structuredClone({
        key: rawArtifactKey,
        importKey: log.key,
        filename: log.filename,
        importedAt: log.importedAt,
        reportKind: log.reportKind,
        byteLength: evidence.bytes.byteLength,
        bytes: evidence.bytes.slice(0),
      } satisfies RawImportArtifact))),
      ...evidence.rawRows.map((values, index) => requestValue(transaction.objectStore("rawRows").add(structuredClone({
        key: rawRowKeys[index],
        importKey: log.key,
        rowNumber: index + 2,
        values,
      } satisfies RawImportRow)))),
    ];
    await finishWrite(requests, done);
  },

  async commitImport<K extends FormalStore>(store: K, records: readonly StoreRecordMap[K][], log: ImportLog, evidence?: ImportEvidence): Promise<void> {
    if (usesServer()) {
      const operations: Array<{ store: OpsStore; records?: readonly unknown[]; mode?: "insert" | "replace" }> = [
        { store, records, mode: log.action === "replace" ? "replace" : "insert" },
        { store: "imports", records: [structuredClone(log)], mode: "insert" },
      ];
      if (evidence) {
        const rawRowKeys = evidence.rawRows.map((_, index) => `raw-row:${log.key}:${index + 2}`);
        operations[1] = { store: "imports", records: [{ ...structuredClone(log), rawArtifactKey: `raw-artifact:${log.key}`, rawRowKeys, derivedResultKeys: records.map((record, index) => `derived:${log.key}:${index}:${record.key}`) }], mode: "insert" };
        operations.push({ store: "rawImports", records: [{ key: `raw-artifact:${log.key}`, importKey: log.key, filename: log.filename, importedAt: log.importedAt, reportKind: log.reportKind, byteLength: evidence.bytes.byteLength, bytes: evidence.bytes }], mode: "insert" });
        operations.push({ store: "rawRows", records: evidence.rawRows.map((values, index) => ({ key: rawRowKeys[index], importKey: log.key, rowNumber: index + 2, values })), mode: "insert" });
        operations.push({ store: "derivedResults", records: records.map((record, index) => ({ key: `derived:${log.key}:${index}:${record.key}`, importKey: log.key, reportKind: store, sourceRecordKey: record.key, record })), mode: "insert" });
      }
      await remoteBatch(operations);
      return;
    }
    const db = await openDatabase();
    const rawArtifactKey = `raw-artifact:${log.key}`;
    const rawRowKeys = evidence?.rawRows.map((_, index) => `raw-row:${log.key}:${index + 2}`) ?? [];
    const derivedResultKeys = records.map((record, index) => `derived:${log.key}:${index}:${record.key}`);
    const committedLog: ImportLog = evidence ? { ...log, rawArtifactKey, rawRowKeys, derivedResultKeys } : structuredClone(log);
    const stores: OpsStore[] = evidence
      ? [store, "imports", "rawImports", "rawRows", "derivedResults"]
      : [store, "imports"];
    const transaction = db.transaction(stores, "readwrite");
    const done = transactionDone(transaction);
    const recordStore = transaction.objectStore(store);
    const importStore = transaction.objectStore("imports");
    const mode = log.action === "replace" ? "put" : "add";
    const requests = [
      ...records.map((record) => requestValue(recordStore[mode](structuredClone(record)))),
      requestValue(importStore.add(structuredClone(committedLog))),
    ];
    if (evidence) {
      const artifact: RawImportArtifact = {
        key: rawArtifactKey,
        importKey: log.key,
        filename: log.filename,
        importedAt: log.importedAt,
        reportKind: log.reportKind,
        byteLength: evidence.bytes.byteLength,
        bytes: evidence.bytes.slice(0),
      };
      requests.push(requestValue(transaction.objectStore("rawImports").add(structuredClone(artifact))));
      requests.push(...evidence.rawRows.map((values, index) => requestValue(transaction.objectStore("rawRows").add(structuredClone({
        key: rawRowKeys[index],
        importKey: log.key,
        rowNumber: index + 2,
        values,
      } satisfies RawImportRow)))));
      requests.push(...records.map((record, index) => requestValue(transaction.objectStore("derivedResults").add(structuredClone({
        key: derivedResultKeys[index],
        importKey: log.key,
        reportKind: store,
        sourceRecordKey: record.key,
        record,
      } satisfies DerivedResultRecord)))));
    }
    await finishWrite(requests, done);
  },

  async clear(store?: OpsStore): Promise<void> {
    if (usesServer()) {
      await remoteRequest("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(store ? { store, clear: true } : { operations: storeNames.map((name) => ({ store: name, clear: true })) }) });
      return;
    }
    if (!store) {
      await Promise.all(storeNames.map((name) => opsDb.clear(name)));
      return;
    }
    const db = await openDatabase();
    const transaction = db.transaction(store, "readwrite");
    const done = transactionDone(transaction);
    await finishWrite([requestValue(transaction.objectStore(store).clear())], done);
  },
};

/** Existing offline tests use IndexedDB explicitly; deployed browsers always use the API. */
export function configureOpsDbForTests(factory: IDBFactory | undefined): void {
  if (database || opening) throw new Error("Close the database before changing the IndexedDB factory");
  idbFactory = factory;
  localTestAdapter = true;
}

/** Closes the cached connection so the next operation behaves like a browser reload. */
export async function closeOpsDbForTests(): Promise<void> {
  const pending = opening;
  if (pending) await pending;
  database?.close();
  database = undefined;
  opening = undefined;
}

/** Clears test data, closes the connection, and restores the browser IndexedDB factory. */
export async function resetOpsDbForTests(): Promise<void> {
  if (idbFactory) await opsDb.clear();
  await closeOpsDbForTests();
  idbFactory = globalThis.indexedDB;
  localTestAdapter = false;
}

/** Uploads the browser's pre-server data into the shared server store once. */
export async function migrateLocalDataToServer(): Promise<WriteResult> {
  if (!usesServer()) throw new Error("当前环境未启用服务器存储");
  const localDatabase = await openDatabase();
  const recordsByStore = await Promise.all(storeNames.map(async (store) => {
    const transaction = localDatabase.transaction(store, "readonly");
    return [store, await requestValue(transaction.objectStore(store).getAll())] as const;
  }));
  const operations = recordsByStore
    .filter(([, records]) => records.length > 0)
    .map(([store, records]) => ({ store, records, mode: "merge" as const }));
  if (!operations.length) return { written: 0, skipped: 0 };
  return remoteBatch(operations);
}

