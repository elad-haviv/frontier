import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AttentionResponse,
  DraftVersionsResponse,
  EntryResponse,
  PublishPlan,
  type StatusSnapshot,
  TreeResponse,
  UnpublishedResponse,
} from "@frontier/schema";
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

  it("counts revisions, and keeps an older save from another device as a kept copy", async () => {
    const first = await save(MIRA, "one\n");
    const second = await save(MIRA, "two\n", { id: first.id, revision: 1 });
    expect(second.revision).toBe(2);

    const stale = await save(MIRA, "from the phone\n", { id: first.id, revision: 1 });
    expect(stale.res.statusCode).toBe(409);
    expect(stale.res.json().error).toMatchObject({ code: "stale_revision", id: first.id });

    const versions = DraftVersionsResponse.parse(
      (await t.get(`/api/drafts/${first.id}/versions`)).json(),
    );
    expect(versions.current).toEqual({ text: "two\n", revision: 2 });
    // A save without a device header, as from an older build, is kept under `unknown`.
    expect(versions.others).toMatchObject([
      { device: "unknown", deviceName: "", text: "from the phone\n" },
    ]);

    const blocked = await t.post("/api/publish/plan", { draftIds: [first.id], renameIds: [] });
    expect(blocked.json().error.message).toMatch(/texts from other devices/);

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

  it("rejects a revision from the future, and keeps a save for a draft now at another path there", async () => {
    const first = await save(MIRA, "one\n");
    expect((await save(MIRA, "x\n", { id: first.id, revision: 5 })).res.statusCode).toBe(400);
    // The draft is at Mira now, as after a move elsewhere: the text is kept beside it (15c).
    const moved = await save("02 People/Shade.md", "x\n", { id: first.id, revision: 1 });
    expect(moved.res.json().error).toMatchObject({ code: "stale_revision", id: first.id });
    expect(t.services.drafts.byPath("02 People/Shade.md")).toBeUndefined();
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

const PHONE = "phone0000001";
const LAPTOP = "laptop000001";

/** A save from the queue of a device: with its headers, the blob it started from and an op. */
async function send(
  device: string | null,
  body: {
    id: string;
    path: string;
    text: string;
    revision: number;
    kind?: string;
    baseBlob?: string;
    op?: string;
  },
  name = "Safari on iPhone",
) {
  const res = await t.app.inject({
    method: "PUT",
    url: "/api/drafts",
    headers: {
      cookie: t.cookie,
      ...(device === null
        ? {}
        : { "frontier-device": device, "frontier-device-name": encodeURIComponent(name) }),
    },
    payload: { kind: "edit", ...body },
  });
  return { res, body: res.json() };
}

const entryOf = async (path: string) =>
  EntryResponse.parse((await t.get("/api/entries?path=" + encodeURIComponent(path))).json());
const versionsOf = async (id: string) =>
  DraftVersionsResponse.parse((await t.get(`/api/drafts/${id}/versions`)).json());
const keptCount = () => t.services.status.snapshot().attention.keptCopies;

describe("saves that say what they started from", () => {
  const HARBOR = "01 Places/Harbor/Harbor.md";

  it("a device's first save, begun offline after another saved a version, is kept beside it", async () => {
    // The phone opens Harbor and loses its connection before its first save reaches the server.
    const opened = await entryOf(HARBOR);
    const phoneText = opened.text + "\nBegun offline on the phone.\n";
    // At home, the laptop edits Harbor and saves a version.
    const laptopText = opened.text + "Written at home.\n";
    const laptop = await send(LAPTOP, {
      id: "laptopdraft2",
      path: HARBOR,
      text: laptopText,
      revision: 0,
      baseBlob: opened.blob,
      op: "laptopop0002",
    });
    expect(laptop.res.statusCode).toBe(200);
    const p = await plan([laptop.body.id]);
    expect((await confirm(p.planId, [], "Harbor, from home")).statusCode).toBe(200);
    expect(mainText(HARBOR)).toBe(laptopText);

    // The phone's first save still names the older text it started from, so it is kept, not built on.
    const phone = await send(PHONE, {
      id: "phonedraft02",
      path: HARBOR,
      text: phoneText,
      revision: 0,
      baseBlob: opened.blob,
      op: "phoneop00003",
    });
    expect(phone.res.statusCode).toBe(409);
    expect(phone.body.error).toMatchObject({ code: "stale_revision", id: "phonedraft02" });
    const versions = await versionsOf("phonedraft02");
    expect(versions.current.text).toBe(laptopText);
    expect(versions.others.map((o) => o.text)).toEqual([phoneText]);
    expect(keptCount()).toBe(1);
  });

  it("CUJ 3: a phone's save after the laptop's draft was saved as a version is kept beside it", async () => {
    // The laptop hears of every new snapshot, as an open page does through the stream.
    const heard: StatusSnapshot[] = [];
    const stop = t.services.status.subscribe((snapshot) => heard.push(snapshot));

    // The phone opens Harbor and saves once, on the train.
    const opened = await entryOf(HARBOR);
    expect(opened.blob).toMatch(/^[0-9a-f]{40}$/);
    const draftId = newId();
    const phoneFirst = await send(PHONE, {
      id: draftId,
      path: HARBOR,
      text: opened.text + "\nTyped on the phone.\n",
      revision: 0,
      baseBlob: opened.blob,
      op: "phoneop00001",
    });
    expect(phoneFirst.body).toEqual({ id: draftId, revision: 1 });
    // The connection drops; the phone keeps typing. Its record still says revision 1, and the
    // library file it started from.
    const phoneUnsent = opened.text + "\nTyped on the phone.\nAnd more, with no connection.\n";

    // At home, the laptop opens the draft, edits it and saves a version.
    const atHome = await entryOf(HARBOR);
    expect(atHome.draft).toEqual({ id: draftId, revision: 1, kind: "edit" });
    const laptopText = atHome.text + "Written at home.\n";
    const laptop = await send(
      LAPTOP,
      {
        id: draftId,
        path: HARBOR,
        text: laptopText,
        revision: 1,
        baseBlob: atHome.blob,
        op: "laptopop0001",
      },
      "Firefox on Linux",
    );
    expect(laptop.body).toEqual({ id: draftId, revision: 2 });
    const p = await plan([draftId]);
    expect((await confirm(p.planId, [], "Harbor, from home")).statusCode).toBe(200);
    expect(mainText(HARBOR)).toBe(laptopText);
    expect(t.services.drafts.list()).toEqual([]);
    expect(keptCount()).toBe(0);

    // The phone gets a connection again and sends what it holds.
    const heardBefore = heard.length;
    const phone = await send(PHONE, {
      id: draftId,
      path: HARBOR,
      text: phoneUnsent,
      revision: 1,
      baseBlob: opened.blob,
      op: "phoneop00002",
    });
    expect(phone.res.statusCode).toBe(409);
    expect(phone.body.error).toMatchObject({ code: "stale_revision", id: draftId });

    // The server did not build on the phone's text: the draft holds the library's text, and the
    // phone's is its kept copy.
    expect(mainText(HARBOR)).toBe(laptopText);
    const now = await entryOf(HARBOR);
    expect(now.text).toBe(laptopText);
    expect(now.draft).toEqual({ id: draftId, revision: 1, kind: "edit" });
    const versions = await versionsOf(draftId);
    expect(versions.current.text).toBe(laptopText);
    expect(versions.others).toEqual([
      {
        device: PHONE,
        deviceName: "Safari on iPhone",
        savedAt: expect.any(String),
        text: phoneUnsent,
      },
    ]);

    // The laptop's attention count rose without a reload, and the list names the draft.
    expect(keptCount()).toBe(1);
    expect(heard.slice(heardBefore).at(-1)?.attention.keptCopies).toBe(1);
    const attention = AttentionResponse.parse((await t.get("/api/attention")).json());
    expect(attention.versions).toEqual([{ draftId, path: HARBOR, count: 1 }]);

    // A draft that differs from the library only by its kept copy survives the next fetch, and
    // cannot be saved as a version until it is merged.
    await t.services.sync();
    expect(t.services.drafts.get(draftId)).toBeDefined();
    expect(
      (await t.post("/api/publish/plan", { draftIds: [draftId], renameIds: [] })).statusCode,
    ).toBe(400);

    // Merging keeps what both typed, and clears the kept copies and the count.
    const merged = laptopText + "And more, with no connection.\n";
    expect(
      (await t.post(`/api/drafts/${draftId}/merge-versions`, { text: merged })).statusCode,
    ).toBe(200);
    expect(keptCount()).toBe(0);
    expect(heard.at(-1)?.attention.keptCopies).toBe(0);
    expect((await entryOf(HARBOR)).text).toBe(merged);
    stop();
  });

  it("starts a new draft from a device's text when its old draft was discarded elsewhere", async () => {
    const opened = await entryOf(MIRA);
    const id = newId();
    await send(PHONE, { id, path: MIRA, text: "one\n", revision: 0, baseBlob: opened.blob });
    // Discarded on the laptop; the library file is unchanged.
    expect((await t.del(`/api/drafts/${id}`)).statusCode).toBe(200);
    const again = await send(PHONE, {
      id,
      path: MIRA,
      text: "two\n",
      revision: 1,
      baseBlob: opened.blob,
    });
    expect(again.body).toEqual({ id, revision: 1 });
    expect((await entryOf(MIRA)).text).toBe("two\n");
    expect(keptCount()).toBe(0);
  });

  it("keeps a device's text when the file it started from was deleted, and a create whose file now exists", async () => {
    const plain = "03 Things/Plain.md";
    const opened = await entryOf(plain);
    t.repo.pushFromOutside({ [plain]: null });
    await t.services.sync();
    const id = newId();
    const res = await send(PHONE, {
      id,
      path: plain,
      text: "Mine, kept.\n",
      revision: 2,
      baseBlob: opened.blob,
    });
    // With no rename to follow, the text the phone started from comes back beside its own, at a
    // path of its own (15c), and the old path is not brought back.
    const recovered = "03 Things/Plain (from Safari on iPhone).md";
    const kept = t.services.drafts.byPath(recovered)!;
    expect(res.body.error).toMatchObject({ code: "stale_revision", id: kept.id });
    expect(kept).toMatchObject({ kind: "create", baseBlob: "" });
    expect(t.services.drafts.byPath(plain)).toBeUndefined();
    const versions = await versionsOf(kept.id);
    expect(versions.current.text).toBe(opened.text);
    expect(versions.others[0]!.text).toBe("Mine, kept.\n");

    // A note this device made, saved as a version elsewhere and changed there since.
    const made = "01 Places/Saltmother.md";
    const first = await send(PHONE, {
      id: newId(),
      path: made,
      kind: "create",
      text: "# Saltmother\n",
      revision: 0,
      baseBlob: "",
    });
    const p = await plan([first.body.id]);
    await confirm(p.planId);
    t.repo.pushFromOutside({ [made]: "# Saltmother\n\nChanged since.\n" });
    await t.services.sync();
    const late = await send(PHONE, {
      id: first.body.id,
      path: made,
      kind: "create",
      text: "# Saltmother\n\nMine.\n",
      revision: 1,
      baseBlob: "",
    });
    expect(late.body.error.code).toBe("stale_revision");
    expect(t.services.drafts.get(first.body.id)).toMatchObject({ kind: "edit" });
    expect((await versionsOf(first.body.id)).current.text).toBe("# Saltmother\n\nChanged since.\n");
  });

  it("keeps one copy per device: three devices give three, and a second save replaces only its own", async () => {
    const { id } = await save(MIRA, "the draft\n");
    await save(MIRA, "the draft, again\n", { id, revision: 1 });
    for (const [device, name] of [
      [PHONE, "Safari on iPhone"],
      [LAPTOP, "Firefox on Linux"],
      ["tablet000001", "Chrome on Android"],
    ] as const) {
      const r = await send(device, { id, path: MIRA, text: `from ${name}\n`, revision: 1 }, name);
      expect(r.res.statusCode).toBe(409);
    }
    await send(PHONE, { id, path: MIRA, text: "from the phone, later\n", revision: 1 });
    const versions = await versionsOf(id);
    expect(versions.current).toEqual({ text: "the draft, again\n", revision: 2 });
    expect(versions.others.map((o) => [o.device, o.deviceName, o.text]).sort()).toEqual([
      [LAPTOP, "Firefox on Linux", "from Firefox on Linux\n"],
      [PHONE, "Safari on iPhone", "from the phone, later\n"],
      ["tablet000001", "Chrome on Android", "from Chrome on Android\n"],
    ]);
    expect(AttentionResponse.parse((await t.get("/api/attention")).json()).versions).toEqual([
      { draftId: id, path: MIRA, count: 3 },
    ]);
    expect(keptCount()).toBe(1);
    // A restart reads them all again.
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    expect(again.services.drafts.keptList()).toEqual([{ draftId: id, path: MIRA, count: 3 }]);
    await again.app.close();
  });

  it("writes nothing for a repeated op", async () => {
    const id = newId();
    const first = await send(PHONE, {
      id,
      path: MIRA,
      text: "one\n",
      revision: 0,
      op: "sameop000001",
    });
    expect(first.body).toEqual({ id, revision: 1 });
    const second = await send(PHONE, {
      id,
      path: MIRA,
      text: "two\n",
      revision: 1,
      op: "sameop000002",
    });
    expect(second.body).toEqual({ id, revision: 2 });
    const before = readFileSync(
      join(t.services.config.dataDir, "state", "drafts", id, "record.json"),
      "utf8",
    );
    // The answer to the second send was lost; the device sends it again.
    const repeat = await send(PHONE, {
      id,
      path: MIRA,
      text: "two\n",
      revision: 1,
      op: "sameop000002",
    });
    expect(repeat.body).toEqual({ id, revision: 2 });
    expect(
      readFileSync(join(t.services.config.dataDir, "state", "drafts", id, "record.json"), "utf8"),
    ).toBe(before);
    expect(t.services.drafts.hasKeptCopies(id)).toBe(false);
    // The op is checked before anything else, even a revision that would be stale.
    const old = await send(PHONE, {
      id,
      path: MIRA,
      text: "two\n",
      revision: 0,
      op: "sameop000002",
    });
    expect(old.body).toEqual({ id, revision: 2 });
  });

  it("reads the spare slot of an earlier Frontier as a copy from an earlier device", async () => {
    const { id } = await save(MIRA, "current\n");
    const folder = join(t.services.config.dataDir, "state", "drafts", id);
    writeFileSync(join(folder, "content.v2"), "from before\n");
    writeFileSync(
      join(folder, "record.v2.json"),
      JSON.stringify({ ...t.services.drafts.get(id), updatedAt: "2026-01-02T03:04:05.000Z" }),
    );
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    expect(again.services.drafts.hasKeptCopies(id)).toBe(true);
    await again.app.close();
    await t.services.drafts.load();
    expect((await versionsOf(id)).others).toEqual([
      {
        device: "earlier",
        deviceName: "",
        savedAt: "2026-01-02T03:04:05.000Z",
        text: "from before\n",
      },
    ]);
    await t.post(`/api/drafts/${id}/merge-versions`, { text: "both\n" });
    expect(existsSync(join(folder, "content.v2"))).toBe(false);
    expect(t.services.drafts.hasKeptCopies(id)).toBe(false);
  });

  it("behaves as before for a save without baseBlob", async () => {
    // No draft and a revision above 0: refused, as today.
    const lost = await send(null, { id: newId(), path: MIRA, text: "x\n", revision: 3 });
    expect(lost.body.error.code).toBe("invalid");
    // A new draft, a save on it, and an older revision kept as a copy.
    const id = newId();
    expect((await send(null, { id, path: MIRA, text: "a\n", revision: 0 })).body).toEqual({
      id,
      revision: 1,
    });
    expect((await send(null, { id, path: MIRA, text: "b\n", revision: 1 })).body).toEqual({
      id,
      revision: 2,
    });
    expect((await send(null, { id, path: MIRA, text: "c\n", revision: 1 })).res.statusCode).toBe(
      409,
    );
    expect((await versionsOf(id)).others.map((o) => o.device)).toEqual(["unknown"]);
    // A first save (revision 0) that started from other text than the library's is kept too.
    const fresh = await send(PHONE, {
      id: newId(),
      path: "02 People/Shade.md",
      text: "s\n",
      revision: 0,
      baseBlob: "not-the-blob",
    });
    expect(fresh.res.statusCode).toBe(409);
    // Without a blob (an older build), a first save builds on the library file, as before.
    const older = await send(null, {
      id: newId(),
      path: "02 People/Twin.md",
      text: "t\n",
      revision: 0,
    });
    expect(older.res.statusCode).toBe(200);
  });

  it("refuses a device header that is not a device id, and cuts a long name", async () => {
    for (const bad of ["../../../etc", "PHONE0000001", "short", "phone00000012"]) {
      const r = await send(bad, { id: newId(), path: MIRA, text: "x\n", revision: 0 });
      expect(r.res.statusCode, bad).toBe(400);
      expect(r.body.error.code).toBe("invalid");
    }
    expect(t.services.drafts.list()).toEqual([]);

    const { id } = await save(MIRA, "the draft\n");
    const long = "A very long name for a device, with ünïcode and more words than fit";
    await send(PHONE, { id, path: MIRA, text: "phone\n", revision: 0 }, long);
    const [copy] = (await versionsOf(id)).others;
    expect(copy!.deviceName).toBe([...long].slice(0, 40).join("").trim());
    // A name that is not valid URI encoding is left out rather than refused.
    const odd = await t.app.inject({
      method: "PUT",
      url: "/api/drafts",
      headers: { cookie: t.cookie, "frontier-device": LAPTOP, "frontier-device-name": "%E0%A4%A" },
      payload: { id, path: MIRA, kind: "edit", text: "laptop\n", revision: 0 },
    });
    expect(odd.statusCode).toBe(409);
    expect((await versionsOf(id)).others.find((o) => o.device === LAPTOP)?.deviceName).toBe("");
    expect(
      readdirSync(join(t.services.config.dataDir, "state", "drafts", id, "versions")).sort(),
    ).toEqual([`${LAPTOP}.json`, `${LAPTOP}.txt`, `${PHONE}.json`, `${PHONE}.txt`]);
  });

  it("does not clear a draft whose only difference from the library is its kept copies", async () => {
    const text = mainText(MIRA)!;
    const { id } = await save(MIRA, text + "\nMine.\n");
    await send(PHONE, { id, path: MIRA, text: "phone\n", revision: 0 });
    // The draft is put back to the library's text, so only the kept copy differs.
    await t.post(`/api/drafts/${id}/resolve`, { text });
    await t.services.publisher.clearPublished();
    expect(t.services.drafts.get(id)).toBeDefined();
    await t.post(`/api/drafts/${id}/merge-versions`, { text });
    await t.services.publisher.clearPublished();
    expect(t.services.drafts.get(id)).toBeUndefined();
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
      for (const arg of args) {
        expect(arg.startsWith("--force")).toBe(false);
        if (args[0] !== "fetch") expect(arg.startsWith("+")).toBe(false);
      }
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

  it("keeps one rename per entry: a rename then a move gives one intent from where it is", async () => {
    const first = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    expect(first.replaced).toBeNull();
    // Named where it is, as the entry's page names it.
    const second = await rename(MIRA, "03 Things/Mira Vale.md");
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().replaced).toEqual({ from: MIRA, to: "02 People/Mira Vale.md" });
    expect(t.services.drafts.listRenames()).toEqual([
      expect.objectContaining({ id: second.json().id, from: MIRA, to: "03 Things/Mira Vale.md" }),
    ]);
    // Named where it goes, as the tree names it.
    const third = (await rename("03 Things/Mira Vale.md", "03 Things/Mira the Bold.md")).json();
    expect(t.services.drafts.listRenames()).toEqual([
      expect.objectContaining({ id: third.id, from: MIRA, to: "03 Things/Mira the Bold.md" }),
    ]);
    const entry = EntryResponse.parse(
      (await t.get(`/api/entries?path=${encodeURIComponent(MIRA)}`)).json(),
    );
    expect(entry.rename).toEqual({ id: third.id, to: "03 Things/Mira the Bold.md" });
    // Back to where it is in the library is no rename; Undo is.
    expect((await rename(MIRA, MIRA)).statusCode).toBe(400);
    expect(t.services.drafts.listRenames()).toHaveLength(1);
    const p = await plan([], [third.id]);
    await confirm(p.planId, [], "Rename Mira");
    expect(mainText("03 Things/Mira the Bold.md")).toContain("# Mira");
    expect(mainText("02 People/Shade.md")).toContain("[[Mira the Bold]]");
  });

  it("keeps rename intents across a restart", async () => {
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    const again = await buildApp(loadConfig(testEnv(t.repo)));
    expect(again.services.drafts.listRenames().map((r) => r.id)).toEqual([id]);
    await again.app.close();
  });
});

describe("renames and the folder file", () => {
  const rename = (from: string, to: string) => t.post("/api/renames", { from, to });
  const FOLDERS = ".frontier/folders.json";
  const find = (
    folders: TreeResponse["folders"],
    path: string,
  ): TreeResponse["folders"][number] | undefined => {
    for (const f of folders) {
      if (f.path === path) return f;
      const inner = find(f.folders, path);
      if (inner) return inner;
    }
    return undefined;
  };

  it("rewrites the folder file's paths in the same commit as the rename", async () => {
    const saved = await t.put("/api/library-files/folders", {
      file: {
        version: 1,
        folders: [
          { path: "01 Places/Harbor", icon: "anchor", order: "V" },
          { path: "01 Places/Harbor/Docks" },
          { path: "02 People", color: "rose" },
        ],
      },
      revision: 0,
      baseBlob: "",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const made = await rename("01 Places/Harbor", "02 People/Harbor");
    expect(made.statusCode, made.body).toBe(200);
    const { id } = made.json();

    // The tree shows the folder where it is going, its entries linked where they still are.
    const tree = TreeResponse.parse((await t.get("/api/tree")).json());
    const moved = find(tree.folders, "02 People/Harbor")!;
    expect(moved).toMatchObject({ moved: "01 Places/Harbor", renameId: id, icon: "anchor" });
    expect(moved.notes.map((n) => [n.path, n.moved])).toEqual([
      ["02 People/Harbor/Harbor.md", "01 Places/Harbor/Harbor.md"],
      ["02 People/Harbor/Old Quay.md", "01 Places/Harbor/Old Quay.md"],
    ]);
    expect(find(moved.folders, "02 People/Harbor/Docks")!.empty).toBe(true);
    expect(find(tree.folders, "01 Places/Harbor")).toBeUndefined();

    // The rename and the folder file's draft go out together.
    const u = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const folderDraft = u.drafts.find((d) => d.path === FOLDERS)!;
    const p = await plan(
      u.drafts.map((d) => d.id),
      [id],
    );
    expect(p.groups).toContainEqual([id, folderDraft.id]);
    const res = await confirm(p.planId);
    expect(res.statusCode, res.body).toBe(200);
    expect(mainText(FOLDERS)!.split("\n").slice(3, 6)).toEqual([
      '    {"path":"02 People/Harbor","icon":"anchor","order":"V"},',
      '    {"path":"02 People/Harbor/Docks"},',
      '    {"path":"02 People","color":"rose"}',
    ]);
    // Nothing is left unpublished: the draft of the folder file was the version saved.
    expect(t.services.drafts.list()).toEqual([]);
    expect(t.services.drafts.listRenames()).toEqual([]);
  });

  it("holds a rename back while the folder file's draft is not chosen", async () => {
    await t.put("/api/library-files/folders", {
      file: { version: 1, folders: [{ path: "01 Places/Harbor", icon: "anchor" }] },
      revision: 0,
    });
    const { id } = (await rename("01 Places/Harbor", "01 Places/Port")).json();
    const p = await plan([], [id]);
    const res = await confirm(p.planId);
    expect(res.statusCode).toBe(400);
    expect(mainText("01 Places/Port/Port.md")).toBeNull();
  });

  it("creates the folder file from the schema's lists when it existed only in memory", async () => {
    t.repo.pushFromOutside({
      ".frontier/schema.yaml":
        'version: 1\ntypes:\n  place: { folders: ["01 Places"] }\n  person: { folders: ["02 People"] }\nwhat: {}\n',
    });
    await t.services.sync();
    expect(mainText(FOLDERS)).toBeNull();
    const { id } = (await rename("01 Places", "Places")).json();
    const res = await confirm((await plan([], [id])).planId);
    expect(res.statusCode, res.body).toBe(200);
    expect(mainText(FOLDERS)).toContain('{"path":"Places","type":"place"}');
    expect(mainText(FOLDERS)).toContain('{"path":"02 People","type":"person"}');
    const entry = EntryResponse.parse(
      (await t.get(`/api/entries?path=${encodeURIComponent("Places/Unwritten.md")}`)).json(),
    );
    expect(entry.fields).toMatchObject({ type: "place", typeFrom: "folder" });
  });

  it("leaves the folder file alone when a rename touches none of its folders", async () => {
    const { id } = (await rename(MIRA, "02 People/Mira Vale.md")).json();
    const res = await confirm((await plan([], [id])).planId);
    expect(res.statusCode, res.body).toBe(200);
    expect(mainText(FOLDERS)).toBeNull();
  });

  it("follows a rename published from elsewhere in the folder file's draft", async () => {
    await t.put("/api/library-files/folders", {
      file: { version: 1, folders: [{ path: "01 Places/Harbor", icon: "anchor" }] },
      revision: 0,
    });
    // An intent whose rename reached the library some other way is cleared at the next fetch,
    // and the draft names the folder's new place.
    await rename("01 Places/Harbor", "01 Places/Port");
    t.repo.pushFromOutside({
      "01 Places/Harbor/Harbor.md": null,
      "01 Places/Harbor/Old Quay.md": null,
      "01 Places/Port/Port.md": "# Port\n",
    });
    await t.services.sync();
    expect(t.services.drafts.listRenames()).toEqual([]);
    const draft = t.services.drafts.byPath(FOLDERS)!;
    expect(await t.services.drafts.text(draft.id)).toContain('"path":"01 Places/Port"');
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
