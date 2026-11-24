/**
 * Several providers through the server: adding and checking keys, the catalogue across them,
 * prices and estimated costs, removing a provider in use, and settings written before stage 18.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelsResponse, ProvidersResponse, SettingsResponse } from "@frontier/schema";
import { encrypt } from "../src/state/secrets.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(async () => {
  anthropicReply = null;
  await t.close();
});

const SECRET = Buffer.alloc(32, 3);
const SECRETS = { SECRETS_KEY: SECRET.toString("base64") };
const GOOD_ANT = "sk-ant-good-key-0001";

interface Sent {
  url: URL;
  headers: Headers;
  body: Record<string, unknown> | null;
}

/** Anthropic's next answer to a message, when a test sets one. */
let anthropicReply: object | null = null;

/** Stands in for OpenRouter, Anthropic and OpenAI, each at its own address. */
function providers() {
  const sent: Sent[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    sent.push({ url, headers, body });
    if (url.host === "openrouter.ai") {
      if (url.pathname.endsWith("/models")) {
        return Response.json({
          data: [
            {
              id: "anthropic/claude-sonnet-5.5",
              name: "Anthropic: Claude Sonnet 5.5",
              description: "A careful writer.",
              context_length: 1000000,
              pricing: { prompt: "0.000003", completion: "0.000015" },
              supported_parameters: ["structured_outputs", "reasoning", "tools"],
              architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            },
            {
              id: "test/model",
              name: "Test model",
              pricing: { prompt: "0.000001", completion: "0.000002" },
              supported_parameters: ["structured_outputs"],
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/key")) {
        return headers.get("authorization") === "Bearer sk-or-good-0002"
          ? Response.json({ data: {} })
          : Response.json({ error: { message: "No auth credentials found" } }, { status: 401 });
      }
      if (body?.stream) {
        const lines = [
          { choices: [{ delta: { reasoning: "Hm." } }] },
          { choices: [{ delta: { content: '{"reply":' } }] },
          {
            choices: [{ delta: { content: '"ok"}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 9, completion_tokens: 4, cost: 0.003 },
          },
        ];
        return new Response(
          lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return Response.json({
        choices: [{ message: { content: '{"reply":"ok"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.001 },
      });
    }
    if (url.host === "api.anthropic.com") {
      if (headers.get("x-api-key") !== GOOD_ANT) {
        return Response.json(
          {
            type: "error",
            error: {
              type: "authentication_error",
              message: `invalid x-api-key ${headers.get("x-api-key")}`,
            },
          },
          { status: 401 },
        );
      }
      if (url.pathname.endsWith("/models")) {
        return Response.json({
          data: [
            {
              id: "claude-sonnet-5-5",
              display_name: "Claude Sonnet 5.5",
              max_input_tokens: 1000000,
            },
          ],
          has_more: false,
        });
      }
      if (anthropicReply) return Response.json(anthropicReply);
      return Response.json({
        type: "message",
        content: [{ type: "text", text: '{"reply":"ok"}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 100 },
      });
    }
    if (url.host === "api.openai.com") {
      if (url.pathname.endsWith("/models"))
        return Response.json({ data: [{ id: "gpt-unlisted-9" }] });
      return Response.json({
        choices: [{ message: { content: '{"reply":"ok"}' } }],
        usage: { prompt_tokens: 500, completion_tokens: 50 },
      });
    }
    throw new TypeError("fetch failed");
  };
  return { fake, sent };
}

async function start(env: Record<string, string> = {}) {
  const p = providers();
  t = await makeTestApp({ ...SECRETS, ...env }, { fetch: p.fake, settleMs: 0 });
  await t.login();
  return p;
}

const settings = async () => SettingsResponse.parse((await t.get("/api/settings")).json()).ai;
const list = async () => ProvidersResponse.parse((await t.get("/api/ai/providers")).json());
const models = async (query = "") =>
  ModelsResponse.parse((await t.get(`/api/ai/models${query}`)).json());
const patch = (url: string, payload: object) =>
  t.app.inject({ method: "PATCH", url, headers: { cookie: t.cookie }, payload });
const logLines = () => {
  const dir = join(t.services.config.dataDir, "state", "ai-log");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) =>
    readFileSync(join(dir, f), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>),
  );
};

describe("settings written before stage 18", () => {
  it("read the one key as the OpenRouter provider and bare model ids as OpenRouter's", async () => {
    await start();
    const file = join(t.services.config.dataDir, "state", "settings.json");
    const old = JSON.parse(readFileSync(file, "utf8"));
    old.ai = {
      key: encrypt(SECRET, "sk-or-v1-old-key-7777"),
      models: { extraction: "test/model", conversation: null, art: null },
      monthlyCapUsd: 4,
    };
    writeFileSync(file, JSON.stringify(old));

    const ai = await settings();
    expect(ai.models).toEqual({
      extraction: "openrouter:test/model",
      conversation: null,
      art: null,
    });
    expect(ai).toMatchObject({
      keySet: true,
      keyFrom: "settings",
      keyLast4: "7777",
      monthlyCapUsd: 4,
    });
    expect(ai.providers).toEqual([
      expect.objectContaining({
        id: "openrouter",
        kind: "openrouter",
        keyFrom: "settings",
        keyHint: "sk-…7777",
        stored: true,
        usedFor: ["extraction"],
      }),
    ]);
    expect(await t.services.ai.ready("extraction")).toBe(true);
    // The next write stores the new form, and the old field is gone.
    await t.put("/api/settings/ai", { monthlyCapUsd: 5 });
    const now = JSON.parse(readFileSync(file, "utf8"));
    expect(now.ai.key).toBeNull();
    expect(now.ai.providers[0].id).toBe("openrouter");
    expect(now.ai.models.extraction).toBe("openrouter:test/model");
  });
});

describe("providers", () => {
  it("checks a key before storing it, never sends it back, and scrubs it from the provider's words", async () => {
    await start();
    const bad = await t.post("/api/ai/providers", {
      kind: "anthropic",
      key: "sk-ant-bad-key-9999",
    });
    expect(bad.statusCode, bad.body).toBe(200);
    expect(bad.json()).toMatchObject({ ok: false, saved: false, refused: true, provider: null });
    expect(bad.json().message).toContain("(401)");
    expect(bad.body).not.toContain("sk-ant-bad-key-9999");
    expect((await list()).providers).toEqual([]);

    const good = (await t.post("/api/ai/providers", { kind: "anthropic", key: GOOD_ANT })).json();
    expect(good).toMatchObject({ ok: true, saved: true, models: 1 });
    expect(good.provider).toMatchObject({
      id: "anthropic",
      keyHint: "sk-…0001",
      keyFrom: "settings",
      check: { ok: true },
    });
    const raw = (await t.get("/api/ai/providers")).body + (await t.get("/api/settings")).body;
    expect(raw).not.toContain(GOOD_ANT);
    // Stored encrypted.
    const file = readFileSync(join(t.services.config.dataDir, "state", "settings.json"), "utf8");
    expect(file).not.toContain(GOOD_ANT);

    // A second Anthropic is refused; its key is replaced instead, checked the same way.
    const again = await t.post("/api/ai/providers", { kind: "anthropic", key: GOOD_ANT });
    expect(again.statusCode).toBe(400);
    const replaced = (
      await t.put("/api/ai/providers/anthropic/key", { key: "sk-ant-wrong-0003" })
    ).json();
    expect(replaced).toMatchObject({ ok: false, saved: false });
    expect((await list()).providers[0]!.keyHint).toBe("sk-…0001");

    // Switched off, it is not used and not listed.
    await patch("/api/ai/providers/anthropic", { enabled: false });
    expect((await list()).providers[0]!.enabled).toBe(false);
    expect((await models()).providers).toEqual([]);
  });

  it("keeps the OpenRouter key field of the earlier page working through the provider list", async () => {
    await start();
    await t.put("/api/settings/ai", {
      key: "sk-or-good-0002",
      models: { conversation: "test/model" },
    });
    expect((await list()).providers).toEqual([
      expect.objectContaining({ id: "openrouter", keyHint: "sk-…0002", usedFor: ["conversation"] }),
    ]);
    const check = (await t.post("/api/ai/providers/openrouter/check")).json();
    expect(check).toMatchObject({ ok: true, provider: { check: { ok: true } } });
    await t.put("/api/settings/ai", { key: null });
    expect((await settings()).keySet).toBe(false);
  });

  it("refuses an endpoint on a private address, and saves one it cannot reach only when asked", async () => {
    await start();
    const internal = await t.post("/api/ai/providers", {
      kind: "custom",
      baseUrl: "https://10.0.0.8/v1",
    });
    expect(internal.json()).toMatchObject({ ok: false, refused: true, saved: false });
    expect(internal.json().message).toMatch(/private or local/);
    const plain = await t.post("/api/ai/providers", {
      kind: "custom",
      baseUrl: "http://llm.invalid/v1",
    });
    expect(plain.statusCode).toBe(400);
    const away = (
      await t.post("/api/ai/providers", {
        kind: "custom",
        baseUrl: "https://llm.invalid/v1",
        name: "Home server",
      })
    ).json();
    expect(away).toMatchObject({ ok: false, refused: false, saved: false });
    const anyway = (
      await t.post("/api/ai/providers", {
        kind: "custom",
        baseUrl: "https://llm.invalid/v1",
        name: "Home server",
        saveAnyway: true,
      })
    ).json();
    expect(anyway).toMatchObject({
      saved: true,
      provider: { id: "custom", name: "Home server", keySet: false },
    });
    const second = (
      await t.post("/api/ai/providers", {
        kind: "custom",
        baseUrl: "https://llm2.invalid/v1",
        saveAnyway: true,
      })
    ).json();
    expect(second.provider.id).toBe("custom-2");
  });

  it("refuses to remove a provider a task uses unless confirmed, then turns that task off", async () => {
    await start();
    await t.post("/api/ai/providers", { kind: "anthropic", key: GOOD_ANT });
    expect(
      (await t.put("/api/settings/ai", { models: { conversation: "anthropic:claude-sonnet-5-5" } }))
        .statusCode,
    ).toBe(200);
    expect((await t.del("/api/ai/providers/anthropic")).statusCode).toBe(400);
    expect((await t.del("/api/ai/providers/anthropic?force=1")).json()).toEqual({
      ok: true,
      turnedOff: ["conversation"],
    });
    expect((await settings()).models.conversation).toBeNull();
    expect((await list()).providers).toEqual([]);
  });
});

describe("the catalogue and costs across providers", () => {
  it("prices direct models from OpenRouter's list, and recommends", async () => {
    await start({ OPENAI_API_KEY: "sk-env-openai-5555" });
    await t.post("/api/ai/providers", { kind: "anthropic", key: GOOD_ANT });
    const all = await models();
    expect(all.providers.map((p) => [p.id, p.ok])).toEqual([
      ["anthropic", true],
      ["openai", true],
    ]);
    const sonnet = all.models.find((m) => m.id === "anthropic:claude-sonnet-5-5")!;
    expect(sonnet).toMatchObject({
      name: "Claude Sonnet 5.5",
      description: "A careful writer.",
      contextLength: 1000000,
      promptPrice: 3,
      completionPrice: 15,
      priceFrom: "openrouter",
      checked: true,
      costReported: false,
      abilities: { structuredOutput: true, imagesIn: true, imageOut: false, reasoning: true },
      suits: { extraction: "yes", conversation: "yes", art: "no" },
      recommendedFor: ["conversation"],
    });
    const unlisted = all.models.find((m) => m.id === "openai:gpt-unlisted-9")!;
    expect(unlisted).toMatchObject({ promptPrice: null, priceFrom: null, checked: false });
    expect(all.typical.conversation).toEqual({ promptTokens: 14000, completionTokens: 1200 });
    // The environment's key shows, masked, and cannot be removed.
    expect((await list()).providers.find((p) => p.id === "openai")).toMatchObject({
      keyFrom: "environment",
      keyHint: "sk-…5555",
      stored: false,
    });
    expect((await t.del("/api/ai/providers/openai")).statusCode).toBe(404);
  });

  it("estimates an unreported cost from prices and counts it against the cap", async () => {
    await start({ OPENAI_API_KEY: "sk-env-openai-5555" });
    await t.post("/api/ai/providers", { kind: "anthropic", key: GOOD_ANT });
    await t.put("/api/settings/ai", { models: { conversation: "anthropic:claude-sonnet-5-5" } });
    const tried = (await t.post("/api/settings/ai/test", { task: "conversation" })).json();
    expect(tried).toMatchObject({ ok: true, message: 'The model answered "ok".' });
    // 1,000 tokens in at $3 and 100 out at $15 per million.
    expect(tried.costUsd).toBeCloseTo(0.0045, 8);
    expect(logLines()).toEqual([
      expect.objectContaining({
        task: "conversation",
        model: "anthropic:claude-sonnet-5-5",
        provider: "anthropic",
        costKind: "estimated",
        promptTokens: 1000,
        completionTokens: 100,
      }),
    ]);
    expect((await settings()).spentUsd).toBeCloseTo(0.0045, 8);
    const log = (await t.get("/api/ai/log")).json();
    expect(log.byProvider).toEqual([
      {
        provider: "anthropic",
        name: "Anthropic",
        calls: 1,
        usd: expect.closeTo(0.0045, 8),
        reported: 0,
        estimated: 1,
        unknown: 0,
      },
    ]);
  });

  it("refuses a model with no known price until the author types one", async () => {
    await start({ OPENAI_API_KEY: "sk-env-openai-5555" });
    const refused = await t.put("/api/settings/ai", {
      models: { extraction: "openai:gpt-unlisted-9" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/No price is known/);
    await t.put("/api/settings/ai/prices", {
      prices: { "openai:gpt-unlisted-9": { promptPrice: 0, completionPrice: 0 } },
    });
    expect(
      (await t.put("/api/settings/ai", { models: { extraction: "openai:gpt-unlisted-9" } }))
        .statusCode,
    ).toBe(200);
    expect((await models("?q=unlisted")).models[0]).toMatchObject({
      promptPrice: 0,
      priceFrom: "author",
    });
    const tried = (await t.post("/api/settings/ai/test", { task: "extraction" })).json();
    expect(tried).toMatchObject({ ok: true, costUsd: 0 });
    expect(logLines()[0]).toMatchObject({ costKind: "estimated", costUsd: 0 });
  });

  it("can try a model before it is chosen", async () => {
    await start();
    await t.put("/api/settings/ai", { key: "sk-or-good-0002" });
    const tried = (
      await t.post("/api/settings/ai/test", {
        task: "conversation",
        model: "openrouter:test/model",
      })
    ).json();
    expect(tried).toMatchObject({ ok: true, costUsd: 0.001 });
    expect((await settings()).models.conversation).toBeNull();
  });
});

describe("calls", () => {
  it("say where to put things right when AI is off", async () => {
    await start();
    t.repo.pushFromOutside({ "01 Places/Vel.md": "# Vel\n\nVel was founded.\n" });
    await t.services.sync();
    await t.put("/api/settings/ai", { models: { extraction: "test/model" } });
    const off = (await t.post("/api/proposals/fields", { path: "01 Places/Vel.md" })).json();
    expect(off.error).toMatchObject({ code: "ai_off", href: "/settings/ai/providers" });
    await t.put("/api/settings/ai", { key: "sk-or-good-0002", models: { extraction: null } });
    const noModel = (await t.post("/api/proposals/fields", { path: "01 Places/Vel.md" })).json();
    expect(noModel.error).toMatchObject({ code: "ai_off", href: "/settings/ai/models/extraction" });
  });

  it("stream text and thinking, and log the call when the stream ends", async () => {
    const p = await start();
    await t.put("/api/settings/ai", {
      key: "sk-or-good-0002",
      models: { conversation: "test/model" },
    });
    const events = [];
    for await (const e of t.services.ai.stream({
      task: "conversation",
      system: "s",
      user: "u",
      entry: "e.md",
    })) {
      events.push(e);
    }
    expect(events.map((e) => e.type)).toEqual(["reasoning", "text", "text", "done"]);
    expect(p.sent.at(-1)!.body).toMatchObject({ model: "test/model", stream: true });
    expect(logLines()).toEqual([
      expect.objectContaining({
        task: "conversation",
        costUsd: 0.003,
        costKind: "reported",
        entry: "e.md",
        ok: true,
      }),
    ]);
  });

  it("give every provider room to think, and say when the answer was cut off at the limit", async () => {
    const p = await start();
    await t.post("/api/ai/providers", { kind: "anthropic", key: GOOD_ANT });
    await t.put("/api/settings/ai", { models: { conversation: "anthropic:claude-sonnet-5-5" } });
    const warned: object[] = [];
    t.services.ai.logFailuresTo({ warn: (details) => warned.push(details) });
    const ask = () =>
      t.services.ai.complete({
        task: "conversation",
        system: "s",
        user: "u",
        maxTokens: 2500,
        schema: {
          name: "reply",
          json: { type: "object" },
          check: { safeParse: (v: unknown) => ({ success: v !== undefined, data: v }) } as never,
        },
      });
    anthropicReply = {
      type: "message",
      content: [{ type: "text", text: '{"reply":"o' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 10500 },
    };
    await expect(ask()).rejects.toThrow("The model ran out of room");
    const sent = p.sent.at(-1)!.body!;
    expect(sent.max_tokens).toBe(2500 + 8000);
    // Brief thinking by default, through the provider's own setting.
    expect(sent).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    anthropicReply = { type: "message", content: [], stop_reason: "max_tokens", usage: {} };
    await expect(ask()).rejects.toThrow("ran out of room");
    expect(warned).toHaveLength(2);
  });

  it("stream a fixed-form answer piece by piece, and log a call the author stopped without warning", async () => {
    await start();
    await t.put("/api/settings/ai", {
      key: "sk-or-good-0002",
      models: { conversation: "test/model" },
    });
    const pieces: object[] = [];
    const answer = await t.services.ai.complete({
      task: "conversation",
      system: "s",
      user: "u",
      onStream: (piece) => pieces.push(piece),
      schema: {
        name: "reply",
        json: { type: "object" },
        check: { safeParse: (v: unknown) => ({ success: true, data: v }) } as never,
      },
    });
    expect(answer).toEqual({ reply: "ok" });
    expect(pieces).toEqual([{ reasoning: "Hm." }, { content: '{"reply":' }, { content: '"ok"}' }]);

    const warned: object[] = [];
    t.services.ai.logFailuresTo({ warn: (details) => warned.push(details) });
    const stop = new AbortController();
    stop.abort();
    await expect(
      t.services.ai.complete({
        task: "conversation",
        system: "s",
        user: "u",
        signal: stop.signal,
        onStream: () => undefined,
        schema: { name: "x", json: {}, check: { safeParse: () => ({ success: true }) } as never },
      }),
    ).rejects.toMatchObject({ code: "ai_stopped" });
    expect(warned).toEqual([]);
    expect(logLines().at(-1)).toMatchObject({ ok: false, error: "Stopped by the author." });
  });
});
