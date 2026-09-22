import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("backup restores committed records while the source still has uncheckpointed WAL writes", () => {
  const root = mkdtempSync(join(tmpdir(), "santa-backup-test-"));
  const source = new DatabaseSync(join(root, "santa-ops.sqlite"));
  try {
    source.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(key TEXT PRIMARY KEY, value TEXT)");
    source.prepare("INSERT INTO records VALUES(?, ?)").run("business:one", "newly committed");
    const result = spawnSync(process.execPath, ["scripts/backup-data.mjs"], {
      env: { ...process.env, SANTA_OPS_DATA_DIR: root, SANTA_OPS_BACKUP_DIR: join(root, "backups") }, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const { path } = JSON.parse(result.stdout);
    const restored = new DatabaseSync(path);
    try {
      expect(restored.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(restored.prepare("SELECT value FROM records WHERE key=?").get("business:one")).toEqual({ value: "newly committed" });
    } finally { restored.close(); }
  } finally {
    source.close();
    rmSync(root, { recursive: true, force: true });
  }
});
