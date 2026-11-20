import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The shared packages are bundled from source, so the web build needs no earlier build step.
    alias: {
      "@frontier/vault": at("../../packages/vault/src/index.ts"),
      "@frontier/schema": at("../../packages/schema/src/index.ts"),
    },
  },
  server: { proxy: { "/api": "http://localhost:3000", "/health": "http://localhost:3000" } },
  build: { outDir: "dist", sourcemap: false },
});
