/**
 * The one place that calls the AI providers. Every call is checked against the monthly cap first
 * and written to the cost log afterwards, whether it worked or not. Which provider answers is
 * read from the model id ("anthropic:claude-…"); the wire formats are in `providers/`.
 */
import { splitModelId, type ModelPrice } from "@frontier/schema";
import type { ZodType, ZodTypeDef } from "zod";
import { ApiError } from "../errors.js";
import type { SettingsStore } from "../state/settings.js";
import { Connections, type ConnectionsConfig, type ResolvedProvider } from "./connections.js";
import { costOf } from "./cost.js";
import { type AiLog, monthOf } from "./log.js";
import type { ModelCatalogue } from "./models.js";
import {
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type ImageRequest,
  type ProviderAdapter,
  ProviderError,
  type Reasoning,
  type StreamEvent,
  type ToolSpec,
  type Usage,
  isCutOff,
} from "./providers/index.js";

export type { Reasoning, StreamEvent, ToolSpec, ChatMessage } from "./providers/index.js";

export type AiTask = "extraction" | "conversation" | "art";

export interface AnswerSchema<T> {
  name: string;
  /** The JSON Schema sent to the provider. */
  json: Record<string, unknown>;
  /** Checks the answer that came back. */
  check: ZodType<T, ZodTypeDef, unknown>;
}

export interface CompleteInput<T> {
  task: AiTask;
  system: string;
  user: string;
  schema: AnswerSchema<T>;
  /** The entry the call is about, for the log. */
  entry?: string;
  /** Overrides the model set for the task. A bare id is OpenRouter's. */
  model?: string;
  /**
   * The room for the answer itself. A model that thinks first spends the same limit on its
   * thinking, so the provider is given this plus `THINKING_ROOM`.
   */
  maxTokens?: number;
  /** How long to wait for the provider; one minute when not given. */
  timeoutMs?: number;
  /** Whether a call that timed out is sent again. A timed-out call may still have been billed. */
  retryOnTimeout?: boolean;
  /**
   * When given, the answer is streamed: each piece of the model's reasoning, and of the answer as
   * it is written, is passed here as it arrives. The reasoning of models that reason is asked for.
   */
  onStream?: (piece: { reasoning?: string; content?: string }) => void;
  /** Stops the call, as the author's Stop button does. A stopped call is not sent again. */
  signal?: AbortSignal;
  /** How much the model thinks first, where it can; brief ("low") when not given. */
  reasoning?: Reasoning;
}

/** Where failed calls are written, so the server's own log says why an AI call failed. */
export interface AiWarnLog {
  warn(details: object, message: string): void;
}

/**
 * The tokens a reasoning model may think with, on top of the answer's own room. Providers count
 * thinking in the same limit, so a tight limit cut answers off midway. Thinking is asked to be
 * brief, so this is rarely used up, and what is not used is not billed.
 */
export const THINKING_ROOM = 8000;
/** Said when the answer stopped at the token limit before it was whole. */
export const CUT_OFF =
  "The model ran out of room before finishing its answer. Try again, or choose another model on the settings page.";
/** Said in the log of a call the author stopped. */
const STOPPED = "Stopped by the author.";

/** A streamed call. The text comes as it is written; with a schema it is the answer's JSON. */
export interface StreamInput {
  task: AiTask;
  system: string;
  /** The question; or give the whole conversation in `messages`. */
  user?: string;
  messages?: ChatMessage[];
  schema?: { name: string; json: Record<string, unknown> };
  tools?: ToolSpec[];
  entry?: string;
  model?: string;
  maxTokens?: number;
  /** For the whole stream; five minutes when not given. */
  timeoutMs?: number;
  signal?: AbortSignal;
  reasoning?: Reasoning;
}

export interface AiProviderDeps {
  config: ConnectionsConfig;
  settings: SettingsStore;
  log: AiLog;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** Shared with the settings routes; made here when not given. */
  connections?: Connections;
  /** For the prices that turn tokens into an estimated cost. */
  catalog?: ModelCatalogue;
}

const money = (n: number) => `$${n.toFixed(2)}`;

interface Target {
  /** Provider-qualified. */
  id: string;
  provider: ResolvedProvider;
  model: string;
  adapter: ProviderAdapter;
}

export class AiProvider {
  readonly connections: Connections;
  private readonly now: () => Date;
  /** The message of the last failed call, cleared by the next one that works. */
  lastError: string | null = null;
  private catalog: ModelCatalogue | null;
  private warnLog: AiWarnLog | null = null;

  constructor(private readonly d: AiProviderDeps) {
    this.now = d.now ?? (() => new Date());
    this.connections =
      d.connections ??
      new Connections({
        config: d.config,
        settings: d.settings,
        ...(d.fetch ? { fetch: d.fetch } : {}),
      });
    this.catalog = d.catalog ?? null;
  }

  /** Failed calls are written to this log as well as to the cost log. */
  logFailuresTo(log: AiWarnLog): void {
    this.warnLog = log;
  }

  private warn(task: AiTask, model: string, error: string, entry?: string): void {
    this.warnLog?.warn({ task, model, entry: entry ?? null, error }, "AI call failed");
  }

  /** Lets the catalogue, made after the provider, lend its prices. */
  useCatalog(catalog: ModelCatalogue): void {
    this.catalog = catalog;
  }

  /** The OpenRouter key: the stored one, or else the one from the environment. */
  async key(): Promise<{ key: string; from: "settings" | "environment" } | null> {
    const p = await this.connections.get("openrouter");
    return p?.key && p.keyFrom !== "none" ? { key: p.key, from: p.keyFrom } : null;
  }

  async spending(): Promise<{ spentUsd: number; capUsd: number }> {
    const capUsd = (await this.d.settings.read())?.ai.monthlyCapUsd ?? 0;
    return { spentUsd: await this.d.log.spent(monthOf(this.now())), capUsd };
  }

  /** The prices of the model chosen for a task, to estimate a call before it is made. */
  async priceForTask(task: AiTask): Promise<ModelPrice | null> {
    const chosen = (await this.d.settings.read())?.ai.models[task];
    if (!chosen) return null;
    const { provider, model } = splitModelId(chosen);
    return this.priceOf(`${provider}:${model}`);
  }

  /** Whether a task can run: a model is chosen and its provider is connected. */
  async ready(task: AiTask): Promise<boolean> {
    const id = (await this.d.settings.read())?.ai.models[task];
    if (!id) return false;
    const p = await this.connections.get(splitModelId(id).provider);
    return p !== null && this.connections.usable(p);
  }

  /** The provider and model a call goes to, or the reason it cannot be made. */
  private async target(task: AiTask, override: string | undefined, what: string): Promise<Target> {
    const settings = await this.d.settings.read();
    const chosen = override ?? settings?.ai.models[task] ?? null;
    const anyKey = (await this.connections.list()).some((p) => this.connections.usable(p));
    if (!chosen) {
      throw new ApiError(
        "ai_off",
        anyKey
          ? `No model is chosen for ${what}. Choose one on the settings page.`
          : "No AI provider key is set. Add one on the settings page.",
        { href: anyKey ? `/settings/ai/models/${task}` : "/settings/ai/providers" },
      );
    }
    const { provider: id, model } = splitModelId(chosen);
    const provider = await this.connections.get(id);
    if (!provider || !this.connections.usable(provider)) {
      throw new ApiError(
        "ai_off",
        id === "openrouter" && !provider?.key
          ? "No AI provider key is set. Add one on the settings page."
          : !provider
            ? `The model chosen for ${what} is from ${id}, which is not connected. Connect it or choose another model on the settings page.`
            : !provider.enabled
              ? `${provider.name} is switched off. Switch it on or choose another model on the settings page.`
              : `${provider.name} has no key. Add one on the settings page.`,
        { href: "/settings/ai/providers" },
      );
    }
    return { id: `${id}:${model}`, provider, model, adapter: this.connections.adapter(provider) };
  }

  private async checkCap(): Promise<void> {
    const { spentUsd, capUsd } = await this.spending();
    if (spentUsd >= capUsd) {
      throw new ApiError(
        "ai_cap_reached",
        `This month's AI spending is ${money(spentUsd)} and your cap is ${money(capUsd)}. ` +
          "Raise the cap on the settings page to go on.",
        { href: "/settings/ai/spending" },
      );
    }
  }

  /** Prices to estimate a cost with: the author's, else the provider's list. */
  private async priceOf(id: string): Promise<ModelPrice | null> {
    const own = (await this.d.settings.read())?.ai.modelPrices[id];
    if (own) return own;
    const listed = await this.catalog?.find(id);
    return listed && listed.promptPrice !== null && listed.completionPrice !== null
      ? { promptPrice: listed.promptPrice, completionPrice: listed.completionPrice }
      : null;
  }

  private async record(
    task: AiTask,
    t: Target,
    usage: Usage | undefined,
    entry: string | undefined,
    error: string | undefined,
  ): Promise<number> {
    const u = usage ?? { promptTokens: 0, completionTokens: 0, costUsd: null };
    // A call that never reached the provider used nothing.
    const reached = usage !== undefined;
    const used = u.promptTokens > 0 || u.completionTokens > 0;
    const { costUsd, costKind } = reached
      ? costOf(u, u.costUsd === null && used ? await this.priceOf(t.id) : null)
      : { costUsd: 0, costKind: "reported" as const };
    await this.d.log.append({
      at: this.now().toISOString(),
      task,
      model: t.id,
      provider: t.provider.id,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      costUsd,
      costKind,
      entry: entry ?? null,
      ok: error === undefined,
      ...(error ? { error } : {}),
    });
    return costUsd;
  }

  private signal(timeoutMs: number, signal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([timeout, signal]) : timeout;
  }

  /** The request for an adapter: brief thinking by default, with room for it. */
  private request(
    t: Target,
    input: {
      system: string;
      messages: ChatMessage[];
      schema?: { name: string; json: Record<string, unknown> } | undefined;
      tools?: ToolSpec[] | undefined;
      maxTokens?: number | undefined;
      reasoning?: Reasoning | undefined;
    },
    signal: AbortSignal,
    showReasoning: boolean,
  ): ChatRequest {
    return {
      model: t.model,
      system: input.system,
      messages: input.messages,
      ...(input.schema ? { schema: input.schema } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      ...(input.maxTokens ? { maxTokens: input.maxTokens + THINKING_ROOM } : {}),
      reasoning: input.reasoning ?? "low",
      showReasoning,
      signal,
    };
  }

  /**
   * One request: whole, or streamed piece by piece to `onStream` when given. Logged either way,
   * and written to the warn log when it failed for any reason but the author's Stop.
   */
  private async attempt(
    task: AiTask,
    t: Target,
    req: ChatRequest,
    entry: string | undefined,
    onStream: CompleteInput<unknown>["onStream"],
    stopper: AbortSignal | undefined,
  ): Promise<ChatResult | ProviderError> {
    try {
      // Stopped before it was sent: nothing goes out.
      if (stopper?.aborted) throw new ProviderError(STOPPED, false, { aborted: true });
      let result: ChatResult;
      if (onStream && t.adapter.stream) {
        let text = "";
        let reasoning = "";
        let usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: null };
        let finishReason: string | null = null;
        const toolCalls: ChatResult["toolCalls"] = [];
        for await (const e of t.adapter.stream(req)) {
          if (e.type === "text") {
            text += e.text;
            onStream({ content: e.text });
          } else if (e.type === "reasoning") {
            reasoning += e.text;
            onStream({ reasoning: e.text });
          } else if (e.type === "tool_call") {
            toolCalls.push(e.call);
          } else {
            usage = e.usage;
            finishReason = e.finishReason;
          }
        }
        if (text === "" && toolCalls.length === 0 && !isCutOff(finishReason)) {
          throw new ProviderError("The AI provider sent an empty answer.", false, { usage });
        }
        result = { text, reasoning, toolCalls, usage, finishReason };
      } else {
        result = await t.adapter.complete(req);
        if (onStream && result.reasoning) onStream({ reasoning: result.reasoning });
        if (onStream && result.text) onStream({ content: result.text });
      }
      if (isCutOff(result.finishReason) && result.text.trim() === "") {
        throw new ProviderError(CUT_OFF, false, { usage: result.usage });
      }
      await this.record(task, t, result.usage, entry, undefined);
      return result;
    } catch (err) {
      let e =
        err instanceof ProviderError
          ? err
          : new ProviderError("The AI provider did not answer.", false);
      // The author's Stop, as opposed to the time running out.
      if (stopper?.aborted && !e.timedOut) {
        e = new ProviderError(STOPPED, false, {
          aborted: true,
          ...(e.opts.usage ? { usage: e.opts.usage } : {}),
        });
      }
      await this.record(task, t, e.opts.usage, entry, e.aborted ? STOPPED : e.message);
      if (!e.aborted) this.warn(task, t.id, e.message, entry);
      return e;
    }
  }

  async complete<T>(input: CompleteInput<T>): Promise<T> {
    const t = await this.target(input.task, input.model, "this task");
    await this.checkCap();

    const send = () => {
      const timeout = AbortSignal.timeout(input.timeoutMs ?? this.d.timeoutMs ?? 60_000);
      const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
      const req = this.request(
        t,
        {
          system: input.system,
          messages: [{ role: "user", content: input.user }],
          schema: { name: input.schema.name, json: input.schema.json },
          maxTokens: input.maxTokens,
          reasoning: input.reasoning,
        },
        signal,
        input.onStream !== undefined,
      );
      return this.attempt(input.task, t, req, input.entry, input.onStream, input.signal);
    };

    let result = await send();
    if (
      result instanceof ProviderError &&
      result.retry &&
      !result.aborted &&
      !(result.timedOut && input.retryOnTimeout === false) &&
      !input.signal?.aborted
    ) {
      result = await send();
    }
    if (result instanceof ProviderError) {
      if (result.aborted) throw new ApiError("ai_stopped", "Stopped.");
      this.lastError = result.message;
      throw new ApiError("ai_failed", this.lastError);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = undefined;
    }
    const checked = input.schema.check.safeParse(parsed);
    if (!checked.success) {
      this.lastError = isCutOff(result.finishReason)
        ? CUT_OFF
        : "The model's answer did not have the form that was asked for.";
      this.warn(input.task, t.id, this.lastError, input.entry);
      throw new ApiError("ai_bad_answer", this.lastError);
    }
    this.lastError = null;
    return checked.data;
  }

  /**
   * A call whose answer comes as it is written: text, thinking and tool calls, then `done`. The
   * cap is checked before and the call logged after, when the stream ends, fails or is left.
   * Not sent twice. Throws ApiError ("ai_off", "ai_cap_reached", "ai_failed", "ai_stopped")
   * before or while streaming. Providers that cannot stream answer in one piece.
   */
  async *stream(input: StreamInput): AsyncGenerator<StreamEvent> {
    const t = await this.target(input.task, input.model, "this task");
    await this.checkCap();
    const timeout = AbortSignal.timeout(input.timeoutMs ?? 300_000);
    const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
    const req = this.request(
      t,
      {
        system: input.system,
        messages: input.messages ?? [{ role: "user", content: input.user ?? "" }],
        schema: input.schema,
        tools: input.tools,
        maxTokens: input.maxTokens,
        reasoning: input.reasoning,
      },
      signal,
      true,
    );
    let usage: Usage | undefined;
    let error: string | undefined = "The stream was left before it ended.";
    let stopped = false;
    try {
      if (t.adapter.stream) {
        for await (const event of t.adapter.stream(req)) {
          if (event.type === "done") usage = event.usage;
          yield event;
        }
      } else {
        const r = await t.adapter.complete(req);
        usage = r.usage;
        if (r.reasoning) yield { type: "reasoning", text: r.reasoning };
        if (r.text) yield { type: "text", text: r.text };
        for (const call of r.toolCalls) yield { type: "tool_call", call };
        yield { type: "done", usage: r.usage, finishReason: r.finishReason };
      }
      error = undefined;
      this.lastError = null;
    } catch (err) {
      const e =
        err instanceof ProviderError
          ? err
          : new ProviderError("The AI provider did not answer.", false);
      usage = e.opts.usage ?? usage;
      stopped = e.aborted || (input.signal?.aborted === true && !e.timedOut);
      error = stopped ? STOPPED : e.message;
      if (stopped) throw new ApiError("ai_stopped", "Stopped.");
      this.lastError = e.message;
      this.warn(input.task, t.id, e.message, input.entry);
      throw new ApiError("ai_failed", e.message);
    } finally {
      await this.record(input.task, t, usage, input.entry, error);
    }
  }

  /**
   * One picture made from a description, as PNG or JPEG bytes. Checked against the cap first and
   * logged like every call. Not sent twice: a picture that timed out may still be billed.
   */
  async image(
    prompt: string,
    entry?: string,
    aspect?: ImageRequest["aspect"],
  ): Promise<{ bytes: Buffer; costUsd: number }> {
    const t = await this.target("art", undefined, "concept art");
    await this.checkCap();
    if (!t.adapter.image) {
      this.lastError = `${t.provider.name} makes no pictures. Choose an image model for concept art.`;
      throw new ApiError("ai_failed", this.lastError);
    }
    try {
      const r = await t.adapter.image({
        model: t.model,
        prompt,
        ...(aspect ? { aspect } : {}),
        signal: AbortSignal.timeout(180_000),
      });
      const costUsd = await this.record("art", t, r.usage, entry, undefined);
      this.lastError = null;
      return { bytes: r.bytes, costUsd };
    } catch (err) {
      const e =
        err instanceof ProviderError
          ? err.timedOut
            ? new ProviderError("The image model did not answer in time.", false, err.opts)
            : err
          : new ProviderError("No picture came back.", false);
      await this.record("art", t, e.opts.usage, entry, e.message);
      this.warn("art", t.id, e.message, entry);
      this.lastError = e.message;
      throw new ApiError("ai_failed", this.lastError);
    }
  }
}
