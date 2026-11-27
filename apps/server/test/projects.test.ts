import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { StateFiles } from "../src/state/files.js";
import { ProjectStore } from "../src/projects/store.js";
import {
  addMember,
  addPerson,
  type Client,
  makeTestApp,
  type TestApp,
  testEnv,
} from "./helpers/app.js";
import { makeTestRepo } from "./helpers/repo.js";

let t: TestApp;
let admin: Client;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
  admin = {
    id: (await t.services.server.people.all())[0]!.id,
    cookie: t.cookie,
    get: (u) => t.get(u),
    post: (u, b) => t.post(u, b),
    put: (u, b) => t.put(u, b),
    del: (u, b) =>
      t.app.inject({
        method: "DELETE",
        url: u,
        headers: t.base(),
        ...(b === undefined ? {} : { payload: b as object }),
      }),
  };
});
afterEach(() => t.close());

const firstProject = async () => (await t.server.projects.all())[0]!;

/** Makes a project as the admin, through the API. */
async function make(slug: string, name = slug, start: "empty" | "sample" = "empty") {
  const res = await admin.post("/api/projects", { name, slug, start });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; slug: string };
}

describe("the project store", () => {
  let store: ProjectStore;
  let now = new Date("2026-11-27T10:00:00Z");
  beforeEach(() => {
    now = new Date("2026-11-27T10:00:00Z");
    store = new ProjectStore(join(t.repo.root, "store-state"), new StateFiles(), () => now);
  });
  const record = (slug: string) => ({
    slug,
    name: slug,
    description: "",
    colour: 0,
    kind: "own" as const,
    layout: "folder" as const,
    iconFolder: null,
    members: [],
  });

  it("keeps slugs unique and refuses reserved words and bad shapes", async () => {
    await store.create(record("atlas"));
    expect(await store.whyNotSlug("atlas")).toMatch(/already uses/);
    expect(await store.whyNotSlug("new")).toMatch(/taken/);
    expect(await store.whyNotSlug("api")).toMatch(/taken/);
    expect(await store.whyNotSlug("Atlas")).toMatch(/lowercase/);
    expect(await store.whyNotSlug("-atlas")).toMatch(/lowercase/);
    expect(await store.whyNotSlug("a")).toMatch(/lowercase/);
    expect(await store.whyNotSlug("two-words")).toBeNull();
    await expect(store.create(record("atlas"))).rejects.toMatchObject({ code: "slug_taken" });
  });

  it("keeps the old address of a renamed project for 90 days, and then forgets it", async () => {
    const p = await store.create(record("atlas"));
    await store.update(p.id, (now) => ({ ...now, slug: "world" }));
    expect((await store.resolve("atlas"))?.movedFrom).toBe("atlas");
    expect((await store.resolve("atlas"))?.record.slug).toBe("world");
    expect((await store.resolve("world"))?.movedFrom).toBeNull();
    // Nobody else may take it meanwhile; the project itself may take it back.
    expect(await store.whyNotSlug("atlas")).toMatch(/already uses/);
    expect(await store.whyNotSlug("atlas", p.id)).toBeNull();
    now = new Date("2027-03-01T10:00:00Z");
    expect(await store.resolve("atlas")).toBeNull();
    expect(await store.whyNotSlug("atlas")).toBeNull();
    // Taking an address back drops it from the old ones.
    await store.update(p.id, (n) => ({ ...n, slug: "atlas" }));
    expect((await store.get(p.id))?.previousSlugs.map((o) => o.slug)).toEqual(["world"]);
  });

  it("refuses a change to a slug another project has, and a missing project", async () => {
    const a = await store.create(record("one"));
    await store.create(record("two"));
    await expect(store.update(a.id, (n) => ({ ...n, slug: "two" }))).rejects.toMatchObject({
      code: "slug_taken",
    });
    await expect(store.update("nothingnothing", (n) => n)).rejects.toMatchObject({
      code: "no_project",
    });
    expect((await store.of("nobody")).length).toBe(0);
  });
});

describe("the first project", () => {
  it("is the library the server had: named from the configuration, legacy layout, the admin its owner", async () => {
    // The account was made after the server started, so the first request takes the project.
    await admin.get("/api/projects");
    const first = await firstProject();
    expect(first).toMatchObject({
      name: "Avalymia",
      slug: "avalymia",
      layout: "legacy",
      kind: "own",
      members: [{ personId: admin.id, role: "owner" }],
    });
    expect(t.services.paths.vault).toBe(join(t.services.config.dataDir, "vault"));
    expect(t.services.paths.state).toBe(join(t.services.config.dataDir, "state"));
  });

  it("is named by FRONTIER_PROJECT_NAME, and Sample for the sample", () => {
    const base = testEnv(makeTestRepo());
    expect(loadConfig({ ...base, FRONTIER_PROJECT_NAME: "Northwind" }).projectName).toBe(
      "Northwind",
    );
    expect(loadConfig({ ...base, FRONTIER_SAMPLE_VAULT: "1" }).projectName).toBe("Sample");
    expect(loadConfig(base).projectName).toBe("Avalymia");
  });

  it("is claimed by the first admin when the server started before any account", async () => {
    const repo = makeTestRepo();
    const config = loadConfig(testEnv(repo));
    mkdirSync(join(config.dataDir, "state"), { recursive: true });
    const fresh = await buildApp(config);
    expect((await fresh.server.projects.all())[0]!.members).toEqual([]);
    const person = await fresh.server.people.create({ name: "A", email: "a@example.com" });
    const list = await fresh.app.inject({ method: "GET", url: "/api/projects", headers: {} });
    expect(list.statusCode).toBe(401);
    const { claimForAdmin } = await import("../src/projects/guard.js");
    await claimForAdmin(fresh.server, person);
    expect((await fresh.server.projects.all())[0]!.members[0]).toMatchObject({
      personId: person.id,
      role: "owner",
    });
    await fresh.app.close();
    repo.cleanup();
  });
});

describe("an upgrade from a data folder from before projects", () => {
  it("makes the existing library the first project without moving a file, and its personal data the admin's", async () => {
    const { dataDir } = t.services.config;
    // What an older server had kept: pins in the library's pins file, a conversation and the
    // question of the day straight in the state folder.
    const old = await t.put("/api/library-files/pins", {
      file: { version: 1, pins: [{ path: "02 People/Mira.md" }] },
      revision: 0,
    });
    expect(old.statusCode, old.body).toBe(200);
    const conversation = {
      id: "abcdefghij12",
      title: "An old question",
      at: "2026-01-01T00:00:00.000Z",
      turns: [],
    };
    mkdirSync(join(dataDir, "state", "conversations"), { recursive: true });
    writeFileSync(
      join(dataDir, "state", "conversations", "abcdefghij12.json"),
      JSON.stringify(conversation),
    );
    // The other person's pins start empty; the old ones are the admin's.
    const other = await addPerson(t, "Other", "other@example.com");
    await addMember(t, (await firstProject()).id, other.id, "owner");
    // Remove what projects made, as if the server had never known them.
    const walk = (dir: string, rel = ""): string[] =>
      readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
      );
    await t.app.close();
    const { rmSync } = await import("node:fs");
    rmSync(join(dataDir, "state", "projects.json"));
    const before = walk(dataDir).filter((f) => !f.startsWith("bucket"));

    const again = await buildApp(loadConfig(testEnv(t.repo)));
    const after = walk(dataDir).filter((f) => !f.startsWith("bucket"));
    // Nothing that was there moved or went; the project list is the one new file.
    expect(before.filter((f) => !after.includes(f))).toEqual([]);
    expect(after.filter((f) => !before.includes(f))).toEqual(["state/projects.json"]);
    const projects = await again.server.projects.all();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ layout: "legacy", slug: "avalymia" });
    // The admin and, to be safe, every account that existed is an owner.
    expect(projects[0]!.members.map((m) => m.role)).toEqual(["owner", "owner"]);
    expect(projects[0]!.members[0]!.personId).toBe(admin.id);

    await again.services.git.ensureClone();
    await again.services.sync();
    const login = async (email: string) =>
      String(
        (
          await again.app.inject({
            method: "POST",
            url: "/api/login",
            payload: { email, password: "correct horse battery" },
          })
        ).headers["set-cookie"],
      ).split(";")[0]!;
    const asAdmin = { cookie: await login("author@example.com") };
    const asOther = { cookie: await login("other@example.com") };
    const get = (c: { cookie: string }, url: string) =>
      again.app.inject({ method: "GET", url, headers: c });
    // The old pins file's pins are the admin's, and the other person starts with none.
    expect(
      (await get(asAdmin, "/api/p/avalymia/pins")).json().pins.map((p: { path: string }) => p.path),
    ).toEqual(["02 People/Mira.md"]);
    expect((await get(asOther, "/api/p/avalymia/pins")).json().pins).toEqual([]);
    const conversations = (await get(asAdmin, "/api/p/avalymia/lore")).json().conversations;
    expect(conversations.map((c: { id: string }) => c.id)).toEqual(["abcdefghij12"]);
    expect((await get(asOther, "/api/p/avalymia/lore")).json().conversations).toEqual([]);
    expect((await get(asOther, "/api/p/avalymia/lore/abcdefghij12")).statusCode).toBe(404);
    await again.app.close();
  });
});

describe("creating, renaming and deleting a project", () => {
  it("makes an own library under projects/<id>, with the creator as its owner and a welcome entry", async () => {
    const made = await make("northwind", "Northwind");
    const root = join(t.services.config.dataDir, "projects", made.id);
    expect(existsSync(join(root, "library.git"))).toBe(true);
    expect(existsSync(join(root, "vault", "Welcome.md"))).toBe(true);
    const info = (await admin.get("/api/p/northwind/project")).json();
    expect(info).toMatchObject({
      slug: "northwind",
      name: "Northwind",
      role: "owner",
      kind: "own",
      deletable: true,
      movedFrom: null,
    });
    const search = (await admin.get("/api/p/northwind/search?q=welcome")).json();
    expect(search.results.map((r: { path: string }) => r.path)).toEqual(["Welcome.md"]);
    // The first project's own files did not change, and it cannot be deleted.
    expect((await admin.get("/api/p/avalymia/project")).json().deletable).toBe(false);
  });

  it("can start from the sample", async () => {
    await make("sandbox", "Sandbox", "sample");
    const tree = (await admin.get("/api/p/sandbox/search?q=Salt Road")).json();
    expect(tree.results.length).toBeGreaterThan(0);
  });

  it("refuses a taken or reserved address, a second account, and bad input", async () => {
    await make("northwind");
    expect(
      (await admin.post("/api/projects", { name: "X", slug: "northwind" })).json().error.code,
    ).toBe("slug_taken");
    expect((await admin.post("/api/projects", { name: "X", slug: "avalymia" })).statusCode).toBe(
      409,
    );
    expect((await admin.post("/api/projects", { name: "X", slug: "new" })).statusCode).toBe(409);
    expect((await admin.post("/api/projects", { name: "", slug: "fine" })).statusCode).toBe(400);
    expect((await admin.post("/api/projects", { name: "X", slug: "Bad Slug" })).statusCode).toBe(
      400,
    );
    const other = await addPerson(t, "Other", "other@example.com");
    const res = await other.post("/api/projects", { name: "Mine", slug: "mine" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("not_allowed");
    expect((await admin.get("/api/projects/slug-free?slug=northwind")).json()).toMatchObject({
      free: false,
    });
    expect((await admin.get("/api/projects/slug-free?slug=free-one")).json()).toEqual({
      free: true,
      reason: null,
    });
  });

  it("renames: the new address works, the old one still reaches the project and says where it moved", async () => {
    await make("northwind", "Northwind");
    const res = await admin.put("/api/p/northwind/project", {
      slug: "north",
      name: "North",
      description: "Up there",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ slug: "north", name: "North", description: "Up there" });
    const viaNew = (await admin.get("/api/p/north/project")).json();
    expect(viaNew).toMatchObject({ slug: "north", movedFrom: null });
    const viaOld = (await admin.get("/api/p/northwind/project")).json();
    expect(viaOld).toMatchObject({ slug: "north", movedFrom: "northwind" });
    expect((await admin.get("/api/p/northwind/search?q=welcome")).statusCode).toBe(200);
    // Another project cannot take the old address; an address in use cannot be changed to.
    expect((await admin.post("/api/projects", { name: "N", slug: "northwind" })).statusCode).toBe(
      409,
    );
    expect((await admin.put("/api/p/north/project", { slug: "avalymia" })).statusCode).toBe(409);
    const list = (await admin.get("/api/projects")).json();
    expect(list.projects.map((p: { slug: string }) => p.slug)).toEqual(["avalymia", "north"]);
  });

  it("deletes into trash: needs the name typed, refuses the first project and the last", async () => {
    const made = await make("northwind", "Northwind");
    const root = join(t.services.config.dataDir, "projects", made.id);
    expect((await admin.del("/api/p/northwind/project", {})).statusCode).toBe(400);
    expect((await admin.del("/api/p/northwind/project", { name: "northwind" })).statusCode).toBe(
      400,
    );
    const first = await admin.del("/api/p/avalymia/project", { name: "Avalymia" });
    expect(first.statusCode).toBe(409);
    expect(first.json().error.code).toBe("project_not_deletable");
    expect(first.json().error.message).toMatch(/started with/);

    const gone = await admin.del("/api/p/northwind/project", { name: "Northwind" });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(existsSync(root)).toBe(false);
    const trash = readdirSync(join(t.services.config.dataDir, "trash"));
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatch(new RegExp(`^${made.id}-`));
    expect(existsSync(join(t.services.config.dataDir, "trash", trash[0]!, "library.git"))).toBe(
      true,
    );
    expect((await admin.get("/api/p/northwind/project")).statusCode).toBe(403);
    expect((await admin.get("/api/projects")).json().projects).toHaveLength(1);

    // The last one: take the first out of the list, and the one left is refused.
    const again = await make("again", "Again");
    await t.server.projects.remove((await firstProject()).id);
    const last = await admin.del("/api/p/again/project", { name: "Again" });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.message).toMatch(/last project/);
    void again;
  });
});

describe("two projects and two people kept apart", () => {
  let other: Client;
  let northwind: { id: string };
  beforeEach(async () => {
    t.repo.pushFromOutside({
      "99 Appendices/Images/vector.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="10"/>',
    });
    await t.services.sync();
    northwind = await make("northwind", "Northwind");
    other = await addPerson(t, "Other", "other@example.com");
    await addMember(t, northwind.id, other.id, "owner");
    // A note only the second project has.
    const draft = await other.put("/api/p/northwind/drafts", {
      id: "northdraft01",
      path: "Zebrafish Secrets.md",
      kind: "create",
      text: "# Zebrafish Secrets\n\nOnly in Northwind: the quokka.\n",
      revision: 0,
    });
    expect(draft.statusCode, draft.body).toBe(200);
  });

  it("answers a non-member exactly as it answers a project that does not exist", async () => {
    const urls = [
      ["GET", "/api/p/{p}/entries?path=02%20People%2FMira.md"],
      ["GET", "/api/p/{p}/images?path=99%20Appendices%2FImages%2Fvector.svg"],
      ["GET", "/api/p/{p}/status/events"],
      ["GET", "/api/p/{p}/export/library.zip"],
      ["POST", "/api/p/{p}/export/site"],
      ["GET", "/api/p/{p}/search?q=Mira"],
      ["GET", "/api/p/{p}/graph"],
      ["GET", "/api/p/{p}/project"],
      ["GET", "/api/p/{p}/nothing-here"],
    ] as const;
    for (const [method, url] of urls) {
      const missing = await t.app.inject({
        method,
        url: url.replace("{p}", "no-such-project"),
        headers: { cookie: other.cookie },
        ...(method === "POST" ? { payload: {} } : {}),
      });
      const foreign = await t.app.inject({
        method,
        url: url.replace("{p}", "avalymia"),
        headers: { cookie: other.cookie },
        ...(method === "POST" ? { payload: {} } : {}),
      });
      expect(foreign.statusCode, url).toBe(403);
      expect(foreign.json().error.code, url).toBe("no_project");
      expect(foreign.statusCode).toBe(missing.statusCode);
      expect(foreign.body).toBe(missing.body);
    }
    // Neither reaches a project's services: the first one's image is not served to them.
  });

  it("does not let a member of one project read the other's image through their own address", async () => {
    const own = await other.get(
      "/api/p/northwind/images?path=99%20Appendices%2FImages%2Fvector.svg",
    );
    expect(own.statusCode).toBe(404);
    expect(
      (await admin.get("/api/p/avalymia/images?path=99%20Appendices%2FImages%2Fvector.svg"))
        .statusCode,
    ).toBe(200);
  });

  it("keeps each project's entries out of the other's search, graph, index and tree", async () => {
    const hits = async (c: Client, p: string, q: string) =>
      (
        (await c.get(`/api/p/${p}/search?q=${encodeURIComponent(q)}`)).json().results as {
          path: string;
        }[]
      ).map((r) => r.path);
    // Drafts are not searched; save the entry, so that it is in the index.
    await other.post("/api/p/northwind/publish/plan", {
      draftIds: ["northdraft01"],
      renameIds: [],
    });
    expect(await hits(admin, "avalymia", "quokka")).toEqual([]);
    expect(await hits(other, "northwind", "Mira")).toEqual([]);
    const graph = async (c: Client, p: string) =>
      (await c.get(`/api/p/${p}/graph`))
        .json()
        .nodes.map((n: { path: string }) => n.path) as string[];
    expect((await graph(other, "northwind")).some((p) => p.startsWith("02 People/"))).toBe(false);
    expect((await graph(admin, "avalymia")).some((p) => p.includes("Zebrafish"))).toBe(false);
    expect(t.services.index.allNotes().some((n) => n.path.includes("Zebrafish"))).toBe(false);
    const opened = await t.server.registry.peek(northwind.id);
    expect(opened!.index.allNotes().some((n) => n.path.startsWith("02 People/"))).toBe(false);
    expect(
      (await admin.get("/api/p/avalymia/entries?path=Zebrafish%20Secrets.md")).statusCode,
    ).toBe(404);
    // The unsaved entry is the second project's draft only.
    expect(t.services.drafts.list()).toEqual([]);
    expect(opened!.drafts.list().map((d) => d.id)).toEqual(["northdraft01"]);
  });

  it("backs each project up under its own prefix, with none of the other's files", async () => {
    await admin.put("/api/p/avalymia/drafts", {
      id: "avalydraft01",
      path: "02 People/Mira.md",
      kind: "edit",
      text: "# Mira\n\nHidden in Avalymia: the okapi.\n",
      revision: 0,
    });
    const opened = await t.server.registry.peek(northwind.id);
    await opened!.backup.runNow();
    await t.services.backup.runNow();
    const bucket = (t.services.config.backup as { dir: string }).dir;
    const keys = (dir: string, rel = ""): string[] =>
      readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? keys(dir, `${rel}${e.name}/`).concat([]) : [`${rel}${e.name}`],
      );
    const all = keys(bucket);
    const north = all.filter((k) => k.startsWith(`projects/${northwind.id}/`));
    const root = all.filter((k) => !k.startsWith("projects/"));
    expect(north.some((k) => k.endsWith("drafts/northdraft01/content"))).toBe(true);
    expect(north.some((k) => k.includes("avalydraft01"))).toBe(false);
    expect(root.some((k) => k.endsWith("drafts/avalydraft01/content"))).toBe(true);
    expect(root.some((k) => k.includes("northdraft01"))).toBe(false);
    const text = (k: string) => readFileSync(join(bucket, k), "utf8");
    expect(north.filter((k) => !k.includes("library")).some((k) => text(k).includes("okapi"))).toBe(
      false,
    );
    expect(root.filter((k) => !k.includes("library")).some((k) => text(k).includes("quokka"))).toBe(
      false,
    );
    // The first project's backup keeps the old keys; the server's own files are in it.
    expect(root).toContain("latest/state/people.json");
    expect(root).toContain("latest/state/projects.json");
    expect(north.some((k) => k.endsWith("/people.json"))).toBe(false);
  });

  it("keeps pins, conversations and the question of the day each person's own", async () => {
    await admin.put("/api/p/avalymia/drafts", {
      id: "x",
      path: "x.md",
      kind: "create",
      text: "# X\n",
      revision: 0,
    });
    expect(
      (await admin.post("/api/p/avalymia/pins", { path: "02 People/Mira.md" })).statusCode,
    ).toBe(200);
    await addMember(t, (await firstProject()).id, other.id, "owner");
    expect((await other.get("/api/p/avalymia/pins")).json().pins).toEqual([]);
    expect((await admin.get("/api/p/avalymia/pins")).json().pins).toHaveLength(1);
    // The same person's pins in another project are another list.
    expect((await admin.get("/api/p/northwind/pins")).json().pins).toEqual([]);
    const kept = JSON.parse(readFileSync(join(t.services.paths.state, "pins.json"), "utf8"));
    expect(Object.keys(kept.people)).toEqual([admin.id]);
  });
});

describe("the legacy alias for the previous web build", () => {
  it("serves the old addresses from the person's last-used project, or their first", async () => {
    await make("northwind", "Northwind");
    // Without a last-used project, the first.
    expect((await admin.get("/api/search?q=Mira")).json().results.length).toBeGreaterThan(0);
    expect((await admin.get("/api/status")).json().library).toBe("own");
    expect((await admin.put("/api/projects/last", { slug: "northwind" })).statusCode).toBe(200);
    expect((await admin.get("/api/search?q=Mira")).json().results).toEqual([]);
    expect((await admin.get("/api/search?q=welcome")).json().results.length).toBe(1);
    expect((await t.get("/api/session")).json().lastProject).toBe("northwind");
    expect((await t.get("/api/me")).json().lastProject).toBe("northwind");
    // Writes land in that project, and the alias checks the role as the prefixed address does.
    const saved = await admin.put("/api/drafts", {
      id: "legacydraft1",
      path: "Legacy.md",
      kind: "create",
      text: "# Legacy\n",
      revision: 0,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await admin.get("/api/p/northwind/unpublished")).json().drafts).toHaveLength(1);
    expect((await admin.get("/api/p/avalymia/unpublished")).json().drafts).toHaveLength(0);
    // The project's own settings have no old address.
    expect((await admin.del("/api/project", { name: "Northwind" })).statusCode).toBe(404);
  });

  it("refuses a person in no project, and forgets a last-used project they left", async () => {
    const nobody = await addPerson(t, "Nobody", "nobody@example.com");
    const res = await nobody.get("/api/entries?path=02%20People%2FMira.md");
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("no_project");
    expect((await nobody.put("/api/projects/last", { slug: "avalymia" })).statusCode).toBe(403);
    expect((await nobody.get("/api/projects")).json()).toMatchObject({
      projects: [],
      last: null,
      canCreate: false,
    });
    const north = await make("northwind");
    await admin.put("/api/projects/last", { slug: "northwind" });
    await t.server.projects.update(north.id, (p) => ({ ...p, members: [] }));
    expect((await t.get("/api/session")).json().lastProject).toBeNull();
    expect((await admin.get("/api/search?q=Mira")).statusCode).toBe(200);
  });
});

describe("the list of projects", () => {
  it("gives each project's role, counts, members and last version", async () => {
    await make("northwind", "Northwind");
    const list = ProjectsResponseCheck((await admin.get("/api/projects")).json());
    expect(list.canCreate).toBe(true);
    const avalymia = list.projects.find((p) => p.slug === "avalymia")!;
    expect(avalymia).toMatchObject({ role: "owner", kind: "own", name: "Avalymia" });
    expect(avalymia.entries).toBeGreaterThan(5);
    expect(avalymia.members).toEqual([{ id: admin.id, name: "The Author" }]);
    const north = list.projects.find((p) => p.slug === "northwind")!;
    expect(north.entries).toBe(1);
    expect(north.maps).toBe(0);
    expect(north.lastVersion?.by).toBe("Frontier");
    expect(Date.parse(north.lastVersion!.at)).not.toBeNaN();
  });
});

function ProjectsResponseCheck(body: unknown) {
  return body as {
    canCreate: boolean;
    projects: {
      slug: string;
      role: string;
      kind: string;
      name: string;
      entries: number;
      maps: number;
      members: { id: string; name: string }[];
      lastVersion: { at: string; by: string } | null;
    }[];
  };
}

describe("the project list", () => {
  it("marks the legacy project and never opens a project to count it", async () => {
    const made = await make("northwind", "Northwind");
    // Opened once, so it saves its numbers; closed again, it is not open.
    expect((await admin.get("/api/p/northwind/tree")).statusCode).toBe(200);
    await vi.waitFor(() =>
      expect(
        existsSync(join(t.services.config.dataDir, "projects", made.id, "state", "summary.json")),
      ).toBe(true),
    );
    await t.server.registry.close(made.id);
    expect(t.server.registry.loaded(made.id)).toBeNull();
    const opened: string[] = [];
    const open = t.server.registry.open.bind(t.server.registry);
    t.server.registry.open = (record) => {
      opened.push(record.slug);
      return open(record);
    };

    const list = (await admin.get("/api/projects")).json();
    const north = list.projects.find((p: { slug: string }) => p.slug === "northwind");
    expect(opened).toEqual([]);
    expect(north).toMatchObject({ legacy: false, entries: 1, maps: 0 });
    expect(list.projects.find((p: { slug: string }) => p.slug === "avalymia").legacy).toBe(true);

    // With no saved numbers a project is unknown, not zero, and still not opened.
    rmSync(join(t.services.config.dataDir, "projects", made.id, "state", "summary.json"));
    const again = (await admin.get("/api/projects")).json();
    expect(opened).toEqual([]);
    expect(again.projects.find((p: { slug: string }) => p.slug === "northwind")).toMatchObject({
      entries: null,
      maps: null,
      lastVersion: null,
    });
  });
});
