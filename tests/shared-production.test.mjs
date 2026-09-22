import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

test("production server shares mutations between two authenticated sessions", { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "santa-production-test-"));
  const password = randomBytes(24).toString("hex");
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    env: { ...process.env, SANTA_OPS_DATA_DIR: root, SANTA_OPS_PASSWORD: password, NODE_ENV: "production" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.stdout.on("data", (data) => { output = (output + data).slice(-6000); });
  child.stderr.on("data", (data) => { output = (output + data).slice(-6000); });
  const login = async () => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const post = (cookie, body) => fetch(`${base}/api/data`, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { ready = (await fetch(`${base}/api/auth/session`)).ok; } catch { /* Wait for the bound listener. */ }
      if (ready) break;
      await delay(250);
    }
    assert.ok(ready, output);
    assert.equal((await fetch(`${base}/api/data?store=dailyOps`)).status, 401);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong-password" }) })).status, 401);
    const first = await login();
    const second = await login();
    const record = { key: "production-sync-check", date: "2026-11-24", action: "First", risk: "", tomorrowPlan: "", status: "未完成", updatedAt: "2026-11-24T00:00:00Z" };
    assert.equal((await post(first, { store: "dailyOps", records: [record], mode: "insert" })).status, 200);
    const read = await fetch(`${base}/api/data?store=dailyOps`, { headers: { cookie: second } });
    assert.equal(read.headers.get("cache-control"), "no-store");
    assert.deepEqual((await read.json()).records, [record]);
    assert.equal((await post(second, { store: "dailyOps", records: [{ ...record, action: "Updated" }], mode: "replace" })).status, 200);
    assert.equal((await (await fetch(`${base}/api/data?store=dailyOps`, { headers: { cookie: first } })).json()).records[0].action, "Updated");
    assert.equal((await post(first, { store: "dailyOps", deleteKeys: [record.key] })).status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/data?store=dailyOps`, { headers: { cookie: second } })).json()).records, []);
    await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: first } });
    assert.equal((await fetch(`${base}/api/data?store=dailyOps`, { headers: { cookie: first } })).status, 401);
  } finally {
    child.kill();
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
