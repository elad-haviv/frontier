/**
 * Several providers through the server, each with the key the device sends: checking keys, the
 * catalogue across them, prices and estimated costs, and the keys that older settings files held.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelsResponse, SettingsResponse } from "@frontier/schema";
import { buildApp } from "../src/app.js";
import { withDeviceKeys } from "../src/ai/keyring.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(async () => {
  anthropicReply = null;
  await t.close();
});

const GOOD_ANT = "sk-ant-good-key-0001";
const GOOD_OR = "sk-or-good-0002";
const OPENAI = "sk-openai-5555";

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

async function start() {
  const p = providers();
  t = await makeTestApp({}, { fetch: p.fake, settleMs: 0 });
  await t.login();
  return p;
}

const settings = async () => SettingsResponse.parse((await t.get("/api/settings")).json()).ai;
const models = async (query = "") =>
  ModelsResponse.parse((await t.get(`/api/ai/models${query}`)).json());
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
const settingsFile = () => join(t.services.config.dataDir, "state", "settings.json");

describe("keys an earlier version stored on the server", () => {
  const stored = { iv: "aXY=", data: "ZGF0YQ==", tag: "dGFn" };

  it("are deleted at start, with one notice, and the cap and the providers go with them", async () => {
    await start();
    const old = JSON.parse(readFileSync(settingsFile(), "utf8"));
    old.ai = {
      key: stored,
      providers: [
        { id: "anthropic", kind: "anthropic", key: stored, enabled: true },
        { id: "custom", kind: "custom", name: "Home server", key: stored, baseUrl: "https://h/v1" },
        { id: "openai", kind: "openai", key: null },
      ],
      models: { extraction: "test/model", conversation: "custom:llama", art: null },
      monthlyCapUsd: 4,
      artStyle: "Charcoal.",
    };
    writeFileSync(settingsFile(), JSON.stringify(old));

    // A server starting on this data folder removes them and remembers to say so once.
    const again = await buildApp(t.services.config, { fetch: providers().fake });
    expect(again.services.status.snapshot().notices.keysRemoved).toEqual({
      at: expect.any(String),
      providers: ["OpenRouter", "Anthropic", "Home server"],
      environment: [],
    });
    const file = readFileSync(settingsFile(), "utf8");
    expect(file).not.toContain(stored.data);
    expect(file).not.toContain('"kind"');
    expect(file).not.toContain("monthlyCapUsd");
    const now = JSON.parse(file);
    expect(now.passwordHash).toBe("");
    expect(now.ai.artStyle).toBe("Charcoal.");
    // Bare ids are OpenRouter's; a model of the removed endpoint is off until another is chosen.
    expect(now.ai.models).toEqual({
      extraction: "openrouter:test/model",
      conversation: null,
      art: null,
    });
    expect(now.ai.keysRemoved.providers).toEqual(["OpenRouter", "Anthropic", "Home server"]);
    await again.app.close();

    // Seen once, it is cleared and not made again; a clean file is left alone.
    expect((await t.services.settings.read())?.ai.keysRemoved?.providers).toHaveLength(3);
    expect((await t.del("/api/notices/keys-removed")).statusCode).toBe(200);
    expect((await t.services.settings.read())?.ai.keysRemoved).toBeNull();
    expect(await t.services.settings.removeStoredKeys()).toBeNull();
    expect((await t.get("/api/status")).json().notices.keysRemoved).toBeNull();
  });

  it("leave no notice when only keyless entries were there, and nothing at all in a clean file", async () => {
    await start();
    expect(await t.services.settings.removeStoredKeys()).toBeNull();
    const before = readFileSync(settingsFile(), "utf8");
    const old = JSON.parse(before);
    old.ai = { providers: [{ id: "openai", kind: "openai", key: null }], monthlyCapUsd: 7 };
    writeFileSync(settingsFile(), JSON.stringify(old));
    expect(await t.services.settings.removeStoredKeys()).toBeNull();
    expect(readFileSync(settingsFile(), "utf8")).not.toContain("monthlyCapUsd");
    expect((await t.services.settings.read())?.ai.keysRemoved).toBeNull();
  });
});

describe("keys sent with a request", () => {
  it("are checked with the provider, never stored, and scrubbed from the provider's words", async () => {
    await start();
    const before = readFileSync(settingsFile(), "utf8");
    t.keys = { anthropic: "sk-ant-bad-key-9999" };
    const bad = await t.post("/api/ai/keys/anthropic/check");
    expect(bad.statusCode, bad.body).toBe(200);
    expect(bad.json()).toMatchObject({ ok: false, refused: true });
    expect(bad.json().message).toContain("(401)");
    expect(bad.body).not.toContain("sk-ant-bad-key-9999");

    t.keys = { anthropic: GOOD_ANT };
    expect((await t.post("/api/ai/keys/anthropic/check")).json()).toMatchObject({
      ok: true,
      refused: false,
      models: 1,
    });
    expect(readFileSync(settingsFile(), "utf8")).toBe(before);
    expect((await t.get("/api/settings")).body).not.toContain(GOOD_ANT);
  });

  it("say a provider could not be reached apart from one that refused the key", async () => {
    await start();
    t.keys = { xai: "xai-nobody-1234" };
    const away = (await t.post("/api/ai/keys/xai/check")).json();
    expect(away).toMatchObject({ ok: false, refused: false, models: null });
  });
});

describe("the catalogue and costs across providers", () => {
  it("lists only the providers the request has keys for, pricing direct models from OpenRouter's list", async () => {
    await start();
    expect((await models()).providers).toEqual([]);
    t.keys = { anthropic: GOOD_ANT, openai: OPENAI };
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
    // Another person's keys are another list: one with only Anthropic's sees no OpenAI model.
    t.keys = { anthropic: GOOD_ANT };
    expect((await models()).providers.map((p) => p.id)).toEqual(["anthropic"]);
  });

  it("estimates an unreported cost from prices", async () => {
    await start();
    t.keys = { anthropic: GOOD_ANT };
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

  it("lets a model with no known price be chosen: its calls count as unknown until a price is typed", async () => {
    await start();
    t.keys = { openai: OPENAI };
    const chosen = await t.put("/api/settings/ai", {
      models: { extraction: "openai:gpt-unlisted-9" },
    });
    expect(chosen.statusCode).toBe(200);
    const unpriced = (await t.post("/api/settings/ai/test", { task: "extraction" })).json();
    expect(unpriced).toMatchObject({ ok: true, costUsd: 0 });
    expect(logLines()[0]).toMatchObject({ costKind: "unknown", costUsd: 0 });
    await t.put("/api/settings/ai/prices", {
      prices: { "openai:gpt-unlisted-9": { promptPrice: 2, completionPrice: 4 } },
    });
    expect((await models("?q=unlisted")).models[0]).toMatchObject({
      promptPrice: 2,
      priceFrom: "author",
    });
    const priced = (await t.post("/api/settings/ai/test", { task: "extraction" })).json();
    expect(priced.costUsd).toBeGreaterThan(0);
    expect(logLines()[1]).toMatchObject({ costKind: "estimated" });
  });

  it("can try a model before it is chosen", async () => {
    await start();
    t.keys = { openrouter: GOOD_OR };
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
    const propose = async () =>
      (await t.post("/api/proposals/fields", { path: "01 Places/Vel.md" })).json();
    // No key on the device: the web app is told which provider, and where to add one.
    expect((await propose()).error).toMatchObject({
      code: "ai_key_missing",
      provider: "openrouter",
      href: "/settings/device/ai-keys",
    });
    t.keys = { openrouter: GOOD_OR };
    await t.put("/api/settings/ai", { models: { extraction: null } });
    expect((await propose()).error).toMatchObject({
      code: "ai_off",
      href: "/settings/you/ai-models/extraction",
    });
  });

  it("stream text and thinking, and log the call when the stream ends", async () => {
    const p = await start();
    await t.put("/api/settings/ai", { models: { conversation: "test/model" } });
    const events: { type: string }[] = [];
    await withDeviceKeys({ openrouter: GOOD_OR }, async () => {
      for await (const e of t.services.ai.stream({
        task: "conversation",
        system: "s",
        user: "u",
        entry: "e.md",
      })) {
        events.push(e);
      }
    });
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

  it("do nothing outside a request that carries a key", async () => {
    const p = await start();
    await t.put("/api/settings/ai", { models: { conversation: "test/model" } });
    await expect(
      t.services.ai.complete({
        task: "conversation",
        system: "s",
        user: "u",
        schema: { name: "x", json: {}, check: { safeParse: () => ({ success: true }) } as never },
      }),
    ).rejects.toMatchObject({ code: "ai_key_missing" });
    expect(p.sent.filter((s) => s.body !== null)).toEqual([]);
    expect(logLines()).toEqual([]);
  });

  it("give every provider room to think, and say when the answer was cut off at the limit", async () => {
    const p = await start();
    t.keys = { anthropic: GOOD_ANT };
    await t.put("/api/settings/ai", { models: { conversation: "anthropic:claude-sonnet-5-5" } });
    const warned: object[] = [];
    t.services.ai.logFailuresTo({ warn: (details) => warned.push(details) });
    const ask = () =>
      withDeviceKeys({ anthropic: GOOD_ANT }, () =>
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
        }),
      );
    anthropicReply = {
      type: "message",
      content: [{ type: "text", text: '{"reply":"o' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 10500 },
    };
    await expect(ask()).rejects.toThrow("The model ran out of room");
    const sent = p.sent.filter((x) => x.body !== null).at(-1)!.body!;
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
    await t.put("/api/settings/ai", { models: { conversation: "test/model" } });
    const pieces: object[] = [];
    const answer = await withDeviceKeys({ openrouter: GOOD_OR }, () =>
      t.services.ai.complete({
        task: "conversation",
        system: "s",
        user: "u",
        onStream: (piece) => pieces.push(piece),
        schema: {
          name: "reply",
          json: { type: "object" },
          check: { safeParse: (v: unknown) => ({ success: true, data: v }) } as never,
        },
      }),
    );
    expect(answer).toEqual({ reply: "ok" });
    expect(pieces).toEqual([{ reasoning: "Hm." }, { content: '{"reply":' }, { content: '"ok"}' }]);

    const warned: object[] = [];
    t.services.ai.logFailuresTo({ warn: (details) => warned.push(details) });
    const stop = new AbortController();
    stop.abort();
    await expect(
      withDeviceKeys({ openrouter: GOOD_OR }, () =>
        t.services.ai.complete({
          task: "conversation",
          system: "s",
          user: "u",
          signal: stop.signal,
          onStream: () => undefined,
          schema: { name: "x", json: {}, check: { safeParse: () => ({ success: true }) } as never },
        }),
      ),
    ).rejects.toMatchObject({ code: "ai_stopped" });
    expect(warned).toEqual([]);
    expect(logLines().at(-1)).toMatchObject({ ok: false, error: "Stopped by the author." });
  });
});
