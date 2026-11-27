/**
 * The fixes after the review of stage 27d (unsaved changes per person, saved versions by several
 * people, presence). Each test here would have failed before its fix.
 */
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DraftCompareResponse,
  type HistoryResponse,
  isStandInAddress,
  JoinPasswordRequest,
  ProfileRequest,
  type PublishPlan,
  STAND_IN_DOMAIN,
} from "@frontier/schema";
import { parseLogZ } from "../src/git/gateway.js";
import { VaultIndex } from "../src/index/build.js";
import { Presence } from "../src/projects/presence.js";
import { StatusService } from "../src/status/status.js";
import type { StatusSnapshot } from "@frontier/schema";
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

describe("the stage 27d review: saved versions and who made them", () => {
  let t: TestApp;
  let base: string;
  let projectId: string;
  let wren: Client;
  let rex: Client;
  let n = 0;
  const newId = () => `review${String(++n).padStart(6, "0")}`;

  beforeEach(async () => {
    t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" });
    await t.login();
    const first = (await t.server.projects.all())[0]!;
    projectId = first.id;
    base = `/api/p/${first.slug}`;
    wren = await addPerson(t, "Wren Writer", "wren@example.com");
    rex = await addPerson(t, "Rex Writer", "rex@example.com");
    await addMember(t, first.id, wren.id, "writer");
    await addMember(t, first.id, rex.id, "writer");
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
  const plan = async (c: Who, draftIds: string[], renameIds: string[] = []) => {
    const res = await c.post(`${base}/publish/plan`, { draftIds, renameIds });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as PublishPlan;
  };
  const confirm = (c: Who, planId: string, confirmedMergeIds: string[] = [], message = "Save") =>
    c.post(`${base}/publish/confirm`, { planId, confirmedMergeIds, message });
  const main = (path: string) => t.repo.remoteFile(path);
  const compare = async (c: Who, id: string) =>
    (await c.get(`${base}/drafts/${id}/compare`)).json() as DraftCompareResponse;
  const history = async (c: Who) => (await c.get(`${base}/history`)).json() as HistoryResponse;
  const lastAuthor = () =>
    execFileSync("git", ["log", "-1", "--format=%an <%ae>", "refs/heads/main"], {
      cwd: t.repo.remote,
      encoding: "utf8",
    }).trim();

  // ---- Item 1: resolving rebases onto the version that was compared ---------------------------

  describe("resolving a conflict", () => {
    const WREN = "# Mira\n\nWren's version.\n";
    const REX1 = "# Mira\n\nRex's first version.\n";
    const REX2 = "# Mira\n\nRex's second version.\n";

    it("is refused when someone saved another version while the person was comparing", async () => {
      const w = await edit(wren, MIRA, WREN);
      const r = await edit(rex, MIRA, REX1);
      expect((await confirm(rex, (await plan(rex, [r])).planId)).statusCode).toBe(200);
      // Wren compares with Rex's first version ...
      const first = await compare(wren, w);
      expect(first.outcome).toBe("conflict");
      expect(first.conflict).toMatchObject({ theirs: REX1, reason: "saved_by_other" });
      expect(first.theirsBlob).toBe(first.conflict!.theirsBlob);
      expect(first.theirsBlob).toMatch(/^[0-9a-f]{40}$/);
      // ... Rex saves a second version meanwhile ...
      const r2 = await edit(rex, MIRA, REX2, newId());
      expect((await confirm(rex, (await plan(rex, [r2])).planId)).statusCode).toBe(200);
      // ... and Wren's choice (keep mine) is refused: it would have overwritten the second version.
      const refused = await wren.post(`${base}/drafts/${w}/resolve`, {
        text: WREN,
        theirsBlob: first.theirsBlob,
      });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe("saved_by_other");
      expect(refused.json().error.message).toContain("Rex Writer");
      expect(main(MIRA)).toBe(REX2);
      // The draft is as it was: still based on the old version, her text untouched.
      expect((await entry(wren, MIRA)).text).toBe(WREN);
      expect((await compare(wren, w)).outcome).toBe("conflict");

      // After comparing again she sees the second version, and her choice (both changes) is saved.
      const second = await compare(wren, w);
      expect(second.conflict!.theirs).toBe(REX2);
      expect(second.theirsBlob).not.toBe(first.theirsBlob);
      const both = "# Mira\n\nRex's second version.\n\nWren's version.\n";
      const ok = await wren.post(`${base}/drafts/${w}/resolve`, {
        text: both,
        theirsBlob: second.theirsBlob,
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const p = await plan(wren, [w]);
      expect(p.ready).toEqual([w]);
      expect((await confirm(wren, p.planId)).statusCode).toBe(200);
      expect(main(MIRA)).toBe(both);
      expect(lastAuthor()).toBe("Wren Writer <wren@example.com>");
    });

    it("is refused without the compared version when the saved one changed since the plan", async () => {
      const w = await edit(wren, MIRA, WREN);
      const r = await edit(rex, MIRA, REX1);
      await confirm(rex, (await plan(rex, [r])).planId);
      // The web app before 27d: a plan shows the conflict, then it resolves with the text alone.
      expect((await plan(wren, [w])).conflicts).toHaveLength(1);
      const r2 = await edit(rex, MIRA, REX2, newId());
      await confirm(rex, (await plan(rex, [r2])).planId);
      const refused = await wren.post(`${base}/drafts/${w}/resolve`, { text: WREN });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.code).toBe("saved_by_other");
      expect(main(MIRA)).toBe(REX2);
      // Planned again, the same request is good while the saved version is the one that was shown.
      expect((await plan(wren, [w])).conflicts).toHaveLength(1);
      const ok = await wren.post(`${base}/drafts/${w}/resolve`, { text: WREN });
      expect(ok.statusCode, ok.body).toBe(200);
      // The version is used up: it is not resolved again without looking again.
      const again = await wren.post(`${base}/drafts/${w}/resolve`, { text: WREN });
      expect(again.statusCode).toBe(400);
    });

    it("is refused when the change was never compared and there is nothing to rebuild on", async () => {
      const w = await edit(wren, MIRA, WREN);
      const res = await wren.post(`${base}/drafts/${w}/resolve`, { text: WREN });
      expect(res.statusCode).toBe(400);
      // Nobody else's draft, as before.
      expect(
        (await rex.post(`${base}/drafts/${w}/resolve`, { text: "x", theirsBlob: null })).statusCode,
      ).toBe(404);
    });

    it("names no version when the compared entry was deleted, and holds while it stays so", async () => {
      const w = await edit(wren, MIRA, WREN);
      const d = newId();
      expect(
        (
          await rex.put(`${base}/drafts`, {
            id: d,
            path: MIRA,
            kind: "delete",
            text: "",
            revision: 0,
            baseBlob: (await entry(rex, MIRA)).blob,
          })
        ).statusCode,
      ).toBe(200);
      await confirm(rex, (await plan(rex, [d])).planId);
      const c = await compare(wren, w);
      expect(c.conflict).toMatchObject({ reason: "deleted_on_main", theirsBlob: null });
      expect(c.theirsBlob).toBeNull();
      const ok = await wren.post(`${base}/drafts/${w}/resolve`, { text: WREN, theirsBlob: null });
      expect(ok.statusCode, ok.body).toBe(200);
      // A file at the path again: the choice made on "nothing there" is not applied to it.
      t.repo.pushFromOutside({ [MIRA]: "# Mira\n\nBack.\n" });
      const late = await wren.post(`${base}/drafts/${w}/resolve`, { text: WREN, theirsBlob: null });
      expect(late.statusCode).toBe(409);
    });
  });

  // ---- Item 4: any version by someone else counts, and a clean merge is sent along -----------

  describe("saving after someone else saved (decision C)", () => {
    it("compares when any version since the one the change started from is by another person", async () => {
      const text = (await entry(wren, MIRA)).text as string;
      const w = await edit(wren, MIRA, text.replace("# Mira", "# Mira the Elder"));
      const r = await edit(rex, MIRA, `${text}\nRex's line.\n`);
      expect((await confirm(rex, (await plan(rex, [r])).planId)).statusCode).toBe(200);
      // The last version is by someone Git alone knows, yet Rex's came in between.
      t.repo.pushFromOutside({ [SHADE]: "# Shade\n\nOutside.\n" });
      t.repo.pushFromOutside({ [MIRA]: `${text}\nRex's line.\nAn outside line.\n` }, "Outside");
      const c = await compare(wren, w);
      expect(c.outcome).toBe("conflict");
      expect(c.conflict).toMatchObject({
        reason: "saved_by_other",
        theirsBy: { id: rex.id, name: "Rex Writer" },
      });
      // The two changes merge cleanly, so the merged text comes with the conflict.
      expect(c.conflict!.mergedText).toBe(
        `${text.replace("# Mira", "# Mira the Elder")}\nRex's line.\nAn outside line.\n`,
      );
      // Versions after the one this change started from, none by someone else: merged as before.
      expect((await compare(rex, await edit(rex, SHADE, "# Shade\n\nRex.\n"))).outcome).not.toBe(
        "conflict",
      );
    });

    it("sends no merged text when the two changes overlap", async () => {
      const w = await edit(wren, MIRA, "# Mira\n\nWren's version.\n");
      const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
      await confirm(rex, (await plan(rex, [r])).planId);
      const c = (await compare(wren, w)).conflict!;
      expect(c.reason).toBe("saved_by_other");
      expect(c.mergedText).toBeUndefined();
      const p = await plan(wren, [w]);
      expect(p.conflicts[0]!.mergedText).toBeUndefined();
      expect(p.conflicts[0]!.theirsBlob).toBe(c.theirsBlob);
    });

    it("says on the plan which version it looked at, for a merge too", async () => {
      const text = (await entry(wren, MIRA)).text as string;
      const w = await edit(wren, MIRA, `${text}\nWren's line.\n`);
      t.repo.pushFromOutside({ [MIRA]: text.replace("# Mira", "# Mira (outside)") });
      const p = await plan(wren, [w]);
      expect(p.merges[0]!.theirsBlob).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  // ---- Item 5: the details of a partial save -------------------------------------------------

  describe("a save that is only partly possible", () => {
    const KNOT = SHADE;
    const ROPE = MIRA;

    it("does not hold a rename back for a draft that reached main meanwhile", async () => {
      const knot = (await entry(wren, KNOT)).text as string;
      const same = `${knot}\nBoth of us wrote this.\n`;
      const w = await edit(wren, KNOT, same);
      const rename = await wren.post(`${base}/renames`, { from: ROPE, to: "02 People/Mirra.md" });
      expect(rename.statusCode, rename.body).toBe(200);
      const p = await plan(wren, [w], [rename.json().id]);
      expect(p.groups.some((g) => g.includes(w) && g.includes(rename.json().id))).toBe(true);
      // Rex saves the same text of the same note first, so Wren's draft of it is on main.
      const r = await edit(rex, KNOT, same);
      expect((await confirm(rex, (await plan(rex, [r])).planId)).statusCode).toBe(200);
      const done = await confirm(wren, p.planId);
      expect(done.statusCode, done.body).toBe(200);
      expect(main("02 People/Mirra.md")).not.toBeNull();
      expect(main(ROPE)).toBeNull();
      expect(main(KNOT)).toContain("[[Mirra]]");
    });

    it("says everything is published when that is all there was", async () => {
      const w = await edit(wren, SHADE, "# Shade\n\nSame.\n");
      const p = await plan(wren, [w]);
      const r = await edit(rex, SHADE, "# Shade\n\nSame.\n");
      await confirm(rex, (await plan(rex, [r])).planId);
      const done = await confirm(wren, p.planId);
      expect(done.statusCode).toBe(400);
      expect(done.json().error.message).toBe("Everything in this plan is already published.");
    });

    it("keeps the right reason, and the merged text, for a clean merge refused at the save", async () => {
      const text = (await entry(wren, MIRA)).text as string;
      const w = await edit(wren, MIRA, text.replace("# Mira", "# Mira the Elder"));
      const ws = await edit(wren, SHADE, "# Shade\n\nWren changed Shade.\n");
      const p = await plan(wren, [w, ws]);
      expect(p.ready).toEqual([w, ws]);
      // Someone changes the entry a line elsewhere, by a save this server made (an import).
      const head = t.repo.pushFromOutside({ [MIRA]: `${text}\nAn imported line.\n` }, "Import");
      t.services.publisher.noteOwnCommit(head);
      const done = await confirm(wren, p.planId);
      expect(done.statusCode, done.body).toBe(200);
      const [c] = done.json().conflicts;
      expect(c).toMatchObject({ draftId: w, path: MIRA, reason: "saved_by_other" });
      expect(c.mergedText).toContain("# Mira the Elder");
      expect(c.mergedText).toContain("An imported line.");
      expect(c.theirsBlob).toMatch(/^[0-9a-f]{40}$/);
      expect(main(SHADE)).toContain("Wren changed Shade.");
      // The person's count of things to settle is refreshed after the save.
      const status = (await wren.get(`${base}/status`)).json();
      expect(status.conflicts).toBe(1);
    });
  });

  // ---- Item 2: an unsent save naming a draft id that is someone else's --------------------------

  describe("a device that names another person's draft id", () => {
    const body = (path: string, blob: string, text: string, revision = 0) => ({
      path,
      kind: "edit",
      text,
      revision,
      baseBlob: blob,
    });

    it("is answered as for an id nobody has, and gets a draft of its own", async () => {
      const w = await edit(wren, MIRA, "# Mira\n\nWren's text.\n");
      const blob = (await entry(rex, SHADE)).blob;
      const taken = await rex.put(`${base}/drafts`, {
        id: w,
        ...body(SHADE, blob, "# Shade\n\nRex's text.\n"),
      });
      const free = await t.put(`${base}/drafts`, {
        id: "freeidfreeid",
        ...body("03 Things/Plain.md", (await entry(t, "03 Things/Plain.md")).blob, "# Plain\n"),
      });
      expect(taken.statusCode).toBe(200);
      expect(taken.json()).toEqual({ id: w, revision: 1 });
      expect(free.json()).toEqual({ id: "freeidfreeid", revision: 1 });
      // Rex's text is his, under his own draft; Wren's is whole.
      const rexList = (await rex.get(`${base}/unpublished`)).json().drafts;
      expect(rexList).toHaveLength(1);
      expect(rexList[0]).toMatchObject({ path: SHADE, text: "# Shade\n\nRex's text.\n" });
      expect(rexList[0].id).not.toBe(w);
      const wrenList = (await wren.get(`${base}/unpublished`)).json().drafts;
      expect(wrenList).toMatchObject([{ id: w, path: MIRA, text: "# Mira\n\nWren's text.\n" }]);
      // The id his device uses goes on naming his draft: it saves again, and Wren's is not touched.
      const again = await rex.put(`${base}/drafts`, {
        id: w,
        ...body(SHADE, blob, "# Shade\n\nRex, again.\n", 1),
      });
      expect(again.json()).toEqual({ id: w, revision: 2 });
      expect((await entry(rex, SHADE)).text).toBe("# Shade\n\nRex, again.\n");
      expect((await entry(wren, MIRA)).text).toBe("# Mira\n\nWren's text.\n");
      // And it is his to discard by that id; Wren's survives.
      expect((await rex.del(`${base}/drafts/${w}`)).statusCode).toBe(200);
      expect((await rex.get(`${base}/unpublished`)).json().drafts).toEqual([]);
      expect((await wren.get(`${base}/unpublished`)).json().drafts).toHaveLength(1);
      // Reading what he sent through the id also stays his.
      expect((await rex.del(`${base}/drafts/${w}`)).statusCode).toBe(404);
    });

    it("keeps its text as a kept copy and answers stale_revision, as for a free id", async () => {
      const w = await edit(wren, SHADE, "# Shade\n\nWren's text.\n");
      const old = (await entry(rex, SHADE)).blob as string;
      // Someone saved Shade since Rex's device read it.
      t.repo.pushFromOutside({ [SHADE]: "# Shade\n\nNewer.\n" });
      await t.services.sync();
      const taken = await rex.put(`${base}/drafts`, {
        id: w,
        ...body(SHADE, old, "# Shade\n\nRex's unsent text.\n"),
      });
      const free = await rex.put(`${base}/drafts`, {
        id: "freeidfreeid",
        ...body(SHADE, old, "# Shade\n\nRex's unsent text.\n"),
      });
      expect(taken.statusCode).toBe(409);
      expect(taken.json().error.code).toBe("stale_revision");
      // The same shape for both; the id in it is one Rex's device goes on with.
      expect(free.statusCode).toBe(409);
      expect(Object.keys(free.json().error).sort()).toEqual(Object.keys(taken.json().error).sort());
      expect(taken.json().error.message).toBe(free.json().error.message);
      const draftId = taken.json().error.id ?? taken.json().error.details?.id;
      expect(draftId).toBeDefined();
      // His text is kept beside a draft of the saved version; Wren's draft is whole.
      const versions = (await rex.get(`${base}/drafts/${draftId}/versions`)).json();
      expect(versions.others.map((o: { text: string }) => o.text)).toContain(
        "# Shade\n\nRex's unsent text.\n",
      );
      expect((await entry(wren, SHADE)).text).toBe("# Shade\n\nWren's text.\n");
    });

    it("finds the pre-27d draft a person's own device still knows by its old id", async () => {
      // A draft from before people belongs to the first owner (the admin), whatever device made it.
      const legacy = "legacyidxxxx";
      await t.services.drafts.saveFrom({
        id: legacy,
        path: SHADE,
        kind: "edit",
        content: "# Shade\n\nThe admin's.\n",
        baseBlob: (await entry(t, SHADE)).blob,
        lineEnding: "lf",
      });
      // Wren's browser profile queued an unsent save of a draft with that id.
      const sent = await wren.put(`${base}/drafts`, {
        id: legacy,
        path: SHADE,
        kind: "edit",
        text: "# Shade\n\nWren's unsent.\n",
        revision: 3,
        baseBlob: (await entry(wren, SHADE)).blob,
      });
      expect(sent.statusCode, sent.body).toBe(200);
      expect((await wren.get(`${base}/unpublished`)).json().drafts).toMatchObject([
        { path: SHADE, text: "# Shade\n\nWren's unsent.\n" },
      ]);
      expect((await t.get(`${base}/unpublished`)).json().drafts).toMatchObject([
        { id: legacy, text: "# Shade\n\nThe admin's.\n" },
      ]);
    });
  });

  // ---- Item 3: whose a draft from before people is --------------------------------------------

  describe("the first owner", () => {
    it("is an owner of the project: the admin only when the admin is one, else the earliest owner", async () => {
      const res = await t.post("/api/projects", {
        name: "Northwind",
        slug: "northwind",
        start: "empty",
      });
      expect(res.statusCode, res.body).toBe(201);
      const made = res.json() as { id: string };
      const owner = await addPerson(t, "Olive Owner", "olive@example.com");
      const early = new Date(Date.now() - 86_400_000).toISOString();
      await t.server.projects.update(made.id, (p) => ({
        ...p,
        members: [...p.members, { personId: owner.id, role: "owner" as const, addedAt: early }],
      }));
      // The admin is only a writer here now.
      await t.server.projects.setRole(made.id, (await t.server.people.all())[0]!.id, "writer");
      await t.server.registry.close(made.id);
      const record = (await t.server.projects.get(made.id))!;
      const folder = `${t.services.config.dataDir}/projects/${made.id}/state/drafts/oldoldoldold`;
      const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
      mkdirSync(folder, { recursive: true });
      writeFileSync(`${folder}/content`, "# Old\n");
      writeFileSync(
        `${folder}/record.json`,
        JSON.stringify({
          id: "oldoldoldold",
          revision: 1,
          path: "Old.md",
          kind: "create",
          baseBlob: "",
          lineEnding: "lf",
          binary: false,
          updatedAt: new Date().toISOString(),
          origins: [],
        }),
      );
      await t.server.registry.open(record);
      const stamped = JSON.parse(readFileSync(`${folder}/record.json`, "utf8"));
      expect(stamped.person).toBe(owner.id);
    });
  });

  // ---- Item 6: renames of other people --------------------------------------------------------

  describe("a rename that someone else saved", () => {
    const MIRRA = "02 People/Mirra.md";
    const MIRELA = "02 People/Mirela.md";
    const rename = async (c: Who, from: string, to: string) => {
      const res = await c.post(`${base}/renames`, { from, to });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().id as string;
    };

    it("moves another person's waiting rename of the same file to where it is now", async () => {
      const rexRename = await rename(rex, MIRA, MIRELA);
      const wrenRename = await rename(wren, MIRA, MIRRA);
      expect((await confirm(wren, (await plan(wren, [], [wrenRename])).planId)).statusCode).toBe(
        200,
      );
      expect(main(MIRRA)).not.toBeNull();
      // Rex's rename now starts from where the file is, and can be saved.
      const intents = (await rex.get(`${base}/unpublished`)).json().renames;
      expect(intents).toMatchObject([{ id: rexRename, from: MIRRA, to: MIRELA }]);
      const p = await plan(rex, [], [rexRename]);
      expect(p.conflicts).toEqual([]);
      expect((await confirm(rex, p.planId)).statusCode).toBe(200);
      expect(main(MIRELA)).not.toBeNull();
      expect(main(MIRRA)).toBeNull();
    });

    it("drops another person's rename that would end where the file already is", async () => {
      const rexRename = await rename(rex, MIRA, MIRRA);
      const wrenRename = await rename(wren, MIRA, MIRRA);
      expect((await confirm(wren, (await plan(wren, [], [wrenRename])).planId)).statusCode).toBe(
        200,
      );
      expect((await rex.get(`${base}/unpublished`)).json().renames).toEqual([]);
      expect(rexRename).toBeDefined();
    });

    it("never leaves a person with two drafts at one path: the other text is kept beside", async () => {
      const moved = await edit(rex, MIRA, "# Mira\n\nRex edits Mira.\n");
      const there = newId();
      expect(
        (
          await rex.put(`${base}/drafts`, {
            id: there,
            path: MIRRA,
            kind: "create",
            text: "# Mirra\n\nRex's other text.\n",
            revision: 0,
            baseBlob: "",
          })
        ).statusCode,
      ).toBe(200);
      const wrenRename = await rename(wren, MIRA, MIRRA);
      expect((await confirm(wren, (await plan(wren, [], [wrenRename])).planId)).statusCode).toBe(
        200,
      );
      const drafts = (await rex.get(`${base}/unpublished`)).json().drafts as {
        id: string;
        path: string;
        text: string;
      }[];
      expect(drafts.map((d) => d.path)).toEqual([MIRRA]);
      expect(drafts[0]).toMatchObject({ id: moved, text: "# Mira\n\nRex edits Mira.\n" });
      const versions = (await rex.get(`${base}/drafts/${moved}/versions`)).json();
      expect(versions.others.map((o: { text: string }) => o.text)).toEqual([
        "# Mirra\n\nRex's other text.\n",
      ]);
    });

    it("lets a repeated clearing of what was saved finish without an error", async () => {
      const wrenRename = await rename(wren, MIRA, MIRRA);
      t.repo.pushFromOutside({ [MIRRA]: main(MIRA)!, [MIRA]: null });
      const r = await t.services.git.fetch();
      t.services.index.build(r.current);
      const p = t.services.publisher;
      // Two clearings at once, as a poll and a webhook could: the second finds the first's work done.
      await expect(Promise.all([p.clearPublished(), p.clearPublished()])).resolves.toBeDefined();
      expect((await wren.get(`${base}/unpublished`)).json().renames).toEqual([]);
      expect(wrenRename).toBeDefined();
    });
  });

  // ---- Item 7: one sync at a time, and a limit on the network --------------------------------

  describe("fetching", () => {
    it("runs one sync at a time, and a call made during one gets a run that starts after it", async () => {
      const real = t.services.publisher.clearPublished.bind(t.services.publisher);
      let active = 0;
      let peak = 0;
      let runs = 0;
      t.services.publisher.clearPublished = async () => {
        runs++;
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 60));
        await real();
        active--;
      };
      try {
        await Promise.all([
          t.services.sync(),
          t.services.sync(),
          t.services.sync(),
          t.services.sync(),
        ]);
        expect(peak).toBe(1);
        // The first, and one that started after the other three asked: not four.
        expect(runs).toBe(2);
        // A failing run does not stop the next one.
        const failing = t.services.git.fetch.bind(t.services.git);
        let first = true;
        t.services.git.fetch = async () => {
          if (first) {
            first = false;
            throw new Error("network down");
          }
          return failing();
        };
        const results = await Promise.allSettled([t.services.sync(), t.services.sync()]);
        expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
        t.services.git.fetch = failing;
      } finally {
        t.services.publisher.clearPublished = real;
      }
    });

    it("stops a fetch that hangs, so it does not hold the lock for everyone", async () => {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { GitGateway } = await import("../src/git/gateway.js");
      const dir = mkdtempSync(join(tmpdir(), "frontier-hang-"));
      const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@x", ...args], { cwd: dir });
      git("init", "--initial-branch=main");
      git("commit", "--allow-empty", "-m", "start");
      git("remote", "add", "origin", "ssh://localhost/never");
      const before = process.env.GIT_SSH_COMMAND;
      // Every ssh connection of this process "hangs" for half a minute.
      process.env.GIT_SSH_COMMAND = "sleep 30 #";
      try {
        const gateway = new GitGateway({
          dir,
          remoteUrl: "ssh://localhost/never",
          author: { name: "A", email: "a@x" },
          committer: { name: "A", email: "a@x" },
          remoteTimeoutMs: 400,
        });
        const started = Date.now();
        await expect(gateway.fetch()).rejects.toMatchObject({
          code: "git_failed",
          message: expect.stringContaining("took longer than"),
        });
        await expect(gateway.push("0".repeat(40))).rejects.toMatchObject({ code: "git_failed" });
        expect(Date.now() - started).toBeLessThan(10_000);
        // The lock is free again: a read is answered at once.
        expect(await gateway.head()).toMatch(/^[0-9a-f]{40}$/);
        await expect(gateway.deleteProposalBranch("proposal/x")).rejects.toMatchObject({
          code: "git_failed",
        });
      } finally {
        if (before === undefined) delete process.env.GIT_SSH_COMMAND;
        else process.env.GIT_SSH_COMMAND = before;
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ---- Item 11: no one can write another's address -----------------------------------------

  describe("the stand-in address", () => {
    it("is refused as an account email in every form, in any letter case and below the domain", () => {
      for (const email of [
        `x@${STAND_IN_DOMAIN}`,
        `X@${STAND_IN_DOMAIN.toUpperCase()}`,
        `x@sub.${STAND_IN_DOMAIN}`,
        ` x@${STAND_IN_DOMAIN} `,
      ]) {
        expect(isStandInAddress(email), email).toBe(true);
        expect(ProfileRequest.safeParse({ name: "N", email }).success, email).toBe(false);
        expect(
          JoinPasswordRequest.safeParse({ name: "N", email, password: "x".repeat(12) }).success,
          email,
        ).toBe(false);
      }
      expect(isStandInAddress(`x@${STAND_IN_DOMAIN}.example.com`)).toBe(false);
      expect(isStandInAddress("wren@example.com")).toBe(false);
      expect(ProfileRequest.safeParse({ name: "N", email: "wren@example.com" }).success).toBe(true);
    });

    it("cannot be taken as one's own address, so a writer cannot save as another member", async () => {
      // The attack: Wren gives her account Rex's stand-in address, then saves.
      const quiet = await addPerson(t, "Quinn Quiet", "quinn@example.com");
      await addMember(t, projectId, quiet.id, "writer");
      await t.server.people.update(quiet.id, (p) => ({ ...p, email: "" }));
      for (const victim of [rex.id, quiet.id]) {
        for (const email of [
          `${victim}@${STAND_IN_DOMAIN}`,
          `${victim}@${STAND_IN_DOMAIN.toUpperCase()}`,
        ]) {
          const res = await wren.put("/api/me", { name: "Wren Writer", email });
          expect(res.statusCode, email).toBe(400);
        }
      }
      // And the store refuses it whatever way the address arrives (setup, a linked account).
      await expect(
        t.server.people.update(wren.id, (p) => ({ ...p, email: `${rex.id}@${STAND_IN_DOMAIN}` })),
      ).rejects.toMatchObject({ code: "invalid" });

      // Both effects hold: the save is Wren's, and Rex is told someone else saved first.
      const w = await edit(wren, MIRA, "# Mira\n\nWren's version.\n");
      const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
      expect((await confirm(wren, (await plan(wren, [w])).planId)).statusCode).toBe(200);
      expect((await history(rex)).versions[0]!.by).toEqual({ id: wren.id, name: "Wren Writer" });
      const p = await plan(rex, [r]);
      expect(p.conflicts[0]).toMatchObject({ reason: "saved_by_other", theirsBy: { id: wren.id } });
    });

    it("names a person only when that person has no email of their own", async () => {
      // A version pushed from outside under Rex's stand-in, though Rex has an email: it is not Rex's.
      t.repo.pushFromOutside({ [MIRA]: "# Mira\n\nForged.\n" }, "Forged", {
        name: "Mallory",
        email: `${rex.id}@${STAND_IN_DOMAIN}`,
      });
      await t.services.sync();
      expect((await history(wren)).versions[0]!.by).toEqual({ id: null, name: "Mallory" });
      // The check that decides who saved a version does not credit Rex either: Rex's change merges
      // as it would with any outside push, and nothing is attributed to him.
      const r = await edit(rex, SHADE, "# Shade\n\nRex.\n");
      expect((await compare(rex, r)).outcome).toBe("ready");

      // A person with no email is found by their stand-in, as before.
      const quiet = await addPerson(t, "Quinn Quiet", "quinn@example.com");
      await addMember(t, projectId, quiet.id, "writer");
      await t.server.people.update(quiet.id, (p) => ({ ...p, email: "" }));
      t.repo.pushFromOutside({ [SHADE]: "# Shade\n\nQ.\n" }, "Q", {
        name: "Whoever",
        email: `${quiet.id}@${STAND_IN_DOMAIN}`,
      });
      await t.services.sync();
      expect((await history(wren)).versions[0]!.by).toEqual({ id: quiet.id, name: "Quinn Quiet" });
    });

    it("finds only people who are or were members of this project", async () => {
      const stranger = await addPerson(t, "Sam Stranger", "sam@example.com");
      t.repo.pushFromOutside({ [MIRA]: "# Mira\n\nBy a stranger.\n" }, "By Sam", {
        name: "Sam on GitHub",
        email: "sam@example.com",
      });
      await t.services.sync();
      // An account that is not in this project is not credited here: Git's own name is shown.
      expect((await history(wren)).versions[0]!.by).toEqual({ id: null, name: "Sam on GitHub" });
      // Once they are a member their versions are theirs, and still are after they leave.
      await addMember(t, projectId, stranger.id, "writer");
      expect((await history(wren)).versions[0]!.by).toEqual({
        id: stranger.id,
        name: "Sam Stranger",
      });
      await t.server.projects.removeMember(projectId, stranger.id);
      expect((await history(wren)).versions[0]!.by).toEqual({
        id: stranger.id,
        name: "Sam Stranger",
      });
    });
  });

  // ---- Item 9: a known person is never authored as someone else ---------------------------

  describe("authors", () => {
    it("authors a known person with neither name nor email by their stand-in, not the configured author", async () => {
      await t.server.people.update(wren.id, (p) => ({ ...p, name: "", email: "" }));
      const w = await edit(wren, MIRA, "# Mira\n\nNameless.\n");
      expect((await confirm(wren, (await plan(wren, [w])).planId)).statusCode).toBe(200);
      expect(lastAuthor()).toBe(`Someone <${wren.id}@${STAND_IN_DOMAIN}>`);
      expect((await history(rex)).versions[0]!.by).toEqual({ id: wren.id, name: "Someone" });
    });
  });

  // ---- Item 14: a control character in an author's name -------------------------------------

  describe("the history log", () => {
    it("reads an author name and subject holding control characters, and paths, as they are", async () => {
      t.repo.pushFromOutside(
        { [MIRA]: "# Mira\n\nOdd.\n", [SHADE]: "# Shade\n\nOdd.\n" },
        "Odd\u0001 sub\u0002ject",
        {
          name: "Ev\u0001il\u0002 Name",
          email: "ev\u0001@example.org",
        },
      );
      await t.services.sync();
      const v = (await t.services.git.history())[0]!;
      expect(v.author).toEqual({ name: "Ev\u0001il\u0002 Name", email: "ev\u0001@example.org" });
      expect(v.message).toBe("Odd\u0001 sub\u0002ject");
      expect(v.paths.sort()).toEqual([MIRA, SHADE]);
      const next = (await t.services.git.history())[1]!;
      expect(next.author.name).toBe("Seed");
      expect(await t.services.git.lastChange(MIRA)).toMatchObject({
        author: { name: "Ev\u0001il\u0002 Name" },
      });
      expect((await t.services.git.lastVersion())!.by).toBe("Ev\u0001il\u0002 Name");
    });

    it("parses records with empty fields and commits that name no path", () => {
      const out = "\0h1\0t1\0\0a@b\0\na.md\0b.md\0\0h2\0t2\0n\0e\0\0h3\0t3\0n3\0e3\0\nc.md\0";
      expect(parseLogZ(out, 4)).toEqual([
        { fields: ["h1", "t1", "", "a@b"], rest: ["a.md", "b.md"] },
        { fields: ["h2", "t2", "n", "e"], rest: [] },
        { fields: ["h3", "t3", "n3", "e3"], rest: ["c.md"] },
      ]);
      expect(parseLogZ("", 4)).toEqual([]);
      expect(parseLogZ("\0h\0only-two", 4)).toEqual([]);
    });
  });
});

// ---- Items 10, 12, 13: presence and the status stream -------------------------------------------

describe("the stage 27d review: presence and the status stream", () => {
  let t: TestApp;
  let base: string;
  let wren: Client;
  let rex: Client;
  let reed: Client;
  const MIRA = "02 People/Mira.md";
  const SHADE = "02 People/Shade.md";

  beforeEach(async () => {
    t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" });
    await t.login();
    const first = (await t.server.projects.all())[0]!;
    base = `/api/p/${first.slug}`;
    wren = await addPerson(t, "Wren Writer", "wren@example.com");
    rex = await addPerson(t, "Rex Writer", "rex@example.com");
    reed = await addPerson(t, "Reed Reader", "reed@example.com");
    await addMember(t, first.id, wren.id, "writer");
    await addMember(t, first.id, rex.id, "writer");
    await addMember(t, first.id, reed.id, "reader");
  });
  afterEach(() => t.close());

  const status = async (c: { get: Client["get"] }) =>
    (await c.get(`${base}/status`)).json() as StatusSnapshot;

  /** A status stream of a person (optionally for a named tab), with what it has been sent. */
  async function stream(who: Client, client?: string) {
    const address = await t.app
      .listen({ port: 0, host: "127.0.0.1" })
      .catch(() => `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`);
    const query = client ? `?client=${client}` : "";
    const res = await fetch(`${address}${base}/status/events${query}`, {
      headers: { cookie: who.cookie },
    });
    const reader = res.body!.getReader();
    let buffer = "";
    const seen: StatusSnapshot[] = [];
    // One read is outstanding at a time: a read that lost a race to the clock must not swallow the next chunk.
    let pending: Promise<{ done: boolean; value?: Uint8Array }> | null = null;
    const pump = async (ms: number, until?: () => boolean) => {
      const stop = Date.now() + ms;
      while (Date.now() < stop && !(until?.() ?? false)) {
        pending ??= reader.read();
        const got = await Promise.race([
          pending,
          new Promise<null>((r) => setTimeout(() => r(null), 50)),
        ]);
        if (got === null) continue;
        pending = null;
        if (got.done) return;
        buffer += new TextDecoder().decode(got.value);
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          const line = buffer
            .slice(0, end)
            .split("\n")
            .find((l) => l.startsWith("data: "));
          buffer = buffer.slice(end + 2);
          if (line) seen.push(JSON.parse(line.slice(6)) as StatusSnapshot);
        }
      }
    };
    return {
      seen,
      pump,
      close: () => reader.cancel().catch(() => undefined),
    };
  }

  describe("a person's other tabs", () => {
    const ids = () => {
      const p = new Presence({
        roleOf: () => "writer",
        nameOf: (id) => id,
        onChange: () => undefined,
      });
      return p;
    };

    it("stay announced when one tab's stream ends; only that tab's announcement goes", () => {
      const p = ids();
      p.streamOpened("ann", "t1");
      p.streamOpened("ann", "t2");
      p.announce("ann", "t1", "A.md");
      p.announce("ann", "t2", "B.md");
      p.streamClosed("ann", "t1");
      expect(p.readingFor("bob").map((r) => r.path)).toEqual(["B.md"]);
      // A second stream of the same tab keeps its announcement until it ends too.
      p.streamOpened("ann", "t2");
      p.streamClosed("ann", "t2");
      expect(p.readingFor("bob").map((r) => r.path)).toEqual(["B.md"]);
      p.streamClosed("ann", "t2");
      expect(p.readingFor("bob")).toEqual([]);
      p.close();
    });

    it("go with a stream that names no tab only when it was the person's last stream", () => {
      const p = ids();
      p.streamOpened("ann", "t1");
      p.streamOpened("ann");
      p.announce("ann", "t1", "A.md");
      p.announce("ann", undefined, "B.md");
      p.streamClosed("ann");
      // The unnamed tab's announcement goes; the named tab, which has its own stream, keeps its own.
      expect(p.readingFor("bob").map((r) => r.path)).toEqual(["A.md"]);
      p.streamOpened("ann");
      p.streamClosed("ann", "t1");
      p.streamClosed("ann");
      expect(p.readingFor("bob")).toEqual([]);
      // An unnamed last stream clears whatever the person announced, as before.
      p.streamOpened("cat");
      p.announce("cat", "x", "A.md");
      p.streamClosed("cat");
      expect(p.readingFor("bob")).toEqual([]);
      p.close();
    });

    it("are told through the real stream: closing one tab's stream leaves the other's reading", async () => {
      const rexStream = await stream(rex);
      const tab1 = await stream(wren, "tab1");
      const tab2 = await stream(wren, "tab2");
      await wren.put(`${base}/presence`, { path: MIRA, client: "tab1" });
      await wren.put(`${base}/presence`, { path: SHADE, client: "tab2" });
      await rexStream.pump(300);
      expect(
        rexStream.seen
          .at(-1)!
          .presence!.map((r) => r.path)
          .sort(),
      ).toEqual([MIRA, SHADE]);
      await tab1.close();
      const paths = () => rexStream.seen.at(-1)!.presence!.map((r) => r.path);
      await rexStream.pump(5000, () => paths().length === 1);
      expect(paths()).toEqual([SHADE]);
      await tab2.close();
      await rexStream.pump(5000, () => paths().length === 0);
      expect(paths()).toEqual([]);
      await rexStream.close();
    });
  });

  describe("the leave beacon", () => {
    it("reads a body sent as text/plain as JSON, and one sent as JSON", async () => {
      const announce = (client: string) => wren.put(`${base}/presence`, { path: MIRA, client });
      await announce("tab1");
      await announce("tab2");
      expect((await status(rex)).presence).toHaveLength(1);
      const beacon = (payload: string, type: string) =>
        t.app.inject({
          method: "POST",
          url: `${base}/presence/leave`,
          headers: { cookie: wren.cookie, "content-type": type },
          payload,
        });
      // sendBeacon with a string: text/plain, whatever the page meant.
      const plain = await beacon(JSON.stringify({ client: "tab1" }), "text/plain;charset=UTF-8");
      expect(plain.statusCode, plain.body).toBe(200);
      // One client left, the person's other tab is still reading (rows are per person and entry,
      // so look at the person's clients through what is told).
      await t.services.presence.announce(wren.id, "tab1", null);
      expect(t.services.presence.size()).toBe(1);
      const json = await beacon(JSON.stringify({ client: "tab2" }), "application/json");
      expect(json.statusCode).toBe(200);
      expect(t.services.presence.size()).toBe(0);
      // Text that is not JSON leaves nobody's announcement but the unnamed one.
      await announce("tab3");
      expect((await beacon("not json", "text/plain")).statusCode).toBe(200);
      expect(t.services.presence.size()).toBe(1);
    });
  });

  describe("what is announced", () => {
    it("is only a published entry: an unsaved new entry or a made-up path announces nothing", async () => {
      const put = (c: Client, path: string | null, client = "tab1") =>
        c.put(`${base}/presence`, { path, client });
      // Wren reads her own unsaved new entry.
      const made = await wren.put(`${base}/drafts`, {
        id: "newentry0001",
        path: "02 People/Brand New.md",
        kind: "create",
        text: "# Brand New\n",
        revision: 0,
        baseBlob: "",
      });
      expect(made.statusCode).toBe(200);
      expect((await put(wren, "02 People/Brand New.md")).statusCode).toBe(200);
      expect((await put(wren, "Not/There.md")).statusCode).toBe(200);
      expect((await status(rex)).presence).toEqual([]);
      expect(t.services.presence.size()).toBe(0);
      // A published entry is announced; moving on to an unsaved one takes it back.
      await put(wren, MIRA);
      expect((await status(rex)).presence!.map((r) => r.path)).toEqual([MIRA]);
      await put(wren, "02 People/Brand New.md");
      expect((await status(rex)).presence).toEqual([]);
      // A reader's announcements are held to the same.
      await put(reed, "Not/There.md");
      await put(reed, SHADE);
      expect((await status(rex)).presence!.map((r) => r.path)).toEqual([SHADE]);
    });
  });

  describe("what a stream says", () => {
    it("is not repeated: a reader's stream shows nothing of a writer's saves it may not know", async () => {
      const readerStream = await stream(reed);
      const writerStream = await stream(rex);
      await readerStream.pump(300);
      await writerStream.pump(100);
      const before = readerStream.seen.length;
      expect(before).toBeGreaterThan(0);
      // Wren saves a draft three times: each tells her own stream and Rex's, not the reader's.
      for (let revision = 0; revision < 3; revision++) {
        const res = await wren.put(`${base}/drafts`, {
          id: "wrendraft001",
          path: MIRA,
          kind: "edit",
          text: `# Mira\n\nVersion ${revision}.\n`,
          revision,
          baseBlob: (
            (await wren.get(`${base}/entries?path=${encodeURIComponent(MIRA)}`)).json() as {
              blob: string;
            }
          ).blob,
        });
        expect(res.statusCode, res.body).toBe(200);
      }
      await readerStream.pump(400);
      await writerStream.pump(400);
      expect(readerStream.seen.length).toBe(before);
      // The writer's own, and another writer's (who is told of Wren's unsaved changes), do change.
      expect(writerStream.seen.length).toBeGreaterThan(1);
      await readerStream.close();
      await writerStream.close();
    });
  });
});

// ---- Items 15 and 16: what is worked out once --------------------------------------------------

describe("the stage 27d review: the library index and the status are worked out once", () => {
  it("answers hasFile from a set, and follows `files` when it is replaced", () => {
    const index = new VaultIndex("/nowhere");
    index.files = ["a.md", "b/c.md"];
    expect(index.hasFile("a.md")).toBe(true);
    expect(index.hasFile("b")).toBe(false);
    index.files = ["z.md"];
    expect(index.hasFile("a.md")).toBe(false);
    expect(index.hasFile("z.md")).toBe(true);
  });

  it("keeps what it found for attention until the index is built again", () => {
    const index = new VaultIndex("/nowhere");
    const first = index.attention();
    expect(index.attention()).toBe(first);
    index.generation++;
    expect(index.attention()).not.toBe(first);
  });

  describe("the status service", () => {
    const make = () => {
      const index = new VaultIndex("/nowhere");
      let attention = 0;
      const real = index.attention.bind(index);
      index.attention = () => {
        attention++;
        return real();
      };
      let people = 0;
      let version = "v1";
      const status = new StatusService(index, {
        library: "own",
        backupOutside: false,
        person: () => {
          people++;
          return {
            unpublished: 0,
            conflicts: 0,
            drafts: 0,
            serverDraftChanges: 0,
            keptCopies: 0,
            othersUnsaved: [],
          };
        },
        presence: () => [],
        personVersion: () => version,
      });
      return {
        status,
        calls: () => ({ attention, people }),
        change: (v: string) => (version = v),
      };
    };

    it("makes the shared part once for every tab, and again only after a change", () => {
      const { status, calls } = make();
      for (let i = 0; i < 40; i++) status.snapshotFor(`p${i % 10}`);
      // The shared part once; each of ten people's part once, however many tabs they have.
      expect(calls()).toEqual({ attention: 1, people: 10 });
      status.drafts(1, 0);
      status.snapshotFor("p1");
      expect(calls().attention).toBe(2);
      expect(calls().people).toBe(10);
    });

    it("makes a person's part again only when what it is made of changed, and not for who is reading", () => {
      const { status, calls, change } = make();
      const seen: StatusSnapshot[] = [];
      for (let i = 0; i < 5; i++) status.subscribe((s) => seen.push(s));
      status.snapshotFor("p1");
      for (let i = 0; i < 20; i++) status.presenceChanged();
      status.snapshotFor("p1");
      // Twenty presence changes told twenty listeners, and worked out nothing again.
      expect(seen).toHaveLength(100);
      expect(calls()).toEqual({ attention: 1, people: 1 });
      change("v2");
      status.snapshotFor("p1");
      expect(calls().people).toBe(2);
    });
  });

  describe("the version of each entry", () => {
    let t: TestApp;
    beforeEach(async () => {
      t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" });
      await t.login();
    });
    afterEach(() => t.close());

    // The passes over the log that make the map of every file's last version.
    const logs = () =>
      t.gitCommands.filter(
        (a) =>
          a[0] === "log" &&
          a.includes("--name-only") &&
          a.includes("--format=%x00%H%x00%cI%x00%an%x00%ae"),
      ).length;

    it("is read without a Git command for each read of an entry", async () => {
      const base = `/api/p/${(await t.server.projects.all())[0]!.slug}`;
      const read = async (path: string) => {
        const res = await t.get(`${base}/entries?path=${encodeURIComponent(path)}`);
        expect(res.statusCode, res.body).toBe(200);
        return res.json().lastVersion as { commit: string; by: { name: string } } | null;
      };
      await read(MIRA);
      const afterFirst = logs();
      for (let i = 0; i < 20; i++) await read(i % 2 === 0 ? MIRA : SHADE);
      expect(logs()).toBe(afterFirst);
      // A new version is picked up by reading the commits since, not the whole log.
      const head = t.repo.pushFromOutside({ [MIRA]: "# Mira\n\nNew.\n" }, "New Mira");
      await t.services.sync();
      expect((await read(MIRA))!.commit).toBe(head);
      expect(logs()).toBe(afterFirst + 1);
      expect(t.gitCommands.some((a) => a.join(" ").includes(`..${head}`))).toBe(true);
    });

    it("agrees with the log for every kind of path: touched, deleted, never touched, and an older commit", async () => {
      const git = t.services.git;
      t.repo.pushFromOutside({ [SHADE]: null }, "Delete Shade");
      t.repo.pushFromOutside({ [MIRA]: "# Mira\n\nTwice.\n" }, "Mira again");
      await t.services.sync();
      const head = t.services.index.commit!;
      for (const path of [MIRA, SHADE, "03 Things/Plain.md", "Nothing/Never.md"]) {
        expect(await git.lastChangeAt(path, head), path).toEqual(await git.lastChange(path));
      }
      // A commit that is not after the one the map was made for gets the map of its own.
      const older = (await git.history())[1]!.commit;
      expect((await git.lastChangeAt(MIRA, older))!.commit).not.toBe(head);
      expect((await git.lastChangeAt(SHADE, older))!.commit).toBe(
        (await git.lastChangeAt(SHADE, head))!.commit,
      );
      // And back to the library's own commit.
      expect((await git.lastChangeAt(MIRA, head))!.commit).toBe(head);
    });
  });
});
