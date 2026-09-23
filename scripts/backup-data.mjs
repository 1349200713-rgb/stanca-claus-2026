import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const dataRoot = resolve(process.env.SANTA_OPS_DATA_DIR ?? "data");
const backupRoot = resolve(process.env.SANTA_OPS_BACKUP_DIR ?? join(dataRoot, "backups"));
const sourcePath = join(dataRoot, "santa-ops.sqlite");
if (!existsSync(sourcePath)) throw new Error("Database does not exist; refusing to create an empty backup");
mkdirSync(backupRoot, { recursive: true });
const filename = `santa-ops-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.sqlite`;
const finalPath = join(backupRoot, filename);
const partialPath = `${finalPath}.partial`;
const database = new DatabaseSync(sourcePath);
try {
  database.exec("PRAGMA busy_timeout=10000");
  // SQLite takes a consistent snapshot including committed WAL records.
  database.prepare("VACUUM INTO ?").run(partialPath);
  const snapshot = new DatabaseSync(partialPath, { readOnly: true });
  try {
    if (snapshot.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Backup integrity check failed");
  } finally { snapshot.close(); }
  renameSync(partialPath, finalPath);
} finally {
  database.close();
  if (existsSync(partialPath)) unlinkSync(partialPath);
}

const snapshots = readdirSync(backupRoot).filter((name) => /^santa-ops-\d{4}-\d{2}-\d{2}T[\dTZ.-]+-[a-f\d-]+\.sqlite$/.test(name)).sort().reverse();
for (const name of snapshots.slice(14)) unlinkSync(join(backupRoot, name));
console.log(JSON.stringify({ path: finalPath, integrity: "ok" }));
