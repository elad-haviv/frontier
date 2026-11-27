/**
 * Stage 27d: saved versions that several people make. Who made each version, what a person sees
 * when someone else saved an entry first (decision C), two people saving at once, and renames and
 * deletes that meet another person's unsaved changes. Each is run on an own library and on a
 * library kept on GitHub (a local bare repository stands in for it).
 */
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DraftCompareResponse,
  type HistoryResponse,
  type PublishPlan,
  type UnpublishedResponse,
} from "@frontier/schema";
import { authorOf, STAND_IN_DOMAIN } from "../src/auth/session.js";
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

describe.each(["own", "github"] as const)(
  "saved versions by several people (%s library)",
  (mode) => {
    let t: TestApp;
    let base: string;
    let wren: Client;
    let rex: Client;
    let n = 0;
    const newId = () => `shared${String(++n).padStart(6, "0")}`;

    beforeEach(async () => {
      t = await makeTestApp({
        LOGIN_ATTEMPTS: "1000",
        ...(mode === "github" ? { VAULT_REPO: "someone/frontier-test" } : {}),
      });
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
    const lastAuthor = () =>
      execFileSync("git", ["log", "-1", "--format=%an <%ae>", "refs/heads/main"], {
        cwd: t.repo.remote,
        encoding: "utf8",
      }).trim();

    it("runs in the mode it says", async () => {
      expect((await t.get(`${base}/status`)).json().library).toBe(
        mode === "github" ? "github" : "own",
      );
    });

    describe("authors on versions", () => {
      it("makes each version by the person who saved it, and says so in the history without an email", async () => {
        const w = await edit(wren, MIRA, "# Mira\n\nWren was here.\n");
        expect((await confirm(wren, (await plan(wren, [w])).planId)).statusCode).toBe(200);
        expect(lastAuthor()).toBe("Wren Writer <wren@example.com>");
        const r = await edit(rex, SHADE, "# Shade\n\nRex was here.\n");
        expect((await confirm(rex, (await plan(rex, [r])).planId)).statusCode).toBe(200);
        expect(lastAuthor()).toBe("Rex Writer <rex@example.com>");

        for (const who of [wren, rex, t]) {
          const res = await who.get(`${base}/history`);
          const history = res.json() as HistoryResponse;
          expect(history.versions[0]!.by).toEqual({ id: rex.id, name: "Rex Writer" });
          expect(history.versions[1]!.by).toEqual({ id: wren.id, name: "Wren Writer" });
          // An older version keeps whatever Git says, and has no person to point at.
          expect(history.versions.at(-1)!.by).toEqual({ id: null, name: "Seed" });
          expect(res.body).not.toContain("example.com");
        }
        const one = (
          await wren.get(`${base}/history?path=${encodeURIComponent(MIRA)}`)
        ).json() as HistoryResponse;
        expect(one.versions[0]!.by.name).toBe("Wren Writer");
      });

      it("shows a person's name as it is now, and never an email", async () => {
        const w = await edit(wren, MIRA, "# Mira\n\nWren was here.\n");
        await confirm(wren, (await plan(wren, [w])).planId);
        await t.server.people.update(wren.id, (p) => ({ ...p, name: "Wren Renamed" }));
        const history = (await rex.get(`${base}/history`)).json() as HistoryResponse;
        expect(history.versions[0]!.by).toEqual({ id: wren.id, name: "Wren Renamed" });
        // No name: the person is "Someone", never their email, though Git has the part before the "@".
        await t.server.people.update(wren.id, (p) => ({ ...p, name: "" }));
        const nameless = (await rex.get(`${base}/history`)).json() as HistoryResponse;
        expect(nameless.versions[0]!.by).toEqual({ id: wren.id, name: "Someone" });
        expect(JSON.stringify(nameless)).not.toContain("wren@example.com");
      });

      it("gives a person with no email a stand-in that is traced back to them", async () => {
        const quiet = await addPerson(t, "Quinn Quiet", "quinn@example.com");
        await addMember(t, (await t.server.projects.all())[0]!.id, quiet.id, "writer");
        await t.server.people.update(quiet.id, (p) => ({ ...p, email: "" }));
        const q = await edit(quiet, MIRA, "# Mira\n\nQuinn was here.\n");
        expect((await confirm(quiet, (await plan(quiet, [q])).planId)).statusCode).toBe(200);
        expect(lastAuthor()).toBe(`Quinn Quiet <${quiet.id}@${STAND_IN_DOMAIN}>`);
        const history = (await rex.get(`${base}/history`)).json() as HistoryResponse;
        expect(history.versions[0]!.by).toEqual({ id: quiet.id, name: "Quinn Quiet" });
        expect(JSON.stringify(history)).not.toContain(STAND_IN_DOMAIN);
      });

      it("says who made the last version of an entry on the entry", async () => {
        expect((await entry(rex, MIRA)).lastVersion.by).toEqual({ id: null, name: "Seed" });
        const w = await edit(wren, MIRA, "# Mira\n\nWren was here.\n");
        await confirm(wren, (await plan(wren, [w])).planId);
        const e = await entry(rex, MIRA);
        expect(e.lastVersion.by).toEqual({ id: wren.id, name: "Wren Writer" });
        expect(e.lastVersion.commit).toBe(t.repo.remoteHead());
      });

      it("names the author from the account, with a stand-in for what is missing", () => {
        const configured = { name: "The Author", email: "author@example.com" };
        const person = { id: "p1", name: "", email: "" } as never;
        // Only work with no person at all is by the configured author.
        expect(authorOf(null, configured)).toEqual(configured);
        expect(authorOf(person, configured)).toEqual({
          name: "Someone",
          email: `p1@${STAND_IN_DOMAIN}`,
        });
        expect(authorOf({ id: "p1", name: "Ann", email: "" } as never, configured)).toEqual({
          name: "Ann",
          email: `p1@${STAND_IN_DOMAIN}`,
        });
        expect(authorOf({ id: "p1", name: "", email: "ann@x.org" } as never, configured)).toEqual({
          name: "ann",
          email: "ann@x.org",
        });
      });
    });

    describe("saving an entry someone else saved first (decision C)", () => {
      it("refuses the second save of the entry with the compare data, who and when, and saves the rest", async () => {
        const original = main(MIRA)!;
        const w = await edit(wren, MIRA, "# Mira\n\nWren's version.\n");
        const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
        const rs = await edit(rex, SHADE, "# Shade\n\nRex also changed Shade.\n");
        expect((await confirm(wren, (await plan(wren, [w])).planId)).statusCode).toBe(200);

        const p = await plan(rex, [r, rs]);
        expect(p.ready).toEqual([rs]);
        expect(p.merges).toEqual([]);
        expect(p.conflicts).toHaveLength(1);
        const c = p.conflicts[0]!;
        expect(c).toMatchObject({
          draftId: r,
          path: MIRA,
          reason: "saved_by_other",
          mine: "# Mira\n\nRex's version.\n",
          theirs: "# Mira\n\nWren's version.\n",
          base: original.replace(/\r\n/g, "\n"),
          theirsBy: { id: wren.id, name: "Wren Writer" },
        });
        expect(Date.now() - Date.parse(c.theirsAt!)).toBeLessThan(60_000);

        // The rest of the save goes through; the entry stays Rex's unsaved change.
        const done = await confirm(rex, p.planId);
        expect(done.statusCode, done.body).toBe(200);
        expect(done.json().conflicts).toEqual([]);
        expect(main(SHADE)).toContain("Rex also changed Shade.");
        expect(main(MIRA)).toBe("# Mira\n\nWren's version.\n");
        expect(
          ((await rex.get(`${base}/unpublished`)).json() as UnpublishedResponse).drafts.map(
            (d) => d.id,
          ),
        ).toEqual([r]);
      });

      it("compares even when the two changes would merge cleanly: whoever saves second always sees it", async () => {
        const text = (await entry(rex, MIRA)).text as string;
        const w = await edit(wren, MIRA, `${text}\nWren's last line.\n`);
        const r = await edit(rex, MIRA, text.replace("# Mira", "# Mira the Elder"));
        await confirm(wren, (await plan(wren, [w])).planId);
        const p = await plan(rex, [r]);
        expect(p.merges).toEqual([]);
        expect(p.conflicts[0]).toMatchObject({
          reason: "saved_by_other",
          theirsBy: { id: wren.id },
        });
      });

      it("gives the same compare data for one change without a plan", async () => {
        const w = await edit(wren, MIRA, "# Mira\n\nWren's version.\n");
        const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
        const before = (
          await rex.get(`${base}/drafts/${r}/compare`)
        ).json() as DraftCompareResponse;
        expect(before).toMatchObject({ draftId: r, path: MIRA, outcome: "ready" });
        await confirm(wren, (await plan(wren, [w])).planId);
        const after = (await rex.get(`${base}/drafts/${r}/compare`)).json() as DraftCompareResponse;
        expect(after.outcome).toBe("conflict");
        expect(after.conflict).toMatchObject({
          reason: "saved_by_other",
          theirs: "# Mira\n\nWren's version.\n",
          theirsBy: { id: wren.id, name: "Wren Writer" },
        });
        // Nobody else can ask about it, and a reader or a missing draft answers not found or role.
        expect((await wren.get(`${base}/drafts/${r}/compare`)).statusCode).toBe(404);
        expect((await rex.get(`${base}/drafts/nothere00000/compare`)).statusCode).toBe(404);
      });

      it("keeps mine, keeps theirs or a merged text, each saved as the person who resolved it", async () => {
        const w = await edit(wren, MIRA, "# Mira\n\nWren's version.\n");
        const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
        await confirm(wren, (await plan(wren, [w])).planId);

        // Keep mine: the text is rebuilt on theirs and saved as Rex (the compare screen came first).
        await rex.get(`${base}/drafts/${r}/compare`);
        let res = await rex.post(`${base}/drafts/${r}/resolve`, {
          text: "# Mira\n\nRex's version.\n",
        });
        expect(res.statusCode, res.body).toBe(200);
        let p = await plan(rex, [r]);
        expect(p.ready).toEqual([r]);
        expect((await confirm(rex, p.planId, [], "Keep mine")).statusCode).toBe(200);
        expect(main(MIRA)).toBe("# Mira\n\nRex's version.\n");
        expect(lastAuthor()).toBe("Rex Writer <rex@example.com>");

        // A merged text, as Wren this time.
        const w2 = await edit(wren, MIRA, "# Mira\n\nWren again.\n", newId());
        const r2 = await edit(rex, MIRA, "# Mira\n\nRex again.\n", newId());
        await confirm(rex, (await plan(rex, [r2])).planId);
        // The compare screen has been looked at (the web app asks for it before it offers a choice).
        await wren.get(`${base}/drafts/${w2}/compare`);
        res = await wren.post(`${base}/drafts/${w2}/resolve`, { text: "# Mira\n\nBoth of us.\n" });
        expect(res.statusCode).toBe(200);
        p = await plan(wren, [w2]);
        expect((await confirm(wren, p.planId, [], "Merged")).statusCode).toBe(200);
        expect(main(MIRA)).toBe("# Mira\n\nBoth of us.\n");
        expect(lastAuthor()).toBe("Wren Writer <wren@example.com>");

        // Keep theirs: nothing is left to save, and nothing is saved.
        const head = t.repo.remoteHead();
        const w3 = await edit(wren, MIRA, "# Mira\n\nWren third.\n", newId());
        const r3 = await edit(rex, MIRA, "# Mira\n\nRex third.\n", newId());
        await confirm(rex, (await plan(rex, [r3])).planId);
        const headAfterRex = t.repo.remoteHead();
        expect(headAfterRex).not.toBe(head);
        await wren.get(`${base}/drafts/${w3}/compare`);
        await wren.post(`${base}/drafts/${w3}/resolve`, { text: "# Mira\n\nRex third.\n" });
        p = await plan(wren, [w3]);
        expect(p).toMatchObject({ ready: [], merges: [], conflicts: [] });
        expect(t.repo.remoteHead()).toBe(headAfterRex);
      });

      it("still merges what this person changed on another device, and what came from outside", async () => {
        const text = (await entry(wren, MIRA)).text as string;
        const mine = await edit(wren, MIRA, `${text}\nWren's own line.\n`);
        t.repo.pushFromOutside({ [MIRA]: text.replace("# Mira", "# Mira (outside)") });
        const p = await plan(wren, [mine]);
        expect(p.conflicts).toEqual([]);
        expect(p.merges).toHaveLength(1);
        expect(p.merges[0]!.theirsBy).toEqual({ id: null, name: "Seed" });
      });

      it("refuses an entry that was saved by someone else between the plan and the save, and saves the others", async () => {
        const w = await edit(wren, MIRA, "# Mira\n\nWren's version.\n");
        const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
        const rs = await edit(rex, SHADE, "# Shade\n\nRex also changed Shade.\n");
        const p = await plan(rex, [r, rs]);
        expect(p.ready).toEqual([r, rs]);
        const wp = await plan(wren, [w]);
        expect((await confirm(wren, wp.planId)).statusCode).toBe(200);

        const done = await confirm(rex, p.planId);
        expect(done.statusCode, done.body).toBe(200);
        expect(done.json().conflicts).toHaveLength(1);
        expect(done.json().conflicts[0]).toMatchObject({
          draftId: r,
          path: MIRA,
          reason: "saved_by_other",
          theirs: "# Mira\n\nWren's version.\n",
          theirsBy: { id: wren.id, name: "Wren Writer" },
        });
        expect(main(SHADE)).toContain("Rex also changed Shade.");
        expect(main(MIRA)).toBe("# Mira\n\nWren's version.\n");
      });

      it("refuses the whole save, with a name in the words, when every entry in it was saved over", async () => {
        const w = await edit(wren, MIRA, "# Mira\n\nWren's version.\n");
        const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
        const p = await plan(rex, [r]);
        await confirm(wren, (await plan(wren, [w])).planId);
        const done = await confirm(rex, p.planId);
        expect(done.statusCode).toBe(409);
        expect(done.json().error.code).toBe("saved_by_other");
        expect(done.json().error.message).toContain("Wren Writer");
        expect(done.json().error.message).toContain(MIRA);
        expect(main(MIRA)).toBe("# Mira\n\nWren's version.\n");
        // The plan is spent; a new one compares.
        expect((await confirm(rex, p.planId)).json().error.code).toBe("plan_expired");
        expect((await plan(rex, [r])).conflicts).toHaveLength(1);
      });

      it("still refuses a save whose main was moved from outside, as before", async () => {
        const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
        const p = await plan(rex, [r]);
        t.repo.pushFromOutside({ [SHADE]: "# Shade\n\nOutside.\n" });
        const done = await confirm(rex, p.planId);
        expect(done.statusCode).toBe(409);
        expect(done.json().error.code).toBe("main_moved");
      });

      it("lets a plan be confirmed only by the person who made it", async () => {
        const r = await edit(rex, MIRA, "# Mira\n\nRex's version.\n");
        const p = await plan(rex, [r]);
        const stolen = await confirm(wren, p.planId);
        expect(stolen.statusCode).toBe(410);
        expect(stolen.json().error.code).toBe("plan_expired");
        expect(main(MIRA)).not.toContain("Rex's version");
        // It was not spent by the attempt: its owner still saves it.
        expect((await confirm(rex, p.planId)).statusCode).toBe(200);
        // And another person's draft ids in a plan are not theirs to plan.
        const other = await plan(wren, [r]);
        expect(other).toMatchObject({ ready: [], merges: [], conflicts: [] });
      });
    });

    describe("two people saving at once", () => {
      it("lets both succeed when they saved different entries, however they interleave", async () => {
        for (let round = 0; round < 3; round++) {
          const a = await edit(wren, MIRA, `# Mira\n\nWren round ${round}.\n`, newId());
          const b = await edit(rex, SHADE, `# Shade\n\nRex round ${round}.\n`, newId());
          const c = await edit(t, PLAIN, `# Plain\n\nAdmin round ${round}.\n`, newId());
          const plans = await Promise.all([plan(wren, [a]), plan(rex, [b]), plan(t, [c])]);
          const saved = await Promise.all([
            confirm(wren, plans[0]!.planId),
            confirm(rex, plans[1]!.planId),
            confirm(t, plans[2]!.planId),
          ]);
          expect(
            saved.map((r) => r.statusCode),
            saved.map((r) => r.body).join("\n"),
          ).toEqual([200, 200, 200]);
          expect(main(MIRA)).toContain(`Wren round ${round}.`);
          expect(main(SHADE)).toContain(`Rex round ${round}.`);
          expect(main(PLAIN)).toContain(`Admin round ${round}.`);
        }
        const log = execFileSync("git", ["log", "--format=%an", "-n9", "refs/heads/main"], {
          cwd: t.repo.remote,
          encoding: "utf8",
        })
          .trim()
          .split("\n");
        expect(new Set(log)).toEqual(new Set(["Wren Writer", "Rex Writer", "The Author"]));
      });

      it("lets exactly one of two saves of the same entry through", async () => {
        const a = await edit(wren, MIRA, "# Mira\n\nWren.\n");
        const b = await edit(rex, MIRA, "# Mira\n\nRex.\n");
        const plans = await Promise.all([plan(wren, [a]), plan(rex, [b])]);
        const saved = await Promise.all([
          confirm(wren, plans[0]!.planId),
          confirm(rex, plans[1]!.planId),
        ]);
        const codes = saved.map((r) => r.statusCode).sort();
        expect(codes).toEqual([200, 409]);
        const loser = saved.find((r) => r.statusCode === 409)!;
        expect(loser.json().error.code).toBe("saved_by_other");
        // The loser's text is still theirs, unsaved.
        const loserClient = saved[0]!.statusCode === 409 ? wren : rex;
        expect(
          ((await loserClient.get(`${base}/unpublished`)).json() as UnpublishedResponse).drafts,
        ).toHaveLength(1);
      });
    });

    describe("renames and deletes that meet another person's unsaved changes", () => {
      it("moves a rename's other readers' drafts with it: nothing they wrote is lost", async () => {
        const w = await edit(wren, MIRA, "# Mira\n\nWren's change before the rename.\n");
        void w;
        const r = await edit(rex, MIRA, "# Mira\n\nRex's change before the rename.\n");
        // Wren renames Mira (and saves just the rename).
        const rename = await wren.post(`${base}/renames`, {
          from: MIRA,
          to: "02 People/Mirabel.md",
        });
        expect(rename.statusCode, rename.body).toBe(200);
        const p = await plan(wren, [], [rename.json().id]);
        expect((await confirm(wren, p.planId)).statusCode).toBe(200);
        expect(main("02 People/Mirabel.md")).toBeTruthy();
        expect(main(MIRA)).toBeNull();

        // Rex's unsaved text follows the file; it is still his, and he can save it where it is now.
        const e = await entry(rex, "02 People/Mirabel.md");
        expect(e.text).toContain("Rex's change before the rename.");
        expect(e.draft.id).toBe(r);
        const rp = await plan(rex, [r]);
        expect(rp.conflicts).toEqual([]);
        expect((await confirm(rex, rp.planId)).statusCode).toBe(200);
        expect(main("02 People/Mirabel.md")).toContain("Rex's change before the rename.");
        // Wren's own change to Mira was saved by... nobody: it follows too, and is his.
        expect((await entry(wren, "02 People/Mirabel.md")).draft).not.toBeNull();
      });

      it("keeps another person's text as a conflict when the entry is deleted, and lets them restore it", async () => {
        const r = await edit(rex, MIRA, "# Mira\n\nRex's change, meant to be kept.\n");
        const gone = await wren.put(`${base}/drafts`, {
          id: newId(),
          path: MIRA,
          kind: "delete",
          text: "",
          revision: 0,
          baseBlob: (await entry(wren, MIRA)).blob,
        });
        expect(gone.statusCode, gone.body).toBe(200);
        const wd = gone.json().id as string;
        expect((await confirm(wren, (await plan(wren, [wd])).planId)).statusCode).toBe(200);
        expect(main(MIRA)).toBeNull();

        // Rex's draft is still there with his text, and the plan names the person who deleted it.
        const p = await plan(rex, [r]);
        expect(p.conflicts[0]).toMatchObject({
          draftId: r,
          reason: "deleted_on_main",
          mine: "# Mira\n\nRex's change, meant to be kept.\n",
          theirs: null,
          theirsBy: { id: wren.id, name: "Wren Writer" },
        });
        // He keeps his text by making it a new entry at the path.
        const kept = await rex.put(`${base}/drafts`, {
          id: r,
          path: MIRA,
          kind: "create",
          text: "# Mira\n\nRex's change, meant to be kept.\n",
          revision: 1,
        });
        expect(kept.statusCode, kept.body).toBe(200);
        const again = await plan(rex, [r]);
        expect(again.ready).toEqual([r]);
        expect((await confirm(rex, again.planId)).statusCode).toBe(200);
        expect(main(MIRA)).toContain("meant to be kept");
      });

      it("leaves a rename of an entry someone else renamed or deleted as a blocked change they can undo", async () => {
        const rexRename = await rex.post(`${base}/renames`, {
          from: SHADE,
          to: "02 People/Shadow.md",
        });
        expect(rexRename.statusCode, rexRename.body).toBe(200);
        const gone = await wren.put(`${base}/drafts`, {
          id: newId(),
          path: SHADE,
          kind: "delete",
          text: "",
          revision: 0,
          baseBlob: (await entry(wren, SHADE)).blob,
        });
        await confirm(wren, (await plan(wren, [gone.json().id])).planId);
        expect(main(SHADE)).toBeNull();
        const p = await plan(rex, [], [rexRename.json().id]);
        expect(p.conflicts[0]).toMatchObject({ reason: "rename_blocked" });
        const undo = await rex.del(`${base}/renames/${rexRename.json().id}`);
        expect(undo.statusCode).toBe(200);
        expect(
          ((await rex.get(`${base}/unpublished`)).json() as UnpublishedResponse).renames,
        ).toEqual([]);
      });

      it("follows a folder that someone else renamed", async () => {
        const r = await edit(rex, MIRA, "# Mira\n\nRex's change.\n");
        const rename = await wren.post(`${base}/renames`, { from: "02 People", to: "02 Folk" });
        expect(rename.statusCode, rename.body).toBe(200);
        expect(
          (await confirm(wren, (await plan(wren, [], [rename.json().id])).planId)).statusCode,
        ).toBe(200);
        const e = await entry(rex, "02 Folk/Mira.md");
        expect(e.draft.id).toBe(r);
        expect(e.text).toContain("Rex's change.");
      });
    });
  },
);
