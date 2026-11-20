import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against the packages' source, so no build is needed first.
    alias: {
      "@frontier/vault": at("../../packages/vault/src/index.ts"),
      "@frontier/schema": at("../../packages/schema/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/cli/**", "src/git/appAuth.ts"],
      thresholds: { "src/git/**": { branches: 90 } },
    },
  },
});
