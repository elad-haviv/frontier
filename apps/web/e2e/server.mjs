// Starts the built server on the sample vault, in a data folder that is emptied first.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "..", ".e2e-data");
rmSync(dataDir, { recursive: true, force: true });

Object.assign(process.env, {
  FRONTIER_SAMPLE_VAULT: "1",
  DATA_DIR: dataDir,
  PUBLIC_URL: `http://127.0.0.1:${process.env.PORT}`,
  SESSION_KEY: Buffer.alloc(32, 9).toString("base64"),
  FRONTIER_INITIAL_PASSWORD: "browser-test-password",
});

await import("../../server/dist/main.js");
