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
    // The map's pure modules keep their branches covered: the pointer's state machine, the
    // tools, the "+" handles, the curve setting and the styles' precedence.
    coverage: {
      enabled: true,
      provider: "v8",
      include: [
        "src/map/gesture.ts",
        "src/map/tools.ts",
        "src/map/handles.ts",
        "src/map/curveSetting.ts",
        "src/map/mapStyles.ts",
      ],
      thresholds: {
        "src/map/gesture.ts": { branches: 90 },
        "src/map/tools.ts": { branches: 90 },
        "src/map/handles.ts": { branches: 90 },
        "src/map/mapStyles.ts": { branches: 90 },
      },
    },
  },
});
