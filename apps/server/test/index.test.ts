import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AttentionResponse,
  EntryResponse,
  Health,
  StatusSnapshot,
  TreeResponse,
  type TreeFolder,
} from "@frontier/schema";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { linkKindOf, VaultIndex } from "../src/index/build.js";
import { makeTestApp, type TestApp, testEnv } from "./helpers/app.js";
import { makeTestRepo } from "./helpers/repo.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
  await t.login();
});
afterAll(() => t.close());

describe("the published index", () => {
  it("knows every note, its title, aliases and line endings", () => {
    const harbor = t.services.index.note("01 Places/Harbor/Harbor.md")!;
    expect(harbor.title).toBe("Harbor");
    expect(harbor.aliases).toEqual(["The Port", "Greywater"]);
    expect(t.services.index.note("03 Things/Rope.md")!.lineEnding).toBe("crlf");
    expect(t.services.index.note("03 Things/Rope.md")!.text).not.toContain("\r");
    expect(t.services.index.note("03 Things/Knot.md")!.lineEnding).toBe("mixed");
    expect(t.services.index.note(".obsidian/Hidden.md")).toBeUndefined();
    expect(t.services.index.note("README.md")!.title).toBe("README");
    expect(t.services.index.note("03 Things/Scalar.md")!.aliases).toEqual([]);
    expect(t.services.index.hasFile("notes.json")).toBe(true);
    expect(t.services.index.commit).toBe(t.repo.remoteHead());
  });

  it("uses the file name as the title, whatever headings the note has", async () => {
    t.repo.pushFromOutside({
      "03 Things/Sections.md": "# First Section\n\ntext\n\n# Second Section\n",
    });
    await t.services.sync();
    expect(t.services.index.note("03 Things/Sections.md")!.title).toBe("Sections");
  });

  it("lists backlinks with the line of each link", () => {
    const back = t.services.index.backlinks("02 People/Mira.md");
    expect(back).toContainEqual({ path: "01 Places/Harbor/Harbor.md", title: "Harbor", line: 8 });
    expect(back).toContainEqual({ path: "02 People/Shade.md", title: "Shade", line: 3 });
    expect(t.services.index.backlinks("03 Things/Plain.md")).toEqual([]);
    // A same-note heading link is not a backlink.
    expect(
      t.services.index.backlinks("01 Places/Harbor/Old Quay.md").map((b) => b.path),
    ).not.toContain("01 Places/Harbor/Old Quay.md");
  });

  it("marks append-only, excluded and mixed-ending files read-only", () => {
    expect(t.services.index.readOnly("02 People/Mira.md")).toBe(false);
    expect(t.services.index.readOnly("99 Appendices/Logs/Session.md")).toBe(true);
    expect(t.services.index.readOnly("03 Things/Knot.md")).toBe(true);
    expect(t.services.index.readOnly(".obsidian/app.json")).toBe(true);
  });

  it("names link kinds for the browser", () => {
    expect(linkKindOf({ kind: "note", path: "a.md", heading: null })).toBe("resolved");
    expect(linkKindOf({ kind: "file", path: "a.png" })).toBe("image");
    expect(linkKindOf({ kind: "file", path: "a.json" })).toBe("resolved");
    expect(linkKindOf({ kind: "unresolved" })).toBe("unresolved");
    expect(linkKindOf({ kind: "ambiguous", candidates: [] })).toBe("ambiguous");
    expect(linkKindOf({ kind: "outside", path: null })).toBe("outside");
  });

  it("shows every published entry from a fresh clone with empty server state (G1)", async () => {
    const repo = makeTestRepo();
    try {
      const config = loadConfig(testEnv(repo));
      expect(existsSync(join(config.dataDir, "state"))).toBe(false);
      const fresh = await buildApp(config);
      await fresh.services.git.ensureClone();
      await fresh.services.sync();
      const paths = (i: VaultIndex) =>
        i
          .allNotes()
          .map((n) => n.path)
          .sort();
      const expected = repo
        .remoteFiles()
        .filter((p) => p.endsWith(".md") && !p.startsWith("."))
        .sort();
      expect(paths(fresh.services.index)).toEqual(expected);
      // Throwing the index away and building it again gives the same result.
      const again = new VaultIndex(join(config.dataDir, "vault"));
      again.build(fresh.services.index.commit!);
      expect(again.allNotes()).toEqual(fresh.services.index.allNotes());
      await fresh.app.close();
    } finally {
      repo.cleanup();
    }
  });

  it("indexes a 500-note vault in under 5 seconds", () => {
    const vaultPackage = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/vault");
    execFileSync("npx", ["tsx", "scripts/make-big-fixture.ts", "index"], {
      cwd: vaultPackage,
      stdio: "ignore",
    });
    // A folder of this test's own: the other timing test makes one at the same time.
    const big = join(vaultPackage, "test", ".big-fixture", "index");
    try {
      const index = new VaultIndex(big);
      const started = performance.now();
      index.build("timing");
      const ms = performance.now() - started;
      expect(index.allNotes().length).toBeGreaterThanOrEqual(500);
      expect(ms).toBeLessThan(5000);
    } finally {
      rmSync(big, { recursive: true, force: true });
    }
  });
});

describe("routes", () => {
  it("returns the folder tree in the agreed shape", async () => {
    const res = await t.get("/api/tree");
    const tree = TreeResponse.parse(res.json());
    expect(tree.notes.map((n) => n.path)).toEqual(
      expect.arrayContaining(["AGENTS.md", "README.md"]),
    );
    const find = (folders: TreeFolder[], path: string): TreeFolder | undefined => {
      for (const f of folders) {
        if (f.path === path) return f;
        const inner = find(f.folders, path);
        if (inner) return inner;
      }
      return undefined;
    };
    const harbor = find(tree.folders, "01 Places/Harbor")!;
    expect(harbor.notes.map((n) => n.title).sort()).toEqual(["Harbor", "Old Quay"]);
    expect(harbor.notes.every((n) => n.state === "published")).toBe(true);
    expect(find(tree.folders, ".obsidian")).toBeUndefined();
    expect(find(tree.folders, "99 Appendices/Images")).toBeUndefined();
  });

  it("returns an entry with its links, backlinks and headings", async () => {
    const res = await t.get("/api/entries?path=" + encodeURIComponent("02 People/Mira.md"));
    const entry = EntryResponse.parse(res.json());
    expect(entry.readOnly).toBe(false);
    expect(entry.lineEnding).toBe("lf");
    expect(entry.draft).toBeNull();
    expect(entry.headings).toEqual([{ level: 1, text: "Mira", line: 1 }]);
    const byRaw = Object.fromEntries(entry.links.map((l) => [l.raw, l]));
    expect(byRaw["[[01 Places/Harbor/Harbor]]"]).toMatchObject({
      kind: "resolved",
      target: "01 Places/Harbor/Harbor.md",
    });
    expect(byRaw["[[.obsidian/app.json]]"]!.kind).toBe("outside");
    expect(byRaw["[[01 Places/Nowhere/Gone]]"]!.kind).toBe("unresolved");
    const first = entry.links[0]!;
    expect(entry.text.slice(first.from, first.to)).toBe(first.raw);
    expect(entry.backlinks.map((b) => b.path)).toContain("02 People/Shade.md");
  });

  it("reports images, ambiguous links and read-only files", async () => {
    const gallery = EntryResponse.parse(
      (await t.get("/api/entries?path=03%20Things%2FGallery.md")).json(),
    );
    const kinds = Object.fromEntries(gallery.links.map((l) => [l.raw, l]));
    expect(kinds["![[photo.png]]"]).toMatchObject({
      kind: "image",
      target: "99 Appendices/Images/photo.png",
    });
    expect(kinds["![[lamp.png]]"]).toMatchObject({
      kind: "ambiguous",
      candidates: ["99 Appendices/Icons/Lamp.png", "99 Appendices/Images/lamp.png"],
    });
    const knot = EntryResponse.parse(
      (await t.get("/api/entries?path=03%20Things%2FKnot.md")).json(),
    );
    expect(knot).toMatchObject({ readOnly: true, lineEnding: "mixed" });
    const log = EntryResponse.parse(
      (await t.get("/api/entries?path=99%20Appendices%2FLogs%2FSession.md")).json(),
    );
    expect(log.readOnly).toBe(true);
  });

  it("answers not_found for a missing note and invalid for a bad path", async () => {
    const missing = await t.get("/api/entries?path=02%20People%2FNobody.md");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
    expect((await t.get("/api/entries?path=..%2Foutside.md")).statusCode).toBe(400);
    expect((await t.get("/api/entries")).statusCode).toBe(400);
  });

  it("lists what needs the author's attention", async () => {
    const a = AttentionResponse.parse((await t.get("/api/attention")).json());
    expect(a.mixedEndings).toEqual(["03 Things/Knot.md"]);
    expect(a.duplicateImages).toEqual([
      ["99 Appendices/Icons/Lamp.png", "99 Appendices/Images/lamp.png"],
    ]);
    expect(a.nearFolderNotes).toEqual(["01 Places/Marsh/The Marsh.md"]);
    expect(a.ambiguousLinks.map((l) => `${l.path} ${l.raw}`)).toEqual([
      "03 Things/Gallery.md ![[lamp.png]]",
      "03 Things/Lantern.md [[Twin]]",
      "03 Things/Twin.md [[Twin]]",
    ]);
    expect(a.brokenAppendixLinks).toEqual([]);
  });

  it("lists unresolved links in append-only files", async () => {
    t.repo.pushFromOutside({
      "99 Appendices/Logs/Later.md": "# Later\n\nSee [[A Note Since Renamed]].\n",
    });
    await t.services.sync();
    const a = AttentionResponse.parse((await t.get("/api/attention")).json());
    expect(a.brokenAppendixLinks).toEqual([
      { path: "99 Appendices/Logs/Later.md", raw: "[[A Note Since Renamed]]" },
    ]);
  });
});

describe("status", () => {
  it("reports the fetch, the index commit and the attention counts", async () => {
    const s = StatusSnapshot.parse((await t.get("/api/status")).json());
    expect(s.indexCommit).toBe(t.repo.remoteHead());
    expect(s.indexStale).toBe(false);
    expect(s.lastFetchAt).not.toBeNull();
    expect(s.attention.mixedEndings).toBe(1);
    expect(s.attention.duplicateImages).toBe(1);
    const health = await t.get("/health");
    expect(Health.parse(health.json()).ok).toBe(true);
    expect(health.body).not.toContain("Harbor");
  });

  it("marks the index stale when main has moved past it, and tells listeners", async () => {
    const seen: boolean[] = [];
    const stop = t.services.status.subscribe((s) => seen.push(s.indexStale));
    t.services.status.fetched("a-newer-commit");
    expect(t.services.status.snapshot().indexStale).toBe(true);
    await t.services.sync();
    expect(t.services.status.snapshot().indexStale).toBe(false);
    stop();
    t.services.status.pushed();
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });

  it("records pushes, failures, backups and draft counts", () => {
    const s = t.services.status;
    s.pushFailed("network down");
    expect(s.snapshot().failedPush).toBe("network down");
    s.pushed(new Date("2026-11-20T10:00:00Z"));
    expect(s.snapshot()).toMatchObject({
      failedPush: null,
      lastPushAt: "2026-11-20T10:00:00.000Z",
    });
    s.backedUp("2026-11-20T11:00:00.000Z", null);
    s.backedUp(null, "bucket unreachable");
    expect(s.snapshot()).toMatchObject({
      lastBackupAt: "2026-11-20T11:00:00.000Z",
      backupError: "bucket unreachable",
    });
    s.drafts(3, 1);
    expect(s.snapshot()).toMatchObject({ unpublished: 3, conflicts: 1 });
  });

  it("reports unhealthy before the first index build", async () => {
    const repo = makeTestRepo();
    try {
      const cold = await buildApp(loadConfig(testEnv(repo)));
      const res = await cold.app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(503);
      expect(res.json().ok).toBe(false);
      await cold.app.close();
    } finally {
      repo.cleanup();
    }
  });

  it("streams a status event at once and after each change, and a heartbeat in between", async () => {
    // The stream's heartbeat timer runs on a clock the test moves.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
      const res = await fetch(`${address}/api/status/events`, { headers: { cookie: t.cookie } });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const reader = res.body!.getReader();
      const read = async () => new TextDecoder().decode((await reader.read()).value);
      const first = await read();
      expect(first.startsWith("event: status\ndata: {")).toBe(true);
      t.services.status.drafts(7, 0);
      expect(await read()).toContain('"unpublished":7');
      vi.advanceTimersByTime(20_000);
      expect(await read()).toBe(": heartbeat\n\n");
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
