/**
 * Stage 27d: each person's unsaved changes are their own. Isolation by id, path, rename and kept
 * copy; counts on the status snapshot and the stream; what other people may know of someone's work
 * in progress (never the text); readers see none of it; the move from one author; people who leave
 * or are demoted.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StatusSnapshot, TreeResponse, UnpublishedResponse } from "@frontier/schema";
import { StateFiles } from "../src/state/files.js";
import { DraftStore } from "../src/state/drafts.js";
import {
  addMember,
  addPerson,
  type Client,
  makeTestApp,
  type TestApp,
  type Who,
} from "./helpers/app.js";

const MIRA = "02 People/Mira.md";
const SHADE = "02 People/Shade.md";

let t: TestApp;
let base: string;
let projectId: string;
let wren: Client;
let rex: Client;
let reed: Client;
let n = 0;
const newId = () => `own${String(++n).padStart(9, "0")}`;

beforeEach(async () => {
  t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" });
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  projectId = first.id;
  base = `/api/p/${first.slug}`;
  wren = await addPerson(t, "Wren Writer", "wren@example.com");
  rex = await addPerson(t, "Rex Writer", "rex@example.com");
  reed = await addPerson(t, "Reed Reader", "reed@example.com");
  await addMember(t, projectId, wren.id, "writer");
  await addMember(t, projectId, rex.id, "writer");
  await addMember(t, projectId, reed.id, "reader");
});
afterEach(() => t.close());

const entry = async (c: { get: Client["get"] }, path: string) =>
  (await c.get(`${base}/entries?path=${encodeURIComponent(path)}`)).json();

async function edit(c: Who, path: string, text: string, id = newId()) {
  const e = await entry(c, path);
  const res = await c.put(`${base}/drafts`, {
    id,
    path,
    kind: "edit",
    text,
    revision: 0,
    baseBlob: e.blob,
  });
  expect(res.statusCode, res.body).toBe(200);
  return id;
}
const unpublished = async (c: Who) =>
  (await c.get(`${base}/unpublished`)).json() as UnpublishedResponse;
const status = async (c: { get: Client["get"] }) =>
  (await c.get(`${base}/status`)).json() as StatusSnapshot;

/** A real connection to the status stream, which reads the events as they come. */
async function stream(who: Client | TestApp) {
  const address = await t.app
    .listen({ port: 0, host: "127.0.0.1" })
    .catch(() => `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`);
  const cookie = "cookie" in who ? who.cookie : "";
  const res = await fetch(`${address}${base}/status/events`, { headers: { cookie } });
  const reader = res.body!.getReader();
  let buffer = "";
  const seen: StatusSnapshot[] = [];
  const read = async (): Promise<void> => {
    const { value, done } = await reader.read();
    if (done) throw new Error("the stream ended");
    buffer += new TextDecoder().decode(value);
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end === -1) return;
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (line) seen.push(JSON.parse(line.slice(6)) as StatusSnapshot);
    }
  };
  return {
    /** Reads until an event satisfies `ok`, and returns it. */
    async until(ok: (s: StatusSnapshot) => boolean, ms = 5000): Promise<StatusSnapshot> {
      const stop = Date.now() + ms;
      for (;;) {
        const found = seen.find(ok);
        if (found) return found;
        if (Date.now() > stop)
          throw new Error(`no matching event; last: ${JSON.stringify(seen.at(-1))}`);
        await Promise.race([read(), new Promise((r) => setTimeout(r, 100))]);
      }
    },
    latest: () => seen.at(-1)!,
    async close() {
      await reader.cancel().catch(() => undefined);
    },
  };
}

describe("each person's unsaved changes are their own", () => {
  it("lists, reads and counts only a person's own drafts, for the same entry", async () => {
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    const r = await edit(rex, MIRA, "# Mira\n\nRex's text.\n");
    expect((await unpublished(wren)).drafts.map((d) => [d.id, d.text])).toEqual([
      [w, "# Mira\n\nWren's text.\n"],
    ]);
    expect((await unpublished(rex)).drafts.map((d) => [d.id, d.text])).toEqual([
      [r, "# Mira\n\nRex's text.\n"],
    ]);
    expect((await unpublished(t)).drafts).toEqual([]);
    expect((await entry(wren, MIRA)).text).toContain("Wren's text.");
    expect((await entry(rex, MIRA)).text).toContain("Rex's text.");
    expect((await entry(t, MIRA)).draft).toBeNull();
    expect((await status(wren)).unpublished).toBe(1);
    expect((await status(t)).unpublished).toBe(0);
    // Each sees their own entry as theirs in the tree; the admin sees it as published.
    const tree = async (c: Client | TestApp) =>
      (await c.get(`${base}/tree`)).json() as TreeResponse;
    const mira = (tr: TreeResponse) => JSON.stringify(tr).match(/\{[^{}]*Mira\.md[^{}]*\}/)![0];
    expect(mira(await tree(wren))).toContain('"state":"unpublished"');
    expect(mira(await tree(t))).toContain('"state":"published"');
  });

  it("answers not_found when another person's draft is reached by its id", async () => {
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    const intruder = (suffix: string) => `${base}/drafts/${w}${suffix}`;
    // Overwrite by id (the same path, and another path).
    for (const path of [MIRA, SHADE]) {
      const res = await rex.put(`${base}/drafts`, {
        id: w,
        path,
        kind: "edit",
        text: "Rex was here.",
        revision: 1,
      });
      expect(res.statusCode, res.body).toBe(404);
      expect(res.json().error.code).toBe("not_found");
    }
    // Create with the id of another's draft: refused the same way, and nothing is written there.
    const create = await rex.put(`${base}/drafts`, {
      id: w,
      path: "New.md",
      kind: "create",
      text: "# New\n",
      revision: 0,
      baseBlob: "",
    });
    expect(create.statusCode).toBe(404);
    expect((await rex.del(intruder(""))).statusCode).toBe(404);
    expect((await rex.get(intruder("/versions"))).statusCode).toBe(404);
    expect((await rex.del(intruder("/versions/server"))).statusCode).toBe(404);
    expect((await rex.post(intruder("/merge-versions"), { text: "x" })).statusCode).toBe(404);
    expect((await rex.post(intruder("/resolve"), { text: "x" })).statusCode).toBe(404);
    expect((await rex.get(intruder("/compare"))).statusCode).toBe(404);
    // Planning with it finds nothing to plan; the draft is whole.
    const plan = (await rex.post(`${base}/publish/plan`, { draftIds: [w], renameIds: [] })).json();
    expect(plan).toMatchObject({ ready: [], merges: [], conflicts: [] });
    expect((await unpublished(wren)).drafts[0]).toMatchObject({
      id: w,
      text: "# Mira\n\nWren's text.\n",
    });
    expect(t.services.drafts.as(wren.id, () => t.services.drafts.get(w))!.revision).toBe(1);
  });

  it("does not let a save by path touch another person's draft, nor reveal it", async () => {
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    const r = await edit(rex, MIRA, "# Mira\n\nRex's text.\n");
    // Rex saving again by his own id works and changes only his.
    const again = await rex.put(`${base}/drafts`, {
      id: r,
      path: MIRA,
      kind: "edit",
      text: "# Mira\n\nRex, again.\n",
      revision: 1,
    });
    expect(again.statusCode, again.body).toBe(200);
    expect((await unpublished(wren)).drafts.map((d) => d.text)).toEqual([
      "# Mira\n\nWren's text.\n",
    ]);
    // Rex discarding his draft leaves Wren's.
    expect((await rex.del(`${base}/drafts/${r}`)).statusCode).toBe(200);
    expect((await unpublished(wren)).drafts.map((d) => d.id)).toEqual([w]);
    // A new entry with the same path is each person's own, until one saves it.
    const newPath = "Fresh Idea.md";
    for (const [c, text] of [
      [wren, "# Fresh Idea\n\nWren.\n"],
      [rex, "# Fresh Idea\n\nRex.\n"],
    ] as const) {
      const res = await c.put(`${base}/drafts`, {
        id: newId(),
        path: newPath,
        kind: "create",
        text,
        revision: 0,
        baseBlob: "",
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    expect((await entry(wren, newPath)).text).toContain("Wren.");
    expect((await entry(rex, newPath)).text).toContain("Rex.");
  });

  it("keeps renames to the person who made them", async () => {
    const made = await wren.post(`${base}/renames`, { from: SHADE, to: "02 People/Shadow.md" });
    expect(made.statusCode, made.body).toBe(200);
    expect((await unpublished(wren)).renames).toHaveLength(1);
    expect((await unpublished(rex)).renames).toEqual([]);
    expect((await unpublished(t)).renames).toEqual([]);
    expect((await status(rex)).unpublished).toBe(0);
    expect((await status(wren)).unpublished).toBe(1);
    const treeOf = async (c: Client) => (await c.get(`${base}/tree`)).body;
    expect(await treeOf(wren)).toContain("Shadow.md");
    expect(await treeOf(rex)).not.toContain("Shadow.md");
    // Rex cannot undo it, and a rename of his own does not replace Wren's.
    expect((await rex.del(`${base}/renames/${made.json().id}`)).statusCode).toBe(404);
    const rexs = await rex.post(`${base}/renames`, { from: SHADE, to: "02 People/Umbra.md" });
    expect(rexs.json().replaced).toBeNull();
    expect((await unpublished(wren)).renames.map((r) => r.to)).toEqual(["02 People/Shadow.md"]);
    // Rex's plan with Wren's rename id leaves it be.
    const plan = (
      await rex.post(`${base}/publish/plan`, { draftIds: [], renameIds: [made.json().id] })
    ).json();
    expect(plan.renames).toEqual([]);
  });

  it("keeps kept copies, conflicts and their counts to the person they happened to", async () => {
    // Wren's second device saves from older text: a kept copy beside Wren's draft.
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    const stale = await wren.put(`${base}/drafts`, {
      id: newId(),
      path: MIRA,
      kind: "edit",
      text: "# Mira\n\nFrom the phone.\n",
      revision: 0,
      baseBlob: (await entry(wren, MIRA)).blob,
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.id).toBe(w);
    expect((await status(wren)).attention.keptCopies).toBe(1);
    expect((await status(rex)).attention.keptCopies).toBe(0);
    expect(
      ((await wren.get(`${base}/attention`)).json() as { versions: unknown[] }).versions,
    ).toHaveLength(1);
    expect(
      ((await rex.get(`${base}/attention`)).json() as { versions: unknown[] }).versions,
    ).toEqual([]);
    expect((await rex.get(`${base}/drafts/${w}/versions`)).statusCode).toBe(404);
    expect((await wren.get(`${base}/drafts/${w}/versions`)).json().others).toHaveLength(1);

    // A conflict is counted for the person whose plan found it.
    const r = await edit(rex, SHADE, "# Shade\n\nRex.\n");
    t.repo.pushFromOutside({ [SHADE]: "# Shade\n\nOutside, same lines.\n" });
    const plan = (await rex.post(`${base}/publish/plan`, { draftIds: [r], renameIds: [] })).json();
    expect(plan.conflicts).toHaveLength(1);
    expect((await status(rex)).conflicts).toBe(1);
    expect((await status(wren)).conflicts).toBe(0);
    expect((await status(t)).conflicts).toBe(0);
  });

  it("counts a device's draft changes and the server's own changes per person", async () => {
    const before = { wren: (await status(wren)).drafts, rex: (await status(rex)).drafts };
    await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    expect((await status(wren)).drafts).toBe(before.wren + 1);
    expect((await status(rex)).drafts).toBe(before.rex);
  });

  it("tells each person's stream their own counts, and updates it when it changes", async () => {
    const wrenStream = await stream(wren);
    const rexStream = await stream(rex);
    await wrenStream.until((s) => s.unpublished === 0);
    await rexStream.until((s) => s.unpublished === 0);
    await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    await edit(rex, SHADE, "# Shade\n\nRex's text.\n");
    await edit(rex, "03 Things/Plain.md", "# Plain\n\nRex's other text.\n");
    const mine = await wrenStream.until((s) => s.unpublished === 1);
    const his = await rexStream.until((s) => s.unpublished === 2);
    expect(mine.unpublished).toBe(1);
    expect(his.unpublished).toBe(2);
    // Neither stream ever carries the other's count.
    await wrenStream.close();
    await rexStream.close();
  });

  it("gives a reader none of it", async () => {
    await edit(wren, MIRA, "# Mira\n\nWren's secret plan.\n");
    const reedsEntry = await reed.get(`${base}/entries?path=${encodeURIComponent(MIRA)}`);
    expect(reedsEntry.json().othersUnsaved).toEqual([]);
    expect(reedsEntry.body).not.toContain("secret plan");
    const s = await status(reed);
    expect(s).toMatchObject({
      unpublished: 0,
      conflicts: 0,
      drafts: 0,
      othersUnsaved: [],
      presence: [],
    });
    expect((await reed.get(`${base}/tree`)).body).not.toContain("othersUnsaved");
    for (const url of [`${base}/unpublished`, `${base}/drafts/${newId()}/compare`]) {
      const res = await reed.get(url);
      expect(res.statusCode, url).toBe(403);
    }
    const stream1 = await stream(reed);
    const first = await stream1.until(() => true);
    expect(first.othersUnsaved).toEqual([]);
    await stream1.close();
  });
});

describe("what other people may know of someone's work in progress", () => {
  it("names who has unsaved changes to an entry, and since when, on the entry, the tree and the status", async () => {
    const w = await edit(wren, MIRA, "# Mira\n\nWren's secret plan.\n");
    const startedAt = t.services.drafts.as(wren.id, () => t.services.drafts.get(w)!.startedAt)!;
    await rex.put(`${base}/drafts`, { id: w, path: MIRA, kind: "edit", text: "x", revision: 1 });

    for (const who of [rex, t]) {
      const e = await who.get(`${base}/entries?path=${encodeURIComponent(MIRA)}`);
      expect(e.json().othersUnsaved).toEqual([
        { id: wren.id, name: "Wren Writer", since: startedAt },
      ]);
      // The text of the draft is nowhere in what they are told.
      expect(e.body).not.toContain("secret plan");
      const tree = await who.get(`${base}/tree`);
      expect(tree.body).not.toContain("secret plan");
      expect(JSON.stringify(tree.json() as TreeResponse)).toContain('"othersUnsaved":true');
      const s = await status(who);
      expect(s.othersUnsaved).toEqual([
        { path: MIRA, people: [{ id: wren.id, name: "Wren Writer", since: startedAt }] },
      ]);
      expect(JSON.stringify(s)).not.toContain("secret plan");
    }
    // Not about oneself.
    expect((await entry(wren, MIRA)).othersUnsaved).toEqual([]);
    expect((await status(wren)).othersUnsaved).toEqual([]);
    // Other entries are clear.
    expect((await entry(rex, SHADE)).othersUnsaved).toEqual([]);
    // The time is when it began, not when the person last typed.
    await wren.put(`${base}/drafts`, {
      id: w,
      path: MIRA,
      kind: "edit",
      text: "# Mira\n\nMore.\n",
      revision: 1,
    });
    expect((await entry(rex, MIRA)).othersUnsaved[0].since).toBe(startedAt);
  });

  it("lists several people in the order they began, and counts a rename as an unsaved change to the entry", async () => {
    await edit(wren, SHADE, "# Shade\n\nWren.\n");
    await new Promise((r) => setTimeout(r, 20));
    const made = await rex.post(`${base}/renames`, { from: SHADE, to: "02 People/Shadow.md" });
    expect(made.statusCode).toBe(200);
    const e = await entry(t, SHADE);
    expect(e.othersUnsaved.map((p: { name: string }) => p.name)).toEqual([
      "Wren Writer",
      "Rex Writer",
    ]);
  });

  it("does not tell the path of someone's unsaved new entry", async () => {
    const res = await wren.put(`${base}/drafts`, {
      id: newId(),
      path: "Wren's Secret Idea.md",
      kind: "create",
      text: "# Idea\n",
      revision: 0,
      baseBlob: "",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.stringify(await status(rex))).not.toContain("Secret Idea");
    expect((await rex.get(`${base}/tree`)).body).not.toContain("Secret Idea");
    // Someone who writes the same new entry is told: the path is theirs.
    const mine = await rex.put(`${base}/drafts`, {
      id: newId(),
      path: "Wren's Secret Idea.md",
      kind: "create",
      text: "# Idea\n\nMine.\n",
      revision: 0,
      baseBlob: "",
    });
    expect(mine.statusCode).toBe(200);
    expect((await status(rex)).othersUnsaved!.map((o) => o.path)).toEqual([
      "Wren's Secret Idea.md",
    ]);
    expect((await entry(rex, "Wren's Secret Idea.md")).othersUnsaved).toHaveLength(1);
  });

  it("stops telling when the person is demoted or has gone, and tells again when they are back", async () => {
    await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    expect((await entry(rex, MIRA)).othersUnsaved).toHaveLength(1);
    await addMember(t, projectId, wren.id, "reader");
    expect((await entry(rex, MIRA)).othersUnsaved).toEqual([]);
    expect((await status(rex)).othersUnsaved).toEqual([]);
    await addMember(t, projectId, wren.id, "writer");
    expect((await entry(rex, MIRA)).othersUnsaved).toHaveLength(1);
    await t.server.projects.removeMember(projectId, wren.id);
    expect((await entry(rex, MIRA)).othersUnsaved).toEqual([]);
  });

  it("is told to everyone's stream as it happens", async () => {
    const rexStream = await stream(rex);
    await rexStream.until(() => true);
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    const seen = await rexStream.until((s) => (s.othersUnsaved ?? []).length === 1);
    expect(seen.othersUnsaved![0]!.people[0]!.name).toBe("Wren Writer");
    await wren.del(`${base}/drafts/${w}`);
    await rexStream.until(
      (s) => (s.othersUnsaved ?? []).length === 0 && s.drafts >= 0 && rexStream.latest() === s,
    );
    await rexStream.close();
  });
});

describe("people who leave, are removed or are demoted", () => {
  it("keeps a removed person's unsaved changes, tells the owner how many, and restores them if they rejoin", async () => {
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    await wren.post(`${base}/renames`, { from: SHADE, to: "02 People/Shadow.md" });
    const removed = await t.del(`${base}/members/${wren.id}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toEqual({ ok: true, unsavedKept: 2, keptDays: 30 });
    expect((await wren.get(`${base}/unpublished`)).statusCode).toBe(403);
    // Kept on disk, and on the clock.
    expect(existsSync(join(t.services.paths.state, "drafts", w, "record.json"))).toBe(true);
    expect(t.services.drafts.awaySince(wren.id)).not.toBeNull();
    // Nobody else can see or use them.
    expect((await unpublished(rex)).drafts).toEqual([]);
    expect((await rex.del(`${base}/drafts/${w}`)).statusCode).toBe(404);
    // In again within the time: it is all as they left it.
    await addMember(t, projectId, wren.id, "writer");
    const back = await unpublished(wren);
    expect(back.drafts.map((d) => d.id)).toEqual([w]);
    expect(back.renames).toHaveLength(1);
    await t.services.drafts.tidyAway(
      (id) => id === wren.id || id === rex.id || id === reed.id || true,
    );
    expect(t.services.drafts.awaySince(wren.id)).toBeNull();
  });

  it("removes a person's unsaved changes 30 days after they left, and not before", async () => {
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    await edit(rex, SHADE, "# Shade\n\nRex's text.\n");
    const left = new Date("2026-12-01T10:00:00Z");
    await t.services.drafts.memberChanged(wren.id, null, left);
    const isMember = (id: string) => id !== wren.id;
    const day = (d: number) => new Date(left.getTime() + d * 24 * 60 * 60 * 1000);
    expect(await t.services.drafts.tidyAway(isMember, day(29.9))).toBe(0);
    expect(existsSync(join(t.services.paths.state, "drafts", w))).toBe(true);
    expect(await t.services.drafts.tidyAway(isMember, day(30.1))).toBe(1);
    expect(existsSync(join(t.services.paths.state, "drafts", w))).toBe(false);
    expect(t.services.drafts.unsavedOf(wren.id)).toBe(0);
    // Someone who is still here is never cleared, however long it has been.
    expect(await t.services.drafts.tidyAway(isMember, day(400))).toBe(0);
    expect((await unpublished(rex)).drafts).toHaveLength(1);
  });

  it("starts the clock when a sweep finds someone gone that it was not told of, and stops it when they are back", async () => {
    await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    const at = new Date("2026-12-01T10:00:00Z");
    await t.services.drafts.tidyAway((id) => id !== wren.id, at);
    expect(t.services.drafts.awaySince(wren.id)).toBe(at.toISOString());
    await t.services.drafts.tidyAway(() => true, new Date(at.getTime() + 1000));
    expect(t.services.drafts.awaySince(wren.id)).toBeNull();
    // Told of a return, the clock stops; a person with nothing unsaved is not put on one.
    await t.services.drafts.memberChanged(wren.id, null, at);
    expect(t.services.drafts.awaySince(wren.id)).not.toBeNull();
    await t.services.drafts.memberChanged(wren.id, "writer");
    expect(t.services.drafts.awaySince(wren.id)).toBeNull();
    await t.services.drafts.memberChanged(reed.id, null, at);
    expect(t.services.drafts.awaySince(reed.id)).toBeNull();
    // The clock is kept on disk.
    await t.services.drafts.memberChanged(wren.id, null, at);
    const again = new DraftStore(join(t.services.paths.state), new StateFiles(), {});
    await again.load();
    expect(again.awaySince(wren.id)).toBe(at.toISOString());
  });

  it("is told the count when a person leaves for themselves", async () => {
    await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    const left = await wren.post(`${base}/members/leave`, {});
    expect(left.json()).toEqual({ ok: true, unsavedKept: 1, keptDays: 30 });
  });

  it("hides a demoted person's changes until they write again, and loses nothing", async () => {
    const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
    await addMember(t, projectId, wren.id, "reader");
    // A reader sees the saved view only, and none of the writers' routes.
    const e = await wren.get(`${base}/entries?path=${encodeURIComponent(MIRA)}`);
    expect(e.json().draft).toBeNull();
    expect(e.json().text).not.toContain("Wren's text.");
    expect((await status(wren)).unpublished).toBe(0);
    expect((await wren.get(`${base}/unpublished`)).statusCode).toBe(403);
    expect((await wren.del(`${base}/drafts/${w}`)).statusCode).toBe(403);
    // Not on the clock: they are still in the project.
    await t.services.drafts.tidyAway(
      (id) => id !== "nobody",
      new Date(Date.now() + 90 * 86400_000),
    );
    await addMember(t, projectId, wren.id, "writer");
    expect((await unpublished(wren)).drafts.map((d) => [d.id, d.text])).toEqual([
      [w, "# Mira\n\nWren's text.\n"],
    ]);
  });
});

describe("the move from one author to unsaved changes per person", () => {
  let dir: string;
  let files: StateFiles;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "frontier-drafts-"));
    files = new StateFiles();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const record = (id: string, path: string, extra: object = {}) => ({
    id,
    revision: 1,
    path,
    kind: "edit",
    baseBlob: "abc",
    lineEnding: "lf",
    binary: false,
    updatedAt: "2026-11-01T10:00:00.000Z",
    origins: [],
    ...extra,
  });
  function legacy(id: string, path: string, text: string, extra: object = {}) {
    mkdirSync(join(dir, "drafts", id), { recursive: true });
    writeFileSync(join(dir, "drafts", id, "record.json"), JSON.stringify(record(id, path, extra)));
    writeFileSync(join(dir, "drafts", id, "content"), text);
  }
  function legacyRename(id: string, from: string, to: string) {
    mkdirSync(join(dir, "drafts", "renames"), { recursive: true });
    writeFileSync(
      join(dir, "drafts", "renames", `${id}.json`),
      JSON.stringify({ id, from, to, createdAt: "2026-11-01T10:00:00.000Z" }),
    );
  }
  const stamped = (id: string) =>
    JSON.parse(readFileSync(join(dir, "drafts", id, "record.json"), "utf8")).person as
      string | undefined;

  it("gives every draft and rename from before to the first owner, without loss", async () => {
    legacy("legacydraft1", "A.md", "text a");
    legacy("legacydraft2", "B.md", "text b");
    legacyRename("legacyrenam1", "C.md", "D.md");
    const store = new DraftStore(dir, files, { legacyOwner: () => "admin1" });
    await store.load();
    const as = <T>(who: string, f: () => T) => store.as(who, f);
    expect(as("admin1", () => store.list().map((d) => d.id))).toEqual([
      "legacydraft1",
      "legacydraft2",
    ]);
    expect(as("admin1", () => store.listRenames().map((r) => r.id))).toEqual(["legacyrenam1"]);
    expect(await as("admin1", () => store.text("legacydraft1"))).toBe("text a");
    expect(as("admin1", () => store.count())).toBe(3);
    // Nobody else has any of it.
    expect(as("bob", () => store.list())).toEqual([]);
    expect(as("bob", () => store.listRenames())).toEqual([]);
    expect(as("bob", () => store.count())).toBe(0);
    await expect(as("bob", () => store.text("legacydraft1"))).rejects.toMatchObject({
      code: "not_found",
    });
    // And it is written down.
    expect(stamped("legacydraft1")).toBe("admin1");
    expect(
      JSON.parse(readFileSync(join(dir, "drafts", "renames", "legacyrenam1.json"), "utf8")).person,
    ).toBe("admin1");
    expect(readFileSync(join(dir, "drafts", "legacydraft2", "content"), "utf8")).toBe("text b");
  });

  it("is safe to run again: nothing is written the second time", async () => {
    legacy("legacydraft1", "A.md", "text a");
    legacyRename("legacyrenam1", "C.md", "D.md");
    const first = new DraftStore(dir, files, { legacyOwner: () => "admin1" });
    await first.load();
    const file = join(dir, "drafts", "legacydraft1", "record.json");
    const stamp = statSync(file).mtimeMs;
    const body = readFileSync(file, "utf8");
    await new Promise((r) => setTimeout(r, 15));
    const second = new DraftStore(dir, files, { legacyOwner: () => "admin1" });
    await second.load();
    expect(await second.stampOwners()).toBe(0);
    expect(statSync(file).mtimeMs).toBe(stamp);
    expect(readFileSync(file, "utf8")).toBe(body);
    expect(second.as("admin1", () => second.count())).toBe(2);
  });

  it("finishes a move that stopped halfway, and reads the files that are not written yet as the first owner's", async () => {
    legacy("legacydraft1", "A.md", "text a");
    legacy("legacydraft2", "B.md", "text b");
    legacy("legacydraft3", "E.md", "text e");
    // The first start stamped one and was stopped; one belongs to someone else already.
    legacy("legacydraft1", "A.md", "text a", { person: "admin1" });
    legacy("legacydraft3", "E.md", "text e", { person: "someone2" });
    const store = new DraftStore(dir, files, { legacyOwner: () => null });
    await store.load();
    // With no first owner known yet nothing can be written, and nothing is lost or mixed up.
    expect(stamped("legacydraft2")).toBeUndefined();
    expect(store.as("someone2", () => store.list().map((d) => d.id))).toEqual(["legacydraft3"]);
    const next = new DraftStore(dir, files, { legacyOwner: () => "admin1" });
    await next.load();
    expect(stamped("legacydraft2")).toBe("admin1");
    expect(stamped("legacydraft3")).toBe("someone2");
    expect(next.as("admin1", () => next.list().map((d) => d.id))).toEqual([
      "legacydraft1",
      "legacydraft2",
    ]);
    expect(next.as("someone2", () => next.list().map((d) => d.id))).toEqual(["legacydraft3"]);
  });

  it("works from a real library: the first account sees what the one author left, nobody else does", async () => {
    // A server's data folder from before 27d: a draft folder with no owner.
    const state = t.services.paths.state;
    const folder = join(state, "drafts", "oldauthor001");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "record.json"),
      JSON.stringify(record("oldauthor001", MIRA, { baseBlob: "" })),
    );
    writeFileSync(join(folder, "content"), "# Mira\n\nWritten before people.\n");
    // (The admin owns the first project from its first request, as on a server that has run.)
    await t.get(`${base}/status`);
    await t.services.drafts.load();
    expect((await unpublished(t)).drafts.map((d) => d.id)).toEqual(["oldauthor001"]);
    expect((await unpublished(wren)).drafts).toEqual([]);
    expect(JSON.parse(readFileSync(join(folder, "record.json"), "utf8")).person).toBe(
      (await t.server.people.all()).find((p) => p.admin)!.id,
    );
    expect(readdirSync(join(state, "drafts"))).toContain("oldauthor001");
  });
});
