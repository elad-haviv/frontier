/**
 * Stage 27e: comments between people. Each role against each action (own and other people's),
 * the move from private notes to the first owner (and running it again), nothing of anyone's
 * unsaved changes reaching a reader, names (never an email to a non-owner), the members who left,
 * the status stream's word that comments changed, and the counts in the keep-going queue.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueueResponse, StatusSnapshot } from "@frontier/schema";
import { buildApp } from "../src/app.js";
import { CommentStore } from "../src/comments/store.js";
import { loadConfig } from "../src/config.js";
import { StateFiles } from "../src/state/files.js";
import {
  addMember,
  addPerson,
  type Client,
  makeTestApp,
  type TestApp,
  testEnv,
} from "./helpers/app.js";

const ROAD = "03 Places/Long Road.md";
const SALT = "The toll on the Long Road is paid in salt.";
const WAYS = "The salt comes by sea.";

let t: TestApp;
let base: string;
let projectId: string;
let wren: Client; // writer
let wes: Client; // writer
let rhea: Client; // reader
let rae: Client; // reader
let n = 0;
const newId = () => `cmt${String(++n).padStart(9, "0")}`;

beforeEach(async () => {
  t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" }, { settleMs: 0 });
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  projectId = first.id;
  base = `/api/p/${first.slug}`;
  t.repo.pushFromOutside({ [ROAD]: `# Long Road\n\nA road.\n\n${SALT}\n\n${WAYS}\n` });
  await t.services.sync();
  wren = await addPerson(t, "Wren Writer", "wren@example.com");
  wes = await addPerson(t, "Wes Writer", "wes@example.com");
  rhea = await addPerson(t, "Rhea Reader", "rhea@example.com");
  rae = await addPerson(t, "Rae Reader", "rae@example.com");
  await addMember(t, projectId, wren.id, "writer");
  await addMember(t, projectId, wes.id, "writer");
  await addMember(t, projectId, rhea.id, "reader");
  await addMember(t, projectId, rae.id, "reader");
});
afterEach(() => t.close());

type Who = Pick<Client, "get" | "post" | "put" | "del"> & { cookie: string };
const owner = (): Who => ({
  get: (u) => t.get(u),
  post: (u, b) => t.post(u, b),
  put: (u, b) => t.put(u, b),
  del: (u) => t.del(u),
  cookie: t.cookie,
});
const patch = (who: Who, url: string, payload: unknown) =>
  t.app.inject({
    method: "PATCH",
    url,
    payload: payload as object,
    headers: { cookie: who.cookie },
  });

const path = encodeURIComponent(ROAD);
type Shown = {
  id: string;
  text: string;
  for: string;
  editedAt: string | null;
  author: { id: string; name: string; role: string | null };
  resolved: { by: { name: string }; at: string } | null;
  replies: {
    id: string;
    text: string;
    editedAt: string | null;
    author: { name: string };
    can: { edit: boolean; delete: boolean };
  }[];
  can: { edit: boolean; delete: boolean; resolve: boolean; hand: boolean };
};
const list = async (who: Who): Promise<Shown[]> =>
  (await who.get(`${base}/comments?path=${path}`)).json().comments;

const say = (who: Who, extra: Record<string, unknown> = {}) =>
  who.post(`${base}/comments`, {
    path: ROAD,
    quote: SALT,
    prefix: "A road.\n\n",
    suffix: "\n\n",
    text: "Since when?",
    for: "me",
    ...extra,
  });
const made = async (who: Who, extra: Record<string, unknown> = {}): Promise<string> => {
  const res = await say(who, extra);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().comment.id;
};

const code = (res: { statusCode: number; json(): { error?: { code: string } } }) => [
  res.statusCode,
  res.json().error?.code,
];

describe("every role comments and replies, and reads what the others wrote", () => {
  it("lets an owner, a writer and a reader add a comment and a reply, and all read them", async () => {
    const people: [string, Who][] = [
      ["owner", owner()],
      ["writer", wren],
      ["reader", rhea],
    ];
    for (const [role, who] of people) {
      const id = await made(who, { text: `From the ${role}` });
      const reply = await who.post(`${base}/comments/${id}/replies`, {
        text: `Reply from ${role}`,
      });
      expect(reply.statusCode, reply.body).toBe(200);
    }
    for (const who of [owner(), wren, wes, rhea, rae]) {
      const seen = await list(who);
      expect(seen.map((c) => c.text).sort()).toEqual([
        "From the owner",
        "From the reader",
        "From the writer",
      ]);
      expect(seen.every((c) => c.replies.length === 1)).toBe(true);
    }
    expect((await rae.get(`${base}/comments/count?path=${path}`)).json()).toEqual({ open: 3 });
  });

  it("shows the author's name, role and time, and the passage; a comment can be on the whole entry", async () => {
    await made(rhea);
    const whole = await say(wren, {
      quote: "",
      prefix: "",
      suffix: "",
      text: "A thought on all of it",
    });
    expect(whole.statusCode, whole.body).toBe(200);
    const seen = await list(rae);
    const mine = seen.find((c) => c.text === "Since when?")!;
    expect(mine.author).toMatchObject({ id: rhea.id, name: "Rhea Reader", role: "reader" });
    expect(mine).toMatchObject({ quote: SALT, editedAt: null, resolved: null });
    expect(Number.isNaN(Date.parse((mine as unknown as { at: string }).at))).toBe(false);
    expect(seen.find((c) => c.text.startsWith("A thought"))).toMatchObject({
      quote: "",
      author: { name: "Wren Writer", role: "writer" },
    });
  });
});

describe("what each role may do to a comment, its own and another person's", () => {
  it("edits the words of one's own comment only, whatever the role, and marks it edited", async () => {
    const id = await made(rhea);
    const url = `${base}/comments/${id}`;
    // Not another reader, not a writer, not even an owner.
    for (const who of [rae, wren, owner()]) {
      expect(code(await patch(who, url, { text: "Changed" })), who.cookie).toEqual([
        403,
        "role_too_low",
      ]);
    }
    const ok = await patch(rhea, url, { text: "Since when, exactly?" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().comment).toMatchObject({ text: "Since when, exactly?" });
    expect(ok.json().comment.editedAt).not.toBeNull();
    // A writer's own, too.
    const mine = await made(wren);
    expect((await patch(wren, `${base}/comments/${mine}`, { text: "Mine" })).statusCode).toBe(200);
    // The same words again are no edit.
    const same = await patch(wren, `${base}/comments/${mine}`, { text: "Mine" });
    expect(same.json().comment.editedAt).toBe(
      (await patch(wren, `${base}/comments/${mine}`, { text: "Mine" })).json().comment.editedAt,
    );
  });

  it("deletes one's own, and an owner deletes anyone's; nobody else deletes another's", async () => {
    const byRhea = await made(rhea);
    const byWren = await made(wren);
    const byOwner = await made(owner());
    // Another reader and a writer cannot delete a reader's, or each other's.
    expect(code(await rae.del(`${base}/comments/${byRhea}`))).toEqual([403, "role_too_low"]);
    expect(code(await wes.del(`${base}/comments/${byRhea}`))).toEqual([403, "role_too_low"]);
    expect(code(await rhea.del(`${base}/comments/${byWren}`))).toEqual([403, "role_too_low"]);
    expect(code(await wes.del(`${base}/comments/${byWren}`))).toEqual([403, "role_too_low"]);
    expect(code(await wren.del(`${base}/comments/${byOwner}`))).toEqual([403, "role_too_low"]);
    expect(await list(owner())).toHaveLength(3);
    // Own: each role.
    expect((await rhea.del(`${base}/comments/${byRhea}`)).statusCode).toBe(200);
    expect((await wren.del(`${base}/comments/${byWren}`)).statusCode).toBe(200);
    // An owner removes anyone's.
    const again = await made(rhea);
    expect((await owner().del(`${base}/comments/${again}`)).statusCode).toBe(200);
    expect((await owner().del(`${base}/comments/${byOwner}`)).statusCode).toBe(200);
    expect(await list(owner())).toEqual([]);
  });

  it("resolves and reopens a thread: its author, any writer, any owner, and not another reader", async () => {
    const id = await made(rhea);
    const resolve = `${base}/comments/${id}/resolve`;
    const reopen = `${base}/comments/${id}/reopen`;
    // Another reader cannot do either.
    expect(code(await rae.post(resolve, {}))).toEqual([403, "role_too_low"]);
    expect((await rae.get(`${base}/comments/count?path=${path}`)).json()).toEqual({ open: 1 });
    // The author, a writer, an owner each can, and each can reopen.
    for (const who of [rhea, wes, owner()]) {
      const done = await who.post(resolve, {});
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json().comment.resolved).toMatchObject({ at: expect.any(String) });
      expect((await rae.get(`${base}/comments/count?path=${path}`)).json()).toEqual({ open: 0 });
      expect(code(await rae.post(reopen, {}))).toEqual([403, "role_too_low"]);
      const open = await who.post(reopen, {});
      expect(open.json().comment.resolved).toBeNull();
    }
    // The name of who resolved it is kept.
    const done = await wes.post(resolve, {});
    expect(done.json().comment.resolved.by.name).toBe("Wes Writer");
    // A reader may resolve their own and not a writer's.
    const byWren = await made(wren);
    expect(code(await rhea.post(`${base}/comments/${byWren}/resolve`, {}))).toEqual([
      403,
      "role_too_low",
    ]);
    expect((await wren.post(`${base}/comments/${byWren}/resolve`, {})).statusCode).toBe(200);
  });

  it("tells each person, in `can`, what they may do", async () => {
    await made(rhea);
    const flags = async (who: Who) => (await list(who))[0]!.can;
    expect(await flags(rhea)).toEqual({ edit: true, delete: true, resolve: true, hand: false });
    expect(await flags(rae)).toEqual({ edit: false, delete: false, resolve: false, hand: false });
    expect(await flags(wes)).toEqual({ edit: false, delete: false, resolve: true, hand: false });
    expect(await flags(owner())).toEqual({ edit: false, delete: true, resolve: true, hand: false });
  });

  it("replies: anyone adds, edits their own only, and deletes their own (an owner anyone's)", async () => {
    const id = await made(wren);
    const r1 = (await rhea.post(`${base}/comments/${id}/replies`, { text: "From Rhea" })).json()
      .comment.replies[0].id;
    const r2 = (await wes.post(`${base}/comments/${id}/replies`, { text: "From Wes" })).json()
      .comment.replies[1].id;
    const url = (rid: string) => `${base}/comments/${id}/replies/${rid}`;
    // Edit: only one's own, not even the comment's author or an owner.
    for (const who of [rae, wren, owner(), wes]) {
      expect(code(await patch(who, url(r1), { text: "X" }))).toEqual([403, "role_too_low"]);
    }
    const edited = await patch(rhea, url(r1), { text: "From Rhea, edited" });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().comment.replies[0]).toMatchObject({ text: "From Rhea, edited" });
    expect(edited.json().comment.replies[0].editedAt).not.toBeNull();
    expect(edited.json().comment.replies[1].editedAt).toBeNull();
    // Delete: another reader, a writer and the comment's author cannot; the owner can.
    for (const who of [rae, wren, wes]) {
      expect(code(await who.del(url(r1)))).toEqual([403, "role_too_low"]);
    }
    expect(
      (await rhea.del(url(r1))).json().comment.replies.map((r: { id: string }) => r.id),
    ).toEqual([r2]);
    expect((await owner().del(url(r2))).json().comment.replies).toEqual([]);
    expect(code(await owner().del(url(r2)))).toEqual([404, "not_found"]);
  });

  it("gives a comment to the AI only to a writer, for their own comment, and keeps it private", async () => {
    // A reader may not leave one for the AI, nor give theirs to it.
    expect(code(await say(rhea, { for: "ai" }))).toEqual([403, "role_too_low"]);
    const theirs = await made(rhea);
    expect(code(await patch(rhea, `${base}/comments/${theirs}`, { for: "ai" }))).toEqual([
      403,
      "role_too_low",
    ]);
    // A writer's own: private to them, whatever the others try.
    const ai = await made(wren, { for: "ai", text: "Tighten this" });
    expect((await list(wren)).map((c) => c.text)).toContain("Tighten this");
    for (const who of [owner(), wes, rhea]) {
      expect((await list(who)).map((c) => c.text)).not.toContain("Tighten this");
      expect(code(await patch(who, `${base}/comments/${ai}`, { text: "x" }))).toEqual([
        404,
        "not_found",
      ]);
      expect(code(await who.del(`${base}/comments/${ai}`))).toEqual([404, "not_found"]);
      expect(code(await who.post(`${base}/comments/${ai}/resolve`, {}))).toEqual([
        404,
        "not_found",
      ]);
      expect(code(await who.post(`${base}/comments/${ai}/replies`, { text: "hi" }))).toEqual([
        404,
        "not_found",
      ]);
    }
    expect(code(await rhea.post(`${base}/comments/${ai}/work`, {}))).toEqual([403, "role_too_low"]);
    expect(code(await wes.post(`${base}/comments/${ai}/work`, {}))).toEqual([404, "not_found"]);
    // Giving a shared comment to the AI is its writer's, and no other writer's.
    const shared = await made(wren);
    expect(code(await patch(wes, `${base}/comments/${shared}`, { for: "ai" }))).toEqual([
      403,
      "role_too_low",
    ]);
    expect((await patch(wren, `${base}/comments/${shared}`, { for: "ai" })).statusCode).toBe(200);
    expect((await list(wes)).map((c) => c.id)).not.toContain(shared);
    // Not counted for anyone: the one left is the reader's.
    expect((await t.get(`${base}/comments/count?path=${path}`)).json()).toEqual({ open: 1 });
  });

  it("keeps the words and sizes sensible: no empty text, a length cap, no more than the limits", async () => {
    expect(code(await say(rhea, { text: "   " }))[0]).toBe(400);
    expect(code(await say(rhea, { text: "x".repeat(2001) }))[0]).toBe(400);
    expect(code(await say(rhea, { path: "03 Places/map.png" }))[0]).toBe(400);
    expect(code(await say(rhea, { quote: "ab" }))[0]).toBe(400);
    const id = await made(rhea);
    expect(
      code(await rae.post(`${base}/comments/${id}/replies`, { text: "x".repeat(2001) }))[0],
    ).toBe(400);
    // The words are kept as plain text: nothing is turned into markup on the way in.
    const html = await made(rhea, { text: "<script>alert(1)</script> **bold**" });
    expect((await list(rae)).find((c) => c.id === html)!.text).toBe(
      "<script>alert(1)</script> **bold**",
    );
  });

  it("limits how fast one person writes", async () => {
    const id = await made(rae);
    let last = 0;
    for (let i = 0; i < 45 && last !== 429; i++) {
      last = (await rae.post(`${base}/comments/${id}/replies`, { text: `r${i}` })).statusCode;
    }
    expect(last).toBe(429);
    // Someone else is not held up by it.
    expect(
      (await rhea.post(`${base}/comments/${id}/replies`, { text: "Still fine" })).statusCode,
    ).toBe(200);
  });
});

describe("a reader never learns anything about unsaved changes", () => {
  const SECRET = "A secret line only Wren has typed so far.";

  async function draftOf(who: Who, p: string, text: string, kind: "edit" | "create" = "edit") {
    const e = (await who.get(`${base}/entries?path=${encodeURIComponent(p)}`)).json();
    const res = await who.put(`${base}/drafts`, {
      id: newId(),
      path: p,
      kind,
      text,
      revision: 0,
      baseBlob: kind === "edit" ? e.blob : "",
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  it("refuses a shared comment on text only someone's unsaved changes hold, the same way as on text that is nowhere", async () => {
    await draftOf(wren, ROAD, `# Long Road\n\nA road.\n\n${SALT}\n\n${WAYS}\n\n${SECRET}\n`);
    const onDraft = await say(rhea, { quote: SECRET, prefix: "", suffix: "" });
    const nowhere = await say(rhea, {
      quote: "A line nobody wrote anywhere at all.",
      prefix: "",
      suffix: "",
    });
    expect(onDraft.statusCode).toBe(400);
    expect(onDraft.json()).toEqual(nowhere.json());
    // Writers, other writers and owners also comment on saved text only: what is shared is saved.
    for (const who of [wes, owner(), wren]) {
      expect((await say(who, { quote: SECRET, prefix: "", suffix: "" })).statusCode).toBe(400);
    }
    // A note for oneself (the AI) on one's own unsaved text is private to its writer.
    expect((await say(wren, { quote: SECRET, prefix: "", suffix: "", for: "ai" })).statusCode).toBe(
      200,
    );
    expect((await list(rhea)).map((c) => c.quote)).not.toContain(SECRET);
    expect(JSON.stringify(await list(rhea))).not.toContain("secret");
    expect(JSON.stringify(await list(owner()))).not.toContain("secret");
  });

  it("refuses a shared comment on an entry that exists only as someone's unsaved new entry, as on one that is not there", async () => {
    const NEW = "03 Places/Unwritten.md";
    await draftOf(wren, NEW, "# Unwritten\n\nA new thought.\n", "create");
    const a = await say(rhea, { path: NEW, quote: "A new thought." });
    const b = await say(rhea, { path: "03 Places/Never.md", quote: "A new thought." });
    expect(a.statusCode).toBe(400);
    expect(a.json()).toEqual(b.json());
    expect(
      (await rhea.get(`${base}/comments?path=${encodeURIComponent(NEW)}`)).json().comments,
    ).toEqual([]);
  });

  it("a reader's comment never changes what a writer's draft or the saved text says", async () => {
    await made(rhea);
    const r = (await rhea.get(`${base}/entries?path=${path}`)).json();
    expect(r.text).toContain(SALT);
    expect((await t.get(`${base}/unpublished`)).json().drafts).toEqual([]);
  });
});

describe("names", () => {
  it("shows a name, never an email except to an owner when there is no name", async () => {
    const nameless = await addPerson(t, "", "quiet@example.com");
    await addMember(t, projectId, nameless.id, "reader");
    await made(nameless, { text: "From nobody in particular" });
    const by = async (who: Who) =>
      (await list(who)).find((c) => c.text.startsWith("From nobody"))!.author.name;
    expect(await by(wren)).toBe("Someone");
    expect(await by(rae)).toBe("Someone");
    expect(await by(owner())).toBe("quiet@example.com");
    for (const who of [wren, rae]) {
      expect(JSON.stringify(await list(who))).not.toContain("example.com");
    }
  });
});

describe("a member who left", () => {
  it("leaves their comments and replies in place, with their name and no role", async () => {
    const id = await made(rae, { text: "A reader's comment" });
    await wren.post(`${base}/comments/${id}/replies`, { text: "A writer replies" });
    const own = await made(wren, { text: "Wren's own" });
    await rae.post(`${base}/comments/${own}/replies`, { text: "Rae again" });
    await t.server.projects.update(projectId, (p) => ({
      ...p,
      members: p.members.filter((m) => m.personId !== rae.id),
      formerMembers: [...p.formerMembers, rae.id],
    }));
    const seen = await list(wes);
    const theirs = seen.find((c) => c.id === id)!;
    expect(theirs.text).toBe("A reader's comment");
    expect(theirs.author).toMatchObject({ name: "Rae Reader", role: null });
    expect(theirs.replies.map((r) => r.text)).toEqual(["A writer replies"]);
    expect(seen.find((c) => c.id === own)!.replies[0]!.author.name).toBe("Rae Reader");
    // They can no longer read or write, and an owner can still remove what they wrote.
    expect((await rae.get(`${base}/comments?path=${path}`)).statusCode).toBe(403);
    expect((await owner().del(`${base}/comments/${id}`)).statusCode).toBe(200);
  });

  it("keeps the name written down when the account itself is gone", async () => {
    const id = await made(rae, { text: "Remembered" });
    const files = new StateFiles();
    const stateDir = join(t.services.config.dataDir, "state");
    // Whoever wrote it is not known any more: the store's own record of the name is shown.
    const store = new CommentStore(stateDir, files, {
      nameOf: () => "Someone else",
      legacyOwner: () => null,
    });
    const [c] = await store.forPath(ROAD);
    expect(c!.id).toBe(id);
    expect(c!.name).toBe("Rae Reader");
  });
});

describe("comments from before people", () => {
  const legacy = (over: Record<string, unknown> = {}) => ({
    id: "abcdefghij01",
    path: ROAD,
    quote: SALT,
    prefix: "",
    suffix: "",
    text: "An old note",
    for: "me",
    at: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("go to the first owner when the store loads, and loading again changes nothing", async () => {
    const dir = join(t.repo.root, "legacy-state");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "comments.json"),
      JSON.stringify({ comments: [legacy(), legacy({ id: "abcdefghij02", for: "ai" })] }),
    );
    const files = new StateFiles();
    let owner: string | null = null;
    const store = new CommentStore(dir, files, { legacyOwner: () => owner, nameOf: () => "Olive" });
    // Before an owner can be named they are read as nobody's, and the file is left alone.
    await store.load();
    expect(
      JSON.parse(readFileSync(join(dir, "comments.json"), "utf8")).comments[0].person,
    ).toBeUndefined();
    owner = "ownerid";
    const [first] = await store.forPath(ROAD);
    expect(first).toMatchObject({ person: "ownerid", name: "Olive", replies: [] });
    await store.load();
    const once = readFileSync(join(dir, "comments.json"), "utf8");
    const written = JSON.parse(once).comments as { person: string; name: string }[];
    expect(written.map((c) => [c.person, c.name])).toEqual([
      ["ownerid", "Olive"],
      ["ownerid", "Olive"],
    ]);
    // A second run, and a store made afresh from the file, say the same.
    await store.load();
    const again = new CommentStore(dir, new StateFiles(), { legacyOwner: () => "someone-else" });
    await again.load();
    expect(readFileSync(join(dir, "comments.json"), "utf8")).toBe(once);
    expect((await again.forPath(ROAD))[0]!.person).toBe("ownerid");
  });

  it("belong, in a project's own store, to the admin when an owner, else the earliest owner", async () => {
    const comments = join(t.services.config.dataDir, "state", "comments.json");
    // The admin owns the project: the old notes are the admin's.
    const rebuild = async () => {
      await t.app.close();
      const again = await buildApp(loadConfig(testEnv(t.repo)), { settleMs: 0 });
      t.app = again.app;
      t.services = again.services;
      t.server = again.server;
      await again.services.git.ensureClone();
      await again.services.sync();
      return again;
    };
    writeFileSync(comments, JSON.stringify({ comments: [legacy()] }));
    const admin = (await t.server.people.all())[0]!;
    // The admin's first request in a project with no owner makes them its owner.
    await t.get(`${base}/comments?path=${path}`);
    let app = await rebuild();
    expect((await app.services.comments.forPath(ROAD))[0]!.person).toBe(admin.id);
    expect(JSON.parse(readFileSync(comments, "utf8")).comments[0].person).toBe(admin.id);
    // The admin is no owner: the earliest owner has them.
    await t.server.projects.update(projectId, (p) => ({
      ...p,
      members: p.members.map((m) =>
        m.personId === admin.id
          ? { ...m, role: "writer" as const }
          : m.personId === wes.id
            ? { ...m, role: "owner" as const, addedAt: "2026-03-01T00:00:00.000Z" }
            : m.personId === wren.id
              ? { ...m, role: "owner" as const, addedAt: "2026-02-01T00:00:00.000Z" }
              : m,
      ),
    }));
    writeFileSync(comments, JSON.stringify({ comments: [legacy()] }));
    app = await rebuild();
    expect((await app.services.comments.forPath(ROAD))[0]!.person).toBe(wren.id);
  });
});

describe("the status stream says that comments changed, never what they say", () => {
  async function stream(who: { cookie: string }) {
    await t.app.listen({ port: 0, host: "127.0.0.1" }).catch(() => undefined);
    const address = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
    const res = await fetch(`${address}${base}/status/events`, { headers: { cookie: who.cookie } });
    const reader = res.body!.getReader();
    let buffer = "";
    const raw: string[] = [];
    const seen: StatusSnapshot[] = [];
    const read = async () => {
      const { value, done } = await reader.read();
      if (done) throw new Error("the stream ended");
      buffer += new TextDecoder().decode(value);
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end === -1) return;
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (line) {
          raw.push(line);
          seen.push(JSON.parse(line.slice(6)) as StatusSnapshot);
        }
      }
    };
    return {
      raw,
      seen,
      async until(ok: (s: StatusSnapshot) => boolean, ms = 5000) {
        const stop = Date.now() + ms;
        for (;;) {
          const found = seen.find(ok);
          if (found) return found;
          if (Date.now() > stop) throw new Error("no matching event");
          await Promise.race([read(), new Promise((r) => setTimeout(r, 100))]);
        }
      },
      close: () => reader.cancel().catch(() => undefined),
    };
  }

  it("tells a reader's stream when a writer comments, replies, resolves and deletes, with the entry and no words", async () => {
    const s = await stream(rhea);
    const first = await s.until(() => true);
    const before = first.comments?.changes ?? 0;
    const id = await made(wren, { text: "Quiet words about the toll" });
    const added = await s.until((x) => (x.comments?.changes ?? 0) > before);
    expect(added.comments).toEqual({ changes: before + 1, path: ROAD });
    await wes.post(`${base}/comments/${id}/replies`, { text: "More quiet words" });
    await wes.post(`${base}/comments/${id}/resolve`, {});
    await wren.del(`${base}/comments/${id}`);
    const last = await s.until((x) => (x.comments?.changes ?? 0) >= before + 4);
    expect(last.comments?.path).toBe(ROAD);
    expect(s.raw.join("\n")).not.toContain("quiet words");
    await s.close();
  });

  it("is silent about a comment only its writer sees", async () => {
    const s = await stream(rhea);
    const before = (await s.until(() => true)).comments?.changes ?? 0;
    await made(wren, { for: "ai", text: "Private" });
    await new Promise((r) => setTimeout(r, 300));
    await made(wes, { text: "Shared" });
    const after = await s.until((x) => (x.comments?.changes ?? 0) > before);
    expect(after.comments?.changes).toBe(before + 1);
    await s.close();
  });
});

describe("open comments in the keep-going queue", () => {
  const rows = async (who: Who) =>
    ((await who.get(`${base}/keep-going/queue`)).json() as QueueResponse).needsLove.rows;
  const reasons = async (who: Who) =>
    (await rows(who))
      .find((r) => r.path === ROAD)
      ?.reasons.filter((r) => r.rule === "openComments");

  it("counts open shared comments for readers too; resolved and private ones are not counted", async () => {
    const one = await made(rhea);
    await made(wren);
    await made(wren, { for: "ai", text: "Private" });
    for (const who of [owner(), wren, rhea]) {
      expect(await reasons(who), who.cookie).toEqual([
        { rule: "openComments", text: "2 open comments" },
      ]);
    }
    await wren.post(`${base}/comments/${one}/resolve`, {});
    expect(await reasons(rhea)).toEqual([{ rule: "openComments", text: "1 open comment" }]);
  });
});
