import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@frontier/vault": at("../../packages/vault/src/index.ts"),
      "@frontier/schema": at("../../packages/schema/src/index.ts"),
      "@frontier/geo": at("../../packages/geo/src/index.ts"),
      "@frontier/time": at("../../packages/time/src/index.ts"),
    },
  },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
