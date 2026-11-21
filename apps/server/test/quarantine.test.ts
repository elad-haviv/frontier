import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EntryResponse,
  InboxResponse,
  PublishPlan,
  TreeResponse,
  UnpublishedResponse,
} from "@frontier/schema";
import { SETTLE_MS } from "../src/quarantine/quarantine.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { makeTestApp, type TestApp, testEnv } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const MIRA = "02 People/Mira.md";
const SHADE = "02 People/Shade.md";
const NEW = "02 People/Intruder.md";
const LIST = ".frontier/quarantine.json";
const REVIEW = ".frontier/review-state.json";

const list = (notes: { path: string; commit: string }[]) =>
  JSON.stringify({
    version: 1,
    notes: notes.map((n) => ({ ...n, pushedBy: "hermes-agent", at: "2026-11-21T10:00:00Z" })),
  });

/** An agent pushes to main, and then the sync lists what it touched, as it would. */
async function breach(changes: Record<string, string | null>) {
  const commit = t.repo.pushFromOutside(changes, "Agent pushes to main");
  t.repo.pushFromOutside({
    [LIST]: list(Object.keys(changes).map((path) => ({ path, commit }))),
  });
  await t.services.sync();
  return commit;
}

const inbox = async () => InboxResponse.parse((await t.get("/api/inbox")).json()).quarantine;
const entry = async (path: string) =>
  EntryResponse.parse((await t.get(`/api/entries?path=${encodeURIComponent(path)}`)).json());
const decide = (path: string, commit: string, decision: "accept" | "revert") =>
  t.post("/api/quarantine", { path, commit, decision });

async function publishAll(message = "Decide") {
  const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
  const plan = PublishPlan.parse(
    (
      await t.post("/api/publish/plan", {
        draftIds: un.drafts.map((d) => d.id),
        renameIds: [],
        decisionIds: un.decisions.map((d) => d.id),
      })
    ).json(),
  );
  const res = await t.post("/api/publish/confirm", {
    planId: plan.planId,
    confirmedMergeIds: plan.merges.map((m) => m.id),
    message,
  });
  return { un, plan, res };
}
const review = () => JSON.parse(t.repo.remoteFile(REVIEW) ?? '{"decisions":[]}').decisions;

describe("showing quarantined notes", () => {
  it("marks them in the tree, the reader and the inbox, with what the commit changed", async () => {
    const before = t.repo.remoteFile(MIRA)!;
    const commit = await breach({
      [MIRA]: before + "\nA line nobody reviewed.\n",
      [NEW]: "# Intruder\n",
    });

    const tree = TreeResponse.parse((await t.get("/api/tree")).json());
    const people = tree.folders.find((f) => f.path === "02 People")!;
    expect(people.notes.find((n) => n.path === MIRA)!.state).toBe("quarantined");
    expect(people.notes.find((n) => n.path === SHADE)!.state).toBe("published");

    const e = await entry(MIRA);
    expect(e.state).toBe("quarantined");
    expect(e.quarantine).toEqual({ commit, pushedBy: "hermes-agent", at: "2026-11-21T10:00:00Z" });
    expect((await entry(SHADE)).quarantine).toBeUndefined();

    const waiting = await inbox();
    expect(waiting.map((q) => [q.path, q.kind])).toEqual([
      [MIRA, "changed"],
      [NEW, "added"],
    ]);
    expect(waiting[0]).toMatchObject({ before, after: before + "\nA line nobody reviewed.\n" });
    expect(waiting[1]).toMatchObject({ before: null, after: "# Intruder\n" });
    expect((await t.get("/api/status")).json().inbox.quarantined).toBe(2);
  });

  it("treats a missing list as empty and says so when the list cannot be read", async () => {
    expect(await inbox()).toEqual([]);
    t.repo.pushFromOutside({ [LIST]: "{ not json" });
    await t.services.sync();
    expect(await inbox()).toEqual([]);
    expect((await t.get("/api/status")).json().problems[0]).toMatch(
      /quarantine\.json cannot be read/,
    );
  });
});

describe("deciding", () => {
  it("publishes an accept in the review file and treats the note as released at once", async () => {
    const commit = await breach({ [MIRA]: t.repo.remoteFile(MIRA)! + "\nUnreviewed.\n" });
    const res = await decide(MIRA, commit, "accept");
    expect(res.statusCode, res.body).toBe(200);
    expect((await entry(MIRA)).state).toBe("published");
    expect((await inbox())[0]!.pending).toMatchObject({ decision: "accepted" });
    // Nothing is published by deciding.
    expect(t.repo.remoteFile(REVIEW)).toBeNull();
    // Until the decision is published, AI features still may not read the note.
    expect(t.services.quarantine.aiMayRead(MIRA)).toMatch(/unreviewed/);

    const { un, res: done } = await publishAll("Accept Mira");
    expect(un.decisions).toHaveLength(1);
    expect(done.statusCode, done.body).toBe(200);
    expect(review()).toEqual([
      expect.objectContaining({ path: MIRA, commit, decision: "accepted" }),
    ]);
    expect((await t.get("/api/unpublished")).json().decisions).toEqual([]);
    expect(await inbox()).toEqual([]);
    expect(t.repo.remoteFile(MIRA)).toContain("Unreviewed.");
  });

  it("reverts a changed note, keeping what the author wrote in it since", async () => {
    const original = t.repo.remoteFile(MIRA)!;
    const commit = t.repo.pushFromOutside({ [MIRA]: original + "\nUnreviewed.\n" });
    // The author edits another part of the same note from Obsidian before deciding.
    t.repo.pushFromOutside({ [MIRA]: "My own opening line.\n\n" + original + "\nUnreviewed.\n" });
    t.repo.pushFromOutside({ [LIST]: list([{ path: MIRA, commit }]) });
    await t.services.sync();

    const made = (await decide(MIRA, commit, "revert")).json();
    expect(made.draftId).toBeDefined();
    const { plan, res } = await publishAll("Revert Mira");
    expect(plan.groups).toContainEqual([made.id, made.draftId]);
    expect(res.statusCode, res.body).toBe(200);
    const text = t.repo.remoteFile(MIRA)!;
    expect(text).toContain("My own opening line.");
    expect(text).not.toContain("Unreviewed.");
    expect(review()).toEqual([expect.objectContaining({ path: MIRA, decision: "reverted" })]);
    // One commit carries both the undo and the decision.
    const files = execFileSync("git", ["show", "--name-only", "--format=", "refs/heads/main"], {
      cwd: t.repo.remote,
      encoding: "utf8",
    });
    expect(files.trim().split("\n").sort()).toEqual([REVIEW, MIRA].sort());
  });

  it("reverts a note the commit created by deleting it, and one it deleted by restoring it", async () => {
    const shade = t.repo.remoteFile(SHADE)!;
    const commit = await breach({ [NEW]: "# Intruder\n", [SHADE]: null });
    expect((await inbox()).map((q) => q.kind)).toEqual(["added", "removed"]);
    await decide(NEW, commit, "revert");
    await decide(SHADE, commit, "revert");
    const { res } = await publishAll();
    expect(res.statusCode, res.body).toBe(200);
    expect(t.repo.remoteFile(NEW)).toBeNull();
    expect(t.repo.remoteFile(SHADE)).toBe(shade);
  });

  it("holds the decision back while the revert is in conflict", async () => {
    const original = t.repo.remoteFile(MIRA)!;
    const commit = t.repo.pushFromOutside({
      [MIRA]: original.replace("# Mira", "# Mira the Usurper"),
    });
    t.repo.pushFromOutside({ [MIRA]: original.replace("# Mira", "# Mira of the Quay") });
    t.repo.pushFromOutside({ [LIST]: list([{ path: MIRA, commit }]) });
    await t.services.sync();
    await decide(MIRA, commit, "revert");
    const { plan, res } = await publishAll();
    expect(plan.conflicts).toHaveLength(1);
    expect(res.statusCode).toBe(400);
    expect(t.repo.remoteFile(REVIEW)).toBeNull();
  });

  it("offers only accept when the author has a draft of the note, and lets a decision be withdrawn", async () => {
    const commit = await breach({
      [MIRA]: t.repo.remoteFile(MIRA)! + "\nUnreviewed.\n",
      [NEW]: "# Intruder\n",
    });
    await t.put("/api/drafts", {
      id: "minedraft002",
      path: MIRA,
      kind: "edit",
      text: "# Mira\n\nMine.\n",
      revision: 0,
    });
    expect((await inbox())[0]!.revertBlocked).toMatch(/unpublished change/);
    expect((await decide(MIRA, commit, "revert")).statusCode).toBe(403);

    const made = (await decide(NEW, commit, "revert")).json();
    expect((await t.get("/api/unpublished")).json().decisions).toHaveLength(1);
    expect((await t.del(`/api/quarantine/${made.id}`)).statusCode).toBe(200);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.decisions).toEqual([]);
    expect(un.drafts.map((d) => d.path)).toEqual([MIRA]);
    expect((await entry(NEW)).state).toBe("quarantined");
    // Deciding twice, or about a note that is not listed, is refused.
    expect((await decide(SHADE, commit, "accept")).statusCode).toBe(404);
  });

  it("drops a revert whose draft the author discarded on its own", async () => {
    const commit = await breach({ [NEW]: "# Intruder\n" });
    const made = (await decide(NEW, commit, "revert")).json();
    await t.del(`/api/drafts/${made.draftId}`);
    expect((await t.get("/api/unpublished")).json().decisions).toEqual([]);
    expect((await entry(NEW)).state).toBe("quarantined");
  });

  it("drops published decisions once the sync has shortened its list", async () => {
    const commit = await breach({
      [MIRA]: t.repo.remoteFile(MIRA)! + "\nA.\n",
      [NEW]: "# Intruder\n",
    });
    await decide(MIRA, commit, "accept");
    await publishAll();
    expect(review()).toHaveLength(1);
    // The sync releases Mira; later the author accepts the other note.
    t.repo.pushFromOutside({ [LIST]: list([{ path: NEW, commit }]) });
    await t.services.sync();
    await decide(NEW, commit, "accept");
    await publishAll();
    expect(review()).toEqual([expect.objectContaining({ path: NEW })]);
  });

  it("clears a published decision after a restart that followed the push", async () => {
    const commit = await breach({ [NEW]: "# Intruder\n" });
    await decide(NEW, commit, "accept");
    // The decision reaches main without Frontier seeing its own publish finish.
    t.repo.pushFromOutside({
      [REVIEW]: JSON.stringify({
        version: 1,
        decisions: [{ path: NEW, commit, decision: "accepted", at: "2026-11-21T11:00:00Z" }],
      }),
    });
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    await again.services.sync();
    expect(again.services.quarantine.pendingDecisions()).toEqual([]);
    // Released: what still holds it back is only that it arrived moments ago.
    expect(again.services.quarantine.aiMayRead(NEW)).not.toMatch(/unreviewed/);
    await again.app.close();
  });
});

describe("what AI features may read", () => {
  it("keeps notes from outside away for a few minutes, across a restart, but not Frontier's own", async () => {
    let now = Date.parse("2026-11-21T12:00:00Z");
    const q = t.services.quarantine as unknown as { now: () => number };
    q.now = () => now;
    t.repo.pushFromOutside({ [NEW]: "# Arrived\n" });
    await t.services.sync();
    expect(t.services.quarantine.aiMayRead(NEW)).toMatch(/just arrived/);
    expect(t.services.quarantine.aiMayRead(MIRA)).toBeNull();
    // Proposing fields is refused meanwhile, before any call is made.
    const res = await t.post("/api/proposals/fields", { path: NEW });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/just arrived/);

    now += SETTLE_MS + 1000;
    expect(t.services.quarantine.aiMayRead(NEW)).toBeNull();

    // What Frontier publishes itself does not settle.
    await t.put("/api/drafts", {
      id: "owndraft0001",
      path: MIRA,
      kind: "edit",
      text: "# Mira\n\nMine.\n",
      revision: 0,
    });
    const plan = (
      await t.post("/api/publish/plan", { draftIds: ["owndraft0001"], renameIds: [] })
    ).json();
    await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Mine",
    });
    expect(t.services.quarantine.aiMayRead(MIRA)).toBeNull();
  });

  it("remembers settling notes over a restart", async () => {
    t.repo.pushFromOutside({ [NEW]: "# Arrived\n" });
    await t.services.sync();
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    await again.services.sync();
    expect(again.services.quarantine.aiMayRead(NEW)).toMatch(/just arrived/);
    await again.app.close();
  });
});
