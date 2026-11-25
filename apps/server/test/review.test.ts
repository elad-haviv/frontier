import { afterEach, describe, expect, it } from "vitest";
import { changedPassages } from "../src/ai/review.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t?.close());

const SECRETS = { SECRETS_KEY: Buffer.alloc(32, 3).toString("base64") };
const MODEL = "test/talker";
const NIRANI = "04 Inhabitants/Nirani.md";
const VAAKH = "01 Universe/Vaakh.md";
const NOTES: Record<string, string> = {
  [NIRANI]:
    "# Nirani\n\nThe Nirani keep time by the pulse of the deep currents, which they call [[Vaakh]].\n" +
    "They have no written calendar.\n",
  [VAAKH]:
    "# Vaakh\n\nVaakh is counted in slow beats felt through the stone floors of the halls.\n",
};

function provider(answers: object[]) {
  const calls: { body: { messages: { role: string; content: string }[] } }[] = [];
  const fake: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("/models")) return Response.json({ data: [] });
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

const EDITED =
  "# Vaakh\n\nVaakh is counted in slow beats felt through the stone floors of the halls.\n\nIt is sacred to the Nirani.\n";

const finding = (over: object) => ({
  id: "f1",
  kind: "contradiction",
  severity: "problem",
  basis: "lore",
  anchor: "It is sacred to the Nirani.",
  comment: "Conflicts.",
  suggestion: "",
  sources: [],
  ...over,
});

describe("changed passages", () => {
  it("finds added, removed and rewritten paragraphs and leaves typo-level ones out", () => {
    const { hunks, typos } = changedPassages(
      "One.\n\nTwo is here.\n\nMid.\n\nThree.\n\nFour",
      "One.\n\nTwo is here!\n\nMid.\n\nThree changed a lot.\n\nFour\n\nFive.",
    );
    expect(typos).toBe(1);
    expect(hunks.map((h) => [h.before, h.after])).toEqual([
      ["Three.", "Three changed a lot."],
      ["", "Five."],
    ]);
    expect(hunks[0]!.contextBefore).toBe("Mid.");
  });

  it("finds nothing when the text is the same", () => {
    expect(changedPassages("A.\n\nB.", "A.\n\nB.\n")).toEqual({ hunks: [], typos: 0 });
  });
});

describe("consult", () => {
  it("checks quotes against the entries given, drops an anchor that is not in the text, and marks a claim without a quote as unverified", async () => {
    const p = await start([
      {
        summary: "One conflict.",
        overall: "needs_attention",
        edits: [
          { hunk: "h1", verdict: "risky", reason: "Touches the Nirani." },
          { hunk: "h9", verdict: "better", reason: "No such passage." },
        ],
        findings: [
          finding({
            sources: [
              { path: NIRANI, quote: "keep time by the pulse of the deep currents" },
              { path: NIRANI, quote: "a quote that is not in the entry at all" },
            ],
          }),
          finding({ id: "f2", anchor: "words that are not in the entry anywhere" }),
          finding({ id: "f3", anchor: "stone floors of the halls", sources: [] }),
          finding({
            id: "f4",
            kind: "clarity",
            basis: "craft",
            severity: "problem",
            anchor: "slow beats felt through",
          }),
        ],
      },
    ]);
    const res = await t.post("/api/write/review", { path: VAAKH, text: EDITED, focus: "edits" });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.focus).toBe("edits");
    expect(r.edits).toEqual([
      {
        hunk: "h1",
        verdict: "risky",
        reason: "Touches the Nirani.",
        after: "It is sacred to the Nirani.",
      },
    ]);
    const byId = Object.fromEntries(r.findings.map((f: { id: string }) => [f.id, f]));
    expect(byId.f1.certainty).toBe("checked");
    expect(byId.f1.severity).toBe("problem");
    expect(byId.f1.sources).toEqual([
      { path: NIRANI, title: "Nirani", quote: "keep time by the pulse of the deep currents" },
    ]);
    expect(byId.f2).toBeUndefined();
    expect(byId.f3.certainty).toBe("unverified");
    expect(byId.f3.severity).toBe("note");
    expect(byId.f4.certainty).toBe("opinion");
    expect(byId.f4.severity).toBe("concern");
    expect(r.droppedFindings).toBe(1);
    expect(r.droppedQuotes).toBe(1);
    expect(r.findings[0].id).toBe("f1");
    const sent = p.calls[0]!.body.messages[1]!.content;
    expect(sent).toContain("Was: (nothing: this passage is new)");
    expect(sent).toContain("Now: It is sacred to the Nirani.");
    expect(sent).toContain(
      `=== Entry: ${NIRANI} (a paragraph that links to the entry being edited)`,
    );
  });

  it("reviews the whole entry when nothing changed, and keeps only the kinds asked for", async () => {
    const p = await start([
      {
        summary: "Fine.",
        overall: "no_issues",
        edits: [],
        findings: [
          finding({
            id: "a",
            kind: "voice",
            basis: "craft",
            severity: "note",
            anchor: "slow beats",
          }),
        ],
      },
    ]);
    const text = NOTES[VAAKH]!;
    const res = await t.post("/api/write/review", {
      path: VAAKH,
      text,
      focus: "edits",
      looks: ["clarity"],
    });
    const r = res.json();
    expect(r.focus).toBe("content");
    expect(r.findings).toEqual([]);
    expect(r.droppedFindings).toBe(1);
    expect(r.overall).toBe("no_issues");
    expect(p.calls[0]!.body.messages[1]!.content).toContain("Give no verdicts on changes");
  });

  it("reviews a new entry as a whole, and a long one in part", async () => {
    const p = await start([{ summary: "Ok.", overall: "no_issues", edits: [], findings: [] }]);
    const fresh = await t.post("/api/write/review", {
      path: "03 Places/New.md",
      text: "# New\n\nA place.\n",
      focus: "edits",
    });
    expect(fresh.json().focus).toBe("content");
    const long = await t.post("/api/write/review", {
      path: "03 Places/New.md",
      text: `# New\n\n${"word ".repeat(4000)}`,
      focus: "content",
    });
    expect(long.json().partial).toBe(true);
    expect(p.calls[1]!.body.messages[1]!.content).toContain("a partial review");
  });

  it("answers a follow-up, checking its quotes", async () => {
    await start([
      {
        answer: "The Nirani entry says they keep time by currents.",
        sources: [
          { path: NIRANI, quote: "keep time by the pulse of the deep currents" },
          { path: NIRANI, quote: "an invented line of lore here" },
        ],
      },
    ]);
    const res = await t.post("/api/write/review/ask", {
      path: VAAKH,
      text: EDITED,
      question: "Why does that matter?",
      finding: { kind: "contradiction", anchor: "sacred to the Nirani", comment: "Conflicts." },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().sources).toHaveLength(1);
  });

  it("is off without a model, and refuses what is not an entry", async () => {
    await start([{}], { extraction: MODEL });
    const off = await t.post("/api/write/review", { path: VAAKH, text: EDITED, focus: "edits" });
    expect(off.statusCode).toBe(409);
    const map = await t.post("/api/write/review", {
      path: ".frontier/maps/abcdefgh.json",
      text: "x",
      focus: "content",
    });
    expect(map.statusCode).toBe(400);
  });
});

describe("consult history", () => {
  const answer = {
    summary: "One note.",
    overall: "minor",
    edits: [],
    findings: [
      finding({
        id: "f1",
        kind: "clarity",
        basis: "craft",
        severity: "note",
        anchor: "slow beats",
      }),
      finding({
        id: "f2",
        kind: "gap",
        basis: "craft",
        severity: "concern",
        anchor: "stone floors",
      }),
    ],
  };
  const review = () =>
    t.post("/api/write/review", { path: VAAKH, text: NOTES[VAAKH]!, focus: "content" });
  const list = async (path = VAAKH) =>
    (await t.get(`/api/write/reviews?path=${encodeURIComponent(path)}`)).json().reviews;
  const patch = (id: string, f: string, body: object) =>
    t.app.inject({
      method: "PATCH",
      url: `/api/write/reviews/${id}/findings/${f}`,
      headers: { cookie: t.cookie },
      payload: body,
    });

  it("saves each review, newest first, and keeps what the author did with each finding", async () => {
    await start([answer]);
    const first = (await review()).json();
    expect(first.id).toMatch(/^[a-z0-9]{12}$/);
    expect(first.scope).toBe("content");
    expect(first.findings.map((f: { state: string }) => f.state)).toEqual(["open", "open"]);
    const second = (await review()).json();
    expect((await list()).map((r: { id: string }) => r.id)).toEqual([second.id, first.id]);

    expect((await patch(second.id, "f1", { state: "dismissed" })).statusCode).toBe(200);
    await patch(second.id, "f2", {
      state: "applied",
      commented: true,
      applied: { before: "stone floors", after: "flagstones" },
    });
    await patch(second.id, "f2", { ask: { question: "Why?", reply: "Because.", checked: false } });
    const byId = (r: { findings: { id: string }[] }, id: string) =>
      r.findings.find((f) => f.id === id);
    const saved = (await list())[0];
    expect(byId(saved, "f1")).toMatchObject({ state: "dismissed" });
    expect(byId(saved, "f2")).toMatchObject({
      state: "applied",
      commented: true,
      applied: { before: "stone floors", after: "flagstones" },
      asks: [{ question: "Why?", reply: "Because.", checked: false }],
    });
    // Restored.
    await patch(second.id, "f1", { state: "open" });
    expect(byId((await list())[0], "f1")).toMatchObject({ state: "open" });

    // Kept across a restart, as the comments are.
    const { ConsultStore } = await import("../src/consults/store.js");
    const { join } = await import("node:path");
    const again = new ConsultStore(join(t.services.config.dataDir, "state"), t.services.files);
    expect(await again.forPath(VAAKH)).toHaveLength(2);
  });

  it("keeps the last 20 reviews of an entry, and each entry's own", async () => {
    await start([answer]);
    for (let i = 0; i < 22; i++) await review();
    await t.post("/api/write/review", { path: NIRANI, text: NOTES[NIRANI]!, focus: "content" });
    expect(await list()).toHaveLength(20);
    expect(await list(NIRANI)).toHaveLength(1);
  });

  it("deletes one review or all of an entry's, and refuses a finding that is not there", async () => {
    await start([answer]);
    const a = (await review()).json();
    await review();
    expect((await patch(a.id, "zzz", { state: "applied" })).statusCode).toBe(404);
    expect((await patch("a".repeat(12), "f1", { state: "applied" })).statusCode).toBe(404);
    expect((await t.del(`/api/write/reviews/${a.id}`)).statusCode).toBe(200);
    expect(await list()).toHaveLength(1);
    expect((await t.del(`/api/write/reviews?path=${encodeURIComponent(VAAKH)}`)).statusCode).toBe(
      200,
    );
    expect(await list()).toEqual([]);
  });

  it("follows its entry when it is renamed", async () => {
    await start([answer]);
    await review();
    await t.services.consults.renamed(VAAKH, "01 Universe/Vaakh Beats.md");
    expect(await list()).toEqual([]);
    expect(await list("01 Universe/Vaakh Beats.md")).toHaveLength(1);
  });
});
