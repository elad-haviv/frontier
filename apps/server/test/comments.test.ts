import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

/** The key this test's "device" holds; it reaches the server only in the keys header. */
const KEY = "sk-or-test-key-1234";
const ROAD = "03 Places/Long Road.md";
const PASSAGE = "The toll on the Long Road is paid in salt.";

/** Stands in for OpenRouter, answering every call with one rewrite. */
function provider(text: string) {
  const calls: { messages: { role: string; content: string }[] }[] = [];
  const fake: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/models")) return Response.json({ data: [] });
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ text }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
    });
  };
  return { fake, calls };
}

async function start(model: string | null = "test/talker") {
  const p = provider("The toll is salt.");
  t = await makeTestApp({}, { fetch: p.fake, settleMs: 0 });
  await t.login();
  t.repo.pushFromOutside({ [ROAD]: `# Long Road\n\nA road.\n\n${PASSAGE}\n` });
  await t.services.sync();
  t.keys = { openrouter: KEY };
  if (model) {
    await t.put("/api/settings/ai", { models: { conversation: model } });
  }
  return p;
}

const patch = (url: string, payload: unknown) =>
  t.app.inject({ method: "PATCH", url, payload: payload as object, headers: { cookie: t.cookie } });

const add = (extra: Record<string, unknown> = {}) =>
  t.post("/api/comments", {
    path: ROAD,
    quote: PASSAGE,
    prefix: "A road.\n\n",
    suffix: "\n",
    text: "Make it shorter",
    for: "ai",
    ...extra,
  });

const list = async () =>
  (await t.get(`/api/comments?path=${encodeURIComponent(ROAD)}`)).json().comments as {
    id: string;
    text: string;
    for: string;
    path: string;
  }[];

describe("comments on a passage", () => {
  it("are added, listed, counted, changed and removed", async () => {
    await start();
    const res = await add();
    expect(res.statusCode, res.body).toBe(200);
    const { id } = res.json().comment;
    expect(await list()).toMatchObject([
      { id, quote: PASSAGE, text: "Make it shorter", for: "ai" },
    ]);
    expect((await t.get(`/api/comments/count?path=${encodeURIComponent(ROAD)}`)).json()).toEqual({
      open: 1,
    });

    const changed = await patch(`/api/comments/${id}`, { text: "Check the toll", for: "me" });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await list())[0]).toMatchObject({ text: "Check the toll", for: "me" });

    expect((await t.del(`/api/comments/${id}`)).statusCode).toBe(200);
    expect(await list()).toEqual([]);
  });

  it("refuses empty words, files that are not entries, and more than the limit", async () => {
    await start();
    expect((await add({ text: "  " })).statusCode).toBe(400);
    expect((await add({ path: "03 Places/map.png" })).statusCode).toBe(400);
    const store = t.services.comments;
    for (let i = 0; i < 300; i++) {
      await store.add({ path: ROAD, quote: "x", prefix: "", suffix: "", text: "n", for: "me" });
    }
    expect((await add()).statusCode).toBe(400);
  });

  it("keep every one of many added at once, on disk too", async () => {
    await start();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => add({ text: `Comment ${i}` })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await list()).toHaveLength(20);
    const { CommentStore } = await import("../src/comments/store.js");
    const again = new CommentStore(join(t.services.config.dataDir, "state"), t.services.files);
    expect(await again.forPath(ROAD)).toHaveLength(20);
  });

  it("follow their entry when a rename is saved", async () => {
    await start();
    await add();
    const to = "03 Places/Salt Road.md";
    const res = await t.post("/api/renames", { from: ROAD, to });
    const plan = (
      await t.post("/api/publish/plan", { draftIds: [], renameIds: [res.json().id] })
    ).json();
    await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Rename",
    });
    expect(await list()).toEqual([]);
    const moved = (await t.get(`/api/comments?path=${encodeURIComponent(to)}`)).json().comments;
    expect(moved).toHaveLength(1);
  });
});

describe("work on a comment for the AI", () => {
  it("rewrites the passage as the comment asks, saving nothing", async () => {
    const p = await start();
    const { id } = (await add()).json().comment;
    const res = await t.post(`/api/comments/${id}/work`, { before: "A road.\n\n", after: "\n" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ text: "The toll is salt." });
    const sent = p.calls
      .at(-1)!
      .messages.map((m) => m.content)
      .join("\n");
    expect(sent).toContain(PASSAGE);
    expect(sent).toContain("Do what this comment on the passage asks: Make it shorter");
    expect(await list()).toHaveLength(1);
  });

  it("is refused for a comment for the author, without a model, and in quarantine", async () => {
    await start(null);
    const mine = (await add({ for: "me" })).json().comment.id;
    expect((await t.post(`/api/comments/${mine}/work`, {})).statusCode).toBe(400);
    const ai = (await add()).json().comment.id;
    expect((await t.post(`/api/comments/${ai}/work`, {})).json().error.code).toBe("ai_off");

    vi.spyOn(t.services.quarantine, "aiMayRead").mockReturnValue("Held in quarantine.");
    const held = await t.post(`/api/comments/${ai}/work`, {});
    expect(held.statusCode).toBe(403);
    expect(held.json().error.message).toBe("Held in quarantine.");
  });
});
