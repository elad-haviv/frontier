import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type App, buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { KILL_WORKER_SCRIPT, type KillWorkerScope } from "../src/killWorker.js";
import { testEnv } from "./helpers/app.js";
import { makeTestRepo, type TestRepo } from "./helpers/repo.js";

const open: { app: App["app"]; repo: TestRepo; web: string }[] = [];

afterEach(async () => {
  for (const { app, repo, web } of open.splice(0)) {
    await app.close();
    repo.cleanup();
    rmSync(web, { recursive: true, force: true });
  }
});

/** A server whose web folder holds a small build; `files` replaces or removes its files. */
async function serve(env: Record<string, string> = {}, files: Record<string, string | null> = {}) {
  const repo = makeTestRepo();
  const web = mkdtempSync(join(tmpdir(), "frontier-web-"));
  const all: Record<string, string | null> = {
    "index.html": '<!doctype html><title>Frontier</title><script src="/assets/a-123.js"></script>',
    "sw.js": "self.addEventListener('fetch', () => {});",
    "build.json": JSON.stringify({ build: "3f9a0c21be77", api: 1 }),
    "manifest.webmanifest": JSON.stringify({ name: "Frontier" }),
    "assets/a-123.js": "console.log(1)",
    "icons/icon-192.png": "png",
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(join(web, name, ".."), { recursive: true });
    writeFileSync(join(web, name), text);
  }
  const { app } = await buildApp(loadConfig(testEnv(repo, env)), { webDir: web });
  open.push({ app, repo, web });
  return (url: string) => app.inject({ method: "GET", url });
}

describe("serving the installable app", () => {
  it("reads what names the other files again each time, and keeps hashed files", async () => {
    const get = await serve();
    for (const url of [
      "/",
      "/index.html",
      "/sw.js",
      "/e/02%20People/Mira.md",
      "/manifest.webmanifest",
      "/build.json",
    ]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
    expect((await get("/assets/a-123.js")).headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await get("/icons/icon-192.png")).headers["cache-control"]).toBe(
      "public, max-age=86400",
    );
    const worker = await get("/sw.js");
    expect(worker.body).toBe("self.addEventListener('fetch', () => {});");
    expect(worker.headers["content-type"]).toMatch(/javascript/);
    expect((await get("/build.json")).json()).toEqual({ build: "3f9a0c21be77", api: 1 });
  });

  it("allows the worker and the manifest, and names the build on API answers", async () => {
    const get = await serve();
    const page = await get("/");
    expect(page.headers["content-security-policy"]).toContain("worker-src 'self'");
    expect(page.headers["content-security-policy"]).toContain("manifest-src 'self'");
    expect(page.headers["frontier-build"]).toBeUndefined();
    const api = await get("/api/session");
    expect(api.statusCode).toBe(200);
    expect(api.headers["frontier-build"]).toBe("3f9a0c21be77");
    // An answer refused for want of a session says it too.
    expect((await get("/api/tree")).headers["frontier-build"]).toBe("3f9a0c21be77");
  });

  it("serves the kill worker and says so in build.json when the switch is off", async () => {
    const get = await serve({ FRONTIER_SERVICE_WORKER: "off" });
    expect((await get("/build.json")).json()).toEqual({
      build: "3f9a0c21be77",
      api: 1,
      worker: false,
    });
    const worker = await get("/sw.js");
    expect(worker.statusCode).toBe(200);
    expect(worker.headers["cache-control"]).toBe("no-cache");
    expect(worker.headers["content-type"]).toMatch(/javascript/);
    expect(worker.body).toBe(KILL_WORKER_SCRIPT);
  });

  it("runs as before without a built worker or build.json", async () => {
    const get = await serve({}, { "sw.js": null, "build.json": null });
    const build = await get("/build.json");
    expect(build.statusCode).toBe(200);
    expect(build.json()).toEqual({ build: "dev" });
    const worker = await get("/sw.js");
    expect(worker.statusCode).toBe(404);
    expect(worker.json().error.code).toBe("not_found");
    expect((await get("/api/session")).headers["frontier-build"]).toBe("dev");
  });
});

/** A fake service worker scope that records what the kill worker does, in order. */
function fakeScope(names: string[], windows: string[]) {
  const did: string[] = [];
  const listeners = new Map<string, (event: { waitUntil(work: Promise<unknown>): void }) => void>();
  const scope: KillWorkerScope = {
    addEventListener: (type, listener) => void listeners.set(type, listener),
    skipWaiting: async () => void did.push("skipWaiting"),
    caches: {
      keys: async () => [...names],
      delete: async (name) => {
        did.push(`delete ${name}`);
        return true;
      },
    },
    clients: {
      claim: async () => void did.push("claim"),
      matchAll: async (options) => {
        did.push(`matchAll ${options.type}`);
        return windows.map((url) => ({
          url,
          navigate: async (to: string) => void did.push(`navigate ${to}`),
        }));
      },
    },
    registration: { unregister: async () => (did.push("unregister"), true) },
  };
  const fire = async (type: string) => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (w) => (work = w) });
    await work;
  };
  return { scope, did, fire };
}

describe("the kill worker", () => {
  it("takes over at once, removes the app's caches and itself, and reloads its pages", async () => {
    const { scope, did, fire } = fakeScope(
      ["workbox-precache-v2-http://x/", "frontier-images", "someone-else", "workbox-runtime"],
      ["http://x/e/Harbor.md", "http://x/map/coast"],
    );
    // The served text, run as a browser would run it, with `self` as the scope.
    new Function("self", KILL_WORKER_SCRIPT)(scope);
    await fire("install");
    expect(did).toEqual(["skipWaiting"]);
    await fire("activate");
    expect(did).toEqual([
      "skipWaiting",
      "claim",
      "delete workbox-precache-v2-http://x/",
      "delete frontier-images",
      "delete workbox-runtime",
      "unregister",
      "matchAll window",
      "navigate http://x/e/Harbor.md",
      "navigate http://x/map/coast",
    ]);
  });

  it("leaves the device's database alone", () => {
    expect(KILL_WORKER_SCRIPT).not.toMatch(/indexedDB/i);
  });
});
