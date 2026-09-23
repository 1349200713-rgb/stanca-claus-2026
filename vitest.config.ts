import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "next/server": "vinext/shims/server" } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
