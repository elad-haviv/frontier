/**
 * Saves of entries made or edited offline that meet a library changed meanwhile (stage 15c): a
 * new entry at a taken path, a name differing only in letter case, an entry renamed or moved
 * elsewhere. Each ends as the device's kept copy, never refused and never stuck.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DraftVersionsResponse, EntryResponse, PublishPlan } from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
let n = 0;
const newId = () => `offln${String(++n).padStart(7, "0")}`;

beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const PHONE = "phone0000001";
const MIRA = "02 People/Mira.md";
const PLAIN = "03 Things/Plain.md";

/** A save from the phone's queue, with its headers. */
async function send(body: {
  id: string;
  path: string;
  text: string;
  revision: number;
  kind?: "edit" | "create" | "delete";
  baseBlob?: string;
}) {
  const res = await t.app.inject({
    method: "PUT",
    url: "/api/drafts",
    headers: {
      cookie: t.cookie,
      "frontier-device": PHONE,
      "frontier-device-name": encodeURIComponent("Safari on iPhone"),
    },
    payload: { kind: "edit", ...body },
  });
  return { status: res.statusCode, body: res.json() };
}

const entryOf = async (path: string) =>
  EntryResponse.parse((await t.get("/api/entries?path=" + encodeURIComponent(path))).json());
const versionsOf = async (id: string) =>
  DraftVersionsResponse.parse((await t.get(`/api/drafts/${id}/versions`)).json());
const keptCount = () => t.services.status.snapshot().attention.keptCopies;

/** Publishes the given drafts and renames, as Save a version does. */
async function publish(draftIds: string[], renameIds: string[] = []) {
  const res = await t.post("/api/publish/plan", { draftIds, renameIds });
  expect(res.statusCode, res.body).toBe(200);
  const plan = PublishPlan.parse(res.json());
  const done = await t.post("/api/publish/confirm", {
    planId: plan.planId,
    confirmedMergeIds: plan.merges.map((m) => m.id),
    message: "Publish",
  });
  expect(done.statusCode, done.body).toBe(200);
}

/** Renames or moves on "another device" and saves it as a version. */
async function renameAndPublish(from: string, to: string) {
  const res = await t.post("/api/renames", { from, to });
  expect(res.statusCode, res.body).toBe(200);
  await publish([], [res.json().id]);
}

describe("a new entry made offline", () => {
  it("at a path published meanwhile: a draft of the library's text, the phone's as its kept copy", async () => {
    const gull = "02 People/Gull.md";
    t.repo.pushFromOutside({ [gull]: "# Gull\n\nFrom the laptop.\n" });
    await t.services.sync();
    const id = newId();
    const res = await send({
      id,
      path: gull,
      kind: "create",
      text: "# Gull\n\nSister of [[Mira]].\n",
      revision: 0,
      baseBlob: "",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "stale_revision", id });
    expect(t.services.drafts.get(id)).toMatchObject({ path: gull, kind: "edit" });
    const versions = await versionsOf(id);
    expect(versions.path).toBe(gull);
    expect(versions.current.text).toBe("# Gull\n\nFrom the laptop.\n");
    expect(versions.others).toMatchObject([
      { device: PHONE, deviceName: "Safari on iPhone", text: "# Gull\n\nSister of [[Mira]].\n" },
    ]);
    expect(keptCount()).toBe(1);
  });

  it("at a path holding another device's unsent create: kept beside that draft", async () => {
    const path = "02 People/Gull.md";
    const laptop = newId();
    await send({ id: laptop, path, kind: "create", text: "# Gull\n", revision: 0, baseBlob: "" });
    const res = await send({
      id: newId(),
      path,
      kind: "create",
      text: "# Gull\n\nPhone.\n",
      revision: 0,
      baseBlob: "",
    });
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: laptop });
    expect((await versionsOf(laptop)).others[0]!.text).toBe("# Gull\n\nPhone.\n");
  });

  it("without a base, as from an older build, is refused at a published path as before", async () => {
    const res = await send({ id: newId(), path: MIRA, kind: "create", text: "x\n", revision: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already exists/);
  });

  it("whose name differs only in letter case is kept on that entry's draft", async () => {
    const mira = await entryOf(MIRA);
    const id = newId();
    const res = await send({
      id,
      path: "02 People/mira.md",
      kind: "create",
      text: "# mira\n",
      revision: 0,
      baseBlob: "",
    });
    const draft = t.services.drafts.byPath(MIRA)!;
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: draft.id });
    expect(t.services.drafts.byPath("02 People/mira.md")).toBeUndefined();
    const versions = await versionsOf(draft.id);
    expect(versions.current.text).toBe(mira.text);
    expect(versions.others[0]!.text).toBe("# mira\n");
    // Later sends from the same record go to the same kept copy.
    const again = await send({
      id: draft.id,
      path: "02 People/mira.md",
      kind: "create",
      text: "# mira\n\nMore.\n",
      revision: 0,
      baseBlob: "",
    });
    expect(again.body.error).toMatchObject({ code: "stale_revision", id: draft.id });
    expect((await versionsOf(draft.id)).others.map((o) => o.text)).toEqual(["# mira\n\nMore.\n"]);
  });

  it("in a folder renamed elsewhere goes to the folder's new path, starting from its heading", async () => {
    await renameAndPublish("03 Things", "04 Objects");
    const res = await send({
      id: newId(),
      path: "03 Things/Wick.md",
      kind: "create",
      text: "# Wick\n\nMade on the train.\n",
      revision: 0,
      baseBlob: "",
    });
    const draft = t.services.drafts.byPath("04 Objects/Wick.md")!;
    expect(draft).toMatchObject({ kind: "create" });
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: draft.id });
    const versions = await versionsOf(draft.id);
    expect(versions.current.text).toBe("# Wick\n\n");
    expect(versions.others[0]!.text).toBe("# Wick\n\nMade on the train.\n");
  });

  it("in a new folder, with nothing renamed, is made as usual", async () => {
    const id = newId();
    const res = await send({
      id,
      path: "05 New/Wick.md",
      kind: "create",
      text: "# Wick\n",
      revision: 0,
      baseBlob: "",
    });
    expect(res.body).toEqual({ id, revision: 1 });
  });
});

describe("an edit of an entry renamed or moved elsewhere", () => {
  it("follows a published rename to the new path's draft, made from its published text", async () => {
    const opened = await entryOf(PLAIN);
    await renameAndPublish(PLAIN, "03 Things/Plainer.md");
    expect(t.services.drafts.renamedLog()).toMatchObject([
      { from: PLAIN, to: "03 Things/Plainer.md" },
    ]);
    const res = await send({
      id: newId(),
      path: PLAIN,
      text: opened.text + "Offline.\n",
      revision: 0,
      baseBlob: opened.blob,
    });
    const draft = t.services.drafts.byPath("03 Things/Plainer.md")!;
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: draft.id });
    expect(draft.kind).toBe("edit");
    const versions = await versionsOf(draft.id);
    expect(versions.current.text).toBe(opened.text);
    expect(versions.others[0]!.text).toBe(opened.text + "Offline.\n");
    // The old path is not brought back as a new entry.
    expect(t.services.drafts.byPath(PLAIN)).toBeUndefined();
  });

  it("follows a pending rename intent", async () => {
    const opened = await entryOf(PLAIN);
    // Moved outside Frontier, and the rename not yet cleared by a fetch.
    t.repo.pushFromOutside({ [PLAIN]: null, "03 Things/Moved.md": opened.text });
    await t.services.sync();
    await t.services.drafts.addRename({
      id: "renameintent",
      from: PLAIN,
      to: "03 Things/Moved.md",
      createdAt: new Date().toISOString(),
    });
    const res = await send({
      id: newId(),
      path: PLAIN,
      text: "Mine.\n",
      revision: 0,
      baseBlob: opened.blob,
    });
    const draft = t.services.drafts.byPath("03 Things/Moved.md")!;
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: draft.id });
  });

  it("goes to its draft where it was moved, and later sends follow it", async () => {
    const opened = await entryOf(PLAIN);
    const id = newId();
    expect(
      (await send({ id, path: PLAIN, text: "One.\n", revision: 0, baseBlob: opened.blob })).body,
    ).toEqual({ id, revision: 1 });
    // The phone's draft is moved with its folder on another device.
    await t.services.drafts.movePath(id, "04 Objects/Plain.md");
    const res = await send({ id, path: PLAIN, text: "Two.\n", revision: 1, baseBlob: opened.blob });
    expect(res.body.error).toMatchObject({ code: "stale_revision", id });
    expect((await versionsOf(id)).others[0]!.text).toBe("Two.\n");
    expect(t.services.drafts.byPath(PLAIN)).toBeUndefined();
    // A delete of it is refused, and says where it went.
    const del = await send({ id, path: PLAIN, kind: "delete", text: "", revision: 1 });
    expect(del.status).toBe(403);
    expect(del.body.error.message).toMatch(/Moved to "04 Objects\/Plain.md" on another device/);
  });

  it("of a vanished path with no rename makes '… (from <device>).md' from the text it started from", async () => {
    const opened = await entryOf(PLAIN);
    t.repo.pushFromOutside({ [PLAIN]: null, "03 Things/Plain (from Safari on iPhone).md": "x" });
    await t.services.sync();
    const res = await send({
      id: newId(),
      path: PLAIN,
      text: "Mine.\n",
      revision: 0,
      baseBlob: opened.blob,
    });
    // The first name is taken, so a number is added.
    const draft = t.services.drafts.byPath("03 Things/Plain (from Safari on iPhone) 2.md")!;
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: draft.id });
    expect(draft).toMatchObject({ kind: "create", baseBlob: "" });
    const versions = await versionsOf(draft.id);
    expect(versions.current.text).toBe(opened.text);
    expect(versions.others[0]!.text).toBe("Mine.\n");
  });

  it("whose started-from text Git no longer has starts empty", async () => {
    t.repo.pushFromOutside({ [PLAIN]: null });
    await t.services.sync();
    const res = await send({
      id: newId(),
      path: PLAIN,
      text: "Mine.\n",
      revision: 0,
      baseBlob: "0".repeat(40),
    });
    const draft = t.services.drafts.byPath("03 Things/Plain (from Safari on iPhone).md")!;
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: draft.id });
    expect((await versionsOf(draft.id)).current.text).toBe("");
  });

  it("refuses a delete of a path renamed elsewhere", async () => {
    const opened = await entryOf(PLAIN);
    await renameAndPublish(PLAIN, "03 Things/Plainer.md");
    const res = await send({
      id: newId(),
      path: PLAIN,
      kind: "delete",
      text: "",
      revision: 0,
      baseBlob: opened.blob,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe(
      'Moved to "03 Things/Plainer.md" on another device; delete it there.',
    );
  });

  it("keeps the last 500 published renames", async () => {
    for (let i = 0; i < 502; i++) await t.services.drafts.noteRenamed(`a${i}.md`, `b${i}.md`);
    const log = t.services.drafts.renamedLog();
    expect(log).toHaveLength(500);
    expect(log[0]!.from).toBe("a2.md");
    // Read again at a restart.
    await t.services.drafts.load();
    expect(t.services.drafts.renamedLog()).toHaveLength(500);
  });
});
