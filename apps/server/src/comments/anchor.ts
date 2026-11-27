/**
 * Where a shared comment's passage is in the SAVED text. What others read as a comment's context
 * (the words on each side of the passage) is taken from the saved entry, never from what the
 * writer's browser sent, so a draft cannot leak into a comment through it.
 */

/** How much text on each side a comment keeps (the same as the editor's). */
export const CONTEXT = 40;

/** Words with the Markdown marks and the spacing taken out, to tell whether a passage is in a text. */
export const plain = (t: string): string =>
  t
    .replace(/<\/?u>|[*_~`#>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const sameEnd = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const sameStart = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/**
 * The context of `quote` in `saved`, or null when the passage is not in the saved text. When the
 * words occur more than once, the client's hint only chooses which occurrence it meant; what is
 * returned is always cut from the saved text. A passage found only with the marks and spacing
 * ignored has no context (the words alone find it).
 */
export function savedAnchor(
  saved: string,
  quote: string,
  hint: { prefix: string; suffix: string },
): { prefix: string; suffix: string } | null {
  if (quote === "") return { prefix: "", suffix: "" };
  let best: { at: number; score: number } | null = null;
  for (let at = saved.indexOf(quote); at !== -1; at = saved.indexOf(quote, at + 1)) {
    const score =
      sameEnd(saved.slice(Math.max(0, at - hint.prefix.length), at), hint.prefix) +
      sameStart(
        saved.slice(at + quote.length, at + quote.length + hint.suffix.length),
        hint.suffix,
      );
    if (!best || score > best.score) best = { at, score };
  }
  if (best) {
    const end = best.at + quote.length;
    return {
      prefix: saved.slice(Math.max(0, best.at - CONTEXT), best.at),
      suffix: saved.slice(end, end + CONTEXT),
    };
  }
  return plain(saved).includes(plain(quote)) ? { prefix: "", suffix: "" } : null;
}
