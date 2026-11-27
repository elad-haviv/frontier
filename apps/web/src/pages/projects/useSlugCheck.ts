import { SlugShape } from "@frontier/schema";
import { useEffect, useState } from "react";
import { api } from "../../api.ts";

/** What the address check says: the state, and the words to show beside the field. */
export interface SlugCheck {
  state: "empty" | "same" | "bad" | "checking" | "taken" | "free";
  words: string;
}

interface Checked {
  slug: string;
  free: boolean;
  reason: string | null;
}

/**
 * Checks an address as it is typed (stage 27b): its shape at once, and with the server (a moment
 * after the last key, only the last answer counting) whether it is free or reserved. `own` is the
 * address a project already has, which needs no check.
 */
export function useSlugCheck(slug: string, own: string | null = null): SlugCheck {
  const [checked, setChecked] = useState<Checked | null>(null);
  const shape = slug === "" ? null : SlugShape.safeParse(slug);
  const shapeProblem = shape && !shape.success ? shape.error.issues[0]!.message : null;
  const same = own !== null && slug === own;

  useEffect(() => {
    if (slug === "" || shapeProblem || same) return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      api.slugFree(slug, control.signal).then(
        (r) => setChecked({ slug, free: r.free, reason: r.reason }),
        () => undefined,
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [slug, shapeProblem, same]);

  const answered = checked?.slug === slug ? checked : null;
  if (slug === "") return { state: "empty", words: "The address is made from the name." };
  if (shapeProblem) return { state: "bad", words: shapeProblem };
  if (same) return { state: "same", words: "This is the address now." };
  if (!answered) return { state: "checking", words: "Checking the address…" };
  return answered.free
    ? { state: "free", words: "This address is free." }
    : { state: "taken", words: answered.reason ?? "This address is taken." };
}
