/**
 * Each provider adapter against recorded answers in the providers' documented formats. No call
 * leaves the machine: every request goes to a stand-in fetch, which also keeps what was sent.
 */
import { describe, expect, it } from "vitest";
import { costOf } from "../src/ai/cost.js";
import { matchName } from "../src/ai/models.js";
import { toGeminiSchema } from "../src/ai/providers/google.js";
import {
  DEFAULT_BASE_URL,
  makeAdapter,
  ProviderError,
  type ChatRequest,
  type StreamEvent,
} from "../src/ai/providers/index.js";
import { scrub, scrubbing } from "../src/ai/providers/scrub.js";
import type { AiProviderKind } from "@frontier/schema";

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

type Answer = Response | ((s: Sent) => Response);

function stand(answers: Answer[]) {
  const sent: Sent[] = [];
  const fake: typeof fetch = async (input, init) => {
    const s: Sent = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    sent.push(s);
    const a = answers[Math.min(sent.length - 1, answers.length - 1)]!;
    return typeof a === "function" ? a(s) : a.clone();
  };
  return { fake, sent };
}

const adapter = (
  kind: AiProviderKind,
  fake: typeof fetch,
  key: string | null = "sk-test-key-123456",
) =>
  makeAdapter({
    kind,
    baseUrl: DEFAULT_BASE_URL[kind],
    key,
    fetch: fake,
  });

const SCHEMA = {
  name: "answer",
  json: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "type"],
    properties: { reply: { type: "string" }, type: { type: ["string", "null"] } },
  },
};

/** A request; `schema: null` asks for plain text. */
const req = (
  over: Partial<Omit<ChatRequest, "schema">> & { schema?: ChatRequest["schema"] | null } = {},
): ChatRequest => {
  const { schema = SCHEMA, ...rest } = over;
  return {
    model: "m",
    system: "Be brief.",
    messages: [{ role: "user", content: "Say ok." }],
    ...(schema ? { schema } : {}),
    maxTokens: 100,
    signal: AbortSignal.timeout(5000),
    ...rest,
  };
};

/** A server-sent event stream made of the given payloads. */
function sse(events: (object | string)[], gap = "\n\n"): Response {
  const text = events
    .map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}`))
    .join(gap);
  const bytes = new TextEncoder().encode(text + gap);
  // Split in awkward places, as a network does.
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const textOf = (events: StreamEvent[], type: "text" | "reasoning") =>
  events
    .filter((e): e is { type: typeof type; text: string } => e.type === type)
    .map((e) => e.text)
    .join("");

describe("OpenRouter", () => {
  it("asks for a json_schema answer, reads the reported cost, and controls reasoning", async () => {
    const s = stand([
      Response.json({
        choices: [
          {
            message: { content: '{"reply":"ok","type":null}', reasoning: "Thought." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0004 },
      }),
    ]);
    const r = await adapter("openrouter", s.fake).complete(req({ reasoning: "high" }));
    expect(r).toMatchObject({
      text: '{"reply":"ok","type":null}',
      reasoning: "Thought.",
      usage: { promptTokens: 12, completionTokens: 3, costUsd: 0.0004 },
      finishReason: "stop",
    });
    expect(s.sent[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(s.sent[0]!.headers.get("authorization")).toBe("Bearer sk-test-key-123456");
    expect(s.sent[0]!.body).toMatchObject({
      model: "m",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Say ok." },
      ],
      response_format: { type: "json_schema", json_schema: { name: "answer", strict: true } },
      max_tokens: 100,
      reasoning: { effort: "high" },
      stream: false,
    });
    await adapter("openrouter", s.fake).complete(req({ reasoning: "off" }));
    expect(s.sent[1]!.body!.reasoning).toEqual({ enabled: false });
    await adapter("openrouter", s.fake).complete(req({ reasoning: { budgetTokens: 2000 } }));
    expect(s.sent[2]!.body!.reasoning).toEqual({ max_tokens: 2000, exclude: true });
  });

  it("turns a refusal into words, even inside a 200 answer, and retries only the provider's trouble", async () => {
    const s = stand([
      Response.json({ error: { message: "No credit left" } }, { status: 402 }),
      Response.json({ error: { message: "upstream" } }, { status: 200 }),
      Response.json({ error: { message: "overloaded" } }, { status: 503 }),
    ]);
    const a = adapter("openrouter", s.fake);
    const e1 = await a.complete(req()).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ProviderError);
    expect((e1 as ProviderError).message).toBe(
      "The AI provider refused the call (402): No credit left",
    );
    expect((e1 as ProviderError).retry).toBe(false);
    expect(((await a.complete(req()).catch((e: unknown) => e)) as ProviderError).message).toContain(
      "upstream",
    );
    expect(((await a.complete(req()).catch((e: unknown) => e)) as ProviderError).retry).toBe(true);
  });

  it("streams text, reasoning and tool calls, skipping comments, and reads the usage chunk", async () => {
    const s = stand([
      sse([
        ": OPENROUTER PROCESSING",
        { choices: [{ delta: { role: "assistant", reasoning: "Let me " } }] },
        { choices: [{ delta: { reasoning: "think." } }] },
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "look", arguments: '{"q":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Mira"}' } }] } }],
        },
        { choices: [{ delta: { content: "" }, finish_reason: "stop" }] },
        {
          choices: [{ delta: { content: "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 7, cost: 0.01 },
        },
        "data: [DONE]",
      ]),
    ]);
    const events = await collect(
      adapter("openrouter", s.fake).stream!(
        req({
          schema: null,
          tools: [{ name: "look", description: "Look up", parameters: { type: "object" } }],
        }),
      ),
    );
    expect(textOf(events, "reasoning")).toBe("Let me think.");
    expect(textOf(events, "text")).toBe("Hello");
    expect(events.find((e) => e.type === "tool_call")).toEqual({
      type: "tool_call",
      call: { id: "call_1", name: "look", arguments: '{"q":"Mira"}' },
    });
    expect(events.at(-1)).toEqual({
      type: "done",
      usage: { promptTokens: 5, completionTokens: 7, costUsd: 0.01 },
      finishReason: "stop",
    });
    expect(s.sent[0]!.body).toMatchObject({
      stream: true,
      tools: [{ type: "function", function: { name: "look" } }],
    });
    // OpenRouter always sends usage; it is not asked for.
    expect(s.sent[0]!.body!.stream_options).toBeUndefined();
  });

  it("makes a picture through /images and lists models with abilities and prices", async () => {
    const s = stand([
      Response.json({
        data: [{ b64_json: Buffer.from("png").toString("base64"), media_type: "image/png" }],
        usage: { cost: 0.04 },
      }),
      Response.json({
        data: [
          {
            id: "google/gemini-2.5-flash-image",
            name: "Gemini Flash Image",
            context_length: 32768,
            pricing: { prompt: "0.0000003", completion: "0.0000025" },
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["image", "text"],
            },
            supported_parameters: ["max_tokens"],
            top_provider: { max_completion_tokens: 8192 },
          },
        ],
      }),
    ]);
    const a = adapter("openrouter", s.fake);
    const pic = await a.image!({
      model: "google/gemini-2.5-flash-image",
      prompt: "A lantern",
      signal: AbortSignal.timeout(1000),
    });
    expect(pic.bytes.toString()).toBe("png");
    expect(pic.usage.costUsd).toBe(0.04);
    expect(s.sent[0]!.url).toBe("https://openrouter.ai/api/v1/images");
    const [m] = await a.listModels(AbortSignal.timeout(1000));
    expect(s.sent[1]!.url).toBe("https://openrouter.ai/api/v1/models?output_modalities=all");
    expect(m).toEqual({
      model: "google/gemini-2.5-flash-image",
      name: "Gemini Flash Image",
      description: null,
      contextLength: 32768,
      maxOutput: 8192,
      promptPrice: 0.3,
      completionPrice: 2.5,
      abilities: {
        structuredOutput: false,
        imagesIn: true,
        imageOut: true,
        reasoning: false,
        tools: false,
      },
      textOut: true,
    });
  });

  it("checks a key with the key endpoint, since its model list needs none", async () => {
    const s = stand([
      Response.json({ error: { message: "No auth credentials found" } }, { status: 401 }),
    ]);
    const e = await adapter("openrouter", s.fake)
      .testKey(AbortSignal.timeout(1000))
      .catch((x: unknown) => x);
    expect((e as ProviderError).message).toContain("(401)");
    expect(s.sent[0]!.url).toBe("https://openrouter.ai/api/v1/key");
  });
});

describe("OpenAI", () => {
  it("uses max_completion_tokens and reasoning_effort only for reasoning models", async () => {
    const ok = Response.json({
      choices: [{ message: { content: '{"reply":"ok","type":null}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
    const s = stand([ok]);
    const r = await adapter("openai", s.fake).complete(
      req({ model: "gpt-5-mini", reasoning: "low" }),
    );
    // OpenAI says no cost; it is left to be estimated.
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 2, costUsd: null });
    expect(s.sent[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(s.sent[0]!.body).toMatchObject({ max_completion_tokens: 100, reasoning_effort: "low" });
    expect(s.sent[0]!.body!.max_tokens).toBeUndefined();
    await adapter("openai", s.fake).complete(req({ model: "gpt-4.1", reasoning: "high" }));
    expect(s.sent[1]!.body!.reasoning_effort).toBeUndefined();
    await adapter("openai", s.fake).complete(req({ model: "gpt-5", reasoning: "off" }));
    expect(s.sent[2]!.body!.reasoning_effort).toBe("minimal");
  });

  it("asks a stream for its usage and makes pictures as base64", async () => {
    const s = stand([
      sse([
        { choices: [{ delta: { content: "ok" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } },
        "data: [DONE]",
      ]),
      Response.json({
        data: [{ b64_json: Buffer.from("img").toString("base64") }],
        usage: { input_tokens: 9, output_tokens: 4000 },
      }),
    ]);
    const a = adapter("openai", s.fake);
    const events = await collect(a.stream!(req({ model: "gpt-4.1" })));
    expect(textOf(events, "text")).toBe("ok");
    expect(events.at(-1)).toMatchObject({
      type: "done",
      usage: { promptTokens: 3, completionTokens: 1, costUsd: null },
    });
    expect(s.sent[0]!.body!.stream_options).toEqual({ include_usage: true });
    const pic = await a.image!({
      model: "gpt-image-1",
      prompt: "x",
      signal: AbortSignal.timeout(1000),
    });
    expect(pic.usage).toEqual({ promptTokens: 9, completionTokens: 4000, costUsd: null });
    expect(s.sent[1]!.url).toBe("https://api.openai.com/v1/images/generations");
    // gpt-image models refuse response_format; DALL·E needs it.
    expect(s.sent[1]!.body!.response_format).toBeUndefined();
    await a.image!({ model: "dall-e-3", prompt: "x", signal: AbortSignal.timeout(1000) });
    expect(s.sent[2]!.body!.response_format).toBe("b64_json");
  });

  it("lists chat and image models, leaving out embeddings and speech, with what the names tell", async () => {
    const s = stand([
      Response.json({
        data: [
          { id: "gpt-5", object: "model" },
          { id: "text-embedding-3-large", object: "model" },
          { id: "whisper-1", object: "model" },
          { id: "gpt-image-1", object: "model" },
          { id: "gpt-3.5-turbo", object: "model" },
        ],
      }),
    ]);
    const list = await adapter("openai", s.fake).listModels(AbortSignal.timeout(1000));
    expect(list.map((m) => m.model)).toEqual(["gpt-5", "gpt-image-1", "gpt-3.5-turbo"]);
    expect(list[0]).toMatchObject({
      promptPrice: null,
      abilities: { structuredOutput: true, reasoning: true, imageOut: false },
    });
    expect(list[1]).toMatchObject({
      textOut: false,
      abilities: { imageOut: true, structuredOutput: false },
    });
    expect(list[2]!.abilities.structuredOutput).toBe(false);
  });
});

describe("xAI and the OpenAI-compatible presets", () => {
  it("sends reasoning_effort only to grok-3-mini, as low or high", async () => {
    const ok = Response.json({
      choices: [{ message: { content: "{}", reasoning_content: "hm" } }],
      usage: {},
    });
    const s = stand([ok]);
    const r = await adapter("xai", s.fake).complete(
      req({ model: "grok-3-mini", reasoning: "medium" }),
    );
    expect(r.reasoning).toBe("hm");
    expect(s.sent[0]!.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(s.sent[0]!.body!.reasoning_effort).toBe("high");
    await adapter("xai", s.fake).complete(req({ model: "grok-4", reasoning: "medium" }));
    expect(s.sent[1]!.body!.reasoning_effort).toBeUndefined();
  });

  it("gives DeepSeek the form in the instructions with json_object, and Groq json_schema", async () => {
    const ok = Response.json({ choices: [{ message: { content: "{}" } }], usage: {} });
    const s = stand([ok]);
    await adapter("deepseek", s.fake).complete(req({ model: "deepseek-chat" }));
    expect(s.sent[0]!.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(s.sent[0]!.body!.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(s.sent[0]!.body!.messages)).toContain("JSON Schema");
    await adapter("groq", s.fake).complete(req({ model: "llama" }));
    expect(s.sent[1]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(s.sent[1]!.body!.response_format).toMatchObject({ type: "json_schema" });
  });
});

describe("Anthropic", () => {
  const message = (content: object[], extra: object = {}) =>
    Response.json({
      type: "message",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 10 },
      ...extra,
    });

  it("asks for the form with output_config and reads the answer and thinking", async () => {
    const s = stand([
      message([
        { type: "thinking", thinking: "Hmm." },
        { type: "text", text: '{"reply":"ok","type":null}' },
      ]),
    ]);
    const r = await adapter("anthropic", s.fake).complete(
      req({ model: "claude-sonnet-5-5", reasoning: "medium" }),
    );
    expect(r).toMatchObject({
      text: '{"reply":"ok","type":null}',
      reasoning: "Hmm.",
      usage: { promptTokens: 30, completionTokens: 5, costUsd: null },
    });
    const sent = s.sent[0]!;
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.headers.get("x-api-key")).toBe("sk-test-key-123456");
    expect(sent.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(sent.headers.get("authorization")).toBeNull();
    expect(sent.body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 100,
      system: "Be brief.",
      messages: [{ role: "user", content: "Say ok." }],
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: SCHEMA.json }, effort: "medium" },
    });
    expect(sent.body!.tool_choice).toBeUndefined();
  });

  it("falls back to a forced tool call for a model that refuses the structured-answer field", async () => {
    const s = stand([
      Response.json(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "output_config.format: not supported for this model",
          },
        },
        { status: 400 },
      ),
      message(
        [{ type: "tool_use", id: "tu_1", name: "answer", input: { reply: "ok", type: null } }],
        { stop_reason: "tool_use" },
      ),
    ]);
    const r = await adapter("anthropic", s.fake).complete(
      req({ model: "claude-3-haiku-20240307", reasoning: "high" }),
    );
    expect(JSON.parse(r.text)).toEqual({ reply: "ok", type: null });
    expect(r.toolCalls).toEqual([]);
    expect(s.sent[1]!.body).toMatchObject({
      tools: [{ name: "answer", input_schema: SCHEMA.json }],
      tool_choice: { type: "tool", name: "answer" },
    });
    // A forced tool call cannot think, and a model before 4.6 is not asked to.
    expect(s.sent[1]!.body!.thinking).toBeUndefined();
    expect(s.sent[1]!.body!.output_config).toBeUndefined();
  });

  it("says plainly when the model declines", async () => {
    const s = stand([message([], { stop_reason: "refusal" })]);
    const e = await adapter("anthropic", s.fake)
      .complete(req())
      .catch((x: unknown) => x);
    expect((e as ProviderError).message).toBe("The model declined to answer.");
  });

  it("streams text, thinking and tool input, with usage from the start and the end", async () => {
    const s2 = stand([
      sse([
        { type: "message_start", message: { usage: { input_tokens: 40, output_tokens: 1 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Mull." },
        },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hi " } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "there" } },
        {
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "tu_9", name: "look", input: {} },
        },
        {
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: '{"q":"Ve' },
        },
        {
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: 'l"}' },
        },
        { type: "content_block_stop", index: 2 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 33 } },
        { type: "message_stop" },
      ]),
    ]);
    const events = await collect(adapter("anthropic", s2.fake).stream!(req({ schema: null })));
    expect(textOf(events, "reasoning")).toBe("Mull.");
    expect(textOf(events, "text")).toBe("Hi there");
    expect(events.filter((e) => e.type === "tool_call")).toEqual([
      { type: "tool_call", call: { id: "tu_9", name: "look", arguments: '{"q":"Vel"}' } },
    ]);
    expect(events.at(-1)).toEqual({
      type: "done",
      usage: { promptTokens: 40, completionTokens: 33, costUsd: null },
      finishReason: "tool_use",
    });
    expect(s2.sent[0]!.body!.stream).toBe(true);
  });

  it("lists models page by page, with names and limits, and no prices", async () => {
    const s = stand([
      Response.json({
        data: [
          {
            id: "claude-sonnet-5-5",
            display_name: "Claude Sonnet 5.5",
            max_input_tokens: 1000000,
            max_tokens: 128000,
          },
        ],
        has_more: true,
        last_id: "claude-sonnet-5-5",
      }),
      Response.json({
        data: [{ id: "claude-3-haiku-20240307", display_name: "Claude Haiku 3" }],
        has_more: false,
      }),
    ]);
    const list = await adapter("anthropic", s.fake).listModels(AbortSignal.timeout(1000));
    expect(s.sent[1]!.url).toBe(
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-sonnet-5-5",
    );
    expect(list[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      contextLength: 1000000,
      maxOutput: 128000,
      promptPrice: null,
      abilities: { structuredOutput: true, imageOut: false, reasoning: true },
    });
    expect(list[1]!.abilities.reasoning).toBe(false);
  });
});

describe("Google AI Studio", () => {
  it("turns JSON Schema into Gemini's schema", () => {
    expect(toGeminiSchema(SCHEMA.json)).toEqual({
      type: "OBJECT",
      required: ["reply", "type"],
      properties: { reply: { type: "STRING" }, type: { type: "STRING", nullable: true } },
      propertyOrdering: ["reply", "type"],
    });
    expect(
      toGeminiSchema({ type: "array", items: { type: "string", enum: ["a"] }, maxItems: 3 }),
    ).toEqual({
      type: "ARRAY",
      maxItems: 3,
      items: { type: "STRING", enum: ["a"] },
    });
  });

  it("asks generateContent for JSON in a form, and reads text apart from thoughts", async () => {
    const s = stand([
      Response.json({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { text: "Plan.", thought: true },
                { text: '{"reply":"ok",' },
                { text: '"type":null}' },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6, thoughtsTokenCount: 4 },
      }),
    ]);
    const r = await adapter("google", s.fake).complete(
      req({ model: "gemini-2.5-flash", reasoning: "low" }),
    );
    expect(r).toMatchObject({
      text: '{"reply":"ok","type":null}',
      reasoning: "Plan.",
      usage: { promptTokens: 8, completionTokens: 10, costUsd: null },
      finishReason: "STOP",
    });
    const sent = s.sent[0]!;
    expect(sent.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(sent.headers.get("x-goog-api-key")).toBe("sk-test-key-123456");
    expect(sent.body).toMatchObject({
      systemInstruction: { parts: [{ text: "Be brief." }] },
      contents: [{ role: "user", parts: [{ text: "Say ok." }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT" },
        maxOutputTokens: 100,
        // Thoughts are sent back only when they are shown.
        thinkingConfig: { thinkingBudget: 1024 },
      },
    });
    await adapter("google", s.fake).complete(req({ model: "gemini-2.5-flash", reasoning: "off" }));
    expect((s.sent[1]!.body!.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
  });

  it("says when the prompt was blocked, streams over SSE, and makes pictures", async () => {
    const s = stand([
      Response.json({
        promptFeedback: { blockReason: "SAFETY" },
        usageMetadata: { promptTokenCount: 3 },
      }),
      sse([
        { candidates: [{ content: { parts: [{ text: "Hel" }] } }] },
        {
          candidates: [{ content: { parts: [{ text: "lo" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2 },
        },
      ]),
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "Here." },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from("pic").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1290 },
      }),
    ]);
    const a = adapter("google", s.fake);
    expect(((await a.complete(req()).catch((x: unknown) => x)) as Error).message).toContain(
      "SAFETY",
    );
    const events = await collect(a.stream!(req({ model: "gemini-2.5-pro" })));
    expect(textOf(events, "text")).toBe("Hello");
    expect(s.sent[1]!.url).toContain(":streamGenerateContent?alt=sse");
    const pic = await a.image!({
      model: "gemini-2.5-flash-image",
      prompt: "A lantern",
      signal: AbortSignal.timeout(1000),
    });
    expect(pic.bytes.toString()).toBe("pic");
    expect(
      (s.sent[2]!.body!.generationConfig as Record<string, unknown>).responseModalities,
    ).toEqual(["TEXT", "IMAGE"]);
  });

  it("lists the models that generate content, without the models/ prefix", async () => {
    const s = stand([
      Response.json({
        models: [
          {
            name: "models/gemini-2.5-pro",
            displayName: "Gemini 2.5 Pro",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ["generateContent", "countTokens"],
            thinking: true,
          },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    ]);
    const list = await adapter("google", s.fake).listModels(AbortSignal.timeout(1000));
    expect(list).toEqual([
      expect.objectContaining({
        model: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        contextLength: 1048576,
        maxOutput: 65536,
        promptPrice: null,
        abilities: expect.objectContaining({ structuredOutput: true, reasoning: true }),
      }),
    ]);
    expect(s.sent[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    );
  });
});

describe("failures that never reach the provider", () => {
  it("tells a timeout from an unreachable provider and from a call the author stopped", async () => {
    const thrower =
      (name: string): typeof fetch =>
      async () => {
        const e = new Error("x");
        e.name = name;
        throw e;
      };
    const timeout = await adapter("openai", thrower("TimeoutError"))
      .complete(req())
      .then(
        () => null,
        (x: unknown) => x as ProviderError,
      );
    expect(timeout).toMatchObject({
      message: "The AI provider did not answer in time.",
      retry: true,
      timedOut: true,
    });
    const stopped = await adapter("openai", thrower("AbortError"))
      .complete(req())
      .then(
        () => null,
        (x: unknown) => x as ProviderError,
      );
    expect(stopped).toMatchObject({ retry: false, aborted: true });
    const down = await adapter("openai", thrower("TypeError"))
      .complete(req())
      .then(
        () => null,
        (x: unknown) => x as ProviderError,
      );
    expect(down!.message).toBe("The AI provider could not be reached.");
  });
});

describe("keys", () => {
  it("are taken out of a provider's words, whole or in part", async () => {
    const key = "sk-ant-api03-SECRETSECRETSECRET-tail9";
    expect(scrub(`Invalid key ${key}`, key)).toBe("Invalid key [key]");
    expect(scrub("Incorrect API key provided: sk-proj-abc*****tail9.", key)).not.toContain("tail9");
    expect(scrub("Key AIzaSyD-abcdefghijklmnop is bad", null)).toBe("Key [key] is bad");
    const s = stand([
      Response.json({ error: { message: `invalid x-api-key ${key}` } }, { status: 401 }),
    ]);
    const e = await scrubbing(adapter("anthropic", s.fake, key), key)
      .testKey(AbortSignal.timeout(1000))
      .then(
        () => null,
        (x: unknown) => x as ProviderError,
      );
    expect(e!.message).toBe("The AI provider refused the call (401): invalid x-api-key [key]");
    expect(e).toBeInstanceOf(ProviderError);
  });
});

describe("costs", () => {
  it("takes the reported cost, else estimates from prices and tokens, else says unknown", () => {
    expect(
      costOf(
        { promptTokens: 1000, completionTokens: 100, costUsd: 0.5 },
        { promptPrice: 3, completionPrice: 15 },
      ),
    ).toEqual({ costUsd: 0.5, costKind: "reported" });
    expect(
      costOf(
        { promptTokens: 1_000_000, completionTokens: 100_000, costUsd: null },
        { promptPrice: 3, completionPrice: 15 },
      ),
    ).toEqual({ costUsd: 4.5, costKind: "estimated" });
    expect(costOf({ promptTokens: 1000, completionTokens: 10, costUsd: null }, null)).toEqual({
      costUsd: 0,
      costKind: "unknown",
    });
    // A free local model, priced at 0 by the author, is estimated at nothing.
    expect(
      costOf(
        { promptTokens: 1000, completionTokens: 10, costUsd: null },
        { promptPrice: 0, completionPrice: 0 },
      ),
    ).toEqual({ costUsd: 0, costKind: "estimated" });
  });

  it("matches a provider's model name to OpenRouter's", () => {
    expect(matchName("claude-sonnet-4-5-20250929")).toBe(matchName("anthropic/claude-sonnet-4.5"));
    expect(matchName("claude-3-5-sonnet-20241022")).toBe(matchName("anthropic/claude-3.5-sonnet"));
    expect(matchName("gpt-4o-2024-08-06")).toBe(matchName("openai/gpt-4o"));
    expect(matchName("models/gemini-2.5-flash")).toBe(matchName("google/gemini-2.5-flash"));
    expect(matchName("mistral-large-latest")).toBe(matchName("mistralai/mistral-large"));
    expect(matchName("gpt-4o")).not.toBe(matchName("openai/gpt-4o-mini"));
  });
});
