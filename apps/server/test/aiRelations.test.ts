import { afterEach, describe, expect, it } from "vitest";
import { BUILT_IN_KINDS, InboxResponse, RelationsResponse } from "@frontier/schema";
import { checkRelations, matchName } from "../src/ai/relationProposals.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp | null = null;
afterEach(() => t?.close());

const SECRETS = { SECRETS_KEY: Buffer.alloc(32, 3).toString("base64") };
const MODEL = "test/model";
const WREN = "02 People/Wren Vane.md";
const CORIN = "02 People/Corin Vane.md";
const PELL = "02 People/Pell Holt.md";
const ODO = "02 People/Odo Vane.md";
const WREN_TEXT =
  "# Wren Vane\n\nWren was the elder daughter of Corin Vane, born in the flood year. " +
  "Her son by Bram, Pell, kept the Holt name. She never forgave Odo.\n";
const NOTES: Record<string, string> = {
  [WREN]: WREN_TEXT,
  [CORIN]:
    '---\ntime:\n  - what: born\n    when: "240"\n---\n# Corin Vane\n\nCorin taught his daughter Wren the tide songs.\n',
  [PELL]: "# Pell Holt\n\nA fisher.\n",
  [ODO]: "---\naliases: [Odo]\n---\n# Odo Vane\n\nA foundling.\n",
};

const rel = (r: Partial<Record<string, unknown>>) => ({
  what: "parent",
  who: "Corin Vane",
  with: null,
  how: null,
  when: null,
  quote: "Wren was the elder daughter of Corin Vane, born in the flood year.",
  words: "daughter of Corin Vane",
  stated: true,
  ...r,
});

/** The answers the stand-in model gives, by the entry it is asked about. */
const ANSWERS: Record<string, object> = {
  "Wren Vane": {
    type: null,
    time: [],
    relations: [
      rel({}),
      // "how" is not in the marked words, so it is dropped.
      rel({
        what: "child",
        who: "Pell",
        with: "Bram",
        how: "adopted",
        quote: "Her son by Bram, Pell, kept the Holt name.",
        words: "Her son by Bram, Pell",
      }),
      rel({
        what: "rival",
        who: "Odo",
        quote: "She never forgave Odo.",
        words: "never forgave Odo",
        stated: false,
      }),
      // Marked words without the name, a sentence not in the entry, and a word that is no kind.
      rel({ who: "Ilsa Thorne", words: "daughter of" }),
      rel({ quote: "Wren was born at sea.", words: "born at sea" }),
      rel({ what: "friend" }),
    ],
  },
  "Corin Vane": {
    type: null,
    time: [],
    relations: [
      rel({
        what: "child",
        who: "Wren",
        quote: "Corin taught his daughter Wren the tide songs.",
        words: "his daughter Wren",
      }),
    ],
  },
};

function provider() {
  const fake: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/key")) return Response.json({ data: { label: "test" } });
    if (path.endsWith("/models")) {
      return Response.json({
        data: [
          {
            id: MODEL,
            name: "Test model",
            pricing: { prompt: "0.000001", completion: "0.000002" },
            supported_parameters: ["structured_outputs"],
          },
        ],
      });
    }
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const user = body.messages.at(-1)!.content;
    const name = /^Entry: (.*)$/m.exec(user)?.[1] ?? "";
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify(ANSWERS[name] ?? { type: null, time: [], relations: [] }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
    });
  };
  return fake;
}

async function start() {
  t = await makeTestApp(SECRETS, { fetch: provider(), settleMs: 0 });
  await t.login();
  t.repo.pushFromOutside(NOTES);
  await t.services.sync();
  // Since stage 31f the key is this device's, sent with each request; the model is the person's.
  const res = await t.put("/api/settings/ai", { models: { extraction: MODEL } });
  expect(res.statusCode, res.body).toBe(200);
  t.keys = { openrouter: "sk-or-test-key-1234" };
}
const app = () => t!;
const propose = async (path: string) => {
  const res = await app().post("/api/proposals/fields", { path });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { made: number }).made;
};
const inbox = async () => InboxResponse.parse((await app().get("/api/inbox")).json()).proposals;
const relations = async () => RelationsResponse.parse((await app().get("/api/relations")).json());
const textOf = async (path: string) =>
  ((await app().get(`/api/entries?path=${encodeURIComponent(path)}`)).json() as { text: string })
    .text;

describe("relations read from the text", () => {
  it("keeps only what the sentence states with the name, and matches who to entries", async () => {
    await start();
    expect(await propose(WREN)).toBe(3);
    const [p] = await inbox();
    const ops = p!.operations.map((o) => o.operation);
    expect(ops).toEqual([
      expect.objectContaining({
        op: "add_relation",
        what: "parent",
        whoPath: CORIN,
        match: "title",
        how: null,
      }),
      expect.objectContaining({
        what: "child",
        who: "Pell",
        whoPath: null,
        match: "none",
        maybe: PELL,
        how: null,
      }),
      expect.objectContaining({ what: "rival", whoPath: ODO, match: "alias", stated: false }),
    ]);
    const r = await relations();
    expect(r.proposed).toHaveLength(3);
    expect(r.proposed![0]).toMatchObject({ kind: "parent", a: CORIN, b: WREN, path: WREN });
    expect(r.unread).toBeGreaterThan(0);
  });

  it("adds the other entry's sentence to the same proposal instead of a second one", async () => {
    await start();
    await propose(WREN);
    expect(await propose(CORIN)).toBe(1);
    const all = await inbox();
    expect(all).toHaveLength(1);
    const parent = all[0]!.operations[0]!.operation;
    expect(parent).toMatchObject({
      what: "parent",
      also: [{ path: CORIN, words: "his daughter Wren" }],
    });
  });

  it("accepts on the entry chosen, in its direction, and Undo takes it back", async () => {
    await start();
    await propose(WREN);
    const [p] = await inbox();
    const parent = p!.operations[0]!.operation;
    const res = await app().post(`/api/proposals/${p!.id}/relations`, {
      accept: [{ op: parent.id, edits: { saveOn: CORIN } }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await textOf(CORIN)).toContain('relations:\n  - what: child\n    who: "[[Wren Vane]]"');
    expect(await textOf(WREN)).toBe(WREN_TEXT);
    expect((await relations()).facts.some((f) => f.kind === "parent" && f.a === CORIN)).toBe(true);

    const undo = await app().post("/api/proposals/undo", {});
    expect(undo.json()).toEqual({ undone: true });
    expect(await textOf(CORIN)).not.toContain("relations:");
    expect((await inbox())[0]!.operations).toHaveLength(3);
  });

  it("does not propose again what was rejected, or what is already written", async () => {
    await start();
    await propose(WREN);
    const [p] = await inbox();
    const rival = p!.operations[2]!.operation;
    const rej = await app().post(`/api/proposals/${p!.id}/operations/${rival.id}`, {
      decision: "reject",
    });
    expect(rej.statusCode, rej.body).toBe(200);
    // Accept the parent with a name corrected, written on Wren.
    const parent = p!.operations[0]!.operation;
    await app().post(`/api/proposals/${p!.id}/relations`, { accept: [{ op: parent.id }] });
    expect(await textOf(WREN)).toContain('who: "[[Corin Vane]]"');
    // The answer is cached, so asking again proposes nothing new.
    expect(await propose(WREN)).toBe(0);
    expect(
      (await inbox())[0]!.operations.map(
        (o) => o.operation.op === "add_relation" && o.operation.what,
      ),
    ).toEqual(["child"]);
  });
});

describe("matching names", () => {
  const entries = [
    { path: PELL, title: "Pell Holt", aliases: [] },
    { path: "x/Pell Marsh.md", title: "Pell Marsh", aliases: [] },
    { path: ODO, title: "Odo Vane", aliases: ["Odo"] },
  ];
  it("prefers the title, then other names, then offers the closest", () => {
    expect(matchName("[[Odo Vane]]", entries, "")).toEqual({
      path: ODO,
      match: "title",
      maybe: null,
    });
    expect(matchName("odo", entries, "")).toEqual({ path: ODO, match: "alias", maybe: null });
    expect(matchName("Pell", entries, "Pell kept the Holt name")).toEqual({
      path: null,
      match: "none",
      maybe: PELL,
    });
    expect(matchName("Nobody", entries, "")).toEqual({ path: null, match: "none", maybe: null });
  });

  it("drops a relation that is already written", () => {
    const r = checkRelations({
      path: WREN,
      body: WREN_TEXT,
      read: [rel({}) as never],
      kinds: BUILT_IN_KINDS,
      entries: [{ path: CORIN, title: "Corin Vane", aliases: [] }],
      written: new Set([`parent|${CORIN}|${WREN}`]),
      pending: [],
    });
    expect(r.ops).toEqual([]);
  });
});
