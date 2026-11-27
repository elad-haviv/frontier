import { SlugShape } from "@frontier/schema";
import { useEffect, useState } from "react";
import { api } from "../../api.ts";

/** What the address check says: the state, and the words to show beside the field. */
export interface SlugCheck {
  state: "empty" | "same" | "bad" | "checking" | "taken" | "free" | "unknown";
  words: string;
  /** Asks again; for the "unknown" state, when the server could not be asked. */
  retry: () => void;
}

type Checked =
  | { slug: string; failed?: false; free: boolean; reason: string | null }
  /** The server could not be asked (no connection, an error): neither free nor taken. */
  | { slug: string; failed: true };

/**
 * Checks an address as it is typed (stage 31b): its shape at once, and with the server (a moment
 * after the last key, only the last answer counting) whether it is free or reserved. `own` is the
 * address a project already has, which needs no check. When the server cannot be asked the state
 * is "unknown", not "checking" for ever: the form may still be sent, since the server refuses a
 * taken address when it is, and "Try again" asks once more.
 */
export function useSlugCheck(slug: string, own: string | null = null): SlugCheck {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [attempt, setAttempt] = useState(0);
  const shape = slug === "" ? null : SlugShape.safeParse(slug);
  const shapeProblem = shape && !shape.success ? shape.error.issues[0]!.message : null;
  const same = own !== null && slug === own;

  useEffect(() => {
    if (slug === "" || shapeProblem || same) return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      api.slugFree(slug, control.signal).then(
        (r) => setChecked({ slug, free: r.free, reason: r.reason }),
        // A check that was only replaced by a newer one says nothing; any other failure is unknown.
        () => !control.signal.aborted && setChecked({ slug, failed: true }),
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [slug, shapeProblem, same, attempt]);
  const retry = () => {
    setChecked(null);
    setAttempt((n) => n + 1);
  };

  const answered = checked?.slug === slug ? checked : null;
  if (slug === "") return { state: "empty", words: "The address is made from the name.", retry };
  if (shapeProblem) return { state: "bad", words: shapeProblem, retry };
  if (same) return { state: "same", words: "This is the address now.", retry };
  if (!answered) return { state: "checking", words: "Checking the address…", retry };
  if (answered.failed) {
    return {
      state: "unknown",
      words: "The address could not be checked. It is checked again when you save.",
      retry,
    };
  }
  return answered.free
    ? { state: "free", words: "This address is free.", retry }
    : { state: "taken", words: answered.reason ?? "This address is taken.", retry };
}
