/**
 * What came from `main` after projects (stages 27 to 30 as numbered there: talking with a
 * character, pictures for entries, relations and Trees), under this branch's rules: roles, one
 * person's work not another's, the saved view for readers, and each person's own AI key.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AI_KEYS_HEADER, type DeviceKeys, encodeDeviceKeys } from "@frontier/schema";
import { addMember, addPerson, type Client, makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
let base: string;

const NIRANI = "04 Inhabitants/Nirani.md";
const KINSMAN = "04 Inhabitants/Kinsman.md";
const SECRET = "A plan only the writer has made";
const SECRET_KIN = "Hidden Cousin";
const MODEL = "test/talker";
const PAINTER = "test/painter";

const NOTES: Record<string, string> = {
  [NIRANI]:
    "# Nirani\n\nThe Nirani keep time by the pulse of the deep currents, which they call [[Vaakh]].\n",
  [KINSMAN]: "# Kinsman\n\nKin of the Nirani.\n",
  "01 Universe/Vaakh.md": "# Vaakh\n\nVaakh is counted in slow beats.\n",
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** What the fake provider was sent: the key of each call, and what the chat was given to read. */
const sent: { auth: string; path: string; text: string }[] = [];

const fake: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  if (auth.includes("WRONG")) {
    return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
  }
  if (path.endsWith("/models")) return Response.json({ data: [] });
  const text = String(init?.body);
  sent.push({ auth, path, text });
  if (path.endsWith("/images")) {
    return Response.json({ data: [{ b64_json: PNG.toString("base64") }], usage: { cost: 0.04 } });
  }
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            lines: [{ text: "We count by the currents.", sources: [NIRANI], quotes: [] }],
          }),
        },
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 200, cost: 0.004 },
  });
};

interface Person {
  client: Client;
  keys: DeviceKeys;
}
let owner: Person;
let writer: Person;
let otherWriter: Person;
let reader: Person;
let keyless: Person;

/** A request as a person, with the AI keys their device holds. */
const as = (who: Person, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown) =>
  t.app.inject({
    method,
    url,
    headers: {
      cookie: who.client.cookie,
      ...(Object.keys(who.keys).length > 0 ? { [AI_KEYS_HEADER]: encodeDeviceKeys(who.keys) } : {}),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });

const q = (path: string) => encodeURIComponent(path);

async function newPerson(name: string, role: "owner" | "writer" | "reader", keys: DeviceKeys) {
  const client = await addPerson(t, name, `${name.split(" ")[0]!.toLowerCase()}@example.com`);
  const first = (await t.server.projects.all())[0]!;
  await addMember(t, first.id, client.id, role);
  const person = { client, keys };
  const put = await as(person, "PUT", "/api/settings/ai", {
    models: { conversation: MODEL, art: PAINTER },
  });
  expect(put.statusCode, put.body).toBe(200);
  return person;
}

beforeAll(async () => {
  t = await makeTestApp({ LOGIN_ATTEMPTS: "100" }, { fetch: fake, settleMs: 0 });
  await t.login();
  t.repo.pushFromOutside(NOTES);
  await t.services.sync();
  base = `/api/p/${(await t.server.projects.all())[0]!.slug}`;
  // The admin is the project's owner; give them a key and a model like everyone else.
  const adminId = (await t.server.people.all())[0]!.id;
  owner = {
    client: { id: adminId, cookie: t.cookie } as Client,
    keys: { openrouter: "sk-or-owner-key-1" },
  };
  expect(
    (await as(owner, "PUT", "/api/settings/ai", { models: { conversation: MODEL, art: PAINTER } }))
      .statusCode,
  ).toBe(200);
  writer = await newPerson("Wren Writer", "writer", { openrouter: "sk-or-writer-key-1" });
  otherWriter = await newPerson("Olga Writer", "writer", { openrouter: "sk-or-olga-key-11" });
  reader = await newPerson("Reed Reader", "reader", { openrouter: "sk-or-reader-key-1" });
  keyless = await newPerson("Kay Keyless", "writer", {});

  // A profile for the character, saved as a version by the owner.
  const approved = await as(owner, "POST", `${base}/characters/approve`, {
    path: NIRANI,
    traits: [{ kind: "voice", text: "Speaks slowly.", sources: [], quotes: [] }],
    moment: { words: "Before the Exodus", year: null },
  });
  expect(approved.statusCode, approved.body).toBe(200);
  const un = (await as(owner, "GET", `${base}/unpublished`)).json();
  const plan = (
    await as(owner, "POST", `${base}/publish/plan`, {
      draftIds: un.drafts.map((d: { id: string }) => d.id),
      renameIds: [],
    })
  ).json();
  const done = await as(owner, "POST", `${base}/publish/confirm`, {
    planId: plan.planId,
    confirmedMergeIds: plan.merges.map((m: { id: string }) => m.id),
    message: "Profile",
  });
  expect(done.statusCode, done.body).toBe(200);
  await t.services.sync();

  // The writer has unsaved changes: a plan in the character's entry, and a relation to a new name.
  const entry = (await as(writer, "GET", `${base}/entries?path=${q(NIRANI)}`)).json();
  const edit = await as(writer, "PUT", `${base}/drafts`, {
    id: "draftnirani1",
    kind: "edit",
    path: NIRANI,
    text: `${entry.text.replace(/^(---\n[\s\S]*?)\n---\n/, `$1\nrelations:\n  - what: parent\n    who: "[[${SECRET_KIN}]]"\n---\n`)}\n${SECRET}\n`,
    revision: 1,
    baseBlob: entry.blob,
  });
  expect(edit.statusCode, edit.body).toBe(200);
});
afterAll(() => t.close());

describe("what each role may do with the new routes", () => {
  it("lets a reader read relations and talk to a character, and nothing that writes", async () => {
    expect((await as(reader, "GET", `${base}/relations`)).statusCode).toBe(200);
    expect(
      (await as(reader, "GET", `${base}/characters/profile?path=${q(NIRANI)}`)).statusCode,
    ).toBe(200);
    expect((await as(reader, "GET", `${base}/characters/talks?path=${q(NIRANI)}`)).statusCode).toBe(
      200,
    );
    const said = await as(reader, "POST", `${base}/characters/say`, {
      path: NIRANI,
      message: "How do you count days?",
    });
    expect(said.statusCode, said.body).toBe(200);

    const refused: [Parameters<typeof as>[1], string][] = [
      ["POST", "/relations"],
      ["POST", "/relations/remove"],
      ["GET", `/pictures?entry=${q(NIRANI)}`],
      ["POST", "/pictures"],
      ["GET", "/pictures/abcdefghij12"],
      ["POST", "/pictures/abcdefghij12/insert"],
      ["POST", "/characters/propose"],
      ["POST", "/characters/approve"],
      ["POST", "/characters/line"],
    ];
    for (const [method, url] of refused) {
      const res = await as(reader, method, `${base}${url}`, method === "GET" ? undefined : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error.code, `${method} ${url}`).toBe("role_too_low");
    }
  });

  it("lets a writer make relations, pictures and a character's line, as themselves", async () => {
    const added = await as(otherWriter, "POST", `${base}/relations`, {
      path: KINSMAN,
      what: "friend",
      who: NIRANI,
    });
    expect(added.statusCode, added.body).toBe(200);
    // The change is the writer's own unsaved change: the owner and the writer next to them see none of it.
    const mine = (await as(otherWriter, "GET", `${base}/unpublished`)).json();
    expect(mine.drafts.map((d: { path: string }) => d.path)).toContain(KINSMAN);
    const theirs = (await as(owner, "GET", `${base}/unpublished`)).json();
    expect(theirs.drafts.map((d: { path: string }) => d.path)).not.toContain(KINSMAN);
    const readerView = (await as(reader, "GET", `${base}/entries?path=${q(KINSMAN)}`)).json();
    expect(readerView.text).not.toContain("friend");

    const line = await as(otherWriter, "POST", `${base}/characters/line`, {
      path: NIRANI,
      text: "We count by the currents.",
    });
    expect(line.statusCode, line.body).toBe(200);
    expect(line.json().draft).not.toBeNull();
  });
});

describe("talks belong to the person who had them", () => {
  it("shows, opens and deletes only a person's own conversations", async () => {
    const said = await as(writer, "POST", `${base}/characters/say`, {
      path: NIRANI,
      message: "Who are you?",
    });
    expect(said.statusCode, said.body).toBe(200);
    const mine = said.json().talk.id as string;
    const list = (await as(writer, "GET", `${base}/characters/talks?path=${q(NIRANI)}`)).json();
    expect(list.talks.map((x: { id: string }) => x.id)).toEqual([mine]);

    // Another writer, a reader and the owner see none of it.
    for (const who of [otherWriter, reader, owner]) {
      const theirs = (await as(who, "GET", `${base}/characters/talks?path=${q(NIRANI)}`)).json();
      expect(theirs.talks.map((x: { id: string }) => x.id)).not.toContain(mine);
      expect((await as(who, "GET", `${base}/characters/talks/${mine}`)).statusCode).toBe(404);
      // Going on with it is not possible either, and deleting it deletes nothing of theirs.
      const goOn = await as(who, "POST", `${base}/characters/say`, {
        path: NIRANI,
        message: "Hello",
        talk: mine,
      });
      expect(goOn.statusCode).toBe(404);
      await as(who, "DELETE", `${base}/characters/talks/${mine}`);
    }
    const still = await as(writer, "GET", `${base}/characters/talks/${mine}`);
    expect(still.statusCode).toBe(200);
    expect(still.json().talk.lines.map((l: { who: string }) => l.who)).toEqual([
      "author",
      "character",
    ]);
    // Their own can be deleted.
    expect((await as(writer, "DELETE", `${base}/characters/talks/${mine}`)).statusCode).toBe(200);
    expect((await as(writer, "GET", `${base}/characters/talks/${mine}`)).statusCode).toBe(404);
  });

  it("marks a line kept only in the writer's own conversation", async () => {
    const said = await as(writer, "POST", `${base}/characters/say`, {
      path: NIRANI,
      message: "Tell me about time.",
    });
    const talk = said.json().talk.id as string;
    // Someone else's attempt to mark it: the line goes into their entry, the talk is not theirs and is left alone.
    await as(otherWriter, "POST", `${base}/characters/line`, {
      path: NIRANI,
      text: "We count by the currents.",
      talk,
      line: 1,
    });
    const after = (await as(writer, "GET", `${base}/characters/talks/${talk}`)).json().talk;
    expect(after.lines[1].kept).toBe(false);
    const mine = await as(writer, "POST", `${base}/characters/line`, {
      path: NIRANI,
      text: "We count by the currents.",
      talk,
      line: 1,
    });
    expect(mine.json().talk.lines[1].kept).toBe(true);
  });
});

describe("a reader never gets someone's unsaved text", () => {
  it("leaves it out of relations, and out of what a character is given to read", async () => {
    const writers = JSON.stringify((await as(writer, "GET", `${base}/relations`)).json());
    expect(writers).toContain(SECRET_KIN);
    const readers = JSON.stringify((await as(reader, "GET", `${base}/relations`)).json());
    expect(readers).not.toContain(SECRET_KIN);
    expect((await as(reader, "GET", `${base}/relations`)).body).not.toContain(SECRET);

    sent.length = 0;
    const said = await as(reader, "POST", `${base}/characters/say`, {
      path: NIRANI,
      message: "What do you plan?",
    });
    expect(said.statusCode, said.body).toBe(200);
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) expect(call.text).not.toContain(SECRET);
    // The reader gets the profile as it was saved; the writer's unsaved lines are not in it.
    expect(JSON.stringify(said.json())).not.toContain(SECRET);
  });
});

describe("every AI call uses the key of the person asking", () => {
  it("sends the caller's own key for a talk and for a picture, and logs them as the caller", async () => {
    sent.length = 0;
    await as(reader, "POST", `${base}/characters/say`, { path: NIRANI, message: "Hello" });
    await as(writer, "POST", `${base}/characters/say`, { path: NIRANI, message: "Hello" });
    const made = await as(otherWriter, "POST", `${base}/pictures`, {
      entry: NIRANI,
      prompt: "A river of light.",
    });
    expect(made.statusCode, made.body).toBe(200);
    expect(sent.map((c) => c.auth)).toEqual([
      "Bearer sk-or-reader-key-1",
      "Bearer sk-or-writer-key-1",
      "Bearer sk-or-olga-key-11",
    ]);
    const log = await t.server.aiLog.calls(new Date().toISOString().slice(0, 7));
    expect(log.at(-1)).toMatchObject({ task: "art", person: otherWriter.client.id, ok: true });
    expect(log.at(-2)).toMatchObject({ task: "conversation", person: writer.client.id });
    expect(log.at(-3)).toMatchObject({ task: "conversation", person: reader.client.id });
  });

  it("asks for a key when the device has none, and says when the provider turns one away", async () => {
    sent.length = 0;
    const talk = await as(keyless, "POST", `${base}/characters/say`, {
      path: NIRANI,
      message: "Hello",
    });
    expect(talk.statusCode).toBe(409);
    expect(talk.json().error).toMatchObject({ code: "ai_key_missing", provider: "openrouter" });
    const picture = await as(keyless, "POST", `${base}/pictures`, { entry: NIRANI, prompt: "x" });
    expect(picture.statusCode).toBe(409);
    expect(picture.json().error).toMatchObject({ code: "ai_key_missing", provider: "openrouter" });
    // The pictures dialog says so before anything is asked.
    const status = (await as(keyless, "GET", `${base}/pictures?entry=${q(NIRANI)}`)).json();
    expect(status.off).toMatchObject({ href: "/settings/device/ai-keys" });
    expect(sent).toEqual([]);

    const wrong = { ...writer, keys: { openrouter: "sk-or-WRONG-key-0000" } };
    const refusedTalk = await as(wrong, "POST", `${base}/characters/say`, {
      path: NIRANI,
      message: "Hello",
    });
    expect(refusedTalk.statusCode).toBe(409);
    expect(refusedTalk.json().error).toMatchObject({
      code: "ai_key_rejected",
      provider: "openrouter",
    });
    const refusedPicture = await as(wrong, "POST", `${base}/pictures`, {
      entry: NIRANI,
      prompt: "x",
    });
    expect(refusedPicture.json().error).toMatchObject({ code: "ai_key_rejected" });
    // Nothing was kept from a refused picture.
    const tries = (await as(writer, "GET", `${base}/pictures?entry=${q(NIRANI)}`)).json().tries;
    expect(tries.every((x: { prompt: string }) => x.prompt !== "x")).toBe(true);
  });
});

describe("pictures are made and kept for one person", () => {
  it("keeps a person's tries from every other person, and inserts an image as an unsaved change of theirs", async () => {
    const made = await as(writer, "POST", `${base}/pictures`, {
      entry: NIRANI,
      prompt: "A lantern.",
    });
    expect(made.statusCode, made.body).toBe(200);
    const id = made.json().try.id as string;
    expect(JSON.stringify(made.json())).not.toContain("person");

    const mine = (await as(writer, "GET", `${base}/pictures?entry=${q(NIRANI)}`)).json();
    expect(mine.tries.map((x: { id: string }) => x.id)).toContain(id);
    const theirs = (await as(otherWriter, "GET", `${base}/pictures?entry=${q(NIRANI)}`)).json();
    expect(theirs.tries.map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await as(otherWriter, "GET", `${base}/pictures/${id}`)).statusCode).toBe(404);
    expect((await as(otherWriter, "POST", `${base}/pictures/${id}/insert`, {})).statusCode).toBe(
      404,
    );
    expect((await as(writer, "GET", `${base}/pictures/${id}`)).statusCode).toBe(200);

    const inserted = await as(writer, "POST", `${base}/pictures/${id}/insert`, { name: "Lantern" });
    expect(inserted.statusCode, inserted.body).toBe(200);
    const path = inserted.json().path as string;
    const un = (await as(writer, "GET", `${base}/unpublished`)).json();
    expect(un.drafts.map((d: { path: string }) => d.path)).toContain(path);
    const others = (await as(owner, "GET", `${base}/unpublished`)).json();
    expect(others.drafts.map((d: { path: string }) => d.path)).not.toContain(path);
  });
});
