/** The four defects of the stage 27b review: each test here failed before its fix. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ROUTE_ROLES } from "../src/projects/roles.js";
import {
  addMember,
  addPerson,
  type Client,
  makeTestApp,
  type TestApp,
  testEnv,
} from "./helpers/app.js";
import { makeTestRepo, type TestRepo } from "./helpers/repo.js";

/** A concrete address for a registered pattern: its parameters filled with something. */
const concrete = (pattern: string) => pattern.replace(/:[A-Za-z]+/g, "x").replace(/\*/g, "x");

/** The same address with the letters of its literal segments percent-encoded. */
const encodeLetters = (url: string) =>
  url
    .split("/")
    .map((seg) =>
      seg === "x" ? seg : seg.replace(/[a-z]/gi, (c) => `%${c.charCodeAt(0).toString(16)}`),
    )
    .join("/");
/** The same address with only the first letter of `api` encoded: `/%61pi/...`. */
const encodeApi = (url: string) => url.replace(/^\/api(?=\/|$)/, "/%61pi");

describe("openness is declared by the route, not read from the address", () => {
  let built: App;
  let repo: TestRepo;
  let web: string;
  beforeAll(async () => {
    repo = makeTestRepo();
    web = mkdtempSync(join(tmpdir(), "frontier-web-"));
    mkdirSync(join(web, "assets"), { recursive: true });
    writeFileSync(join(web, "index.html"), "<!doctype html><title>Frontier</title>");
    writeFileSync(join(web, "assets", "a-1.js"), "1");
    writeFileSync(join(web, "build.json"), JSON.stringify({ build: "abc", api: 1 }));
    built = await buildApp(loadConfig(testEnv(repo)), { webDir: web });
  });
  afterAll(async () => {
    await built.app.close();
    repo.cleanup();
    rmSync(web, { recursive: true, force: true });
  });

  const hit = (method: string, url: string) => built.app.inject({ method: method as "GET", url });

  it("refuses every route that is not declared open, at its plain and its percent-encoded address", async () => {
    const routes = built.allRoutes.filter(
      (r) =>
        r.url.startsWith("/api/") && !r.public && r.method !== "HEAD" && r.method !== "OPTIONS",
    );
    // A guard against an empty list passing: the table's routes are all among them.
    expect(routes.length).toBeGreaterThan(Object.keys(ROUTE_ROLES).length);
    const failures: string[] = [];
    for (const r of routes) {
      const plain = concrete(r.url);
      for (const url of [plain, encodeApi(plain), encodeLetters(plain)]) {
        const res = await hit(r.method, url);
        if (res.statusCode !== 401) failures.push(`${r.method} ${url} -> ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps open only what the routes declare, and no other route under /api is open", () => {
    const open = built.allRoutes
      .filter((r) => r.public && r.method !== "HEAD")
      .map((r) => `${r.method} ${r.url}`);
    expect(open.sort()).toEqual(
      [
        // Stage 27c: joining by invitation and Google sign-on. Each counts against the per-address
        // allowance (`server.joinLimit`); invitations.test.ts asks each for its 429.
        "GET /api/auth/google/callback",
        "GET /api/auth/google/start",
        "GET /api/join/:code",
        "POST /api/join/:code",
        "POST /api/join/:code/passkey/options",
        "POST /api/join/:code/passkey/verify",
        "GET /api/session",
        "GET /health",
        "POST /api/github/webhook",
        "POST /api/login",
        "POST /api/passkeys/login/options",
        "POST /api/passkeys/login/verify",
      ].sort(),
    );
    // What is not under /api is the web app's files: nothing else.
    const rest = built.allRoutes
      .filter((r) => !r.url.startsWith("/api/") && !r.public)
      .map((r) => r.url);
    expect(rest.filter((u) => u !== "/*" && !/^\/(assets|icons)\//.test(u))).toEqual(
      expect.arrayContaining(["/sw.js", "/build.json"]),
    );
    expect(rest.some((u) => u.startsWith("/api"))).toBe(false);
  });

  it("asks for a session on an address under /api that matches no route, however it is written", async () => {
    for (const url of ["/api/nothing", "/%61pi/nothing", "/api", "/%61pi/p/x/nothing"]) {
      expect((await hit("GET", url)).statusCode, url).toBe(401);
      expect((await hit("POST", url)).statusCode, url).toBe(401);
    }
  });

  it("still serves the web app and the open routes without a session", async () => {
    expect((await hit("GET", "/health")).statusCode).not.toBe(401);
    expect((await hit("GET", "/some/page")).statusCode).toBe(200);
    expect((await hit("GET", "/build.json")).statusCode).toBe(200);
    expect((await hit("GET", "/assets/a-1.js")).statusCode).toBe(200);
    expect((await hit("GET", "/api/session")).statusCode).toBe(200);
    // The api's build header goes on a decoded address too.
    expect((await hit("GET", "/%61pi/nothing")).headers["frontier-build"]).toBeDefined();
  });
});

describe("a session is what unlocks a server-wide route", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(() => t.close());

  it("does not let an encoded address reach the server's own routes", async () => {
    for (const url of ["/%61pi/projects/slug-free?slug=abc", "/api/projects/slug-free?slug=abc"]) {
      expect((await t.app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
    for (const url of [
      "/%61pi/settings/keep-going",
      "/%61pi/settings/ai",
      "/%61pi/settings/ai/prices",
    ]) {
      const res = await t.app.inject({ method: "PUT", url, payload: {} });
      expect(res.statusCode, url).toBe(401);
    }
    expect((await t.app.inject({ method: "GET", url: "/%61pi/ai/prices" })).statusCode).toBe(401);
  });
});

describe("AI choices and Keep going rules belong to each person", () => {
  let t: TestApp;
  let other: Client;
  beforeEach(async () => {
    t = await makeTestApp();
    await t.login();
    other = await addPerson(t, "Other", "other@example.com");
    const first = (await t.server.projects.all())[0]!;
    await addMember(t, first.id, other.id, "writer");
  });
  afterEach(() => t.close());

  const settings = async (c: { get(u: string): ReturnType<TestApp["get"]> }) =>
    (await c.get("/api/settings")).json();

  it("keeps one person's models, prices, art style and propose-on-publish from the others", async () => {
    expect(
      (
        await t.put("/api/settings/ai", {
          models: { extraction: "openrouter:a/b", conversation: "openrouter:c/d" },
          artStyle: "Charcoal.",
          proposeOnPublish: true,
        })
      ).statusCode,
    ).toBe(200);
    await t.put("/api/settings/ai/prices", {
      prices: { "openrouter:a/b": { promptPrice: 1, completionPrice: 2 } },
    });
    const mine = await settings(t);
    expect(mine.ai.models.extraction).toBe("openrouter:a/b");
    expect(mine.ai.artStyle).toBe("Charcoal.");
    expect(mine.ai.proposeOnPublish).toBe(true);
    expect(Object.keys(mine.ai.modelPrices)).toEqual(["openrouter:a/b"]);

    // The other person sees the defaults, and their own changes do not touch the first person's.
    const theirs = await settings(other);
    expect(theirs.ai.models).toEqual({ extraction: null, conversation: null, art: null });
    expect(theirs.ai.artStyle).toContain("Pencil and ink");
    expect(theirs.ai.proposeOnPublish).toBe(false);
    expect(theirs.ai.modelPrices).toEqual({});
    expect(
      (await other.put("/api/settings/ai", { models: { extraction: "openrouter:x/y" } }))
        .statusCode,
    ).toBe(200);
    expect((await settings(t)).ai.models.extraction).toBe("openrouter:a/b");
    expect((await settings(other)).ai.models.extraction).toBe("openrouter:x/y");
    expect((await settings(other)).ai.models.conversation).toBeNull();
  });

  it("asks the current person's choices from inside a project's services", async () => {
    await t.put("/api/settings/ai", {
      models: { conversation: "openrouter:c/d", art: "openrouter:e/f" },
    });
    const map = "kingdom1";
    const ready = async (c: Client | null) => {
      const res = c
        ? await c.get(`/api/maps/${map}/discoveries`)
        : await t.get(`/api/maps/${map}/discoveries`);
      return res.json();
    };
    expect(await ready(null)).toMatchObject({ ready: true, art: true });
    expect(await ready(other)).toMatchObject({ ready: false, art: false });
  });

  it("keeps Keep going rules per person, both in the settings and in the queue they get", async () => {
    await t.put("/api/settings/keep-going", { needsLove: { stub: false } });
    expect((await settings(t)).keepGoing.needsLove.stub).toBe(false);
    expect((await settings(other)).keepGoing.needsLove.stub).toBe(true);
    expect((await t.get("/api/keep-going/queue")).json().rules.stub).toBe(false);
    expect((await other.get("/api/keep-going/queue")).json().rules.stub).toBe(true);
    await other.put("/api/settings/keep-going", { needsLove: { noType: false } });
    expect((await settings(t)).keepGoing.needsLove.noType).toBe(true);
  });

  it("gives the admin what the server held before settings were per person, and a new person the defaults", async () => {
    await t.services.settings.update((s) => ({
      ...s,
      ai: {
        ...s.ai,
        artStyle: "Old style.",
        models: { ...s.ai.models, extraction: "openrouter:o/ld" },
      },
      keepGoing: { needsLove: { ...s.keepGoing.needsLove, stub: false } },
    }));
    const admin = await settings(t);
    expect(admin.ai.artStyle).toBe("Old style.");
    expect(admin.ai.models.extraction).toBe("openrouter:o/ld");
    expect(admin.keepGoing.needsLove.stub).toBe(false);
    const fresh = await addPerson(t, "Fresh", "fresh@example.com");
    expect((await settings(fresh)).ai.artStyle).toContain("Pencil and ink");
    expect((await settings(fresh)).keepGoing.needsLove.stub).toBe(true);
    // The admin's first change keeps the rest of what was theirs.
    await t.put("/api/settings/ai", { proposeOnPublish: true });
    expect((await settings(t)).ai.artStyle).toBe("Old style.");
  });

  it("writes two people's changes at once without losing either", async () => {
    await Promise.all([
      t.put("/api/settings/ai", { artStyle: "A" }),
      other.put("/api/settings/ai", { artStyle: "B" }),
      t.put("/api/settings/keep-going", { needsLove: { stub: false } }),
      other.put("/api/settings/keep-going", { needsLove: { noType: false } }),
    ]);
    expect((await settings(t)).ai.artStyle).toBe("A");
    expect((await settings(other)).ai.artStyle).toBe("B");
    expect((await settings(t)).keepGoing.needsLove).toMatchObject({ stub: false, noType: true });
    expect((await settings(other)).keepGoing.needsLove).toMatchObject({
      stub: true,
      noType: false,
    });
  });

  it("leaves the notice about removed keys to the admin", async () => {
    expect((await other.del("/api/notices/keys-removed")).statusCode).toBe(403);
  });
});

describe("deleting a project while it is in use", () => {
  let t: TestApp;
  let other: Client;
  beforeEach(async () => {
    t = await makeTestApp();
    await t.login();
    other = await addPerson(t, "Other", "other@example.com");
    await t.app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterEach(() => t.close());

  const make = async () => {
    const res = await t.post("/api/projects", {
      name: "Northwind",
      slug: "northwind",
      start: "empty",
    });
    expect(res.statusCode, res.body).toBe(201);
    const made = res.json() as { id: string };
    await addMember(t, made.id, other.id, "writer");
    return made;
  };
  const remove = () =>
    t.app.inject({
      method: "DELETE",
      url: "/api/p/northwind/project",
      headers: t.base(),
      payload: { name: "Northwind" },
    });

  it("refuses to open a deleted project, and a request already past the guard cannot recreate its folder", async () => {
    const made = await make();
    const record = (await t.server.projects.get(made.id))!;
    const root = join(t.services.config.dataDir, "projects", made.id);
    // A request past the guard holds the project's services.
    const held = await t.server.registry.open(record);
    expect((await remove()).statusCode).toBe(200);
    expect(existsSync(root)).toBe(false);

    await expect(t.server.registry.open(record)).rejects.toMatchObject({ code: "no_project" });
    await expect(
      held.files.writeJson(join(root, "state", "late.json"), { late: true }),
    ).rejects.toMatchObject({ code: "no_project" });
    await expect(held.images.serve(Buffer.alloc(0))).rejects.toBeDefined();
    expect(existsSync(root)).toBe(false);
  });

  it("answers requests that are running cleanly, keeps no folder, and refuses a reconnecting stream", async () => {
    const made = await make();
    const root = join(t.services.config.dataDir, "projects", made.id);
    const port = (t.app.server.address() as { port: number }).port;
    const stream = new AbortController();
    const events = await fetch(`http://127.0.0.1:${port}/api/p/northwind/status/events`, {
      headers: { cookie: other.cookie },
      signal: stream.signal,
    });
    expect(events.status).toBe(200);

    let n = 0;
    const draft = () =>
      other.put("/api/p/northwind/drafts", {
        id: `draft${String(n++).padStart(7, "0")}`,
        path: `Note ${n}.md`,
        kind: "create",
        text: `# Note ${n}\n`,
        revision: 0,
      });
    const running = Promise.all([
      ...Array.from({ length: 12 }, draft),
      remove(),
      ...Array.from({ length: 12 }, draft),
      other.get("/api/p/northwind/search?q=welcome"),
      other.get("/api/p/northwind/status"),
    ]);
    const answers = await running;
    for (const res of answers) {
      // Done, or told there is no such project: never an unexpected error.
      expect([200, 201, 403, 404], `${res.statusCode} ${res.body}`).toContain(res.statusCode);
    }
    expect(existsSync(root)).toBe(false);

    // The stream reconnects, as the browser's does: it is refused, and nothing is made.
    const again = await fetch(`http://127.0.0.1:${port}/api/p/northwind/status/events`, {
      headers: { cookie: other.cookie },
    });
    expect(again.status).toBe(403);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("no_project");
    stream.abort();
    expect(existsSync(root)).toBe(false);
    expect((await t.get("/api/projects")).json().projects).toHaveLength(1);
  });
});

describe("an inbox branch's image is for people who can write", () => {
  let t: TestApp;
  let reader: Client;
  let writer: Client;
  beforeAll(async () => {
    t = await makeTestApp();
    await t.login();
    const first = (await t.server.projects.all())[0]!;
    reader = await addPerson(t, "Reed", "reed@example.com");
    writer = await addPerson(t, "Wren", "wren@example.com");
    await addMember(t, first.id, reader.id, "reader");
    await addMember(t, first.id, writer.id, "writer");
  });
  afterAll(() => t.close());

  const url = (prefix: string) =>
    `${prefix}/images?branch=${encodeURIComponent("proposal/x")}&path=${encodeURIComponent("01 Places/a.png")}`;

  it("refuses a reader, at the project's address and the old one, and lets a writer past the role check", async () => {
    for (const prefix of ["/api/p/avalymia", "/api"]) {
      const denied = await reader.get(url(prefix));
      expect(denied.statusCode, prefix).toBe(403);
      expect(denied.json().error.code).toBe("role_too_low");
      const allowed = await writer.get(url(prefix));
      expect(allowed.json().error?.code).not.toBe("role_too_low");
    }
    // A reader still reads the library's own images.
    const plain = await reader.get("/api/p/avalymia/images?path=01%20Places%2Fnope.png");
    expect(plain.json().error?.code).not.toBe("role_too_low");
  });
});
