import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EntryResponse, PublishPlan, TreeResponse, UnpublishedResponse } from "@frontier/schema";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { makeTestApp, type TestApp, testEnv } from "./helpers/app.js";

let t: TestApp;
let n = 0;
/** A fresh 12-character id, as the browser would make. */
const newId = () => `draft${String(++n).padStart(7, "0")}`;

beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const MIRA = "02 People/Mira.md";
const mainText = (path: string) => t.repo.remoteFile(path);
const commitsOnMain = () =>
  Number(
    execFileSync("git", ["rev-list", "--count", "refs/heads/main"], {
      cwd: t.repo.remote,
      encoding: "utf8",
    }),
  );

async function save(
  path: string,
  text: string,
  opts: { id?: string; kind?: string; revision?: number } = {},
) {
  const id = opts.id ?? newId();
  const res = await t.put("/api/drafts", {
    id,
    path,
    kind: opts.kind ?? "edit",
    text,
    revision: opts.revision ?? 0,
  });
  return { id, res, revision: res.statusCode === 200 ? (res.json().revision as number) : -1 };
}

async function plan(draftIds: string[], renameIds: string[] = []) {
  const res = await t.post("/api/publish/plan", { draftIds, renameIds });
  expect(res.statusCode, res.body).toBe(200);
  return PublishPlan.parse(res.json());
}

const confirm = (planId: string, confirmedMergeIds: string[] = [], message = "Publish") =>
  t.post("/api/publish/confirm", { planId, confirmedMergeIds, message });

describe("drafts", () => {
  it("saves a draft without creating a commit", async () => {
    const before = commitsOnMain();
    const { id, res } = await save(MIRA, "# Mira\n\nA draft.\n");
    expect(res.json()).toEqual({ id, revision: 1 });
    expect(commitsOnMain()).toBe(before);
    expect(mainText(MIRA)).not.toContain("A draft.");
    expect(t.gitCommands.some((c) => c[0] === "commit-tree" || c[0] === "push")).toBe(false);
  });

  it("shows the author his draft in the entry and the tree", async () => {
    const { id } = await save(MIRA, "# Mira\n\nNow links to [[Saltmother]] and [[Harbor]].\n");
    const entry = EntryResponse.parse(
      (await t.get("/api/entries?path=" + encodeURIComponent(MIRA))).json(),
    );
    expect(entry.state).toBe("unpublished");
    expect(entry.text).toContain("Saltmother");
    expect(entry.draft).toEqual({ id, revision: 1, kind: "edit" });
    expect(entry.links.map((l) => [l.raw, l.kind])).toEqual([
      ["[[Saltmother]]", "unresolved"],
      ["[[Harbor]]", "resolved"],
    ]);
    // The published index is untouched: other notes still see the published links.
    expect(t.services.index.note(MIRA)!.text).not.toContain("Saltmother");
    const tree = JSON.stringify(TreeResponse.parse((await t.get("/api/tree")).json()));
    expect(tree).toContain(`{"path":"${MIRA}","title":"Mira","state":"unpublished"}`);
  });

  it("creates and deletes notes as drafts", async () => {
    await save("01 Places/Saltmother.md", "# Saltmother\n\nNear the [[Harbor]].\n", {
      kind: "create",
    });
    await save("03 Things/Plain.md", "", { kind: "delete" });
    const tree = JSON.stringify((await t.get("/api/tree")).json());
    expect(tree).toContain(
      '"path":"01 Places/Saltmother.md","title":"Saltmother","state":"unpublished"',
    );
    expect(tree).not.toContain("03 Things/Plain.md");
    const created = EntryResponse.parse(
      (await t.get("/api/entries?path=01%20Places%2FSaltmother.md")).json(),
    );
    expect(created.links[0]).toMatchObject({
      kind: "resolved",
      target: "01 Places/Harbor/Harbor.md",
    });
    // A link to the new note resolves in another draft, before either is published.
    await save(MIRA, "# Mira\n\nVisits [[Saltmother]].\n");
    const mira = EntryResponse.parse(
      (await t.get("/api/entries?path=" + encodeURIComponent(MIRA))).json(),
    );
    expect(mira.links[0]).toMatchObject({ kind: "resolved", target: "01 Places/Saltmother.md" });
    const deleted = EntryResponse.parse(
      (await t.get("/api/entries?path=03%20Things%2FPlain.md")).json(),
    );
    expect(deleted.state).toBe("unpublished");
    expect(deleted.draft?.kind).toBe("delete");
  });

  it("refuses drafts for files that may not change", async () => {
    const code = async (path: string, kind = "edit") =>
      (await save(path, "x\n", { kind })).res.json().error?.code;
    expect(await code("99 Appendices/Logs/Session.md")).toBe("append_only");
    expect(await code("03 Things/Knot.md")).toBe("read_only_file");
    expect(await code("notes.json")).toBe("invalid");
    expect(await code(".obsidian/Hidden.md")).toBe("invalid");
    expect(await code("02 People/Nobody.md")).toBe("not_found");
    expect(await code(MIRA, "create")).toBe("invalid");
    // A new file under the appendix folder is allowed: the folder is append-only, not closed.
    expect(
      (await save("99 Appendices/Logs/New Log.md", "# New\n", { kind: "create" })).res.statusCode,
    ).toBe(200);
  });

  it("counts revisions, and keeps an older save from another device as a second version", async () => {
    const first = await save(MIRA, "one\n");
    const second = await save(MIRA, "two\n", { id: first.id, revision: 1 });
    expect(second.revision).toBe(2);

    const stale = await save(MIRA, "from the phone\n", { id: first.id, revision: 1 });
    expect(stale.res.statusCode).toBe(409);
    expect(stale.res.json().error).toMatchObject({ code: "stale_revision", id: first.id });

    const versions = (await t.get(`/api/drafts/${first.id}/versions`)).json();
    expect(versions).toEqual({
      current: { text: "two\n", revision: 2 },
      other: { text: "from the phone\n" },
    });

    const blocked = await t.post("/api/publish/plan", { draftIds: [first.id], renameIds: [] });
    expect(blocked.json().error.message).toMatch(/two versions/);

    const merged = await t.post(`/api/drafts/${first.id}/merge-versions`, {
      text: "two\nand the phone\n",
    });
    expect(merged.json()).toEqual({ id: first.id, revision: 3 });
    expect((await t.get(`/api/drafts/${first.id}/versions`)).statusCode).toBe(404);
  });

  it("treats a second draft id for the same path as an older version", async () => {
    const first = await save(MIRA, "desktop\n");
    const other = await save(MIRA, "phone, started offline\n");
    expect(other.res.json().error).toMatchObject({ code: "stale_revision", id: first.id });
    expect(t.services.drafts.list()).toHaveLength(1);
  });

  it("rejects a revision from the future and a draft that changes file", async () => {
    const first = await save(MIRA, "one\n");
    expect((await save(MIRA, "x\n", { id: first.id, revision: 5 })).res.statusCode).toBe(400);
    expect(
      (await save("02 People/Shade.md", "x\n", { id: first.id, revision: 1 })).res.statusCode,
    ).toBe(400);
    expect((await save("02 People/Shade.md", "x\n", { revision: 3 })).res.statusCode).toBe(400);
  });

  it("survives a restart, and ignores a half-written draft folder", async () => {
    const { id } = await save(MIRA, "kept across a restart\n");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(t.services.config.dataDir, "state", "drafts", "interrupted000"), {
      recursive: true,
    });
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    expect(again.services.drafts.list().map((d) => d.id)).toEqual([id]);
    expect(await again.services.drafts.text(id)).toBe("kept across a restart\n");
    await again.app.close();
  });

  it("discards a draft", async () => {
    const { id } = await save(MIRA, "gone\n");
    expect((await t.del(`/api/drafts/${id}`)).statusCode).toBe(200);
    expect((await t.del(`/api/drafts/${id}`)).statusCode).toBe(404);
    expect(t.services.drafts.list()).toEqual([]);
    expect(existsSync(join(t.services.config.dataDir, "state", "drafts", id))).toBe(false);
  });

  it("lists unpublished changes with the published text beside each", async () => {
    await save(MIRA, "# Mira\n\nEdited.\n");
    await save("01 Places/Saltmother.md", "# Saltmother\n", { kind: "create" });
    const u = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(u.drafts.map((d) => [d.path, d.kind, d.mainText === null])).toEqual([
      ["01 Places/Saltmother.md", "create", true],
      [MIRA, "edit", false],
    ]);
    expect(t.services.status.snapshot().unpublished).toBe(2);
  });
});

describe("publish", () => {
  it("publishes several drafts as one commit and clears them", async () => {
    const before = commitsOnMain();
    const a = await save(MIRA, "# Mira\n\nEdited.\n");
    const b = await save("01 Places/Saltmother.md", "# Saltmother\n", { kind: "create" });
    const c = await save("03 Things/Plain.md", "", { kind: "delete" });
    const p = await plan([a.id, b.id, c.id]);
    expect(p.ready.sort()).toEqual([a.id, b.id, c.id].sort());
    expect(p.merges).toEqual([]);
    expect(p.conflicts).toEqual([]);
    expect(commitsOnMain()).toBe(before);

    const res = await confirm(p.planId, [], "Edit Mira, add Saltmother, drop Plain");
    expect(res.statusCode, res.body).toBe(200);
    expect(commitsOnMain()).toBe(before + 1);
    expect(res.json().commit).toBe(t.repo.remoteHead());
    expect(t.repo.remoteCommit(t.repo.remoteHead()).message).toBe(
      "Edit Mira, add Saltmother, drop Plain",
    );
    expect(mainText(MIRA)).toBe("# Mira\n\nEdited.\n");
    expect(mainText("01 Places/Saltmother.md")).toBe("# Saltmother\n");
    expect(mainText("03 Things/Plain.md")).toBeNull();
    expect(t.services.drafts.list()).toEqual([]);
    expect(t.services.index.commit).toBe(t.repo.remoteHead());
    expect(t.services.status.snapshot()).toMatchObject({ unpublished: 0, failedPush: null });
    expect(t.services.status.snapshot().lastPushAt).not.toBeNull();
  });

  it("keeps Windows line endings and changes only the edited line", async () => {
    const before = mainText("03 Things/Rope.md")!;
    const edited = before.replace(/\r\n/g, "\n").replace("Second line.", "Second line, edited.");
    const { id } = await save("03 Things/Rope.md", edited);
    await confirm((await plan([id])).planId);
    const after = mainText("03 Things/Rope.md")!;
    expect(after).toBe(before.replace("Second line.", "Second line, edited."));
    expect(after.split("\r\n").length).toBe(before.split("\r\n").length);
  });

  it("publishes only the selected drafts", async () => {
    const a = await save(MIRA, "# Mira\n\nA.\n");
    const b = await save("02 People/Shade.md", "# Shade\n\nB.\n");
    await confirm((await plan([a.id])).planId);
    expect(mainText(MIRA)).toContain("A.");
    expect(mainText("02 People/Shade.md")).not.toContain("B.");
    expect(t.services.drafts.list().map((d) => d.id)).toEqual([b.id]);
  });

  it("holds back an overlapping change and publishes the rest", async () => {
    const mine = await save(MIRA, mainText(MIRA)!.replace("# Mira", "# Mira the Elder"));
    const other = await save("02 People/Shade.md", "# Shade\n\nUnrelated.\n");
    t.repo.pushFromOutside({ [MIRA]: mainText(MIRA)!.replace("# Mira", "# Mira of the Marsh") });

    const p = await plan([mine.id, other.id]);
    expect(p.ready).toEqual([other.id]);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]).toMatchObject({ draftId: mine.id, reason: "overlap" });
    expect(p.conflicts[0]!.theirs).toContain("Mira of the Marsh");
    expect(p.conflicts[0]!.base).toContain("# Mira\n");
    expect(t.services.status.snapshot().conflicts).toBe(1);

    await confirm(p.planId);
    expect(mainText("02 People/Shade.md")).toContain("Unrelated.");
    expect(mainText(MIRA)).toContain("Mira of the Marsh");
    expect(t.services.drafts.list().map((d) => d.id)).toEqual([mine.id]);

    // He settles it by hand; the draft then builds on what is on main and publishes cleanly.
    const resolved = await t.post(`/api/drafts/${mine.id}/resolve`, {
      text: mainText(MIRA)!.replace("# Mira of the Marsh", "# Mira the Elder, of the Marsh"),
    });
    expect(resolved.json().revision).toBe(2);
    const again = await plan([mine.id]);
    expect(again.ready).toEqual([mine.id]);
    await confirm(again.planId);
    expect(mainText(MIRA)).toContain("# Mira the Elder, of the Marsh");
  });

  it("offers a clean merge and publishes it only when confirmed", async () => {
    const original = mainText(MIRA)!;
    const mine = await save(MIRA, original.replace("# Mira", "# Mira the Elder"));
    t.repo.pushFromOutside({ [MIRA]: original + "\nAdded at the end by an agent.\n" });

    const p = await plan([mine.id]);
    expect(p.ready).toEqual([]);
    expect(p.merges).toHaveLength(1);
    const merge = p.merges[0]!;
    expect(merge.mergedText).toContain("# Mira the Elder");
    expect(merge.mergedText).toContain("Added at the end by an agent.");
    expect(merge.mainText).toContain("Added at the end by an agent.");

    // Unconfirmed: nothing is published and the draft is untouched.
    const refused = await confirm(p.planId, []);
    expect(refused.statusCode).toBe(400);
    expect(mainText(MIRA)).not.toContain("the Elder");
    expect(await t.services.drafts.text(mine.id)).not.toContain("Added at the end");

    const p2 = await plan([mine.id]);
    const ok = await confirm(p2.planId, [p2.merges[0]!.id]);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(mainText(MIRA)).toBe(merge.mergedText);
    expect(t.services.drafts.list()).toEqual([]);
  });

  it("drops a draft whose change is already on main", async () => {
    const text = mainText(MIRA)!.replace("# Mira", "# Mira the Elder");
    const mine = await save(MIRA, text);
    t.repo.pushFromOutside({ [MIRA]: text });
    const p = await plan([mine.id]);
    expect(p).toMatchObject({ ready: [], merges: [], conflicts: [] });
    expect(t.services.drafts.list()).toEqual([]);
  });

  it("reports the other conflict kinds", async () => {
    const created = await save("01 Places/Saltmother.md", "# Mine\n", { kind: "create" });
    const edited = await save("02 People/Shade.md", "# Shade\n\nMine.\n");
    const deleted = await save("03 Things/Plain.md", "", { kind: "delete" });
    t.repo.pushFromOutside({
      "01 Places/Saltmother.md": "# Theirs\n",
      "02 People/Shade.md": null,
      "03 Things/Plain.md": "# Plain\n\nChanged by someone else.\n",
    });
    const p = await plan([created.id, edited.id, deleted.id]);
    const reasons = Object.fromEntries(p.conflicts.map((c) => [c.draftId, c.reason]));
    expect(reasons).toEqual({
      [created.id]: "created_on_main",
      [edited.id]: "deleted_on_main",
      [deleted.id]: "delete_of_changed_file",
    });
    expect((await confirm(p.planId)).json().error.code).toBe("invalid");
  });

  it("drops a create or delete that already happened on main", async () => {
    const created = await save("01 Places/Saltmother.md", "# Same\n", { kind: "create" });
    const deleted = await save("03 Things/Plain.md", "", { kind: "delete" });
    t.repo.pushFromOutside({ "01 Places/Saltmother.md": "# Same\n", "03 Things/Plain.md": null });
    const p = await plan([created.id, deleted.id]);
    expect(p).toMatchObject({ ready: [], merges: [], conflicts: [] });
    expect(t.services.drafts.list()).toEqual([]);
  });

  it("refuses to confirm when main moved after the plan, and publishes nothing", async () => {
    const mine = await save(MIRA, "# Mira\n\nMine.\n");
    const p = await plan([mine.id]);
    const theirs = t.repo.pushFromOutside({ "02 People/Shade.md": "# Shade\n\nTheirs.\n" });
    const res = await confirm(p.planId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("main_moved");
    expect(t.repo.remoteHead()).toBe(theirs);
    expect(t.services.drafts.list()).toHaveLength(1);
    // The plan is spent; the author reviews again.
    expect((await confirm(p.planId)).json().error.code).toBe("plan_expired");
    const again = await plan([mine.id]);
    expect((await confirm(again.planId)).statusCode).toBe(200);
  });

  it("expires a plan after 15 minutes and rejects an unknown one", async () => {
    let clock = Date.now();
    (t.services.publisher as unknown as { now: () => number }).now = () => clock;
    const mine = await save(MIRA, "# Mira\n\nMine.\n");
    const p = await plan([mine.id]);
    clock += 16 * 60 * 1000;
    expect((await confirm(p.planId)).json().error.code).toBe("plan_expired");
    expect((await confirm("unknownplan0")).statusCode).toBe(410);
    expect(mainText(MIRA)).not.toContain("Mine.");
    const messages = await t.post("/api/publish/confirm", {
      planId: p.planId,
      confirmedMergeIds: [],
      message: " ",
    });
    expect(messages.statusCode).toBe(400);
  });

  it("leaves out a draft edited after the plan was made", async () => {
    const mine = await save(MIRA, "# Mira\n\nFirst.\n");
    const other = await save("02 People/Shade.md", "# Shade\n\nOther.\n");
    const p = await plan([mine.id, other.id]);
    await save(MIRA, "# Mira\n\nSecond thoughts.\n", { id: mine.id, revision: 1 });
    await confirm(p.planId);
    expect(mainText("02 People/Shade.md")).toContain("Other.");
    expect(mainText(MIRA)).not.toContain("First.");
    expect(t.services.drafts.list().map((d) => d.id)).toEqual([mine.id]);
  });

  it("reports a failed push, keeps the drafts, and shows it in the status", async () => {
    const mine = await save(MIRA, "# Mira\n\nMine.\n");
    const p = await plan([mine.id]);
    const real = t.services.git.push.bind(t.services.git);
    t.services.git.push = async () => {
      const { GitError } = await import("../src/git/gateway.js");
      throw new GitError("push_failed", "The push did not go through: network unreachable");
    };
    const res = await confirm(p.planId);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("push_failed");
    expect(t.services.status.snapshot().failedPush).toMatch(/network unreachable/);
    expect(t.services.drafts.list()).toHaveLength(1);
    t.services.git.push = real;
    const again = await plan([mine.id]);
    expect((await confirm(again.planId)).statusCode).toBe(200);
    expect(t.services.status.snapshot().failedPush).toBeNull();
  });

  it("never forces a push, in any of this", async () => {
    const mine = await save(MIRA, "# Mira\n\nMine.\n");
    await confirm((await plan([mine.id])).planId);
    for (const args of t.gitCommands) {
      for (const arg of args) expect(arg.startsWith("--force") || arg.startsWith("+")).toBe(false);
    }
    expect(t.gitCommands.filter((c) => c[0] === "push")).toHaveLength(1);
  });
});

describe("crash recovery", () => {
  it("clears a published draft when the server stopped right after the push", async () => {
    const mine = await save(MIRA, "# Mira\n\nPublished, then the server died.\n");
    const p = await plan([mine.id]);
    // Stop after the push: the fetch that normally follows never runs.
    const realSync = t.services.sync;
    let calls = 0;
    t.services.sync = async () => {
      if (++calls > 1) throw new Error("server stopped");
      await realSync();
    };
    (t.services.publisher as unknown as { d: { sync: () => Promise<void> } }).d.sync = () =>
      t.services.sync();
    const res = await confirm(p.planId);
    expect(res.statusCode).toBe(500);
    expect(mainText(MIRA)).toContain("then the server died");
    expect(readdirSync(join(t.services.config.dataDir, "state", "drafts"))).toContain(mine.id);

    // A new server on the same disk comes up clean.
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    expect(again.services.drafts.list()).toHaveLength(1);
    await again.services.sync();
    expect(again.services.drafts.list()).toEqual([]);
    const work = join(t.services.config.dataDir, "vault");
    expect(readFileSync(join(work, MIRA), "utf8")).toContain("then the server died");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: work, encoding: "utf8" })).toBe(
      "",
    );
    await again.app.close();
  });

  it("keeps the draft when the server stopped before the push", async () => {
    const mine = await save(MIRA, "# Mira\n\nNever pushed.\n");
    await plan([mine.id]);
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    await again.services.sync();
    expect(again.services.drafts.list().map((d) => d.id)).toEqual([mine.id]);
    expect(mainText(MIRA)).not.toContain("Never pushed.");
    await again.app.close();
  });

  it("clears a draft published through a confirmed merge, and a delete draft", async () => {
    const original = mainText(MIRA)!;
    const mine = await save(MIRA, original.replace("# Mira", "# Mira the Elder"));
    const gone = await save("03 Things/Plain.md", "", { kind: "delete" });
    t.repo.pushFromOutside({ [MIRA]: original + "\nAgent line.\n" });
    const p = await plan([mine.id, gone.id]);
    await confirm(p.planId, [p.merges[0]!.id]);
    expect(t.services.drafts.list()).toEqual([]);
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    await again.services.sync();
    expect(again.services.drafts.list()).toEqual([]);
    await again.app.close();
  });

  it("clears a draft that someone else published in the same words", async () => {
    const text = "# Mira\n\nSame words.\n";
    await save(MIRA, text);
    t.repo.pushFromOutside({ [MIRA]: text });
    await t.services.sync();
    expect(t.services.drafts.list()).toEqual([]);
  });
});

describe("renames", () => {
  const rename = (from: string, to: string) => t.post("/api/renames", { from, to });

  it("records a rename as an intent and says which notes will change", async () => {
    const res = await rename(MIRA, "02 People/Mira Vale.md");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().affected.sort()).toEqual([
      "01 Places/Harbor/Harbor.md",
      "01 Places/Harbor/Old Quay.md",
      "02 People/Shade.md",
      "03 Things/Ledger.md",
    ]);
    expect(mainText(MIRA)).not.toBeNull();
    const u = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(u.renames).toHaveLength(1);
    expect(u.renames[0]).toMatchObject({ from: MIRA, to: "02 People/Mira Vale.md" });
    expect(t.services.status.snapshot().unpublished).toBe(1);
  });

  it("refuses a rename that cannot be done", async () => {
    const message = async (from: string, to: string) =>
      (await rename(from, to)).json().error?.message as string;
    expect(await message(MIRA, "02 People/Shade.md")).toMatch(/already exists/);
    expect(await message("99 Appendices/Logs/Session.md", "99 Appendices/Logs/Old.md")).toMatch(
      /append-only/,
    );
    expect(await message("02 People/Nobody.md", "02 People/Somebody.md")).toMatch(/Nothing exists/);
    expect(t.services.drafts.listRenames()).toEqual([]);
  });

  it("publishes a rename and every link rewrite as one commit", async () => {
    const before = commitsOnMain();
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    const p = await plan([], [id]);
    expect(p.renames).toHaveLength(1);
    expect(p.conflicts).toEqual([]);
    const res = await confirm(p.planId, [], "Rename Mira to Mira Vale");
    expect(res.statusCode, res.body).toBe(200);
    expect(commitsOnMain()).toBe(before + 1);
    expect(mainText(MIRA)).toBeNull();
    expect(mainText("02 People/Mira Vale.md")).toContain("# Mira");
    expect(mainText("02 People/Shade.md")).toContain("[[Mira Vale]]");
    expect(mainText("03 Things/Ledger.md")).toContain("| [[Lantern]] | [[Mira Vale]] |");
    expect(mainText("01 Places/Harbor/Old Quay.md")).toContain(
      "[Mira](../../02%20People/Mira%20Vale.md)",
    );
    expect(t.services.drafts.listRenames()).toEqual([]);
    expect(t.services.index.note("02 People/Mira Vale.md")).toBeDefined();
  });

  it("leaves append-only files alone and keeps Windows line endings in rewritten notes", async () => {
    const log = mainText("99 Appendices/Logs/Session.md");
    const { id } = (
      await rename("01 Places/Harbor/Old Quay.md", "01 Places/Harbor/New Quay.md")
    ).json();
    await confirm((await plan([], [id])).planId);
    expect(mainText("99 Appendices/Logs/Session.md")).toBe(log);
    expect(mainText("03 Things/Rope.md")).toBe(
      "# Rope\r\n\r\nTied at the [[New Quay]].\r\nSecond line.\r\n",
    );
    const attention = (await t.get("/api/attention")).json();
    expect(attention.brokenAppendixLinks).toContainEqual({
      path: "99 Appendices/Logs/Session.md",
      raw: "[[Old Quay]]",
    });
  });

  it("renames a folder with its folder note, and carries other files along unchanged", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(t.repo.root, "outside", "01 Places", "Harbor", "plan.png"), image);
    t.repo.pushFromOutside({ "01 Places/Harbor/notes.txt": "not a note\n" });
    await t.services.sync();

    const { id } = (await rename("01 Places/Harbor", "01 Places/Port")).json();
    await confirm((await plan([], [id])).planId, [], "Rename Harbor to Port");
    const files = t.repo.remoteFiles();
    expect(files.filter((f) => f.startsWith("01 Places/Harbor/"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("01 Places/Port/")).sort()).toEqual([
      "01 Places/Port/Old Quay.md",
      "01 Places/Port/Port.md",
      "01 Places/Port/notes.txt",
      "01 Places/Port/plan.png",
    ]);
    expect(
      execFileSync("git", ["show", "refs/heads/main:01 Places/Port/plan.png"], {
        cwd: t.repo.remote,
      }).equals(image),
    ).toBe(true);
    expect(mainText("01 Places/Marsh/The Marsh.md")).toContain("[[Port]]");
    expect(mainText("03 Things/Lantern.md")).toContain("at the [[Port]].\r\n");
    expect(mainText("02 People/Mira.md")).toContain("[[01 Places/Port/Port]]");
  });

  it("publishes a draft of the renamed note at its new path, together with the rename", async () => {
    const draft = await save(
      MIRA,
      "# Mira\n\nRewritten while being renamed. Still at [[Harbor]].\n",
    );
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    const p = await plan([draft.id], [id]);
    expect(p.groups).toEqual([[id, draft.id]]);
    await confirm(p.planId);
    expect(mainText(MIRA)).toBeNull();
    expect(mainText("02 People/Mira Vale.md")).toBe(
      "# Mira\n\nRewritten while being renamed. Still at [[Harbor]].\n",
    );
    expect(t.services.drafts.list()).toEqual([]);
    expect(t.services.drafts.listRenames()).toEqual([]);
  });

  it("applies link rewrites on top of a draft of a linking note", async () => {
    const draft = await save(
      "02 People/Shade.md",
      "# Shade\n\nNow a rival of [[Mira]], not a friend.\n",
    );
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    await confirm((await plan([draft.id], [id])).planId);
    expect(mainText("02 People/Shade.md")).toBe(
      "# Shade\n\nNow a rival of [[Mira Vale]], not a friend.\n",
    );
  });

  it("holds a rename back with a conflicted draft it depends on, and still publishes unrelated drafts", async () => {
    const linking = await save("02 People/Shade.md", "# Shade the Quiet\n\nFriend of [[Mira]].\n");
    const unrelated = await save("03 Things/Plain.md", "# Plain\n\nUnrelated edit.\n");
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    t.repo.pushFromOutside({
      "02 People/Shade.md": "# Shade the Loud\n\nA quiet figure. Friend of [[Mira]].\n",
    });

    const p = await plan([linking.id, unrelated.id], [id]);
    expect(p.conflicts.map((c) => c.draftId)).toEqual([linking.id]);
    await confirm(p.planId);
    expect(mainText("03 Things/Plain.md")).toContain("Unrelated edit.");
    expect(mainText(MIRA)).not.toBeNull();
    expect(mainText("02 People/Mira Vale.md")).toBeNull();
    expect(t.services.drafts.listRenames()).toHaveLength(1);
    expect(t.services.drafts.list().map((d) => d.id)).toEqual([linking.id]);
  });

  it("reports a rename that main has made impossible", async () => {
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    t.repo.pushFromOutside({ "02 People/Mira Vale.md": "# Someone else got there first\n" });
    const p = await plan([], [id]);
    expect(p.renames).toEqual([]);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]).toMatchObject({ draftId: id, reason: "rename_blocked" });
    expect(p.conflicts[0]!.mine).toMatch(/already exists/);
    expect((await confirm(p.planId)).statusCode).toBe(400);
    expect(mainText(MIRA)).not.toBeNull();
  });

  it("refuses a rename that would rewrite a file with mixed line endings", async () => {
    const res = await rename("03 Things/Rope.md", "03 Things/Cord.md");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Knot\.md.*mixes two kinds of line endings/);
  });

  it("clears a rename that already happened on main, and cancels one on request", async () => {
    const first = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    const { renameSync } = await import("node:fs");
    renameSync(
      join(t.repo.root, "outside", MIRA),
      join(t.repo.root, "outside", "02 People/Mira Vale.md"),
    );
    t.repo.pushFromOutside({ "x.md": "# X\n" });
    await t.services.sync();
    expect(t.services.drafts.getRename(first.id)).toBeUndefined();

    const second = (await rename("02 People/Shade.md", "02 People/Shadow.md")).json();
    expect((await t.del(`/api/renames/${second.id}`)).statusCode).toBe(200);
    expect((await t.del(`/api/renames/${second.id}`)).statusCode).toBe(404);
    expect(t.services.drafts.listRenames()).toEqual([]);
  });

  it("keeps rename intents across a restart", async () => {
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    expect(again.services.drafts.listRenames().map((r) => r.id)).toEqual([id]);
    await again.app.close();
  });
});

describe("where a renamed path ends up", () => {
  it("moves a file, the files in a folder, and the folder's own note", async () => {
    const { movedPath } = await import("../src/publish/publish.js");
    expect(movedPath("a/Old.md", "a/Old.md", "a/New.md")).toBe("a/New.md");
    expect(movedPath("a/Harbor/Old Quay.md", "a/Harbor", "a/Port")).toBe("a/Port/Old Quay.md");
    expect(movedPath("a/Harbor/Harbor.md", "a/Harbor", "a/Port")).toBe("a/Port/Port.md");
    expect(movedPath("a/Harbor/Harbor.md", "a/Harbor", "b/Harbor")).toBe("b/Harbor/Harbor.md");
    expect(movedPath("a/Harbour.md", "a/Harb", "a/X")).toBeNull();
    expect(movedPath("b/Other.md", "a/Old.md", "a/New.md")).toBeNull();
  });
});
