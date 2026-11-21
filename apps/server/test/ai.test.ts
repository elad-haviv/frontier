import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EntryResponse,
  FieldJobState,
  InboxResponse,
  SettingsResponse,
  UnpublishedResponse,
} from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const SECRETS = { SECRETS_KEY: Buffer.alloc(32, 3).toString("base64") };
const MODEL = "test/model";
const VEL = "01 Places/Vel Aran.md";
const BODY =
  "# Vel Aran\n\nVel Aran was founded around 340 EM by [[Mira]].\nIt fell   a generation\nafter the Exodus.\n";

interface Call {
  url: string;
  auth: string | null;
  body: { model: string; messages: { role: string; content: string }[]; response_format: unknown };
}

/** Stands in for OpenRouter. Each answer is used once, the last one for every later call. */
function provider(answers: (object | "network" | number)[], cost = 0.002) {
  const calls: Call[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return Response.json({
        data: [
          {
            id: MODEL,
            name: "Test model",
            pricing: { prompt: "0.000001", completion: "0.000002" },
            supported_parameters: ["structured_outputs"],
          },
          { id: "other/plain", name: "No structure", pricing: {}, supported_parameters: [] },
        ],
      });
    }
    calls.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (answer === "network") throw new TypeError("fetch failed");
    if (typeof answer === "number") {
      return Response.json({ error: { message: "upstream trouble" } }, { status: answer });
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, cost },
    });
  };
  return { fake, calls };
}

async function start(
  answers: (object | "network" | number)[],
  opts: { env?: Record<string, string>; cost?: number; setUp?: boolean } = {},
) {
  const p = provider(answers, opts.cost);
  t = await makeTestApp({ ...SECRETS, ...opts.env }, { fetch: p.fake });
  await t.login();
  t.repo.pushFromOutside({ [VEL]: BODY });
  await t.services.sync();
  if (opts.setUp !== false) {
    const res = await t.put("/api/settings/ai", {
      key: "sk-or-test-key-1234",
      models: { extraction: MODEL },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  return p;
}

const settings = async () => SettingsResponse.parse((await t.get("/api/settings")).json()).ai;
const inbox = async () => InboxResponse.parse((await t.get("/api/inbox")).json()).proposals;
const logLines = () => {
  const dir = join(t.services.config.dataDir, "state", "ai-log");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) =>
    readFileSync(join(dir, f), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l)),
  );
};
const propose = (path = VEL) => t.post("/api/proposals/fields", { path });

const GOOD = {
  type: "place",
  time: [
    {
      what: "founded",
      when: "around 340 EM",
      quote: "Vel Aran was founded around 340 EM by [[Mira]].",
    },
    // The quote runs over a line break and extra spaces in the entry.
    {
      what: "ended",
      when: "a generation after the Exodus",
      quote: "It fell a generation after the Exodus.",
    },
    { what: "born", when: "long ago", quote: "A sentence the entry does not contain." },
    { what: "conquered", when: "later", quote: "Vel Aran was founded around 340 EM by [[Mira]]." },
  ],
};

describe("settings and the provider key", () => {
  it("stores the key encrypted, never sends it back, and removes it on request", async () => {
    await start([{ reply: "ok" }], { setUp: false });
    expect(await settings()).toMatchObject({
      keySet: false,
      keyFrom: "none",
      canStoreKey: true,
      monthlyCapUsd: 10,
      proposeOnPublish: false,
      spentUsd: 0,
    });
    await t.put("/api/settings/ai", { key: "sk-or-test-key-1234", models: { extraction: MODEL } });
    const body = (await t.get("/api/settings")).body;
    expect(body).not.toContain("sk-or-test-key");
    expect(await settings()).toMatchObject({ keySet: true, keyFrom: "settings", keyLast4: "1234" });
    const stored = readFileSync(join(t.services.config.dataDir, "state", "settings.json"), "utf8");
    expect(stored).not.toContain("sk-or-test-key");
    expect(JSON.parse(stored).passwordHash).toMatch(/^\$argon2/);

    await t.put("/api/settings/ai", { key: null, monthlyCapUsd: 3 });
    expect(await settings()).toMatchObject({ keySet: false, monthlyCapUsd: 3 });
    expect((await settings()).models.extraction).toBe(MODEL);
  });

  it("refuses to store a key without SECRETS_KEY and uses the one from the environment", async () => {
    const p = provider([{ reply: "ok" }]);
    t = await makeTestApp({ OPENROUTER_API_KEY: "sk-or-from-env-9876" }, { fetch: p.fake });
    await t.login();
    const res = await t.put("/api/settings/ai", { key: "sk-or-test-key-1234" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("secrets_key_missing");
    expect(await settings()).toMatchObject({
      keyFrom: "environment",
      keyLast4: "9876",
      canStoreKey: false,
    });
    await t.put("/api/settings/ai", { models: { extraction: MODEL } });
    const test = (await t.post("/api/settings/ai/test")).json();
    expect(test).toMatchObject({ ok: true, costUsd: 0.002 });
    expect(p.calls[0]!.auth).toBe("Bearer sk-or-from-env-9876");
  });

  it("lists the models that can answer in a fixed form, with prices per million tokens", async () => {
    await start([{ reply: "ok" }]);
    expect((await t.get("/api/ai/models")).json()).toEqual({
      models: [{ id: MODEL, name: "Test model", promptPrice: 1, completionPrice: 2 }],
    });
  });
});

describe("calling the provider", () => {
  it("is off without a key or a model", async () => {
    await start([GOOD], { setUp: false });
    const res = await propose();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ai_off");
    expect(logLines()).toEqual([]);
  });

  it("writes one log line per call and counts the spending", async () => {
    const p = await start([GOOD]);
    expect((await propose()).statusCode).toBe(200);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.body.model).toBe(MODEL);
    expect(p.calls[0]!.body.response_format).toMatchObject({ type: "json_schema" });
    // The text sent is the published body, and the schema's names are in the instructions.
    expect(p.calls[0]!.body.messages[1]!.content).toContain("Vel Aran was founded around 340 EM");
    expect(p.calls[0]!.body.messages[0]!.content).toContain("founded");
    expect(logLines()).toEqual([
      expect.objectContaining({
        task: "extraction",
        model: MODEL,
        promptTokens: 120,
        completionTokens: 30,
        costUsd: 0.002,
        entry: VEL,
        ok: true,
      }),
    ]);
    expect((await settings()).spentUsd).toBe(0.002);
    const log = (await t.get("/api/ai/log")).json();
    expect(log.totalUsd).toBe(0.002);
    expect(log.calls).toHaveLength(1);
    expect((await t.get("/api/status")).json().ai).toEqual({ on: true, lastError: null });
  });

  it("stops at the monthly cap with a message that says how much and where to change it", async () => {
    const p = await start([GOOD], { cost: 0.6 });
    await t.put("/api/settings/ai", { monthlyCapUsd: 0.5 });
    expect((await propose()).statusCode).toBe(200);
    t.repo.pushFromOutside({ "01 Places/Second.md": "# Second\n\nFounded in the dry year.\n" });
    await t.services.sync();
    const res = await propose("01 Places/Second.md");
    expect(res.statusCode).toBe(402);
    expect(res.json().error.message).toMatch(/\$0\.60.*cap is \$0\.50.*settings page/);
    expect(p.calls).toHaveLength(1);
  });

  it("tries once more after a network error or a 5xx answer, and logs both attempts", async () => {
    const p = await start(["network", GOOD]);
    expect((await propose()).statusCode).toBe(200);
    expect(p.calls).toHaveLength(2);
    expect(logLines().map((l) => l.ok)).toEqual([false, true]);

    await t.close();
    const q = await start([503, 503]);
    const res = await propose();
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("ai_failed");
    expect(res.json().error.message).toContain("upstream trouble");
    expect(q.calls).toHaveLength(2);
    expect((await t.get("/api/status")).json().ai.lastError).toContain("upstream trouble");
  });

  it("does not retry a refused call or an answer in the wrong form", async () => {
    const p = await start([400]);
    expect((await propose()).json().error.code).toBe("ai_failed");
    expect(p.calls).toHaveLength(1);

    await t.close();
    const q = await start([{ unexpected: true }]);
    const res = await propose();
    expect(res.json().error.code).toBe("ai_bad_answer");
    expect(q.calls).toHaveLength(1);
    expect(await inbox()).toEqual([]);
  });
});

describe("field proposals", () => {
  it("keeps only items with a sentence found in the entry and a known name", async () => {
    await start([GOOD]);
    expect((await propose()).json()).toEqual({ made: 3 });
    const [p] = await inbox();
    expect(p!.path).toBe(VEL);
    expect(p!.operations.map((o) => o.operation)).toEqual([
      expect.objectContaining({
        op: "add_time",
        what: "founded",
        when: "around 340 EM",
        model: MODEL,
      }),
      expect.objectContaining({
        op: "add_time",
        what: "ended",
        when: "a generation after the Exodus",
      }),
      expect.objectContaining({ op: "set_type", type: "place" }),
    ]);
    expect(p!.operations.every((o) => o.applies)).toBe(true);
    expect((await t.get("/api/status")).json().inbox.operations).toBe(3);
  });

  it("does not ask the model twice for the same text, nor propose the same thing twice", async () => {
    const p = await start([GOOD]);
    await propose();
    expect((await propose()).json()).toEqual({ made: 0 });
    expect(p.calls).toHaveLength(1);
    expect((await inbox())[0]!.operations).toHaveLength(3);
  });

  it("refuses appendix files, drafts not yet published and anything that is not a note", async () => {
    const p = await start([GOOD]);
    const appendix = t.services.index.files.find(
      (f) => f.startsWith("99 Appendices/") && f.endsWith(".md"),
    )!;
    for (const path of [appendix, "01 Places/Not written.md", "notes.json"]) {
      const res = await propose(path);
      expect(res.statusCode, path).toBe(403);
    }
    expect(p.calls).toHaveLength(0);
  });

  it("accepts into a new draft, then into the same draft, changing only the fields", async () => {
    await start([GOOD]);
    await propose();
    const [p] = await inbox();
    const [founded, ended, type] = p!.operations.map((o) => o.operation.id);
    const before = (await t.get("/api/status")).json().serverDraftChanges;

    const first = await t.post(`/api/proposals/${p!.id}/operations/${founded}`, {
      decision: "accept",
    });
    expect(first.statusCode, first.body).toBe(200);
    const draftId = first.json().draftId as string;
    // The author corrects the wording before accepting the second one.
    const second = await t.post(`/api/proposals/${p!.id}/operations/${ended}`, {
      decision: "accept",
      what: "destroyed",
      when: "a generation after [[The Exodus]]",
    });
    expect(second.json().draftId).toBe(draftId);
    await t.post(`/api/proposals/${p!.id}/operations/${type}`, { decision: "accept" });
    expect(await inbox()).toEqual([]);
    expect((await t.get("/api/status")).json().serverDraftChanges).toBe(before + 3);

    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts).toHaveLength(1);
    expect(un.drafts[0]!.origins).toEqual([{ kind: "fields", ref: p!.id, model: MODEL }]);
    expect(un.drafts[0]!.text).toBe(
      '---\ntime:\n  - what: founded\n    when: "around 340 EM"\n  - what: destroyed\n' +
        '    when: "a generation after [[The Exodus]]"\ntype: place\n---\n' +
        BODY,
    );
    // Nothing was published by accepting.
    expect(t.repo.remoteFile(VEL)).toBe(BODY);

    const plan = (await t.post("/api/publish/plan", { draftIds: [draftId], renameIds: [] })).json();
    const done = await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Date Vel Aran",
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(t.repo.remoteCommit(t.repo.remoteHead()).message).toBe(
      `Date Vel Aran\n\nFrontier-Proposal: ${p!.id}\nFrontier-Model: ${MODEL}`,
    );
  });

  it("accepts into the author's own draft and raises its revision", async () => {
    await start([GOOD]);
    await propose();
    await t.put("/api/drafts", {
      id: "authordraft1",
      path: VEL,
      kind: "edit",
      text: BODY + "\nA line of my own.\n",
      revision: 0,
    });
    const [p] = await inbox();
    const res = await t.post(
      `/api/proposals/${p!.id}/operations/${p!.operations[0]!.operation.id}`,
      {
        decision: "accept",
      },
    );
    expect(res.json().draftId).toBe("authordraft1");
    const e = EntryResponse.parse(
      (await t.get(`/api/entries?path=${encodeURIComponent(VEL)}`)).json(),
    );
    expect(e.draft).toMatchObject({ id: "authordraft1", revision: 2 });
    expect(e.text).toContain("A line of my own.");
    expect(e.fields.time).toHaveLength(1);
    // A device still holding revision 1 is told, and its text is kept as a second version.
    const stale = await t.put("/api/drafts", {
      id: "authordraft1",
      path: VEL,
      kind: "edit",
      text: BODY + "\nTyped meanwhile.\n",
      revision: 1,
    });
    expect(stale.statusCode).toBe(409);
  });

  it("says when a proposal no longer applies, and lets it only be dismissed", async () => {
    await start([GOOD]);
    await propose();
    await t.put("/api/drafts", {
      id: "authordraft2",
      path: VEL,
      kind: "edit",
      text: "# Vel Aran\n\nIt fell a generation after the Exodus.\n",
      revision: 0,
    });
    const [p] = await inbox();
    expect(p!.operations.map((o) => o.applies)).toEqual([false, true, true]);
    const gone = p!.operations[0]!.operation.id;
    const refused = await t.post(`/api/proposals/${p!.id}/operations/${gone}`, {
      decision: "accept",
    });
    expect(refused.statusCode).toBe(403);
    await t.post(`/api/proposals/${p!.id}/operations/${gone}`, { decision: "dismiss" });
    expect((await inbox())[0]!.operations).toHaveLength(2);
  });

  it("refuses to accept into an entry marked for deletion or with unreadable dates", async () => {
    await start([GOOD]);
    await propose();
    const [p] = await inbox();
    const op = p!.operations[0]!.operation.id;
    await t.put("/api/drafts", {
      id: "deletedraft1",
      path: VEL,
      kind: "delete",
      text: "",
      revision: 0,
    });
    let res = await t.post(`/api/proposals/${p!.id}/operations/${op}`, { decision: "accept" });
    expect(res.statusCode).toBe(403);
    await t.del("/api/drafts/deletedraft1");
    await t.put("/api/drafts", {
      id: "brokendraft1",
      path: VEL,
      kind: "edit",
      text: "---\ntime: someday\n---\n" + BODY,
      revision: 0,
    });
    res = await t.post(`/api/proposals/${p!.id}/operations/${op}`, { decision: "accept" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/dates of this entry cannot be read/);
    expect((await inbox())[0]!.operations).toHaveLength(3);
  });

  it("does not propose a rejected date again until its sentence changes", async () => {
    const reworded = {
      type: null,
      time: [{ ...GOOD.time[0]!, when: "c. 340 EM" }],
    };
    const p = await start([GOOD, reworded, GOOD]);
    await propose();
    const [first] = await inbox();
    for (const o of first!.operations) {
      await t.post(`/api/proposals/${first!.id}/operations/${o.operation.id}`, {
        decision: "reject",
      });
    }
    expect(await inbox()).toEqual([]);

    // The entry changes elsewhere, so the model is asked again; it rewords the same date.
    t.repo.pushFromOutside({ [VEL]: BODY + "\nA new closing line.\n" });
    await t.services.sync();
    expect((await propose()).json()).toEqual({ made: 0 });
    expect(p.calls).toHaveLength(2);

    // The sentence itself changes: the date may be proposed again.
    t.repo.pushFromOutside({
      [VEL]: BODY.replace("around 340 EM by [[Mira]]", "around 340 EM by [[Mira]] and her kin"),
    });
    await t.services.sync();
    const changed = {
      type: null,
      time: [
        {
          what: "founded",
          when: "around 340 EM",
          quote: "Vel Aran was founded around 340 EM by [[Mira]] and her kin.",
        },
      ],
    };
    await t.close();
    const q = await start([changed]);
    t.repo.pushFromOutside({
      [VEL]: BODY.replace("around 340 EM by [[Mira]]", "around 340 EM by [[Mira]] and her kin"),
    });
    await t.services.sync();
    expect((await propose()).json()).toEqual({ made: 1 });
    expect(q.calls).toHaveLength(1);
  });

  it("moves proposals with a published rename and drops them when the entry is deleted", async () => {
    await start([GOOD]);
    await propose();
    const res = await t.post("/api/renames", { from: VEL, to: "01 Places/Vel Aran the White.md" });
    const plan = (
      await t.post("/api/publish/plan", { draftIds: [], renameIds: [res.json().id] })
    ).json();
    await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Rename",
    });
    expect((await inbox())[0]!.path).toBe("01 Places/Vel Aran the White.md");

    t.repo.pushFromOutside({ "01 Places/Vel Aran the White.md": null });
    await t.services.sync();
    expect(await inbox()).toEqual([]);
  });

  it("proposes after a publish when that is switched on, for the published notes only", async () => {
    const p = await start([GOOD]);
    await t.put("/api/settings/ai", { proposeOnPublish: true });
    await t.put("/api/drafts", {
      id: "publishdraft",
      path: VEL,
      kind: "edit",
      text: BODY + "\nOne more line.\n",
      revision: 0,
    });
    const plan = (
      await t.post("/api/publish/plan", { draftIds: ["publishdraft"], renameIds: [] })
    ).json();
    await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Edit",
    });
    await expect.poll(async () => (await inbox()).length).toBe(1);
    expect(p.calls).toHaveLength(1);
  });
});

describe("a run over a folder", () => {
  it("estimates first, then runs in the background and reports each failure", async () => {
    const p = await start([GOOD, 400, GOOD]);
    t.repo.pushFromOutside({
      "01 Places/Second.md": "# Second\n\nFounded in the dry year.\n",
      "01 Places/Third.md": "# Third\n\nVel Aran was founded around 340 EM by [[Mira]].\n",
    });
    await t.services.sync();
    const candidates = t.services.fields.candidates("01 Places");
    const first = (await t.post("/api/proposals/job", { folder: "01 Places" })).json();
    expect(first.entries).toBe(candidates.length);
    expect(first.estimateUsd).toBeGreaterThan(0);
    expect(p.calls).toHaveLength(0);

    expect(
      (await t.post("/api/proposals/job", { folder: "01 Places", confirm: true })).json(),
    ).toEqual({
      started: true,
    });
    await t.services.fieldJob.finished();
    const state = FieldJobState.parse((await t.get("/api/proposals/job")).json());
    expect(state).toMatchObject({ state: "done", folder: "01 Places", total: candidates.length });
    expect(state.done).toBe(candidates.length);
    expect(state.failed).toHaveLength(1);
    expect(state.made).toBeGreaterThan(0);
  });

  it("stops at the cap and can be cancelled", async () => {
    await start([GOOD], { cost: 5 });
    await t.put("/api/settings/ai", { monthlyCapUsd: 4 });
    await t.post("/api/proposals/job", { folder: "", confirm: true });
    await t.services.fieldJob.finished();
    const state = FieldJobState.parse((await t.get("/api/proposals/job")).json());
    expect(state.state).toBe("stopped");
    expect(state.stoppedBy).toMatch(/cap/);
    expect(state.done).toBe(1);

    await t.put("/api/settings/ai", { monthlyCapUsd: 1000 });
    await t.post("/api/proposals/job", { folder: "", confirm: true });
    await t.del("/api/proposals/job");
    await t.services.fieldJob.finished();
    expect((await t.get("/api/proposals/job")).json().state).toBe("cancelled");
  });
});

describe("entry ids", () => {
  it("returns the id an entry has, or writes a new one through a draft", async () => {
    await start([GOOD], { setUp: false });
    const id = await t.services.changer.ensureId(VEL);
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(await t.services.changer.ensureId(VEL)).toBe(id);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts).toHaveLength(1);
    expect(un.drafts[0]!.text).toBe(`---\nid: ${id}\n---\n${BODY}`);
    expect(un.drafts[0]!.origins).toEqual([]);
    expect(t.repo.remoteFile(VEL)).toBe(BODY);
  });
});
