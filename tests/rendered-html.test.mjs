import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const previewRoot = new URL("../app/_sites-preview/", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the completed Santa Ops dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>2026 圣诞服每日经营驾驶舱<\/title>/i);
  assert.match(html, /SANTA OPS 2026/);
  assert.match(html, /计划销量 vs 实际销量/);
  assert.match(html, /库存与积压风险/);
  assert.match(html, /今日异常与动作/);
  for (const label of ["经营驾驶舱", "计划与库存", "广告推广", "推广复盘图表", "关键词排名", "竞品跟踪", "每日操作"]) assert.match(html, new RegExp(label));
  assert.match(html, /data-chart-kind="line"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("starter preview artifacts and dependency are removed", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.dependencies["react-loading-skeleton"], undefined);
  await assert.rejects(access(previewRoot));
});
