/**
 * Anthropic's Messages API. A structured answer is asked for with `output_config.format`; a model
 * that refuses it (the older ones) is asked again with a forced call of a tool whose input is the
 * answer. The newest models refuse a forced tool call, so that is the fallback, not the first try.
 */
import {
  emptyAnswer,
  noUsage,
  num,
  parseEvent,
  readJson,
  refused,
  saidIn,
  send,
  sseData,
} from "./http.js";
import { anthropicModel } from "./known.js";
import {
  type ChatRequest,
  type ChatResult,
  type Connection,
  type ListedModel,
  type ProviderAdapter,
  type StreamEvent,
  type ToolCall,
  type Usage,
  isCutOff,
  ProviderError,
} from "./types.js";

const VERSION = "2023-06-01";
/** The Messages API needs a ceiling on every call. */
const DEFAULT_MAX_TOKENS = 8192;

type Block =
  | { type: "text"; text?: unknown }
  | { type: "thinking"; thinking?: unknown }
  | { type: "tool_use"; id?: unknown; name?: unknown; input?: unknown }
  | { type: string };

function usageOf(u: unknown): Usage {
  const x = (u ?? {}) as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
  };
  return {
    promptTokens:
      num(x.input_tokens) + num(x.cache_read_input_tokens) + num(x.cache_creation_input_tokens),
    completionTokens: num(x.output_tokens),
    costUsd: null,
  };
}

/** Whether a refusal is about the structured-answer field, so the tool form may work instead. */
const formatRefused = (e: unknown) =>
  e instanceof ProviderError &&
  e.opts.status === 400 &&
  /output_config|output_format|format|structured/i.test(e.message);

export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = "anthropic" as const;

  constructor(private readonly c: Connection) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "anthropic-version": VERSION,
      ...(this.c.key ? { "x-api-key": this.c.key } : {}),
    };
  }

  /** `viaTool` asks for the structured answer as the input of a forced tool call. */
  private body(req: ChatRequest, stream: boolean, viaTool: boolean): Record<string, unknown> {
    // Adaptive thinking and an effort are for the 4.6 models and later; the older ones are not
    // asked, rather than refused.
    const adaptive = /^claude-(opus|sonnet|haiku|fable|mythos)-(4-[6-9]|[5-9])/.test(req.model);
    const effort =
      req.reasoning === undefined || req.reasoning === "off" || !adaptive
        ? null
        : typeof req.reasoning === "string"
          ? req.reasoning
          : req.reasoning.budgetTokens < 4000
            ? "low"
            : req.reasoning.budgetTokens < 16000
              ? "medium"
              : "high";
    const tools = [
      ...(req.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      ...(viaTool && req.schema
        ? [
            {
              name: req.schema.name,
              description: "Give the answer in this form.",
              input_schema: req.schema.json,
            },
          ]
        : []),
    ];
    const outputConfig = {
      ...(req.schema && !viaTool
        ? { format: { type: "json_schema", schema: req.schema.json } }
        : {}),
      ...(effort ? { effort } : {}),
    };
    return {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: req.system,
      messages: req.messages,
      ...(tools.length ? { tools } : {}),
      // A forced tool call cannot be combined with thinking, so thinking is not asked for then.
      ...(viaTool && req.schema ? { tool_choice: { type: "tool", name: req.schema.name } } : {}),
      ...(effort && !viaTool
        ? {
            thinking: {
              type: "adaptive",
              ...(req.showReasoning ? { display: "summarized" } : {}),
            },
          }
        : {}),
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      ...(stream ? { stream: true } : {}),
    };
  }

  async complete(req: ChatRequest): Promise<ChatResult> {
    try {
      return await this.once(req, false);
    } catch (err) {
      if (req.schema && formatRefused(err)) return this.once(req, true);
      throw err;
    }
  }

  private async once(req: ChatRequest, viaTool: boolean): Promise<ChatResult> {
    const res = await send(this.c.fetch, `${this.c.baseUrl}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(req, false, viaTool)),
      signal: req.signal,
    });
    const b = await readJson(res);
    const usage = usageOf(b.usage);
    if (!res.ok || b.type === "error") throw refused(res.status, saidIn(b), usage);
    if (b.stop_reason === "refusal") {
      throw new ProviderError("The model declined to answer.", false, { status: 200, usage });
    }
    const blocks = (Array.isArray(b.content) ? b.content : []) as Block[];
    let text = "";
    let reasoning = "";
    const toolCalls: ToolCall[] = [];
    for (const block of blocks) {
      if (block.type === "text" && "text" in block && typeof block.text === "string") {
        text += block.text;
      } else if (
        block.type === "thinking" &&
        "thinking" in block &&
        typeof block.thinking === "string"
      ) {
        reasoning += block.thinking;
      } else if (block.type === "tool_use" && "name" in block) {
        const call: ToolCall = {
          id: typeof block.id === "string" ? block.id : `call_${toolCalls.length}`,
          name: typeof block.name === "string" ? block.name : "",
          arguments: JSON.stringify(block.input ?? {}),
        };
        if (viaTool && req.schema && call.name === req.schema.name) text = call.arguments;
        else toolCalls.push(call);
      }
    }
    const finishReason = typeof b.stop_reason === "string" ? b.stop_reason : null;
    if (text === "" && toolCalls.length === 0 && !isCutOff(finishReason)) throw emptyAnswer(usage);
    return {
      text,
      reasoning,
      toolCalls,
      usage,
      finishReason: typeof b.stop_reason === "string" ? b.stop_reason : null,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const res = await send(this.c.fetch, `${this.c.baseUrl}/messages`, {
      method: "POST",
      headers: { ...this.headers(), accept: "text/event-stream" },
      body: JSON.stringify(this.body(req, true, false)),
      signal: req.signal,
    });
    if (!res.ok) {
      const b = await readJson(res);
      throw refused(res.status, saidIn(b), usageOf(b.usage));
    }
    const usage = noUsage();
    let finishReason: string | null = null;
    const blocks = new Map<number, ToolCall>();
    for await (const payload of sseData(res)) {
      const e = parseEvent(payload);
      if (!e) continue;
      const index = typeof e.index === "number" ? e.index : -1;
      switch (e.type) {
        case "message_start": {
          const u = usageOf((e.message as { usage?: unknown } | undefined)?.usage);
          usage.promptTokens = u.promptTokens;
          usage.completionTokens = u.completionTokens;
          break;
        }
        case "content_block_start": {
          const block = (e.content_block ?? {}) as { type?: unknown; id?: unknown; name?: unknown };
          if (block.type === "tool_use") {
            blocks.set(index, {
              id: typeof block.id === "string" ? block.id : `call_${index}`,
              name: typeof block.name === "string" ? block.name : "",
              arguments: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          const d = (e.delta ?? {}) as {
            type?: unknown;
            text?: unknown;
            thinking?: unknown;
            partial_json?: unknown;
          };
          if (d.type === "text_delta" && typeof d.text === "string") {
            yield { type: "text", text: d.text };
          } else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
            yield { type: "reasoning", text: d.thinking };
          } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
            const call = blocks.get(index);
            if (call) call.arguments += d.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          const call = blocks.get(index);
          if (call) {
            blocks.delete(index);
            yield { type: "tool_call", call: { ...call, arguments: call.arguments || "{}" } };
          }
          break;
        }
        case "message_delta": {
          const d = (e.delta ?? {}) as { stop_reason?: unknown };
          if (typeof d.stop_reason === "string") finishReason = d.stop_reason;
          const out = (e.usage as { output_tokens?: unknown } | undefined)?.output_tokens;
          if (typeof out === "number") usage.completionTokens = out;
          break;
        }
        case "error":
          throw refused(502, saidIn(e), usage);
      }
    }
    yield { type: "done", usage, finishReason };
  }

  async listModels(signal: AbortSignal): Promise<ListedModel[]> {
    const out: ListedModel[] = [];
    let after: string | null = null;
    // A page holds up to a thousand; a few pages at most are ever needed.
    for (let page = 0; page < 5; page++) {
      const query: string = `?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
      const res = await send(this.c.fetch, `${this.c.baseUrl}/models${query}`, {
        headers: this.headers(),
        signal,
      });
      const b = await readJson(res);
      if (!res.ok) throw refused(res.status, saidIn(b));
      for (const raw of Array.isArray(b.data) ? (b.data as unknown[]) : []) {
        const m = raw as {
          id?: unknown;
          display_name?: unknown;
          max_input_tokens?: unknown;
          max_tokens?: unknown;
          capabilities?: unknown;
        };
        if (typeof m.id !== "string") continue;
        const known = anthropicModel(m.id);
        const caps = capabilities(m.capabilities);
        out.push({
          model: m.id,
          name: typeof m.display_name === "string" ? m.display_name : m.id,
          description: null,
          contextLength: typeof m.max_input_tokens === "number" ? m.max_input_tokens : null,
          maxOutput: typeof m.max_tokens === "number" ? m.max_tokens : null,
          // The model list gives no prices.
          promptPrice: null,
          completionPrice: null,
          abilities: {
            structuredOutput: known.abilities.structuredOutput,
            imagesIn: caps.imagesIn ?? known.abilities.imagesIn,
            imageOut: false,
            reasoning: caps.reasoning ?? known.abilities.reasoning,
            tools: known.abilities.tools,
          },
          textOut: true,
        });
      }
      if (b.has_more !== true || typeof b.last_id !== "string") break;
      after = b.last_id;
    }
    return out;
  }

  async testKey(signal: AbortSignal): Promise<void> {
    const res = await send(this.c.fetch, `${this.c.baseUrl}/models?limit=1`, {
      headers: this.headers(),
      signal,
    });
    if (!res.ok) throw refused(res.status, saidIn(await readJson(res)));
  }
}

/**
 * The model list's `capabilities` object, read loosely: its exact shape is newer than this code,
 * so a value is taken only when it is plainly a yes or no (`true`, or `{ supported: true }`).
 */
function capabilities(raw: unknown): { imagesIn: boolean | null; reasoning: boolean | null } {
  if (!raw || typeof raw !== "object") return { imagesIn: null, reasoning: null };
  const c = raw as Record<string, unknown>;
  const yes = (...keys: string[]): boolean | null => {
    for (const k of keys) {
      const v = c[k];
      if (typeof v === "boolean") return v;
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { supported?: unknown }).supported === "boolean"
      ) {
        return (v as { supported: boolean }).supported;
      }
    }
    return null;
  };
  return {
    imagesIn: yes("image_input", "vision", "images"),
    reasoning: yes("thinking", "extended_thinking", "adaptive_thinking"),
  };
}
