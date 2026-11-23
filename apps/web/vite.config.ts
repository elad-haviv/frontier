import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { CLIENT_API } from "../../packages/schema/src/client.ts";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Writes `dist/build.json`: the build id, which is the first 12 hex characters of the SHA-256 of
 * the built `index.html` (it names every hashed chunk, so it changes exactly when the app does),
 * and the client API number. The server reads it once at start.
 */
function buildId(): Plugin {
  return {
    name: "frontier-build-id",
    apply: "build",
    writeBundle(options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") return;
      const build = createHash("sha256").update(index.source).digest("hex").slice(0, 12);
      writeFileSync(
        join(options.dir ?? at("dist"), "build.json"),
        `${JSON.stringify({ build, api: CLIENT_API })}\n`,
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    // Our own worker (`src/sw/sw.ts`), given the list of built files to keep. The app registers it
    // itself (`src/offline/updates.ts`), and it is off in `vite dev`.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/sw",
      filename: "sw.ts",
      injectRegister: false,
      devOptions: { enabled: false },
      manifest: {
        name: "Frontier",
        short_name: "Frontier",
        description: "Writing Avalymia",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f7f3ea",
        theme_color: "#f7f3ea",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        maximumFileSizeToCacheInBytes: 5242880,
      },
    }),
    buildId(),
  ],
  resolve: {
    // The shared packages are bundled from source, so the web build needs no earlier build step.
    alias: {
      "@frontier/vault": at("../../packages/vault/src/index.ts"),
      "@frontier/geo": at("../../packages/geo/src/index.ts"),
      "@frontier/schema": at("../../packages/schema/src/index.ts"),
      "@frontier/time": at("../../packages/time/src/index.ts"),
    },
  },
  server: { proxy: { "/api": "http://localhost:3000", "/health": "http://localhost:3000" } },
  build: { outDir: "dist", sourcemap: false },
});
