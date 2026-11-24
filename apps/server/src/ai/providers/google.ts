/**
 * Google AI Studio (the Gemini API): generateContent, with the answer's form given as a
 * `responseSchema` in JSON mode. That schema is OpenAPI's subset of JSON Schema, so the form
 * Frontier writes is translated first.
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
import { googleModel } from "./known.js";
import {
  type ChatRequest,
  type ChatResult,
  type Connection,
  type ImageRequest,
  type ImageResult,
  type ListedModel,
  type ProviderAdapter,
  type StreamEvent,
  type ToolCall,
  type Usage,
  isCutOff,
  ProviderError,
} from "./types.js";

const KEPT = new Set([
  "description",
  "enum",
  "format",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "required",
  "nullable",
]);

/**
 * JSON Schema to the Gemini schema: types in capitals, `["string", "null"]` as a nullable string,
 * `additionalProperties` and other unknown words left out, and properties kept in their order.
 */
export function toGeminiSchema(s: unknown): Record<string, unknown> {
  if (!s || typeof s !== "object") return {};
  const src = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let type = src.type;
  if (Array.isArray(type)) {
    const real = type.filter((t) => t !== "null");
    if (real.length < type.length) out.nullable = true;
    type = real[0];
  }
  if (typeof type === "string") out.type = type.toUpperCase();
  for (const [k, v] of Object.entries(src)) {
    if (KEPT.has(k)) out[k] = v;
  }
  if (src.properties && typeof src.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      props[k] = toGeminiSchema(v);
    }
    out.properties = props;
    out.propertyOrdering = Object.keys(props);
  }
  if (src.items) out.items = toGeminiSchema(src.items);
  if (Array.isArray(src.anyOf)) out.anyOf = src.anyOf.map(toGeminiSchema);
  return out;
}

interface Part {
  text?: unknown;
  thought?: unknown;
  functionCall?: { name?: unknown; args?: unknown };
  inlineData?: { mimeType?: unknown; data?: unknown };
}

function usageOf(u: unknown): Usage {
  const x = (u ?? {}) as {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
  };
  return {
    promptTokens: num(x.promptTokenCount),
    // Thinking is billed as output.
    completionTokens: num(x.candidatesTokenCount) + num(x.thoughtsTokenCount),
    costUsd: null,
  };
}

export class GoogleAdapter implements ProviderAdapter {
  readonly kind = "google" as const;

  constructor(private readonly c: Connection) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.c.key ? { "x-goog-api-key": this.c.key } : {}),
    };
  }

  private url(model: string, method: string): string {
    const name = model.startsWith("models/") ? model : `models/${model}`;
    return `${this.c.baseUrl}/${name}:${method}`;
  }

  private thinking(req: ChatRequest): Record<string, unknown> | null {
    const r = req.reasoning;
    // Only the 2.5 models and later think; the others refuse a thinking setting.
    if (r === undefined || !/^gemini-(2\.5|[3-9])/.test(req.model)) return null;
    const m = req.model;
    if (r === "off") {
      // Only the Flash models can stop thinking; Pro always thinks.
      return /flash/.test(m) && /^gemini-2\.5/.test(m) ? { thinkingBudget: 0 } : null;
    }
    if (/^gemini-[3-9]/.test(m)) {
      const level = typeof r === "string" ? r : r.budgetTokens < 8000 ? "low" : "high";
      return {
        thinkingLevel: level === "medium" ? "high" : level,
        ...(req.showReasoning ? { includeThoughts: true } : {}),
      };
    }
    const budget =
      typeof r === "object" ? r.budgetTokens : { low: 1024, medium: 8192, high: 24576 }[r];
    return { thinkingBudget: budget, ...(req.showReasoning ? { includeThoughts: true } : {}) };
  }

  private body(req: ChatRequest): Record<string, unknown> {
    const thinking = this.thinking(req);
    return {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      ...(req.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: toGeminiSchema(t.parameters),
                })),
              },
            ],
          }
        : {}),
      generationConfig: {
        ...(req.schema
          ? {
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(req.schema.json),
            }
          : {}),
        ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
    };
  }

  /** The text, thoughts and calls of one answer (or one piece of a streamed answer). */
  private read(b: Record<string, unknown>) {
    const candidate = (
      b.candidates as { content?: { parts?: Part[] }; finishReason?: unknown }[] | undefined
    )?.[0];
    let text = "";
    let reasoning = "";
    const calls: ToolCall[] = [];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === "string") {
        if (part.thought === true) reasoning += part.text;
        else text += part.text;
      } else if (part.functionCall && typeof part.functionCall.name === "string") {
        calls.push({
          id: `call_${calls.length}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        });
      }
    }
    const blocked = (b.promptFeedback as { blockReason?: unknown } | undefined)?.blockReason;
    return {
      text,
      reasoning,
      calls,
      finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : null,
      blocked: typeof blocked === "string" ? blocked : null,
    };
  }

  async complete(req: ChatRequest): Promise<ChatResult> {
    const res = await send(this.c.fetch, this.url(req.model, "generateContent"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(req)),
      signal: req.signal,
    });
    const b = await readJson(res);
    const usage = usageOf(b.usageMetadata);
    if (!res.ok || b.error) throw refused(res.status, saidIn(b), usage);
    const got = this.read(b);
    if (got.blocked) {
      throw new ProviderError(`The model declined to answer (${got.blocked}).`, false, { usage });
    }
    if (got.text === "" && got.calls.length === 0 && !isCutOff(got.finishReason)) {
      throw emptyAnswer(usage);
    }
    return {
      text: got.text,
      reasoning: got.reasoning,
      toolCalls: got.calls,
      usage,
      finishReason: got.finishReason,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const res = await send(
      this.c.fetch,
      `${this.url(req.model, "streamGenerateContent")}?alt=sse`,
      {
        method: "POST",
        headers: { ...this.headers(), accept: "text/event-stream" },
        body: JSON.stringify(this.body(req)),
        signal: req.signal,
      },
    );
    if (!res.ok) {
      const b = await readJson(res);
      throw refused(res.status, saidIn(b), usageOf(b.usageMetadata));
    }
    let usage = noUsage();
    let finishReason: string | null = null;
    let n = 0;
    for await (const payload of sseData(res)) {
      const e = parseEvent(payload);
      if (!e) continue;
      if (e.error) throw refused(502, saidIn(e), usage);
      if (e.usageMetadata) usage = usageOf(e.usageMetadata);
      const got = this.read(e);
      if (got.finishReason) finishReason = got.finishReason;
      if (got.reasoning) yield { type: "reasoning", text: got.reasoning };
      if (got.text) yield { type: "text", text: got.text };
      for (const call of got.calls)
        yield { type: "tool_call", call: { ...call, id: `call_${n++}` } };
    }
    yield { type: "done", usage, finishReason };
  }

  /** Pictures come from the Gemini image models, asked for an image as well as text. */
  async image(req: ImageRequest): Promise<ImageResult> {
    const res = await send(this.c.fetch, this.url(req.model, "generateContent"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: req.signal,
    });
    const b = await readJson(res);
    const usage = usageOf(b.usageMetadata);
    const parts =
      (b.candidates as { content?: { parts?: Part[] } }[] | undefined)?.[0]?.content?.parts ?? [];
    const picture = parts.find((p) => typeof p.inlineData?.data === "string")?.inlineData;
    if (!res.ok || !picture) {
      const said = saidIn(b);
      throw new ProviderError(
        `The image model refused the call (${res.status})${said ? `: ${said}` : "."}`,
        false,
        { status: res.status, usage },
      );
    }
    return {
      bytes: Buffer.from(String(picture.data), "base64"),
      mime: typeof picture.mimeType === "string" ? picture.mimeType : "image/png",
      usage,
    };
  }

  async listModels(signal: AbortSignal): Promise<ListedModel[]> {
    const out: ListedModel[] = [];
    let token: string | null = null;
    for (let page = 0; page < 5; page++) {
      const query: string = `?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
      const res = await send(this.c.fetch, `${this.c.baseUrl}/models${query}`, {
        headers: this.headers(),
        signal,
      });
      const b = await readJson(res);
      if (!res.ok) throw refused(res.status, saidIn(b));
      for (const raw of Array.isArray(b.models) ? (b.models as unknown[]) : []) {
        const m = raw as {
          name?: unknown;
          displayName?: unknown;
          description?: unknown;
          inputTokenLimit?: unknown;
          outputTokenLimit?: unknown;
          supportedGenerationMethods?: unknown;
          thinking?: unknown;
        };
        if (typeof m.name !== "string") continue;
        const id = m.name.replace(/^models\//, "");
        const methods = Array.isArray(m.supportedGenerationMethods)
          ? (m.supportedGenerationMethods as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
        const known = googleModel(id, methods, m.thinking);
        if (known.skip) continue;
        out.push({
          model: id,
          name: typeof m.displayName === "string" ? m.displayName : id,
          description: typeof m.description === "string" ? m.description : null,
          contextLength: typeof m.inputTokenLimit === "number" ? m.inputTokenLimit : null,
          maxOutput: typeof m.outputTokenLimit === "number" ? m.outputTokenLimit : null,
          // The model list gives no prices.
          promptPrice: null,
          completionPrice: null,
          abilities: known.abilities,
          textOut: known.textOut,
        });
      }
      if (typeof b.nextPageToken !== "string" || b.nextPageToken === "") break;
      token = b.nextPageToken;
    }
    return out;
  }

  async testKey(signal: AbortSignal): Promise<void> {
    const res = await send(this.c.fetch, `${this.c.baseUrl}/models?pageSize=1`, {
      headers: this.headers(),
      signal,
    });
    if (!res.ok) throw refused(res.status, saidIn(await readJson(res)));
  }
}
