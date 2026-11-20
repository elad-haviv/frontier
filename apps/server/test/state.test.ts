import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Settings } from "@frontier/schema";
import { startPolling } from "../src/git/poll.js";
import { StateFiles } from "../src/state/files.js";
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
    expect(await files.readJson(path, Settings)).toEqual({ passwordHash: "h" });
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
    expect(await store.read()).toEqual({ passwordHash: "$argon2id$x" });
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
