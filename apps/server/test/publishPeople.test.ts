/**
 * Stage 27d, the parts of the publisher and the author lookup that a person-to-person test does not
 * reach by itself: the bounds, the fallbacks, and the answers for a change that is already gone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftCompareResponse, PublishPlan } from "@frontier/schema";
import { Authors } from "../src/publish/authors.js";
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
const PLAIN = "03 Things/Plain.md";

describe("the author lookup", () => {
  const people = (byId: Record<string, { id: string; name: string; email: string }>) =>
    ({
      get: async (id: string) => byId[id] ?? null,
      byEmail: async (email: string) => Object.values(byId).find((p) => p.email === email) ?? null,
    }) as never;

  it("finds the account by its email or its stand-in, and falls back to the name Git has", async () => {
    const a = new Authors(
      people({
        p1: { id: "p1", name: "Ann", email: "ann@x.org" },
        p2: { id: "p2", name: "Bo", email: "" },
      }),
    );
    expect(await a.resolve({ name: "Anything", email: "ann@x.org" })).toEqual({
      id: "p1",
      name: "Ann",
    });
    // The stand-in names a person who has no email, in any letter case; not one who has one.
    expect(await a.resolve({ name: "Anything", email: "p2@people.frontier.invalid" })).toEqual({
      id: "p2",
      name: "Bo",
    });
    expect(await a.resolve({ name: "Anything", email: "P2@PEOPLE.FRONTIER.INVALID" })).toEqual({
      id: "p2",
      name: "Bo",
    });
    expect(await a.resolve({ name: "Anything", email: "p1@people.frontier.invalid" })).toEqual({
      id: null,
      name: "Anything",
    });
    // Only people of the project are found.
    const strict = new Authors(
      people({ p1: { id: "p1", name: "Ann", email: "ann@x.org" } }),
      () => false,
    );
    expect(await strict.resolve({ name: "Ann on Git", email: "ann@x.org" })).toEqual({
      id: null,
      name: "Ann on Git",
    });
    expect(await a.resolve({ name: "Seed", email: "seed@x.org" })).toEqual({
      id: null,
      name: "Seed",
    });
    expect(await a.resolve({ name: "Seed", email: "" })).toEqual({ id: null, name: "Seed" });
    expect(await a.resolve({ name: "", email: "" })).toEqual({ id: null, name: "Someone" });
    expect(await a.resolve({ name: "ann@x.org", email: "other@x.org" })).toEqual({
      id: null,
      name: "Someone",
    });
    expect(await a.resolve({ name: "Ghost", email: "gone@people.frontier.invalid" })).toEqual({
      id: null,
      name: "Ghost",
    });
  });
});

describe("the publisher with several people", () => {
  let t: TestApp;
  let base: string;
  let wren: Client;
  let rex: Client;
  let n = 0;
  const newId = () => `pubp${String(++n).padStart(8, "0")}`;
  beforeEach(async () => {
    t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" });
    await t.login();
    const first = (await t.server.projects.all())[0]!;
    base = `/api/p/${first.slug}`;
    wren = await addPerson(t, "Wren Writer", "wren@example.com");
    rex = await addPerson(t, "Rex Writer", "rex@example.com");
    await addMember(t, first.id, wren.id, "writer");
    await addMember(t, first.id, rex.id, "writer");
  });
  afterEach(() => t.close());

  const entry = async (c: { get: Client["get"] }, path: string) =>
    (await c.get(`${base}/entries?path=${encodeURIComponent(path)}`)).json();
  async function put(c: Who, path: string, text: string, kind = "edit", id = newId()) {
    const e = kind === "create" ? { blob: "" } : await entry(c, path);
    const res = await c.put(`${base}/drafts`, {
      id,
      path,
      kind,
      text,
      revision: 0,
      baseBlob: e.blob,
    });
    expect(res.statusCode, res.body).toBe(200);
    return id;
  }
  const plan = async (c: Who, ids: string[]) =>
    (await c.post(`${base}/publish/plan`, { draftIds: ids, renameIds: [] })).json() as PublishPlan;
  const confirm = (c: Who, planId: string) =>
    c.post(`${base}/publish/confirm`, { planId, confirmedMergeIds: [], message: "Save" });
  const publisher = () =>
    t.services.publisher as unknown as {
      own: Set<string>;
      movedByUs(from: string): Promise<boolean>;
      d: { authors: unknown };
    };

  it("remembers a bounded number of its own commits", () => {
    for (let i = 0; i < 520; i++) t.services.publisher.noteOwnCommit(`commit${i}`);
    expect(publisher().own.size).toBe(500);
    expect(publisher().own.has("commit0")).toBe(false);
    expect(publisher().own.has("commit519")).toBe(true);
  });

  it("does not take a commit it cannot find for one of its own", async () => {
    expect(await publisher().movedByUs("0".repeat(40))).toBe(false);
    expect(await publisher().movedByUs(t.repo.remoteHead())).toBe(false);
  });

  it("says nothing about who saved when Git has no version of the file", async () => {
    // An edit of an entry the library never had: there is nothing to name, and it is a conflict.
    const id = newId();
    await t.services.drafts.saveFrom({
      id,
      path: "Never There.md",
      kind: "edit",
      content: "# Never\n",
      baseBlob: "",
      lineEnding: "lf",
    });
    const p = await plan(t, [id]);
    expect(p.conflicts[0]).toMatchObject({
      reason: "deleted_on_main",
      theirsBy: null,
      theirsAt: null,
    });
  });

  it("still plans when it has no way to tell who saved", async () => {
    const real = publisher().d.authors;
    publisher().d.authors = undefined;
    try {
      const w = await put(wren, MIRA, "# Mira\n\nWren.\n");
      const r = await put(rex, MIRA, "# Mira\n\nRex.\n");
      expect((await confirm(wren, (await plan(wren, [w])).planId)).statusCode).toBe(200);
      // With nobody to name, the other version is Git's name only: not a person, so it merges or not as before.
      const p = await plan(rex, [r]);
      expect(p.conflicts[0]).toMatchObject({
        reason: "overlap",
        theirsBy: { id: null, name: "Wren Writer" },
      });
    } finally {
      publisher().d.authors = real;
    }
  });

  it("compares an unsaved change that is on main already, and one whose only difference is its kept copies", async () => {
    const same = "# Mira\n\nSame as main will be.\n";
    const a = await put(wren, MIRA, same);
    t.repo.pushFromOutside({ [MIRA]: same });
    const gone = (await wren.get(`${base}/drafts/${a}/compare`)).json() as DraftCompareResponse;
    expect(gone).toMatchObject({ draftId: a, path: MIRA, outcome: "none" });

    // A draft that equals the library but keeps a device's other text is not cleared: nothing to save.
    const main = (await entry(rex, SHADE)).text as string;
    const keep = await put(rex, SHADE, main);
    const stale = await rex.put(`${base}/drafts`, {
      id: newId(),
      path: SHADE,
      kind: "edit",
      text: "# Shade\n\nOther device.\n",
      revision: 0,
      baseBlob: (await entry(rex, SHADE)).blob,
    });
    expect(stale.statusCode).toBe(409);
    const none = (await rex.get(`${base}/drafts/${keep}/compare`)).json() as DraftCompareResponse;
    expect(none.outcome).toBe("none");
    // A clean merge is offered as one.
    const text = (await entry(wren, PLAIN)).text as string;
    const m = await put(wren, PLAIN, `${text}\nAnd a line.\n`);
    t.repo.pushFromOutside({ [PLAIN]: text.replace("# Plain", "# Plain (outside)") });
    const merge = (await wren.get(`${base}/drafts/${m}/compare`)).json() as DraftCompareResponse;
    expect(merge.outcome).toBe("merge");
    expect(merge.merge).toMatchObject({ path: PLAIN, theirsBy: { id: null, name: "Seed" } });
  });

  it("names how many entries were saved over when none of a save could go in", async () => {
    const wm = await put(wren, MIRA, "# Mira\n\nWren.\n");
    const ws = await put(wren, SHADE, "# Shade\n\nWren.\n");
    const rm = await put(rex, MIRA, "# Mira\n\nRex.\n");
    const rs = await put(rex, SHADE, "# Shade\n\nRex.\n");
    const p = await plan(rex, [rm, rs]);
    expect((await confirm(wren, (await plan(wren, [wm, ws])).planId)).statusCode).toBe(200);
    const done = await confirm(rex, p.planId);
    expect(done.statusCode).toBe(409);
    expect(done.json().error.message).toMatch(/and 1 more/);
  });

  it("drops an entry that someone else already deleted, and saves the rest", async () => {
    const e = await entry(rex, PLAIN);
    const del = await rex.put(`${base}/drafts`, {
      id: newId(),
      path: PLAIN,
      kind: "delete",
      text: "",
      revision: 0,
      baseBlob: e.blob,
    });
    const edit = await put(rex, SHADE, "# Shade\n\nRex.\n");
    const p = await plan(rex, [del.json().id, edit]);
    // Wren deletes the same entry and saves first.
    const wd = await wren.put(`${base}/drafts`, {
      id: newId(),
      path: PLAIN,
      kind: "delete",
      text: "",
      revision: 0,
      baseBlob: e.blob,
    });
    expect((await confirm(wren, (await plan(wren, [wd.json().id])).planId)).statusCode).toBe(200);
    const done = await confirm(rex, p.planId);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().conflicts).toEqual([]);
    expect(t.repo.remoteFile(SHADE)).toContain("Rex.");
    expect(t.repo.remoteFile(PLAIN)).toBeNull();
  });

  it("offers an own commit that moved a file as a conflict to look at, even when it would merge", async () => {
    const text = (await entry(rex, MIRA)).text as string;
    const r = await put(rex, MIRA, `${text}\nRex's line.\n`);
    const other = await put(rex, SHADE, "# Shade\n\nRex.\n");
    const p = await plan(rex, [r, other]);
    // Something this server made (here, noted as such) changed Mira without overlapping.
    const commit = t.repo.pushFromOutside({
      [MIRA]: text.replace("# Mira", "# Mira (their title)"),
    });
    t.services.publisher.noteOwnCommit(commit);
    const done = await confirm(rex, p.planId);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().conflicts).toHaveLength(1);
    expect(done.json().conflicts[0]).toMatchObject({
      draftId: r,
      path: MIRA,
      // A clean merge is not an overlap: it is refused because a newer version was saved.
      reason: "saved_by_other",
      theirsBy: { id: null, name: "Seed" },
    });
    expect(done.json().conflicts[0].mergedText).toContain("(their title)");
    expect(t.repo.remoteFile(SHADE)).toContain("Rex.");
  });

  it("leaves a draft that the library has caught up with out of the way", async () => {
    const same = "# Plain\n\nCaught up.\n";
    const r = await put(rex, PLAIN, same);
    const other = await put(rex, SHADE, "# Shade\n\nRex.\n");
    const p = await plan(rex, [r, other]);
    const commit = t.repo.pushFromOutside({ [PLAIN]: same });
    t.services.publisher.noteOwnCommit(commit);
    const done = await confirm(rex, p.planId);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().conflicts).toEqual([]);
    expect(t.repo.remoteFile(SHADE)).toContain("Rex.");
  });
});
