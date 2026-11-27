import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { Backup, msUntilHour, restore } from "../src/backup/backup.js";
import { type BackupTarget, FolderTarget } from "../src/backup/targets.js";
import { loadConfig } from "../src/config.js";
import { EMAIL, seedAccount, testEnv } from "./helpers/app.js";
import { makeTestRepo } from "./helpers/repo.js";

let root: string;
let state: string;
let generated: string;
let bucket: string;
let target: FolderTarget;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "frontier-backup-"));
  state = join(root, "data", "state");
  generated = join(root, "data", "assets", "generated");
  bucket = join(root, "bucket");
  mkdirSync(state, { recursive: true });
  target = new FolderTarget(bucket);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const inBucket = (key: string) =>
  existsSync(join(bucket, key)) ? readFileSync(join(bucket, key), "utf8") : null;

function make(extra: Partial<ConstructorParameters<typeof Backup>[0]> = {}) {
  const results: { lastSuccessAt: string | null; lastError: string | null }[] = [];
  const backup = new Backup({
    sources: { state, generated },
    target,
    stateFile: join(state, "backup.json"),
    onResult: (s) => results.push(s),
    ...extra,
  });
  return { backup, results };
}

describe("the folder target", () => {
  it("stores, lists by prefix, reads and removes", async () => {
    await target.put("latest/a/one.txt", Buffer.from("1"));
    await target.put("latest/two.txt", Buffer.from("2"));
    await target.put("nightly/2026-01-01/x", Buffer.from("x"));
    expect(await target.list("latest/")).toEqual(["latest/a/one.txt", "latest/two.txt"]);
    expect(await target.list("nothing/")).toEqual([]);
    expect((await target.get("latest/two.txt"))?.toString()).toBe("2");
    expect(await target.get("latest/missing")).toBeNull();
    await target.remove("latest/two.txt");
    await target.remove("latest/two.txt");
    expect(await target.list("latest/")).toEqual(["latest/a/one.txt"]);
    expect(await new FolderTarget(join(root, "never-made")).list("")).toEqual([]);
  });
});

describe("the latest copy", () => {
  it("mirrors the working files, uploads only what changed, and removes what is gone", async () => {
    put(state, "drafts/abc/content", "first");
    put(state, "settings.json", "{}");
    put(generated, "art.png", "image");
    put(state, "drafts/abc/content.123.tmp", "half-written");
    const uploads: string[] = [];
    const counting: BackupTarget = {
      put: (k, d) => (uploads.push(k), target.put(k, d)),
      get: (k) => target.get(k),
      list: (p) => target.list(p),
      remove: (k) => target.remove(k),
    };
    const { backup, results } = make({ target: counting });

    const first = await backup.runNow();
    expect(first.lastError).toBeNull();
    expect(first.lastSuccessAt).not.toBeNull();
    expect(inBucket("latest/state/drafts/abc/content")).toBe("first");
    expect(inBucket("latest/generated/art.png")).toBe("image");
    expect(inBucket("latest/state/drafts/abc/content.123.tmp")).toBeNull();
    // The record of the backup itself is not backed up.
    expect(inBucket("latest/state/backup.json")).toBeNull();
    expect(results).toHaveLength(1);

    uploads.length = 0;
    put(state, "drafts/abc/content", "second");
    rmSync(join(state, "settings.json"));
    await backup.runNow();
    expect(uploads.filter((k) => !k.endsWith(".manifest.json"))).toEqual([
      "latest/state/drafts/abc/content",
    ]);
    expect(inBucket("latest/state/drafts/abc/content")).toBe("second");
    expect(inBucket("latest/state/settings.json")).toBeNull();
    expect(inBucket("latest/generated/art.png")).toBe("image");
  });

  it("runs once, the set delay after the first change", async () => {
    put(state, "a.txt", "a");
    const { backup, results } = make({ delayMs: 40 });
    backup.noteChange();
    backup.noteChange();
    backup.noteChange();
    expect(results).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 120));
    expect(results).toHaveLength(1);
    expect(inBucket("latest/state/a.txt")).toBe("a");
    backup.noteChange();
    backup.stop();
    await new Promise((r) => setTimeout(r, 80));
    expect(results).toHaveLength(1);
  });

  it("records a failure, keeps the time of the last success, and recovers", async () => {
    put(state, "a.txt", "a");
    const { backup } = make();
    const ok = await backup.runNow();
    let broken = true;
    const failing: BackupTarget = {
      put: (k, d) => (broken ? Promise.reject(new Error("bucket unreachable")) : target.put(k, d)),
      get: (k) => target.get(k),
      list: (p) => target.list(p),
      remove: (k) => target.remove(k),
    };
    const second = make({ target: failing });
    put(state, "a.txt", "changed");
    const failed = await second.backup.runNow();
    expect(failed).toEqual({ lastSuccessAt: ok.lastSuccessAt, lastError: "bucket unreachable" });
    expect(await second.backup.lastState()).toEqual(failed);
    broken = false;
    expect((await second.backup.runNow()).lastError).toBeNull();
    expect(inBucket("latest/state/a.txt")).toBe("changed");
  });

  it("reports no backup yet, and survives a damaged record", async () => {
    const { backup } = make();
    expect(await backup.lastState()).toEqual({ lastSuccessAt: null, lastError: null });
    put(state, "backup.json", "not json");
    expect(await backup.lastState()).toEqual({ lastSuccessAt: null, lastError: null });
  });

  it("never runs two copies at once", async () => {
    put(state, "a.txt", "a");
    let running = 0;
    let most = 0;
    const slow: BackupTarget = {
      put: async (k, d) => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 15));
        await target.put(k, d);
        running--;
      },
      get: (k) => target.get(k),
      list: (p) => target.list(p),
      remove: (k) => target.remove(k),
    };
    const { backup } = make({ target: slow });
    await Promise.all([backup.runNow(), backup.runNightly(), backup.runNow()]);
    expect(most).toBe(1);
  });
});

describe("the nightly copy", () => {
  it("keeps a full copy per night and removes nights beyond the limit", async () => {
    put(state, "a.txt", "a");
    let today = new Date("2026-11-20T03:00:00Z");
    const { backup } = make({ keepNights: 2, now: () => today });
    await backup.runNightly();
    today = new Date("2026-11-21T03:00:00Z");
    put(state, "a.txt", "b");
    await backup.runNightly();
    today = new Date("2026-11-22T03:00:00Z");
    await backup.runNightly();
    expect(inBucket("nightly/2026-11-20/state/a.txt")).toBeNull();
    expect(inBucket("nightly/2026-11-21/state/a.txt")).toBe("b");
    expect(inBucket("nightly/2026-11-22/state/a.txt")).toBe("b");
    expect(inBucket("nightly/2026-11-22/.complete")).toBe("2026-11-22T03:00:00.000Z");
  });

  it("records a failure", async () => {
    const failing: BackupTarget = {
      put: () => Promise.reject(new Error("")),
      get: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
    };
    put(state, "a.txt", "a");
    const { backup } = make({ target: failing });
    expect((await backup.runNightly()).lastError).toBe("The nightly backup failed.");
    expect((await backup.runNow()).lastError).toBe("The backup failed.");
  });

  it("works out the wait until three in the morning", () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m, 0, 0);
    expect(msUntilHour(3, at(2, 0))).toBe(60 * 60 * 1000);
    expect(msUntilHour(3, at(3, 0))).toBe(24 * 60 * 60 * 1000);
    expect(msUntilHour(3, at(23, 30))).toBe(3.5 * 60 * 60 * 1000);
  });

  it("schedules itself and can be stopped", () => {
    const { backup } = make();
    backup.startNightly();
    backup.stop();
  });
});

describe("restore", () => {
  it("fills empty folders from the latest copy, or from a named night", async () => {
    put(state, "drafts/abc/content", "my draft");
    put(generated, "art.png", "image");
    const { backup } = make({ now: () => new Date("2026-11-20T03:00:00Z") });
    await backup.runNow();
    await backup.runNightly();
    put(state, "drafts/abc/content", "later text");
    await backup.runNow();

    const fresh = { state: join(root, "new", "state"), generated: join(root, "new", "generated") };
    expect(await restore(target, fresh)).toEqual({ files: 2, from: "latest/" });
    expect(readFileSync(join(fresh.state, "drafts/abc/content"), "utf8")).toBe("later text");
    expect(readFileSync(join(fresh.generated, "art.png"), "utf8")).toBe("image");

    const night = { state: join(root, "night", "state") };
    expect(await restore(target, night, "2026-11-20")).toEqual({
      files: 1,
      from: "nightly/2026-11-20/",
    });
    expect(readFileSync(join(night.state, "drafts/abc/content"), "utf8")).toBe("my draft");
  });

  it("refuses to write into a folder that holds files, and reports a missing backup", async () => {
    put(state, "a.txt", "a");
    await make().backup.runNow();
    await expect(restore(target, { state })).rejects.toThrow(/not empty/);
    await expect(restore(target, { state: join(root, "x") }, "1999-01-01")).rejects.toThrow(
      /no backup/,
    );
  });
});

describe("in the server", () => {
  it("backs up a draft shortly after it is saved, shows it in the status, and restores it into a new server", async () => {
    const repo = makeTestRepo();
    const env = testEnv(repo);
    const config = loadConfig(env);
    mkdirSync(join(config.dataDir, "state"), { recursive: true });
    const first = await buildApp(config, { backupDelayMs: 30 });
    await first.services.git.ensureClone();
    await first.services.sync();
    await seedAccount(first.services, "a password for the test");
    const login = await first.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: EMAIL, password: "a password for the test" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    await first.app.inject({
      method: "PUT",
      url: "/api/drafts",
      headers: { cookie },
      payload: {
        id: "backupdraft1",
        path: "02 People/Mira.md",
        kind: "edit",
        text: "# Mira\n\nBacked up.\n",
        revision: 0,
      },
    });
    await new Promise((r) => setTimeout(r, 400));
    const snapshot = first.services.status.snapshot();
    expect(snapshot.lastBackupAt).not.toBeNull();
    expect(snapshot.backupError).toBeNull();
    const bucketFile = join(
      (config.backup as { dir: string }).dir,
      "latest/state/drafts/backupdraft1/content",
    );
    expect(readFileSync(bucketFile, "utf8")).toBe("# Mira\n\nBacked up.\n");
    await first.app.close();

    // The disk is lost. A new server on an empty data folder gets the draft back from the backup.
    rmSync(config.dataDir, { recursive: true, force: true });
    const { backupSources } = await import("../src/app.js");
    const bucketDir = (config.backup as { dir: string }).dir;
    const restored = await restore(new FolderTarget(bucketDir), backupSources(config.dataDir));
    expect(restored.files).toBeGreaterThan(0);
    const second = await buildApp(config);
    await second.services.git.ensureClone();
    await second.services.sync();
    expect(second.services.drafts.list().map((d) => d.id)).toEqual(["backupdraft1"]);
    // The accounts are in the backup too: the same person can log in on the new disk.
    expect((await second.services.server.people.all()).map((p) => p.email)).toEqual([EMAIL]);
    expect(await second.services.drafts.text("backupdraft1")).toBe("# Mira\n\nBacked up.\n");
    // The time of the last backup is read from disk at start when it exists.
    await second.services.backup.runNow();
    const third = await buildApp(config);
    expect(third.services.status.snapshot().lastBackupAt).not.toBeNull();
    await second.app.close();
    await third.app.close();
    repo.cleanup();
  });
});

describe("backup and restore of projects", () => {
  it("restores only the files asked for, and does not mind the ones that are left out", async () => {
    put(state, "people.json", "{}");
    put(state, "drafts/abc/content", "mine");
    await make().backup.runNow();
    const fresh = join(root, "fresh", "state");
    put(fresh, "people.json", "{ already here }");
    const done = await restore(
      target,
      { state: fresh },
      "latest",
      (_name, rel) => !rel.startsWith("people.json"),
    );
    expect(done.files).toBe(1);
    expect(readFileSync(join(fresh, "people.json"), "utf8")).toBe("{ already here }");
    expect(readFileSync(join(fresh, "drafts/abc/content"), "utf8")).toBe("mine");
    // A file that would be written over one that is there is refused, and nothing is written.
    await expect(restore(target, { state: fresh }, "latest", () => true)).rejects.toThrow(
      /already there/,
    );
    await expect(restore(target, { state: fresh })).rejects.toThrow(/not empty/);
  });

  it("keeps a prefixed target to its own prefix", async () => {
    const { PrefixedTarget } = await import("../src/app.js");
    const a = new PrefixedTarget(target, "projects/aaaaaaaaaa/");
    await a.put("latest/x", Buffer.from("x"));
    await target.put("latest/y", Buffer.from("y"));
    expect(await a.list("latest/")).toEqual(["latest/x"]);
    expect((await a.get("latest/x"))?.toString()).toBe("x");
    expect(await a.get("latest/y")).toBeNull();
    await a.remove("latest/x");
    expect(await a.list("")).toEqual([]);
    expect(await target.list("latest/")).toEqual(["latest/y"]);
  });

  it("brings back every project on a new disk, or one project alone", async () => {
    const repo = makeTestRepo();
    const config = loadConfig(testEnv(repo));
    mkdirSync(join(config.dataDir, "state"), { recursive: true });
    const first = await buildApp(config, { backupDelayMs: 20 });
    await first.services.git.ensureClone();
    await first.services.sync();
    const admin = await seedAccount(first.services, "a password for the test");
    const login = await first.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: EMAIL, password: "a password for the test" },
    });
    const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0]! };
    const made = await first.app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: { name: "Northwind", slug: "northwind" },
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;
    for (const slug of ["avalymia", "northwind"]) {
      const saved = await first.app.inject({
        method: "PUT",
        url: `/api/p/${slug}/drafts`,
        headers,
        payload: {
          id: slug === "avalymia" ? "avalymiadr01" : "northwinddr1",
          path: "Note.md",
          kind: "create",
          text: `# Note\n\nIn ${slug}.\n`,
          revision: 0,
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
    }
    await (await first.server.registry.peek(id))!.backup.runNow();
    await first.services.backup.runNow();
    await first.app.close();
    expect(admin.id).toBeTruthy();

    const bucket = new FolderTarget((config.backup as { dir: string }).dir);
    const { restoreEverything, restoreProject } = await import("../src/backup/restoreProjects.js");
    const setup = { dataDir: config.dataDir, own: true, target: bucket, from: "latest" };

    // One project alone: lose its folder (its library too), bring it back, and the first project is untouched.
    rmSync(join(config.dataDir, "projects", id), { recursive: true, force: true });
    const one = await restoreProject(setup, "northwind");
    expect(one.name).toBe("Northwind");
    expect(
      existsSync(join(config.dataDir, "projects", id, "state", "drafts", "northwinddr1")),
    ).toBe(true);
    await expect(restoreProject(setup, "nothing")).rejects.toThrow(/no project "nothing"/);
    // The first project's own files are restored without the server's: the folder holds them.
    await expect(restoreProject(setup, "avalymia")).rejects.toThrow(/already there/);
    rmSync(join(config.dataDir, "state", "drafts"), { recursive: true, force: true });
    expect((await restoreProject(setup, "avalymia")).files).toBeGreaterThan(0);

    // The disk is lost: everything comes back, the project list with it.
    rmSync(config.dataDir, { recursive: true, force: true });
    expect(await restoreEverything(setup)).toBeGreaterThan(5);
    const second = await buildApp(config);
    await second.services.git.ensureClone();
    await second.services.sync();
    const projects = await second.server.projects.all();
    expect(projects.map((p) => p.slug)).toEqual(["avalymia", "northwind"]);
    expect(second.services.drafts.list().map((d) => d.id)).toEqual(["avalymiadr01"]);
    const north = await second.server.registry.open(projects[1]!);
    expect(north.drafts.list().map((d) => d.id)).toEqual(["northwinddr1"]);
    expect(north.index.allNotes().map((n) => n.path)).toEqual(["Welcome.md"]);
    await second.app.close();
    repo.cleanup();
  });
});
