import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses a pale-blue base palette with semantic green, red, and yellow statuses", async () => {
  const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--background:\s*#edf6ff;/);
  assert.match(css, /--brand:\s*#2563a8;/);
  assert.match(css, /--complete:\s*#16803c;/);
  assert.match(css, /--risk:\s*#c62828;/);
  assert.match(css, /--attention:\s*#9a6700;/);
  assert.match(css, /\.status-complete\s*\{\s*color: var\(--complete\); background: var\(--complete-bg\);\s*\}/);
  assert.match(css, /\.status-risk\s*\{\s*color: var\(--risk\); background: var\(--risk-bg\);\s*\}/);
  assert.match(css, /\.status-attention\s*\{\s*color: var\(--attention\); background: var\(--attention-bg\);\s*\}/);
});
