import { afterEach, describe, expect, it } from "vitest";
import { QuestionResponse, WhatsMissingResponse } from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const SECRETS = { SECRETS_KEY: Buffer.alloc(32, 3).toString("base64") };
const MODEL = "test/talker";
const WORDS = (n: number) => Array(n).fill("stone").join(" ");

const HARBOR = "10 Test/Harbor Town.md";
const SALT = "10 Test/Salt Road.md";

const NOTES: Record<string, string> = {
  [HARBOR]:
    "---\ntype: place\n---\n# Harbor Town\n\nShips come in from the [[Salt Road]], past the lighthouse " +
    "that the Wardens keep. The Tide Bell rings at dusk.\n",
  [SALT]: `---\ntype: place\n---\n# Salt Road\n\nA long road to the [[Harbor Town]]. ${WORDS(100)}\n`,
  "10 Test/Wardens.md": "# Wardens\n\nExist already.\n",
  "20 Elsewhere/Lonely.md": "# Lonely\n\nNothing here.\n",
};

interface Call {
  messages: { role: string; content: string }[];
}

/** Stands in for OpenRouter, answering each call with the next answer, the last one for later calls. */
function provider(answers: object[]) {
  const calls: Call[] = [];
  const fake: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/models")) return Response.json({ data: [] });
    calls.push(JSON.parse(String(init?.body)));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 900, completion_tokens: 200, cost: 0.004 },
    });
  };
  return { fake, calls };
}

async function start(answers: object[], model: string | null = MODEL) {
  const p = provider(answers);
  t = await makeTestApp(SECRETS, { fetch: p.fake, settleMs: 0 });
  await t.login();
  t.repo.pushFromOutside(NOTES);
  await t.services.sync();
  if (model) {
    const res = await t.put("/api/settings/ai", {
      key: "sk-or-test-key-1234",
      models: { conversation: model },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  return p;
}

const missing = (path = HARBOR) => t.post("/api/keep-going/whats-missing", { path });

describe("What's missing here?", () => {
  it("proposes entries the text implies, leaving out those that exist, and two questions", async () => {
    const p = await start([
      {
        proposals: [
          { name: "Tide Bell", reason: "It rings at dusk.", folder: "10 Test" },
          { name: "Wardens", reason: "Already an entry.", folder: "10 Test" },
          { name: "wardens", reason: "Same again.", folder: "" },
          { name: "Salt Road", reason: "A neighbour.", folder: "" },
          { name: "Harbor Town", reason: "The entry itself.", folder: "" },
          { name: "The Lighthouse", reason: "Kept by the Wardens.", folder: "Made Up" },
          { name: "tide bell", reason: "A repeat.", folder: "" },
          { name: "Harbor: Master?", reason: "A name with signs.", folder: "../x" },
          {
            name: "Dusk Rite",
            reason: "![x](https://evil.example/a.png) At dusk.",
            folder: "20 Elsewhere",
          },
          { name: "Sixth", reason: "Over the limit.", folder: "" },
        ],
        questions: ["Who built the lighthouse?", "", "Why is the bell rung?", "A third?"],
      },
    ]);
    const res = await missing();
    expect(res.statusCode, res.body).toBe(200);
    const made = WhatsMissingResponse.parse(res.json());
    expect(made.model).toBe(`openrouter:${MODEL}`);
    expect(made.proposals).toEqual([
      { name: "Tide Bell", reason: "It rings at dusk.", folder: "10 Test" },
      // A folder nobody has is replaced by the entry's own.
      { name: "The Lighthouse", reason: "Kept by the Wardens.", folder: "10 Test" },
      { name: "Harbor Master", reason: "A name with signs.", folder: "10 Test" },
      { name: "Dusk Rite", reason: "At dusk.", folder: "20 Elsewhere" },
      { name: "Sixth", reason: "Over the limit.", folder: "10 Test" },
    ]);
    expect(made.questions).toEqual(["Who built the lighthouse?", "Why is the bell rung?"]);
    // The model read the entry and the entries linked with it.
    const sent = p.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(sent).toContain("Look at this entry: Harbor Town");
    expect(sent).toContain("The Tide Bell rings at dusk.");
    expect(sent).toContain("=== Entry: 10 Test/Salt Road.md");
    expect(sent).not.toContain("Lonely");
    // Nothing was saved.
    expect(t.services.drafts.list()).toEqual([]);
  });

  it("does not offer a name that is waiting as a new entry, or an alias of one", async () => {
    await start([
      {
        proposals: [
          { name: "Brand New", reason: "Waiting.", folder: "" },
          { name: "Fresh Idea", reason: "Free.", folder: "" },
        ],
        questions: [],
      },
    ]);
    await t.put("/api/drafts", {
      id: "brandnew0001",
      path: "10 Test/Brand New.md",
      kind: "create",
      text: "# Brand New\n",
      revision: 0,
    });
    const made = WhatsMissingResponse.parse((await missing()).json());
    expect(made.proposals.map((p) => p.name)).toEqual(["Fresh Idea"]);
    expect(made.questions).toEqual([]);
  });

  it("reads the author's draft of the entry, not only what is published", async () => {
    const p = await start([{ proposals: [], questions: [] }]);
    await t.put("/api/drafts", {
      id: "harbordraft1",
      path: HARBOR,
      kind: "edit",
      text: "# Harbor Town\n\nThe draft mentions the Moon Gate.\n",
      revision: 0,
      baseBlob: (
        (await t.get(`/api/entries?path=${encodeURIComponent(HARBOR)}`)).json() as { blob: string }
      ).blob,
    });
    expect((await missing()).statusCode).toBe(200);
    expect(p.calls[0]!.messages.map((m) => m.content).join("\n")).toContain("the Moon Gate");
  });

  it("says when no model is chosen, and when the entry is not there", async () => {
    await start([{ proposals: [], questions: [] }], null);
    const off = await missing();
    expect(off.statusCode).toBe(409);
    expect(off.json().error.code).toBe("ai_off");
    await t.put("/api/settings/ai", { models: { conversation: MODEL } });
    expect((await missing("10 Test/Nowhere.md")).statusCode).toBe(404);
  });

  it("does not send an entry held in quarantine to the model", async () => {
    await start([{ proposals: [], questions: [] }]);
    t.services.quarantine.aiMayRead = (path) => (path === HARBOR ? "Held." : null);
    const held = await missing();
    expect(held.statusCode).toBe(403);
    expect(held.json().error.code).toBe("not_allowed");
    t.services.quarantine.aiMayRead = (path) => (path === SALT ? "Held." : null);
    expect((await missing()).statusCode).toBe(200);
  });

  it("stops at the monthly cap and says so when the answer is not in form", async () => {
    await start([{ proposals: "none" }]);
    const bad = await missing();
    expect(bad.json().error.code).toBe("ai_bad_answer");
    await t.put("/api/settings/ai", { monthlyCapUsd: 0 });
    expect((await missing()).json().error.code).toBe("ai_cap_reached");
  });

  it("says in the status that lore conversations can run once a model is chosen", async () => {
    await start([{ proposals: [], questions: [] }]);
    expect((await t.get("/api/status")).json().ai.conversation).toBe(true);
    await t.put("/api/settings/ai", { models: { conversation: null } });
    expect((await t.get("/api/status")).json().ai.conversation).toBe(false);
  });
});

describe("the question of the day", () => {
  const today = async (tz = 0) =>
    QuestionResponse.parse((await t.get(`/api/keep-going/question?tz=${tz}`)).json()).question;
  const ask = async (body: object = {}) => {
    const res = await t.post("/api/keep-going/question", body);
    expect(res.statusCode, res.body).toBe(200);
    return QuestionResponse.parse(res.json()).question!;
  };

  it("is never made until asked, then kept for the day", async () => {
    const p = await start([{ question: "Who keeps the Tide Bell?" }, { question: "Another one?" }]);
    expect(await today()).toBeNull();
    expect(p.calls).toHaveLength(0);
    const made = await ask();
    expect(made.question).toBe("Who keeps the Tide Bell?");
    expect(made.model).toBe(`openrouter:${MODEL}`);
    expect(made.day).toBe(new Date().toISOString().slice(0, 10));
    // It is a thin entry the question is drawn from.
    expect(t.services.index.note(made.path)).toBeDefined();
    expect(made.path).not.toMatch(/README|^99 Appendices/);
    expect(t.services.keepGoing.wordsOf(made.path)).toBeLessThan(80);
    expect(p.calls[0]!.messages.map((m) => m.content).join("\n")).toContain(
      `A thin entry: ${made.title}`,
    );
    expect(await today()).toEqual(made);
    // Asked again the same day, it gives the kept question without calling the model.
    expect(await ask()).toEqual(made);
    expect(p.calls).toHaveLength(1);
  });

  it("makes another, from a different entry, and keeps that one", async () => {
    const p = await start([{ question: "First?" }, { question: "Second?" }]);
    const first = await ask();
    const second = await ask({ another: true });
    expect(second.question).toBe("Second?");
    expect(second.path).not.toBe(first.path);
    expect(p.calls).toHaveLength(2);
    expect(await today()).toEqual(second);
  });

  it("is a new day's question after midnight in the reader's time zone", async () => {
    await start([{ question: "First?" }, { question: "Tomorrow's?" }]);
    const first = await ask({ tz: 0 });
    // Far enough ahead that it is already the next day there.
    const hours = 24 - new Date().getUTCHours();
    expect(await today(hours * 60)).toBeNull();
    const next = await ask({ tz: hours * 60 });
    expect(next.day).not.toBe(first.day);
    expect(next.question).toBe("Tomorrow's?");
  });

  it("falls back to the thinnest entries when none is a stub", async () => {
    await start([{ question: "Q?" }]);
    const rows: Record<string, string> = {};
    // Every entry long enough not to be a stub.
    for (const note of t.services.index.allNotes()) {
      rows[note.path] = `${note.text}\n\n${WORDS(100)}\n`;
    }
    t.repo.pushFromOutside(
      Object.fromEntries(Object.entries(rows).filter(([p]) => !p.startsWith("99 Appendices/"))),
    );
    await t.services.sync();
    expect((await ask()).question).toBe("Q?");
  });

  it("asks about no entry the AI may not read, and says when there is none", async () => {
    await start([{ question: "Q?" }]);
    t.services.quarantine.aiMayRead = () => "Held.";
    const res = await t.post("/api/keep-going/question", {});
    expect(res.statusCode).toBe(404);
  });

  it("refuses with no model, an empty question and a tz out of range", async () => {
    await start([{ question: "   " }]);
    const empty = await t.post("/api/keep-going/question", {});
    expect(empty.json().error.code).toBe("ai_bad_answer");
    expect((await t.post("/api/keep-going/question", { tz: 9999 })).statusCode).toBe(400);
    await t.put("/api/settings/ai", { models: { conversation: null } });
    expect((await t.post("/api/keep-going/question", {})).json().error.code).toBe("ai_off");
  });

  it("starts again when the kept file cannot be read", async () => {
    await start([{ question: "Q?" }]);
    await ask();
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(t.services.config.dataDir, "state", "question.json"), "{ not json");
    expect(await today()).toBeNull();
  });
});
