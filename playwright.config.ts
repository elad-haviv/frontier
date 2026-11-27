import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets two checkouts (such as worktrees) run their browser tests side by side.
const PORT = Number(process.env.E2E_PORT ?? 3987);
const AUTH = "test-results/.auth.json";
// Stage 32: the specs about email need a server that sends mail (kept in memory, read at
// /api/test/mail), and every other spec needs one that does not. So there are two servers: the
// main one as always, and a second with `E2E_MAIL=1` on its own port and its own data folder. It is
// addressed as 127.0.0.1, not localhost, so the two never share cookies (cookies ignore the port).
const MAIL_PORT = Number(process.env.E2E_MAIL_PORT ?? PORT + 500);

/**
 * Browser tests. They run against the built server on the made-up sample vault, in a data folder
 * that is wiped at every start. Build first: `npm run build`.
 */
export default defineConfig({
  testDir: "apps/web/e2e",
  // One server holds one vault, so the tests take turns.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    // "localhost", not an address: a passkey is bound to a host name.
    baseURL: `http://localhost:${PORT}`,
    // Tracing is off to keep runs fast; turn it on with --trace on when a test needs debugging.
    trace: "off",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Everything runs at phone size with touch, since the phone is the harder case. The service
    // worker is blocked here, so every request reaches the server as the tests expect.
    {
      name: "phone",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        storageState: AUTH,
        serviceWorkers: "block",
      },
      dependencies: ["setup"],
      testIgnore: /offline\.spec\.ts|auth\.setup\.ts|email\.spec\.ts/,
    },
    // Reading is also checked at desktop size, where the layout differs.
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 }, storageState: AUTH, serviceWorkers: "block" },
      dependencies: ["setup"],
      testMatch:
        /(reader|voice|chronicle|mapstime|mapviews|mapgestures|mapsread|mapsedit|starmap|systemmap|stackmap|mapslist|mapstyles|maplayers|maptools|findareas|findpaths|terrain|terrainhints|biomes|explore|mapjoins|mapgroups|editor|shell|tree|graph|writing|consult|properties|margin|settings|accounts|home|keepgoing|phonelibrary|librarypane|pictures|trees|projects|members|readerrole|google|people|airelations|artstyles|types)\.spec\.ts/,
    },
    // Email (stage 32): against the server that sends mail, logged out: each test logs in or joins
    // by itself, as a person would. Desktop size; the phone is looked at inside the tests.
    {
      name: "mail",
      use: {
        viewport: { width: 1280, height: 800 },
        baseURL: `http://127.0.0.1:${MAIL_PORT}`,
        serviceWorkers: "block",
      },
      testMatch: /email\.spec\.ts/,
    },
    // The installed app: the service worker the build ships, with the connection cut.
    {
      name: "offline",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        storageState: AUTH,
        serviceWorkers: "allow",
      },
      dependencies: ["setup"],
      testMatch: /offline\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "node apps/web/e2e/server.mjs",
      url: `http://127.0.0.1:${PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(PORT) },
    },
    {
      command: "node apps/web/e2e/server.mjs",
      url: `http://127.0.0.1:${MAIL_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(MAIL_PORT),
        E2E_MAIL: "1",
        E2E_DATA: ".e2e-data-mail",
        E2E_ORIGIN: `http://127.0.0.1:${MAIL_PORT}`,
      },
    },
  ],
});
