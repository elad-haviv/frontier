/**
 * The providers that speak OpenAI's Chat Completions: OpenRouter, OpenAI itself, xAI, and any
 * endpoint that copies the format (a local server, a proxy). They differ in small ways, listed in
 * a flavour per kind.
 */
import type { AiProviderKind } from "@frontier/schema";
import {
  emptyAnswer,
  noUsage,
  num,
  parseEvent,
  perMillion,
  readJson,
  refused,
  saidIn,
  send,
  sseData,
} from "./http.js";
import { openaiModel, unknownModel, xaiModel, type Known } from "./known.js";
import {
  type ChatRequest,
  type ChatResult,
  type Connection,
  type ImageRequest,
  type ImageResult,
  type ListedModel,
  type ProviderAdapter,
  type Reasoning,
  type StreamEvent,
  type ToolCall,
  type Usage,
  ProviderError,
} from "./types.js";

type Effort = "low" | "medium" | "high";
const effortOf = (r: Exclude<Reasoning, "off">): Effort =>
  typeof r === "string"
    ? r
    : r.budgetTokens < 4000
      ? "low"
      : r.budgetTokens < 16000
        ? "medium"
        : "high";

interface Flavour {
  /** The request fields that ask for (or switch off) thinking, for this model. */
  reasoning(r: Reasoning, model: string): Record<string, unknown>;
  maxTokensField: "max_tokens" | "max_completion_tokens";
  /** Whether usage must be asked for in a stream; OpenRouter always sends it. */
  askStreamUsage: boolean;
  /** Where pictures are made, or null when the provider makes none through this format. */
  imagePath: string | null;
  /** Asks for the picture as base64 rather than a link. */
  imageBody(model: string): Record<string, unknown>;
  modelsPath: string;
  /** What the provider's list does not say about a model. */
  known(id: string): Known;
  /**
   * "schema" sends the answer's JSON Schema as `response_format: json_schema`; "object" asks
   * only for JSON (`json_object`) and gives the form in the instructions, for providers that
   * take nothing more.
   */
  json: "schema" | "object";
}

export type CompatKind = Extract<
  AiProviderKind,
  "openrouter" | "openai" | "xai" | "mistral" | "deepseek" | "groq" | "custom"
>;

/** A provider that follows OpenAI's format and asks for nothing special. */
const plain = (known: (id: string) => Known = unknownModel): Flavour => ({
  reasoning: () => ({}),
  maxTokensField: "max_tokens",
  askStreamUsage: true,
  imagePath: null,
  imageBody: () => ({}),
  modelsPath: "/models",
  known,
  json: "schema",
});

const FLAVOURS: Record<CompatKind, Flavour> = {
  openrouter: {
    reasoning: (r) =>
      r === "off"
        ? { reasoning: { enabled: false } }
        : typeof r === "object"
          ? { reasoning: { max_tokens: r.budgetTokens } }
          : { reasoning: { effort: r } },
    maxTokensField: "max_tokens",
    askStreamUsage: false,
    imagePath: "/images",
    imageBody: () => ({}),
    // Without this the list holds only the models that write text, and none that paint.
    modelsPath: "/models?output_modalities=all",
    known: unknownModel,
    json: "schema",
  },
  openai: {
    reasoning: (r, model) => {
      if (!/^(o\d|gpt-5)/.test(model)) return {};
      if (r === "off") return { reasoning_effort: /^gpt-5/.test(model) ? "minimal" : "low" };
      return { reasoning_effort: effortOf(r) };
    },
    maxTokensField: "max_completion_tokens",
    askStreamUsage: true,
    imagePath: "/images/generations",
    // gpt-image models always answer in base64 and refuse the field; DALL·E needs it.
    imageBody: (model) => (/^dall-e/.test(model) ? { response_format: "b64_json" } : {}),
    modelsPath: "/models",
    known: openaiModel,
    json: "schema",
  },
  xai: {
    // Only the grok-3-mini family takes an effort, and only "low" or "high".
    reasoning: (r, model) =>
      /^grok-3-mini/.test(model)
        ? { reasoning_effort: r === "off" || effortOf(r) === "low" ? "low" : "high" }
        : {},
    maxTokensField: "max_tokens",
    askStreamUsage: true,
    imagePath: "/images/generations",
    imageBody: () => ({ response_format: "b64_json" }),
    modelsPath: "/models",
    known: xaiModel,
    json: "schema",
  },
  mistral: plain(),
  // DeepSeek's chat API takes `json_object` only.
  deepseek: { ...plain(), json: "object" },
  groq: plain(),
  custom: {
    // An unknown server may refuse fields it does not know, so nothing is sent.
    reasoning: () => ({}),
    maxTokensField: "max_tokens",
    askStreamUsage: false,
    imagePath: "/images/generations",
    imageBody: () => ({ response_format: "b64_json" }),
    modelsPath: "/models",
    known: unknownModel,
    json: "schema",
  },
};

interface Message {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[];
}

function usageOf(u: unknown): Usage {
  const x = (u ?? {}) as { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
  return {
    promptTokens: num(x.prompt_tokens),
    completionTokens: num(x.completion_tokens),
    // OpenRouter, and endpoints that copy it, say what the call cost.
    costUsd: typeof x.cost === "number" && Number.isFinite(x.cost) ? x.cost : null,
  };
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  private readonly flavour: Flavour;

  constructor(
    readonly kind: CompatKind,
    private readonly c: Connection,
  ) {
    this.flavour = FLAVOURS[kind];
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.c.key ? { authorization: `Bearer ${this.c.key}` } : {}),
    };
  }

  private system(req: ChatRequest): string {
    if (!req.schema || this.flavour.json !== "object") return req.system;
    return `${req.system}\n\nAnswer with one JSON object only, of this JSON Schema:\n${JSON.stringify(req.schema.json)}`;
  }

  private body(req: ChatRequest, stream: boolean): Record<string, unknown> {
    return {
      model: req.model,
      messages: [{ role: "system", content: this.system(req) }, ...req.messages],
      ...(req.schema && this.flavour.json === "object"
        ? { response_format: { type: "json_object" } }
        : req.schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: req.schema.name, strict: true, schema: req.schema.json },
              },
            }
          : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      stream,
      ...(stream && this.flavour.askStreamUsage ? { stream_options: { include_usage: true } } : {}),
      ...(req.maxTokens ? { [this.flavour.maxTokensField]: req.maxTokens } : {}),
      ...(req.reasoning ? this.flavour.reasoning(req.reasoning, req.model) : {}),
    };
  }

  async complete(req: ChatRequest): Promise<ChatResult> {
    const res = await send(this.c.fetch, `${this.c.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(req, false)),
      signal: req.signal,
    });
    const b = await readJson(res);
    const usage = usageOf(b.usage);
    // OpenRouter can report a failure inside a 200 answer.
    if (!res.ok || b.error) throw refused(res.status, saidIn(b), usage);
    const choice = (b.choices as { message?: Message; finish_reason?: unknown }[] | undefined)?.[0];
    const message = choice?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((t, i) => ({
      id: typeof t.id === "string" ? t.id : `call_${i}`,
      name: typeof t.function?.name === "string" ? t.function.name : "",
      arguments: typeof t.function?.arguments === "string" ? t.function.arguments : "",
    }));
    const text = typeof message?.content === "string" ? message.content : null;
    if (text === null && toolCalls.length === 0) throw emptyAnswer(usage);
    const reasoning =
      typeof message?.reasoning === "string"
        ? message.reasoning
        : typeof message?.reasoning_content === "string"
          ? message.reasoning_content
          : "";
    return {
      text: text ?? "",
      reasoning,
      toolCalls,
      usage,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const res = await send(this.c.fetch, `${this.c.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), accept: "text/event-stream" },
      body: JSON.stringify(this.body(req, true)),
      signal: req.signal,
    });
    if (!res.ok) {
      const b = await readJson(res);
      throw refused(res.status, saidIn(b), usageOf(b.usage));
    }
    let usage = noUsage();
    let finishReason: string | null = null;
    const calls = new Map<number, ToolCall>();
    for await (const payload of sseData(res)) {
      const e = parseEvent(payload);
      if (!e) continue;
      if (e.error) throw refused(res.status === 200 ? 502 : res.status, saidIn(e));
      if (e.usage) usage = usageOf(e.usage);
      const choice = (
        e.choices as
          | { delta?: Message & { tool_calls?: { index?: unknown }[] }; finish_reason?: unknown }[]
          | undefined
      )?.[0];
      if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
      const d = choice?.delta;
      if (!d) continue;
      const thought =
        typeof d.reasoning === "string"
          ? d.reasoning
          : typeof d.reasoning_content === "string"
            ? d.reasoning_content
            : "";
      if (thought) yield { type: "reasoning", text: thought };
      if (typeof d.content === "string" && d.content !== "")
        yield { type: "text", text: d.content };
      for (const [i, t] of (d.tool_calls ?? []).entries()) {
        const index =
          typeof (t as { index?: unknown }).index === "number" ? (t as { index: number }).index : i;
        const now = calls.get(index) ?? { id: `call_${index}`, name: "", arguments: "" };
        const part = t as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
        if (typeof part.id === "string") now.id = part.id;
        if (typeof part.function?.name === "string") now.name += part.function.name;
        if (typeof part.function?.arguments === "string") now.arguments += part.function.arguments;
        calls.set(index, now);
      }
    }
    for (const call of [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)) {
      yield { type: "tool_call", call };
    }
    yield { type: "done", usage, finishReason };
  }

  async image(req: ImageRequest): Promise<ImageResult> {
    if (!this.flavour.imagePath) throw new ProviderError("This provider makes no pictures.", false);
    const res = await send(this.c.fetch, `${this.c.baseUrl}${this.flavour.imagePath}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        ...this.flavour.imageBody(req.model),
      }),
      signal: req.signal,
    });
    const b = await readJson(res);
    const u = (b.usage ?? {}) as {
      cost?: unknown;
      input_tokens?: unknown;
      output_tokens?: unknown;
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
    };
    const usage: Usage = {
      promptTokens: num(u.prompt_tokens ?? u.input_tokens),
      completionTokens: num(u.completion_tokens ?? u.output_tokens),
      costUsd: typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : null,
    };
    const first = (b.data as { b64_json?: unknown; media_type?: unknown }[] | undefined)?.[0];
    if (!res.ok || typeof first?.b64_json !== "string") {
      const said = saidIn(b);
      throw new ProviderError(
        `The image model refused the call (${res.status})${said ? `: ${said}` : "."}`,
        false,
        { status: res.status, usage },
      );
    }
    return {
      bytes: Buffer.from(first.b64_json, "base64"),
      mime: typeof first.media_type === "string" ? first.media_type : "image/png",
      usage,
    };
  }

  async listModels(signal: AbortSignal): Promise<ListedModel[]> {
    const res = await send(this.c.fetch, `${this.c.baseUrl}${this.flavour.modelsPath}`, {
      headers: this.headers(),
      signal,
    });
    const b = await readJson(res);
    if (!res.ok) throw refused(res.status, saidIn(b));
    const out: ListedModel[] = [];
    for (const raw of Array.isArray(b.data) ? (b.data as unknown[]) : []) {
      const m = raw as {
        id?: unknown;
        name?: unknown;
        description?: unknown;
        context_length?: unknown;
        top_provider?: { max_completion_tokens?: unknown };
        pricing?: { prompt?: unknown; completion?: unknown };
        supported_parameters?: unknown;
        architecture?: { input_modalities?: unknown; output_modalities?: unknown };
      };
      if (typeof m.id !== "string") continue;
      const known = this.flavour.known(m.id);
      if (known.skip) continue;
      const params = Array.isArray(m.supported_parameters)
        ? (m.supported_parameters as unknown[])
        : null;
      const inputs = Array.isArray(m.architecture?.input_modalities)
        ? (m.architecture.input_modalities as unknown[])
        : null;
      const outputs = Array.isArray(m.architecture?.output_modalities)
        ? (m.architecture.output_modalities as unknown[])
        : null;
      // OpenRouter's list (and any that copies it) says what each model can do; trust it first.
      out.push({
        model: m.id,
        name: typeof m.name === "string" ? m.name : m.id,
        description: typeof m.description === "string" ? m.description : null,
        contextLength: typeof m.context_length === "number" ? m.context_length : null,
        maxOutput:
          typeof m.top_provider?.max_completion_tokens === "number"
            ? m.top_provider.max_completion_tokens
            : null,
        promptPrice: perMillion(m.pricing?.prompt),
        completionPrice: perMillion(m.pricing?.completion),
        abilities: {
          structuredOutput: params
            ? params.includes("structured_outputs")
            : known.abilities.structuredOutput,
          imagesIn: inputs ? inputs.includes("image") : known.abilities.imagesIn,
          imageOut: outputs ? outputs.includes("image") : known.abilities.imageOut,
          reasoning: params
            ? params.includes("reasoning") || params.includes("include_reasoning")
            : known.abilities.reasoning,
          tools: params ? params.includes("tools") : known.abilities.tools,
        },
        textOut: outputs ? outputs.includes("text") : known.textOut,
      });
    }
    return out;
  }

  async testKey(signal: AbortSignal): Promise<void> {
    // OpenRouter's model list answers without a key, so its key is checked where it is needed.
    const path = this.kind === "openrouter" ? "/key" : "/models";
    const res = await send(this.c.fetch, `${this.c.baseUrl}${path}`, {
      headers: this.headers(),
      signal,
    });
    if (!res.ok) throw refused(res.status, saidIn(await readJson(res)));
  }
}
