import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("the read-only workbook deterministically reproduces the checked-in 3000/3010 plan audit", () => {
  const script = resolve(process.cwd(), "../work/dashboard_analysis/extract_plan.mjs");
  const result = spawnSync(process.execPath, [script, "--check"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain("authoritative=3000");
  expect(result.stdout).toContain("weekly=3010");
});
