/**
 * The one place that calls the AI provider. Every call is checked against the monthly cap first
 * and written to the cost log afterwards, whether it worked or not.
 */
import type { ZodType, ZodTypeDef } from "zod";
import type { Config } from "../config.js";
import { ApiError } from "../errors.js";
import { decrypt } from "../state/secrets.js";
import type { SettingsStore } from "../state/settings.js";
import { type AiLog, monthOf } from "./log.js";

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
  /** Overrides the model set for the task. */
  model?: string;
  maxTokens?: number;
  /** How long to wait for the provider; one minute when not given. */
  timeoutMs?: number;
  /** Whether a call that timed out is sent again. A timed-out call may still have been billed. */
  retryOnTimeout?: boolean;
  /** Stops the call, as when the author presses Stop: it is not sent again. */
  signal?: AbortSignal;
}

export interface AiProviderDeps {
  config: Pick<Config, "secretsKey" | "openrouterKey" | "openrouterUrl">;
  settings: SettingsStore;
  log: AiLog;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

interface Attempt {
  ok: boolean;
  retry: boolean;
  timedOut?: boolean;
  content?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  error?: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export class AiProvider {
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  /** The message of the last failed call, cleared by the next one that works. */
  lastError: string | null = null;

  constructor(private readonly d: AiProviderDeps) {
    this.fetch = d.fetch ?? fetch;
    this.now = d.now ?? (() => new Date());
  }

  /** The provider key: the stored one, or else the one from the environment. */
  async key(): Promise<{ key: string; from: "settings" | "environment" } | null> {
    const stored = (await this.d.settings.read())?.ai.key;
    if (stored && this.d.config.secretsKey) {
      const key = decrypt(this.d.config.secretsKey, stored);
      if (key) return { key, from: "settings" };
    }
    return this.d.config.openrouterKey
      ? { key: this.d.config.openrouterKey, from: "environment" }
      : null;
  }

  async spending(): Promise<{ spentUsd: number; capUsd: number }> {
    const capUsd = (await this.d.settings.read())?.ai.monthlyCapUsd ?? 0;
    return { spentUsd: await this.d.log.spent(monthOf(this.now())), capUsd };
  }

  /** Whether a task can run: a key and a model are set. */
  async ready(task: AiTask): Promise<boolean> {
    return (await this.key()) !== null && Boolean((await this.d.settings.read())?.ai.models[task]);
  }

  async complete<T>(input: CompleteInput<T>): Promise<T> {
    const settings = await this.d.settings.read();
    const key = await this.key();
    const model = input.model ?? settings?.ai.models[input.task] ?? null;
    if (!key || !model) {
      throw new ApiError(
        "ai_off",
        !key
          ? "No AI provider key is set. Add one on the settings page."
          : "No model is chosen for this task. Choose one on the settings page.",
      );
    }
    const { spentUsd, capUsd } = await this.spending();
    if (spentUsd >= capUsd) {
      throw new ApiError(
        "ai_cap_reached",
        `This month's AI spending is ${money(spentUsd)} and your cap is ${money(capUsd)}. ` +
          "Raise the cap on the settings page to go on.",
      );
    }

    let attempt = await this.attempt(key.key, model, input);
    const again =
      attempt.retry &&
      !input.signal?.aborted &&
      !(attempt.timedOut && input.retryOnTimeout === false);
    if (!attempt.ok && again) attempt = await this.attempt(key.key, model, input);
    if (!attempt.ok) {
      this.lastError = attempt.error ?? "The AI provider did not answer.";
      throw new ApiError("ai_failed", this.lastError);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(attempt.content ?? "");
    } catch {
      parsed = undefined;
    }
    const checked = input.schema.check.safeParse(parsed);
    if (!checked.success) {
      this.lastError = "The model's answer did not have the form that was asked for.";
      throw new ApiError("ai_bad_answer", this.lastError);
    }
    this.lastError = null;
    return checked.data;
  }

  /**
   * One picture made from a description, as PNG or JPEG bytes. Checked against the cap first and
   * logged like every call. Not sent twice: a picture that timed out may still be billed.
   */
  async image(prompt: string, entry?: string): Promise<{ bytes: Buffer; costUsd: number }> {
    const settings = await this.d.settings.read();
    const key = await this.key();
    const model = settings?.ai.models.art ?? null;
    if (!key || !model) {
      throw new ApiError(
        "ai_off",
        !key
          ? "No AI provider key is set. Add one on the settings page."
          : "No model is chosen for concept art. Choose one on the settings page.",
      );
    }
    const { spentUsd, capUsd } = await this.spending();
    if (spentUsd >= capUsd) {
      throw new ApiError(
        "ai_cap_reached",
        `This month's AI spending is ${money(spentUsd)} and your cap is ${money(capUsd)}. ` +
          "Raise the cap on the settings page to go on.",
      );
    }
    let ok = false;
    let costUsd = 0;
    let error: string | undefined;
    let bytes: Buffer | null = null;
    try {
      const res = await this.fetch(`${this.d.config.openrouterUrl}/images`, {
        method: "POST",
        headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, prompt }),
        signal: AbortSignal.timeout(180_000),
      });
      const body = (await res.json().catch(() => null)) as {
        data?: { b64_json?: unknown }[];
        usage?: { cost?: unknown };
        error?: { message?: unknown };
      } | null;
      costUsd = typeof body?.usage?.cost === "number" ? body.usage.cost : 0;
      const b64 = body?.data?.[0]?.b64_json;
      if (res.ok && typeof b64 === "string") {
        bytes = Buffer.from(b64, "base64");
        ok = true;
      } else {
        const said = typeof body?.error?.message === "string" ? body.error.message : null;
        error = `The image model refused the call (${res.status})${said ? `: ${said}` : "."}`;
      }
    } catch (err) {
      error =
        err instanceof Error && err.name === "TimeoutError"
          ? "The image model did not answer in time."
          : "The AI provider could not be reached.";
    }
    await this.d.log.append({
      at: this.now().toISOString(),
      task: "art",
      model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd,
      entry: entry ?? null,
      ok,
      ...(error ? { error } : {}),
    });
    if (!ok || !bytes) {
      this.lastError = error ?? "No picture came back.";
      throw new ApiError("ai_failed", this.lastError);
    }
    this.lastError = null;
    return { bytes, costUsd };
  }

  /** One request to the provider, and its line in the log. */
  private async attempt<T>(key: string, model: string, input: CompleteInput<T>): Promise<Attempt> {
    const result = await this.request(key, model, input);
    await this.d.log.append({
      at: this.now().toISOString(),
      task: input.task,
      model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: result.costUsd,
      entry: input.entry ?? null,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
    });
    return result;
  }

  private async request<T>(key: string, model: string, input: CompleteInput<T>): Promise<Attempt> {
    const none = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    const wait = AbortSignal.timeout(input.timeoutMs ?? this.d.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await this.fetch(`${this.d.config.openrouterUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: input.schema.name, strict: true, schema: input.schema.json },
          },
          stream: false,
          ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
        }),
        signal: input.signal ? AbortSignal.any([wait, input.signal]) : wait,
      });
    } catch (err) {
      if (input.signal?.aborted) {
        return { ...none, ok: false, retry: false, error: "The call was stopped." };
      }
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      return {
        ...none,
        ok: false,
        retry: true,
        timedOut,
        error: timedOut
          ? "The AI provider did not answer in time."
          : "The AI provider could not be reached.",
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const b = (body ?? {}) as {
      error?: { message?: unknown };
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
    };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const usage = {
      promptTokens: num(b.usage?.prompt_tokens),
      completionTokens: num(b.usage?.completion_tokens),
      costUsd: num(b.usage?.cost),
    };
    // The provider can report a failure inside a 200 answer.
    if (!res.ok || b.error) {
      const said = typeof b.error?.message === "string" ? b.error.message : null;
      return {
        ...usage,
        ok: false,
        retry: res.status >= 500,
        error: `The AI provider refused the call (${res.status})${said ? `: ${said}` : "."}`,
      };
    }
    const content = b.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ...usage, ok: false, retry: false, error: "The AI provider sent an empty answer." };
    }
    return { ...usage, ok: true, retry: false, content };
  }
}
