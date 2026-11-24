/**
 * Finding a commented passage again. A comment holds its passage's words and a little of the text
 * on each side; every place the words occur is scored by how much of the text around it still
 * matches, and the best place wins.
 */

/** How much of the text on each side a comment keeps. */
export const CONTEXT = 40;

export interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
}

/** The passage at `from`..`to`, with the text around it, as a comment keeps it. */
export function anchorAt(text: string, from: number, to: number): Anchor {
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
  };
}

/** Characters that match, counting from the end of `a` and of `b`. */
function sameEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Characters that match, counting from the start of `a` and of `b`. */
function sameStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** The fewest characters, not counting spaces, a commented passage may have. */
export const MIN_QUOTE = 3;

/** Context that must still match for a place to count, when the words alone are not enough. */
const NEEDED = 10;

/**
 * Where the passage is now, or null when it cannot be told. The words alone are enough only when
 * they are long and occur once; otherwise some of the text around them must still match, so a
 * short passage that was rewritten is not mistaken for the same words elsewhere.
 */
export function locate(text: string, a: Anchor): { from: number; to: number } | null {
  if (a.quote.replace(/\s/g, "").length < MIN_QUOTE) return null;
  let best: { from: number; score: number } | null = null;
  let found = 0;
  for (let at = text.indexOf(a.quote); at !== -1; at = text.indexOf(a.quote, at + 1)) {
    found++;
    const before = text.slice(Math.max(0, at - a.prefix.length), at);
    const after = text.slice(at + a.quote.length, at + a.quote.length + a.suffix.length);
    const score = sameEnd(before, a.prefix) + sameStart(after, a.suffix);
    if (!best || score > best.score) best = { from: at, score };
  }
  if (!best) return null;
  const alone = found === 1 && a.quote.length >= 40;
  if (!alone && best.score < Math.min(NEEDED, a.prefix.length + a.suffix.length)) return null;
  return { from: best.from, to: best.from + a.quote.length };
}
