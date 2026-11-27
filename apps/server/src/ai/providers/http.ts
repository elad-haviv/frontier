/** The plumbing every adapter shares: sending, failures in plain words, and reading a stream. */
import { ProviderError, type Usage } from "./types.js";

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A price per token, as a string or number, in US dollars per million tokens; null if none. */
export function perMillion(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1e6 * 1e4) / 1e4;
}

export const noUsage = (): Usage => ({ promptTokens: 0, completionTokens: 0, costUsd: null });

/** The failure of a fetch that never got an answer. */
export function unreachable(err: unknown): ProviderError {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") {
    return new ProviderError("The AI provider did not answer in time.", true, { timedOut: true });
  }
  if (name === "AbortError") {
    return new ProviderError("Stopped by the author.", false, { aborted: true });
  }
  return new ProviderError("The AI provider could not be reached.", true);
}

export async function send(
  f: typeof fetch,
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<Response> {
  try {
    return await f(url, init);
  } catch (err) {
    throw err instanceof ProviderError ? err : unreachable(err);
  }
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The provider's own words about a failure, from the usual places in an error body. */
export function saidIn(body: Record<string, unknown>): string | null {
  const e = body.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  if (Array.isArray(body) && body[0]) return saidIn(body[0] as Record<string, unknown>);
  return typeof body.message === "string" ? body.message : null;
}

export function refused(status: number, said: string | null, usage?: Usage): ProviderError {
  return new ProviderError(
    `The AI provider refused the call (${status})${said ? `: ${said}` : "."}`,
    status >= 500,
    { status, ...(usage ? { usage } : {}) },
  );
}

export const emptyAnswer = (usage?: Usage) =>
  new ProviderError("The AI provider sent an empty answer.", false, usage ? { usage } : {});

/**
 * The `data:` payloads of a server-sent event stream, one per event. Comment lines (OpenRouter
 * sends ": OPENROUTER PROCESSING" while it waits) and the closing `[DONE]` are left out.
 */
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const reader = res.body.getReader();
  try {
    for (;;) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader.read();
      } catch (err) {
        throw unreachable(err);
      }
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer[nl] === "\r" ? 2 : 1));
        if (line === "") {
          if (data.length > 0) {
            const payload = data.join("\n");
            data = [];
            if (payload.trim() === "[DONE]") return;
            yield payload;
          }
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
        // "event:", "id:", "retry:" and ":" comments are not needed: every payload names its type.
      }
      if (chunk.done) break;
    }
    if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, ""));
    if (data.length > 0 && data.join("\n").trim() !== "[DONE]") yield data.join("\n");
  } finally {
    reader.releaseLock();
  }
}

/** Parses one event's JSON; an event that is not JSON is skipped. */
export function parseEvent(payload: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(payload);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
