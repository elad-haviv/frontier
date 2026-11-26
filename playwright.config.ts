import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets two checkouts (such as worktrees) run their browser tests side by side.
const PORT = Number(process.env.E2E_PORT ?? 3987);
const AUTH = "test-results/.auth.json";

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
      testIgnore: /offline\.spec\.ts|auth\.setup\.ts/,
    },
    // Reading is also checked at desktop size, where the layout differs.
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 }, storageState: AUTH, serviceWorkers: "block" },
      dependencies: ["setup"],
      testMatch:
        /(reader|voice|chronicle|mapstime|mapviews|mapgestures|mapsread|mapsedit|starmap|systemmap|stackmap|mapslist|mapstyles|maplayers|maptools|findareas|findpaths|terrain|terrainhints|biomes|explore|mapjoins|mapgroups|editor|shell|tree|graph|writing|consult|properties|margin|settings|accounts|home|keepgoing|phonelibrary)\.spec\.ts/,
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
  webServer: {
    command: "node apps/web/e2e/server.mjs",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(PORT) },
  },
});
