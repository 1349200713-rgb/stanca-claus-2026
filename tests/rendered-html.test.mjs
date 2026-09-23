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

test("server-renders the authentication gate without private dashboard content", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>2026 圣诞服每日经营驾驶舱<\/title>/i);
  assert.match(html, /正在验证访问权限/);
  assert.doesNotMatch(html, /data-chart-kind="line"/);
  assert.doesNotMatch(html, /今日异常与动作/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("starter preview artifacts and dependency are removed", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.dependencies["react-loading-skeleton"], undefined);
  await assert.rejects(access(previewRoot));
});
