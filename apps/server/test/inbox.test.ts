import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { InboxResponse, PublishPlan, UnpublishedResponse } from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const MIRA = "02 People/Mira.md";
const SHADE = "02 People/Shade.md";
const BRANCH = "proposal/architect/mira";
const NEW = "02 People/Vyrinea.md";

async function inbox() {
  await t.services.sync();
  const res = await t.get("/api/inbox");
  expect(res.statusCode, res.body).toBe(200);
  return InboxResponse.parse(res.json()).branches;
}

const fileOf = (branches: Awaited<ReturnType<typeof inbox>>, path: string, name = BRANCH) =>
  branches.find((b) => b.name === name)!.files.find((f) => f.path === path)!;

async function decide(path: string, decision: "accept" | "reject", name = BRANCH) {
  const file = fileOf(await inbox(), path, name);
  return t.post("/api/inbox/branch-file", { branch: name, path, blob: file.blob, decision });
}

async function publishAll(confirmMerges = true) {
  const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
  const planRes = await t.post("/api/publish/plan", {
    draftIds: un.drafts.map((d) => d.id),
    renameIds: [],
  });
  const plan = PublishPlan.parse(planRes.json());
  const res = await t.post("/api/publish/confirm", {
    planId: plan.planId,
    confirmedMergeIds: confirmMerges ? plan.merges.map((m) => m.id) : [],
    message: "Take the agent's proposal",
  });
  return { plan, res };
}

describe("listing proposal branches", () => {
  it("lists only branches under proposal/, with commits and files against the fork point", async () => {
    const before = t.repo.remoteFile(MIRA)!;
    t.repo.pushBranch(
      BRANCH,
      { [MIRA]: before + "\nShe mends nets.\n", [NEW]: "# Vyrinea\n" },
      "Add Vyrinea",
    );
    t.repo.pushBranch(BRANCH, { [SHADE]: null }, "Remove Shade");
    t.repo.pushBranch("feature/other", { "x.md": "x\n" });
    // A later change on main must not show up as something the agent undid.
    t.repo.pushFromOutside({ "03 Things/Plain.md": "Changed on main.\n" });

    const branches = await inbox();
    expect(branches.map((b) => b.name)).toEqual([BRANCH]);
    const b = branches[0]!;
    expect(b.state).toBe("open");
    expect(b.commits).toEqual(["Add Vyrinea", "Remove Shade"]);
    expect(b.files.map((f) => [f.path, f.kind, f.binary])).toEqual([
      [MIRA, "changed", false],
      [SHADE, "removed", false],
      [NEW, "added", false],
    ]);
    expect(b.files.every((f) => f.blocked === undefined)).toBe(true);
    expect((await t.get("/api/status")).json().inbox).toMatchObject({ branches: 1 });

    const texts = await t.get(
      `/api/inbox/branch-file?branch=${encodeURIComponent(BRANCH)}&path=${encodeURIComponent(MIRA)}`,
    );
    expect(texts.json()).toEqual({ before, after: before + "\nShe mends nets.\n" });
  });

  it("marks what can only be rejected, with the reason", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#804020" },
    })
      .png()
      .toBuffer();
    const existingImage = t.services.index.files.find((f) => f.endsWith(".png"))!;
    const appendixNote = t.services.index.files.find(
      (f) => f.startsWith("99 Appendices/") && f.endsWith(".md"),
    )!;
    const mixed = t.services.index.files.find(
      (f) => t.services.index.note(f)?.lineEnding === "mixed",
    )!;
    await t.put("/api/drafts", {
      id: "minedraft001",
      path: SHADE,
      kind: "edit",
      text: "# Shade\n\nMine.\n",
      revision: 0,
    });
    t.repo.pushBranch(BRANCH, {
      ".frontier/schema.yaml": "version: 1\n",
      "notes.json": "{}\n",
      [existingImage]: png,
      [appendixNote]: "Rewritten history.\n",
      "99 Appendices/Logs/New log.md": "A new log is fine.\n",
      [`01 Places/${existingImage.split("/").pop()!.toUpperCase()}`]: png,
      "01 Places/Fresh view.png": png,
      [SHADE]: "# Shade\n\nTheirs.\n",
      [mixed]: "# Now clean\n",
      "03 Things/Bytes.md": Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]),
      "03 Things/Mixed new.md": "a\r\nb\nc\r\n",
    });
    const b = (await inbox())[0]!;
    const reason = (path: string) => b.files.find((f) => f.path === path)!.blocked;
    expect(reason(".frontier/schema.yaml")).toMatch(/do not change these folders/);
    expect(reason("notes.json")).toMatch(/notes and new images/);
    expect(reason(existingImage)).toMatch(/notes and new images/);
    expect(reason(appendixNote)).toMatch(/append-only/);
    expect(reason("99 Appendices/Logs/New log.md")).toBeUndefined();
    expect(reason(`01 Places/${existingImage.split("/").pop()!.toUpperCase()}`)).toMatch(
      /image of this name exists/,
    );
    expect(reason("01 Places/Fresh view.png")).toBeUndefined();
    expect(reason(SHADE)).toMatch(/your own change/);
    expect(reason(mixed)).toMatch(/read-only/);
    expect(reason("03 Things/Bytes.md")).toMatch(/not readable as text/);
    expect(reason("03 Things/Mixed new.md")).toMatch(/On the branch/);

    const refused = await decide(appendixNote, "accept");
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("not_allowed");

    // The new image is shown from the branch and accepted as an unpublished image.
    const shown = await t.get(
      `/api/images?branch=${encodeURIComponent(BRANCH)}&path=${encodeURIComponent("01 Places/Fresh view.png")}`,
    );
    expect(shown.statusCode).toBe(200);
    expect(shown.headers["content-type"]).toBe("image/png");
    expect((await decide("01 Places/Fresh view.png", "accept")).statusCode).toBe(200);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts.find((d) => d.path === "01 Places/Fresh view.png")).toMatchObject({
      binary: true,
      kind: "create",
      origins: [{ kind: "branch", ref: BRANCH }],
    });
  });

  it("shows a branch with nothing to review and removes it", async () => {
    t.repo.pushBranch("proposal/empty", { "x.md": "x\n" });
    t.repo.pushBranch("proposal/empty", { "x.md": null });
    let branches = await inbox();
    expect(branches[0]).toMatchObject({ name: "proposal/empty", state: "empty", files: [] });
    const res = await t.post("/api/inbox/branch", {
      branch: "proposal/empty",
      tip: branches[0]!.tip,
      decision: "remove",
    });
    expect(res.json()).toEqual({ branchRemoved: true });
    expect(t.repo.hasBranch("proposal/empty")).toBe(false);
    branches = await inbox();
    expect(branches).toEqual([]);
  });
});

describe("deciding", () => {
  it("accepts files as drafts based on the fork point and removes the branch when all are decided", async () => {
    const before = t.repo.remoteFile(MIRA)!;
    t.repo.pushBranch(BRANCH, {
      [MIRA]: before + "\nShe mends nets.\n",
      [NEW]: "# Vyrinea\n",
      [SHADE]: null,
    });
    // main moves on in another part of the same note after the agent branched.
    t.repo.pushFromOutside({ [MIRA]: "A line the author added first.\n\n" + before });
    const head = t.repo.remoteHead();

    const first = await decide(MIRA, "accept");
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ branchRemoved: false });
    expect(t.repo.hasBranch(BRANCH)).toBe(true);
    expect(fileOf(await inbox(), MIRA).decision).toBe("accepted");
    await decide(NEW, "accept");
    const last = await decide(SHADE, "reject");
    expect(last.json()).toEqual({ branchRemoved: true });
    expect(t.repo.hasBranch(BRANCH)).toBe(false);
    expect(await inbox()).toEqual([]);
    // Accepting made drafts and no commit.
    expect(t.repo.remoteHead()).toBe(head);

    const { plan, res } = await publishAll();
    // The agent's change is merged with what happened on main since the fork, after confirmation.
    expect(plan.merges.map((m) => m.path)).toEqual([MIRA]);
    expect(plan.groups).toHaveLength(1);
    expect(res.statusCode, res.body).toBe(200);
    const text = t.repo.remoteFile(MIRA)!;
    expect(text).toContain("A line the author added first.");
    expect(text).toContain("She mends nets.");
    expect(t.repo.remoteFile(NEW)).toBe("# Vyrinea\n");
    expect(t.repo.remoteFile(SHADE)).not.toBeNull();
    expect(t.repo.remoteCommit(t.repo.remoteHead()).message).toBe(
      `Take the agent's proposal\n\nFrontier-Proposal: ${BRANCH}`,
    );
  });

  it("holds every file of a branch back while one of them is in conflict", async () => {
    const before = t.repo.remoteFile(MIRA)!;
    t.repo.pushBranch(BRANCH, {
      [MIRA]: before.replace("# Mira", "# Mira the Netmender"),
      [NEW]: "# Vyrinea\n",
    });
    t.repo.pushFromOutside({ [MIRA]: before.replace("# Mira", "# Mira of the Quay") });
    await decide(MIRA, "accept");
    await decide(NEW, "accept");
    const head = t.repo.remoteHead();
    const { plan, res } = await publishAll();
    expect(plan.conflicts.map((c) => c.path)).toEqual([MIRA]);
    expect(res.statusCode).toBe(400);
    expect(t.repo.remoteHead()).toBe(head);
    expect(t.repo.remoteFile(NEW)).toBeNull();
  });

  it("holds a group back when only part of it is selected", async () => {
    t.repo.pushBranch(BRANCH, { [NEW]: "# Vyrinea\n", "02 People/Other.md": "# Other\n" });
    await decide(NEW, "accept");
    await decide("02 People/Other.md", "accept");
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const one = un.drafts.find((d) => d.path === NEW)!;
    const plan = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: [one.id], renameIds: [] })).json(),
    );
    const res = await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Half",
    });
    expect(res.statusCode).toBe(400);
    expect(t.repo.remoteFile(NEW)).toBeNull();
  });

  it("refuses a decision on content the author has not seen", async () => {
    t.repo.pushBranch(BRANCH, { [NEW]: "# Vyrinea\n" });
    const seen = fileOf(await inbox(), NEW);
    t.repo.pushBranch(BRANCH, { [NEW]: "# Vyrinea\n\nA line slipped in afterwards.\n" });
    await t.services.sync();
    const res = await t.post("/api/inbox/branch-file", {
      branch: BRANCH,
      path: NEW,
      blob: seen.blob,
      decision: "accept",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("proposal_moved");
    expect((await t.get("/api/unpublished")).json().drafts).toEqual([]);
  });

  it("asks again about a file the agent changed after it was decided, and keeps the others", async () => {
    t.repo.pushBranch(BRANCH, {
      [NEW]: "# Vyrinea\n",
      "02 People/Other.md": "# Other\n",
      "02 People/Third.md": "# Third\n",
    });
    await decide(NEW, "reject");
    await decide("02 People/Other.md", "reject");
    t.repo.pushBranch(BRANCH, { [NEW]: "# Vyrinea, revised\n" });
    const branches = await inbox();
    expect(fileOf(branches, NEW).decision).toBeUndefined();
    expect(fileOf(branches, "02 People/Other.md").decision).toBe("rejected");
  });

  it("rejects a whole branch and removes it; a moved branch is not removed", async () => {
    t.repo.pushBranch(BRANCH, { [NEW]: "# Vyrinea\n", "02 People/Other.md": "# Other\n" });
    const seen = (await inbox())[0]!;
    t.repo.pushBranch(BRANCH, { "02 People/Late.md": "# Late\n" });
    await t.services.sync();
    const stale = await t.post("/api/inbox/branch", {
      branch: BRANCH,
      tip: seen.tip,
      decision: "reject",
    });
    expect(stale.json().error.code).toBe("proposal_moved");
    expect(t.repo.hasBranch(BRANCH)).toBe(true);

    const now = (await inbox())[0]!;
    const res = await t.post("/api/inbox/branch", {
      branch: BRANCH,
      tip: now.tip,
      decision: "reject",
    });
    expect(res.json()).toEqual({ branchRemoved: true });
    expect(t.repo.hasBranch(BRANCH)).toBe(false);
    expect((await t.get("/api/unpublished")).json().drafts).toEqual([]);
    expect((await t.get("/api/status")).json().inbox).toMatchObject({ branches: 0 });
  });

  it("accepts a removal as a delete draft", async () => {
    t.repo.pushBranch(BRANCH, { [SHADE]: null });
    expect((await decide(SHADE, "accept")).json()).toMatchObject({ branchRemoved: true });
    const { res } = await publishAll();
    expect(res.statusCode, res.body).toBe(200);
    expect(t.repo.remoteFile(SHADE)).toBeNull();
  });

  it("never forces a push while handling branches", async () => {
    t.repo.pushBranch(BRANCH, { [NEW]: "# Vyrinea\n" });
    await decide(NEW, "reject");
    const pushes = t.gitCommands.filter((c) => c[0] === "push");
    expect(pushes).toHaveLength(1);
    for (const args of pushes) {
      for (const arg of args) {
        expect(arg.startsWith("--force") || arg === "-f" || arg.startsWith("+")).toBe(false);
      }
    }
  });
});
