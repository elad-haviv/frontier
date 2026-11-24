/**
 * Finding a commented passage in the page as it reads. A comment keeps the Markdown it was made
 * on; the page shows that text without its marks. So the passage's first line is stripped of its
 * marks, and found among the page's words, spaces counted as one.
 */
import { type Anchor, locate } from "../anchor.ts";

/** How many characters of the passage are looked for: enough to tell it apart, short enough to
 *  stay within one paragraph as the page lays it out. */
const LOOK_FOR = 60;

/** The words of a passage's first line, without Markdown marks, spaces as one. */
export function plainQuote(quote: string): string {
  const line = quote.split("\n").find((l) => l.trim() !== "") ?? "";
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]*)\]\]/g, (_, t: string) => t.split("#")[0]!.split("/").pop() ?? t)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?u>/g, "")
    .replace(/(\*\*|__|~~|\*|_|`)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LOOK_FOR)
    .trim();
}

/** Which occurrence of its words, counted from 0, the passage is in the text it was made on. */
export function occurrence(text: string, a: Anchor): number {
  const at = locate(text, a);
  if (!at) return -1;
  let n = 0;
  for (let i = text.indexOf(a.quote); i !== -1 && i < at.from; i = text.indexOf(a.quote, i + 1)) {
    n++;
  }
  return n;
}

/**
 * Where the `nth` occurrence of `needle` starts in `text`, comparing with spaces as one; the
 * offsets are in `text` as written. Falls back to the first occurrence; -1 when there is none.
 */
export function findSpaced(text: string, needle: string, nth: number): number {
  if (needle === "") return -1;
  // The text with every run of spaces as one, and where each of its characters came from.
  let squeezed = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const space = /\s/.test(text[i]!);
    if (space && squeezed.endsWith(" ")) continue;
    squeezed += space ? " " : text[i];
    from.push(i);
  }
  let first = -1;
  let n = 0;
  for (let at = squeezed.indexOf(needle); at !== -1; at = squeezed.indexOf(needle, at + 1)) {
    if (first === -1) first = at;
    if (n++ === nth) return from[at]!;
  }
  return first === -1 ? -1 : from[first]!;
}

/** A range over the passage's first words in a page's rendered text, or null when not found. */
export function passageRange(root: HTMLElement, text: string, a: Anchor): Range | null {
  const needle = plainQuote(a.quote);
  const nth = occurrence(text, a);
  if (needle.length < 3 || nth === -1) return null;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const all = nodes.map((n) => n.data).join("");
  const start = findSpaced(all, needle, nth);
  if (start === -1) return null;
  let pos = 0;
  for (const node of nodes) {
    if (start < pos + node.data.length) {
      const range = document.createRange();
      range.setStart(node, start - pos);
      range.setEnd(node, Math.min(node.data.length, start - pos + 1));
      return range;
    }
    pos += node.data.length;
  }
  /* c8 ignore next */
  return null;
}
