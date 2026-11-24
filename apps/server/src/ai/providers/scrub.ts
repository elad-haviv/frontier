/**
 * Takes keys out of a provider's words before they are stored or shown: some providers echo the
 * key, or part of it, when they refuse it.
 */
import { ProviderError, type ProviderAdapter, type StreamEvent } from "./types.js";

/** The shapes of the providers' keys: sk-…, sk-ant-…, sk-or-…, xai-…, gsk_…, AIza…. */
const KEYLIKE = /\b(?:sk|xai|gsk)[-_][-_A-Za-z0-9*.…]{6,}|\bAIza[-_A-Za-z0-9*.…]{10,}/g;

export function scrub(text: string, key: string | null): string {
  let out = text;
  if (key && key.length >= 6) {
    out = out.split(key).join("[key]");
    // A start or an end of the key, as providers show it masked.
    for (const n of [12, 8]) {
      if (key.length > n + 4) {
        out = out.split(key.slice(0, n)).join("[key]").split(key.slice(-n)).join("[key]");
      }
    }
  }
  return out.replace(KEYLIKE, "[key]");
}

function clean(err: unknown, key: string | null): unknown {
  if (!(err instanceof ProviderError)) return err;
  const said = scrub(err.message, key);
  return said === err.message ? err : new ProviderError(said, err.retry, err.opts);
}

/** The same adapter, with every failure's words scrubbed of the key. */
export function scrubbing(a: ProviderAdapter, key: string | null): ProviderAdapter {
  const wrap =
    <A extends unknown[], R>(f: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await f(...args);
      } catch (err) {
        throw clean(err, key);
      }
    };
  const out: ProviderAdapter = {
    kind: a.kind,
    complete: wrap(a.complete.bind(a)),
    listModels: wrap(a.listModels.bind(a)),
    testKey: wrap(a.testKey.bind(a)),
  };
  if (a.image) out.image = wrap(a.image.bind(a));
  if (a.stream) {
    const stream = a.stream.bind(a);
    out.stream = async function* (req): AsyncGenerator<StreamEvent> {
      try {
        yield* stream(req);
      } catch (err) {
        throw clean(err, key);
      }
    };
  }
  return out;
}
