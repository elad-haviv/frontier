import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { applySampleMode, ensureSampleRemote } from "../src/sample.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "frontier-sample-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sample mode", () => {
  it("makes a local remote from the bundled sample vault, once", () => {
    const remote = ensureSampleRemote(dir);
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
      cwd: remote,
      encoding: "utf8",
    });
    expect(files).toContain("01 Places/Harbor/Harbor.md");
    const head = () =>
      execFileSync("git", ["rev-parse", "main"], { cwd: remote, encoding: "utf8" });
    const first = head();
    expect(ensureSampleRemote(dir)).toBe(remote);
    expect(head()).toBe(first);
  });

  it("keeps the sample's Windows line endings", () => {
    const remote = ensureSampleRemote(dir);
    const rope = execFileSync("git", ["show", "main:03 Things/Rope.md"], { cwd: remote });
    expect(rope.includes(Buffer.from("\r\n"))).toBe(true);
  });

  it("fills in the settings so only a few variables are needed", () => {
    const env: NodeJS.ProcessEnv = {
      FRONTIER_SAMPLE_VAULT: "1",
      DATA_DIR: dir,
      PUBLIC_URL: "https://preview.example.com",
      SESSION_KEY: Buffer.alloc(32, 3).toString("base64"),
      COMMIT_AUTHOR_NAME: "Kept",
    };
    applySampleMode(env);
    const config = loadConfig(env);
    expect(config.remoteUrl).toBe(join(dir, "sample-remote.git"));
    expect(config.githubApp).toBeNull();
    expect(config.backup).toEqual({ kind: "local", dir: join(dir, "bucket") });
    expect(config.commitAuthor.name).toBe("Kept");
  });

  it("does nothing unless switched on", () => {
    const env: NodeJS.ProcessEnv = { DATA_DIR: dir };
    applySampleMode(env);
    expect(env["VAULT_REMOTE_URL"]).toBeUndefined();
  });
});

describe("the sample vault shows every piece of Home (stage 25)", () => {
  it("has a stub linked three times, wanted names, an orphan, a dead end and mentions", async () => {
    const { buildApp } = await import("../src/app.js");
    const dataDir = join(dir, "data");
    const env: NodeJS.ProcessEnv = {
      FRONTIER_SAMPLE_VAULT: "1",
      DATA_DIR: dataDir,
      PUBLIC_URL: "http://localhost:3000",
      SESSION_KEY: Buffer.alloc(32, 3).toString("base64"),
    };
    applySampleMode(env);
    const { app, services } = await buildApp(loadConfig(env));
    try {
      await services.git.ensureClone();
      await services.sync();
      const queue = await services.keepGoing.queue();
      const flats = queue.needsLove.rows.find((r) => r.path === "01 Places/Salt Flats.md")!;
      expect(flats.reasons.map((r) => r.rule)).toEqual([
        "stub",
        "emptyHeadings",
        "noType",
        "todoMarks",
      ]);
      expect(flats.linkedFrom).toBe(3);
      const road = queue.needsLove.rows.find((r) => r.path === "01 Places/Salt Road.md")!;
      expect(road.reasons.map((r) => r.rule)).toEqual(["noPicture"]);
      expect(queue.wanted.rows.find((w) => w.name === "The Sunken Gate")!.mentions).toBe(3);
      expect(queue.wanted.rows.find((w) => w.name === "Tide Singers")!.mentions).toBe(3);
      expect(queue.orphans.rows.map((r) => r.path)).toEqual(
        expect.arrayContaining(["01 Places/Salt Road.md", "02 People/Ruun.md"]),
      );
      expect(queue.deadEnds.rows.map((r) => r.path)).toEqual(
        expect.arrayContaining(["03 Things/Salt Crystal.md", "01 Places/Salt Flats.md"]),
      );
      const harbor = await services.keepGoing.fromHere("01 Places/Harbor/Harbor.md");
      expect(harbor.unlinked.map((m) => m.path)).toEqual(["01 Places/Salt Road.md"]);
      const mira = await services.keepGoing.fromHere("02 People/Mira.md");
      expect(mira.unlinked.map((m) => m.path)).toEqual(["03 Things/Brine Works.md"]);

      const { week, onThisDay } = await services.keepGoingHistory.weekAndOnThisDay(0);
      expect(week.entriesTouched).toBe(3);
      expect(week.wordsAdded).toBeGreaterThan(150);
      expect(week.linksFilled).toBe(2);
      expect(onThisDay.map((r) => [r.span, r.kind])).toEqual(
        expect.arrayContaining([
          ["month", "written"],
          ["sixMonths", "written"],
          ["year", "written"],
        ]),
      );
      // The entries of the fixture are a year old; the new ones are not.
      const old = await services.keepGoingHistory.untouched();
      expect(old.has("02 People/Mira.md")).toBe(true);
      expect(old.has("01 Places/Salt Road.md")).toBe(false);
    } finally {
      await app.close();
    }
  });
});
