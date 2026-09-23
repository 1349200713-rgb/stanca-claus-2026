import type { DatabaseSync } from "node:sqlite";
import { stableRecordKey, type OpsFilter, type OpsRepository, type OpsResource, type ServerImportBatch, type UpsertResult } from "./ops-repository";

interface StoredRow {
  payload: string;
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

export function createSqliteOpsRepository(database: DatabaseSync): OpsRepository {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS ops_records (
      resource TEXT NOT NULL,
      stable_key TEXT NOT NULL,
      marketplace TEXT,
      record_date TEXT,
      asin TEXT,
      sku TEXT,
      keyword_id TEXT,
      competitor_asin TEXT,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (resource, stable_key)
    );
    CREATE INDEX IF NOT EXISTS ops_records_filter ON ops_records(resource, marketplace, record_date, asin, sku);
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      resource TEXT NOT NULL,
      filename TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource TEXT NOT NULL,
      stable_key TEXT NOT NULL,
      action TEXT NOT NULL,
      before_payload TEXT,
      after_payload TEXT,
      batch_id TEXT,
      changed_at TEXT NOT NULL
    );
  `);

  return {
    async list<T extends Record<string, unknown>>(resource: OpsResource, filter: OpsFilter): Promise<T[]> {
      const clauses = ["resource = ?"];
      const values: string[] = [resource];
      const add = (clause: string, value: string | undefined, normalize = true) => {
        if (!value) return;
        clauses.push(clause);
        values.push(normalize ? value.trim().toUpperCase() : value);
      };
      add("marketplace = ?", filter.marketplace);
      add("record_date >= ?", filter.startDate, false);
      add("record_date <= ?", filter.endDate, false);
      add("asin = ?", filter.asin);
      add("sku = ?", filter.sku);
      add("keyword_id = ?", filter.keywordId);
      add("competitor_asin = ?", filter.competitorAsin);
      const rows = database.prepare(`SELECT payload FROM ops_records WHERE ${clauses.join(" AND ")} ORDER BY record_date, stable_key`).all(...values) as unknown as StoredRow[];
      return rows.map((row) => JSON.parse(row.payload) as T);
    },

    async upsertBatch(resource: OpsResource, records: readonly Record<string, unknown>[], batch: ServerImportBatch): Promise<UpsertResult> {
      const keys = records.map(stableRecordKey);
      const find = database.prepare("SELECT payload FROM ops_records WHERE resource = ? AND stable_key = ?");
      const upsert = database.prepare(`INSERT INTO ops_records(resource, stable_key, marketplace, record_date, asin, sku, keyword_id, competitor_asin, payload, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource, stable_key) DO UPDATE SET marketplace=excluded.marketplace, record_date=excluded.record_date, asin=excluded.asin, sku=excluded.sku, keyword_id=excluded.keyword_id, competitor_asin=excluded.competitor_asin, payload=excluded.payload, updated_at=excluded.updated_at`);
      const audit = database.prepare("INSERT INTO audit_events(resource, stable_key, action, before_payload, after_payload, batch_id, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const insertBatch = database.prepare("INSERT INTO import_batches(id, resource, filename, imported_at, payload) VALUES (?, ?, ?, ?, ?)");
      let inserted = 0;
      let updated = 0;
      database.exec("BEGIN IMMEDIATE");
      try {
        insertBatch.run(batch.id, resource, batch.filename, batch.importedAt, JSON.stringify(batch));
        records.forEach((record, index) => {
          const key = keys[index];
          const before = find.get(resource, key) as unknown as StoredRow | undefined;
          const payload = JSON.stringify(record);
          upsert.run(resource, key, stringField(record, "marketplace"), typeof record.date === "string" ? record.date : null, stringField(record, "asin"), stringField(record, "sku"), stringField(record, "keywordId"), stringField(record, "competitorAsin"), payload, batch.importedAt);
          audit.run(resource, key, before ? "update" : "insert", before?.payload ?? null, payload, batch.id, batch.importedAt);
          if (before) updated += 1; else inserted += 1;
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return { inserted, updated, skipped: 0 };
    },

    async delete(resource: OpsResource, stableKey: string): Promise<void> {
      database.prepare("DELETE FROM ops_records WHERE resource = ? AND stable_key = ?").run(resource, stableKey);
    },

    async listImports(): Promise<ServerImportBatch[]> {
      const rows = database.prepare("SELECT payload FROM import_batches ORDER BY imported_at").all() as unknown as StoredRow[];
      return rows.map((row) => JSON.parse(row.payload) as ServerImportBatch);
    },

    async health() {
      const records = database.prepare("SELECT COUNT(*) AS count FROM ops_records").get() as unknown as { count: number };
      const imports = database.prepare("SELECT COUNT(*) AS count FROM import_batches").get() as unknown as { count: number };
      return { ok: true as const, recordCount: records.count, importCount: imports.count };
    },
  };
}
