import { useEffect, useState } from "react";
import { ApiFailure } from "./api.ts";

export type Loaded<T> =
  { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; error: ApiFailure };

/** Runs an async call when `key` changes and reports loading, the value, or the failure. */
export function useAsync<T>(fn: () => Promise<T>, key: string): Loaded<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    // On a re-run the earlier value stays on screen until the new one arrives.
    setResult((r) => (r.state === "ready" ? r : { state: "loading" }));
    fn().then(
      (value) => live && setResult({ state: "ready", value }),
      (error: unknown) =>
        live &&
        setResult({
          state: "failed",
          error: error instanceof ApiFailure ? error : new ApiFailure(0, "unknown", String(error)),
        }),
    );
    return () => {
      live = false;
    };
    // The caller controls re-runs through `key`; `fn` is deliberately not a dependency.
  }, [key]);
  return result;
}
