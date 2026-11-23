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
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The save queue and the connection service run on browser APIs.
    environmentMatchGlobs: [["src/sync/**", "happy-dom"]],
    // The pointer's state machine keeps its branches covered.
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/map/gesture.ts"],
      thresholds: { "src/map/gesture.ts": { branches: 90 } },
    },
  },
});
