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
