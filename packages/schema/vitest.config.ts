import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // The map styles keep their branches covered.
      thresholds: { "src/mapStyles.ts": { branches: 90 } },
    },
  },
});
