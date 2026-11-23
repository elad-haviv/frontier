import { useEffect, useState } from "react";
import { ApiFailure } from "./api.ts";

export type Loaded<T> =
  | { state: "loading" }
  /** `error` is a failure to load again: the value shown is the one from before it. */
  | { state: "ready"; value: T; error: ApiFailure | null }
  | { state: "failed"; error: ApiFailure };

export type Async<T> = Loaded<T> & {
  /** True while a value is shown and a newer one is being loaded. */
  reloading: boolean;
  /** Loads again, as after a failure. */
  retry: () => void;
};

/**
 * Runs an async call when `key` changes and reports loading, the value, or the failure. On a
 * re-run the earlier value stays on screen until the new one arrives, and a failure then keeps it
 * and reports the error beside it, so a page never goes blank because a reload failed.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string): Async<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  const [reloading, setReloading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setReloading(true);
    setResult((r) => (r.state === "ready" ? r : { state: "loading" }));
    fn().then(
      (value) => {
        if (!live) return;
        setResult({ state: "ready", value, error: null });
        setReloading(false);
      },
      (err: unknown) => {
        if (!live) return;
        const error = err instanceof ApiFailure ? err : new ApiFailure(0, "unknown", String(err));
        setResult((r) => (r.state === "ready" ? { ...r, error } : { state: "failed", error }));
        setReloading(false);
      },
    );
    return () => {
      live = false;
    };
    // The caller controls re-runs through `key`; `fn` is deliberately not a dependency.
  }, [key, attempt]);
  return {
    ...result,
    reloading: reloading && result.state === "ready",
    retry: () => setAttempt((n) => n + 1),
  };
}

/** Why the last load failed, whether or not an earlier value is still shown; null when it did not. */
export function failureOf(loaded: Loaded<unknown>): ApiFailure | null {
  return loaded.state === "loading" ? null : loaded.error;
}
