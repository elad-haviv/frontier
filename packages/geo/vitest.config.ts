import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // The curve and the zone move are held to more.
      thresholds: {
        branches: 85,
        "src/curve.ts": { branches: 90 },
        "src/move.ts": { branches: 90 },
      },
    },
  },
});
