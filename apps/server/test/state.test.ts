import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Settings } from "@frontier/schema";
import { startPolling } from "../src/git/poll.js";
import { StateFiles } from "../src/state/files.js";
import { DraftStore } from "../src/state/drafts.js";
import { SettingsStore } from "../src/state/settings.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "frontier-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("state files", () => {
  it("writes through a temporary file and leaves none behind", async () => {
    const files = new StateFiles();
    await files.write(join(dir, "a", "b", "file.txt"), "hello");
    expect(readFileSync(join(dir, "a", "b", "file.txt"), "utf8")).toBe("hello");
    expect(readdirSync(join(dir, "a", "b"))).toEqual(["file.txt"]);
  });

  it("keeps the previous file when a write fails", async () => {
    const files = new StateFiles();
    const path = join(dir, "file.txt");
    await files.write(path, "first");
    // A folder in the way makes the rename fail.
    const blocked = join(dir, "blocked");
    await files.write(join(blocked, "inner.txt"), "x");
    await expect(files.write(blocked, "second")).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe("first");
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("reads checked JSON, null for a missing file, and throws on a wrong shape", async () => {
    const files = new StateFiles();
    const path = join(dir, "settings.json");
    expect(await files.readJson(path, Settings)).toBeNull();
    await files.writeJson(path, { passwordHash: "h" });
    expect(await files.readJson(path, Settings)).toMatchObject({ passwordHash: "h" });
    await files.writeJson(path, { wrong: true });
    await expect(files.readJson(path, Settings)).rejects.toThrow();
  });

  it("tells listeners about every write and removal", async () => {
    const files = new StateFiles();
    let changes = 0;
    files.onChange(() => changes++);
    await files.write(join(dir, "x"), "1");
    await files.writeJson(join(dir, "y.json"), {});
    await files.remove(join(dir, "x"));
    await files.remove(join(dir, "never-existed"));
    expect(changes).toBe(4);
  });

  it("stores settings", async () => {
    const store = new SettingsStore(dir, new StateFiles());
    expect(await store.read()).toBeNull();
    await store.write({ passwordHash: "$argon2id$x" });
    // A file from before the AI settings existed reads with their defaults.
    expect(await store.read()).toEqual({
      passwordHash: "$argon2id$x",
      ai: {
        models: { extraction: null, conversation: null, art: null },
        modelPrices: {},
        artStyle: expect.stringContaining("Pencil and ink"),
        proposeOnPublish: false,
        keysRemoved: null,
      },
      passkeys: [],
      passwordOff: false,
    });
  });

  it("changes one part of the settings and keeps the rest, the password included", async () => {
    const store = new SettingsStore(dir, new StateFiles());
    await expect(store.update((s) => s)).rejects.toThrow();
    await store.write({ passwordHash: "$argon2id$x" });
    await store.update((s) => ({ ...s, ai: { ...s.ai, artStyle: "Charcoal." } }));
    // Setting the password again, as the command does, keeps what was set since.
    await store.write({ ...(await store.read()), passwordHash: "$argon2id$y" });
    expect(await store.read()).toMatchObject({
      passwordHash: "$argon2id$y",
      ai: { artStyle: "Charcoal." },
    });
  });
});

describe("timer fetch", () => {
  it("runs on the interval, skips a run while one is in flight, and reports errors", async () => {
    let calls = 0;
    const errors: unknown[] = [];
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const stop = startPolling(
      async () => {
        calls++;
        if (calls === 1) await slow;
        if (calls === 2) throw new Error("fetch failed");
      },
      (e) => errors.push(e),
      5,
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 40));
    stop();
    const settled = calls;
    expect(settled).toBeGreaterThan(2);
    expect(errors).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(settled);
  });
});

describe("the drafts count", () => {
  it("rises on every draft save, server change, move and discard", async () => {
    const drafts = new DraftStore(dir, new StateFiles());
    const published = { blob: "", text: null, lineEnding: "lf" as const };
    expect(drafts.changes).toBe(0);
    const save = (text: string, revision: number) =>
      drafts.save({ id: "countdraft01", path: "a.md", kind: "create", text, revision }, published);
    await save("One", 0);
    expect(drafts.changes).toBe(1);
    // A second save of the same draft leaves the number of drafts as it was; the count rises.
    await save("Two", 1);
    expect(drafts.changes).toBe(2);
    await drafts.serverChange("countdraft01", "Three");
    expect(drafts.changes).toBe(3);
    await drafts.movePath("countdraft01", "b.md");
    expect(drafts.changes).toBe(4);
    await drafts.discard("countdraft01");
    expect(drafts.changes).toBe(5);
  });

  it("is in the status snapshot", async () => {
    const { makeTestApp } = await import("./helpers/app.js");
    const t = await makeTestApp();
    try {
      await t.login();
      const before = (await t.get("/api/status")).json().drafts as number;
      const res = await t.put("/api/drafts", {
        id: "countdraft02",
        path: "02 People/Mira.md",
        kind: "edit",
        text: "Changed.\n",
        revision: 0,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await t.get("/api/status")).json().drafts).toBe(before + 1);
    } finally {
      await t.close();
    }
  });
});
