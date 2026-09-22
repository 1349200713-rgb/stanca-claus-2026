import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storeNames, type WriteOperation, type WriteMode, type WriteResult } from "../storage/protocol";

const dataRoot = process.env.SANTA_OPS_DATA_DIR ?? join(process.cwd(), "data");
const databasePath = join(dataRoot, "santa-ops.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

let database: DatabaseSync | undefined;

function db(): DatabaseSync {
  if (database) return database;
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS records (
      store TEXT NOT NULL,
      record_key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store, record_key)
    );
    CREATE TABLE IF NOT EXISTS settings (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);
  ensurePassword();
  return database;
}

function setting(name: string): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE name = ?").get(name);
  return row?.value as string | undefined;
}

function setSetting(name: string, value: string): void {
  db().prepare("INSERT INTO settings(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(name, value);
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

function ensurePassword(): void {
  if (setting("password_hash")) return;
  setSetting("password_hash", hashPassword(process.env.SANTA_OPS_PASSWORD ?? "SantaOps2026!"));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyPassword(password: string): boolean {
  const stored = setting("password_hash");
  return Boolean(stored && passwordMatches(password, stored));
}

export function changePassword(password: string): void {
  setSetting("password_hash", hashPassword(password));
  db().prepare("DELETE FROM sessions").run();
}

export function createSession(): string {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  db().prepare("INSERT INTO sessions(token_hash, expires_at) VALUES(?, ?)").run(hashToken(token), expiresAt);
  return token;
}

export function deleteSession(token: string | undefined): void {
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = db().prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token));
  if (!row) return false;
  if (Number(row.expires_at) <= Date.now()) {
    deleteSession(token);
    return false;
  }
  return true;
}

export function listRecords(store: string): unknown[] {
  validateStore(store);
  return db().prepare("SELECT value FROM records WHERE store = ? ORDER BY record_key").all(store).map((row) => JSON.parse(String(row.value)));
}

function validateStore(store: string): void {
  if (!(storeNames as readonly string[]).includes(store)) throw new Error("未知的数据类别");
}

function putRecords(store: string, records: readonly unknown[], mode: WriteMode): WriteResult {
  const connection = db();
  const now = new Date().toISOString();
  const statement = connection.prepare(`INSERT ${mode === "replace" ? "OR REPLACE" : mode === "merge" ? "OR IGNORE" : ""} INTO records(store, record_key, value, updated_at) VALUES(?, ?, ?, ?)`);
  const result = { written: 0, skipped: 0 };
  for (const record of records) {
    const key = typeof record === "object" && record !== null && "key" in record ? String((record as { key: unknown }).key) : undefined;
    if (!key) throw new Error("每条业务记录必须包含 key");
    const { changes } = statement.run(store, key, JSON.stringify(record), now);
    result.written += Number(changes);
    result.skipped += changes ? 0 : 1;
  }
  return result;
}

export function writeRecords(store: string, records: unknown[], mode: WriteMode): WriteResult {
  return batchWrite([{ store: store as WriteOperation["store"], records, mode }]);
}

export function clearRecords(store?: string): void {
  if (store) db().prepare("DELETE FROM records WHERE store = ?").run(store);
  else db().prepare("DELETE FROM records").run();
}

export function batchWrite(operations: WriteOperation[]): WriteResult {
  if (!Array.isArray(operations) || operations.length > 100) throw new Error("无效的批量操作");
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") throw new Error("无效的操作");
    validateStore(operation.store);
    if (operation.mode !== undefined && !["insert", "replace", "merge"].includes(operation.mode)) throw new Error("无效的写入模式");
    const actions = Number(operation.records !== undefined) + Number(operation.deleteKeys !== undefined) + Number(operation.clear === true);
    if (actions !== 1) throw new Error("每个操作必须指定一种修改方式");
    if (operation.records !== undefined) {
      if (!Array.isArray(operation.records) || operation.records.length > 100000) throw new Error("无效的记录列表");
      for (const record of operation.records) {
        if (!record || typeof record !== "object" || !("key" in record) || typeof record.key !== "string" || !record.key || record.key.length > 2048) throw new Error("每条业务记录必须包含有效 key");
      }
    }
    if (operation.deleteKeys !== undefined && (!Array.isArray(operation.deleteKeys) || operation.deleteKeys.some((key) => typeof key !== "string" || !key))) throw new Error("无效的删除列表");
  }
  const connection = db();
  const result = { written: 0, skipped: 0 };
  connection.exec("BEGIN IMMEDIATE");
  try {
    for (const operation of operations) {
      if (operation.clear) clearRecords(operation.store);
      for (const key of operation.deleteKeys ?? []) connection.prepare("DELETE FROM records WHERE store = ? AND record_key = ?").run(operation.store, key);
      if (operation.records?.length) {
        const written = putRecords(operation.store, operation.records, operation.mode ?? "replace");
        result.written += written.written;
        result.skipped += written.skipped;
      }
    }
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
