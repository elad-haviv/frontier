/**
 * Finds links in a note, with the exact character positions needed to rewrite them
 * without touching anything else.
 */

export interface WikiLink {
  kind: "wikilink";
  /** True for "![[...]]". */
  embed: boolean;
  /** The whole link as written, including brackets. */
  raw: string;
  start: number;
  end: number;
  /** The note or file part as written, before "#" and "|". Empty for a same-note heading link. */
  target: string;
  /** Position of `target` in the note text. */
  targetStart: number;
  targetEnd: number;
  heading: string | null;
  display: string | null;
  /** Width in pixels from "![[image.png|300]]", when the part after "|" is a number. */
  width: number | null;
}

export interface MarkdownLink {
  kind: "mdlink";
  /** True for "![...](...)". */
  embed: boolean;
  raw: string;
  start: number;
  end: number;
  /** The destination, decoded: without angle brackets and with URL escapes resolved. */
  target: string;
  /** Position of the destination as written, without the angle brackets and without "#heading". */
  targetStart: number;
  targetEnd: number;
  heading: string | null;
  display: string;
  /** Whether the destination was written inside "<...>". */
  angle: boolean;
}

export type Link = WikiLink | MarkdownLink;

type Range = [number, number];

/** Ranges of fenced code blocks and inline code spans, where "[[...]]" is text and not a link. */
export function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const fenceLine = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm;
  let open: { marker: string; start: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = fenceLine.exec(text))) {
    const marker = m[1] ?? "";
    if (open === null) {
      open = { marker, start: m.index };
    } else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
      ranges.push([open.start, m.index + m[0].length]);
      open = null;
    }
  }
  if (open !== null) ranges.push([open.start, text.length]);

  const inFence = (i: number) => ranges.some(([a, b]) => i >= a && i < b);
  const fences = ranges.length;
  const tick = /`+/g;
  while ((m = tick.exec(text))) {
    if (inFence(m.index)) continue;
    const run = m[0];
    // The closing run must have the same length and sit in the same paragraph.
    let search = m.index + run.length;
    for (;;) {
      const close = text.indexOf(run, search);
      if (close === -1) break;
      const between = text.slice(m.index + run.length, close);
      if (/\n[ \t]*\n/.test(between)) break;
      const before = text[close - 1];
      const after = text[close + run.length];
      if (before !== "`" && after !== "`") {
        ranges.push([m.index, close + run.length]);
        tick.lastIndex = close + run.length;
        break;
      }
      search = close + 1;
    }
  }
  return ranges.length === fences ? ranges : ranges.sort((a, b) => a[0] - b[0]);
}

function inAny(ranges: Range[], index: number): boolean {
  for (const [a, b] of ranges) {
    if (index >= a && index < b) return true;
    if (a > index) return false;
  }
  return false;
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MD =
  /(!?)\[([^\]\n]*)\]\((<[^>\n]*>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(?:[ \t]+"[^"\n]*")?\)/g;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Finds every wikilink, embed and local Markdown link in a note. Links to web addresses are left out. */
export function findLinks(text: string): Link[] {
  const code = codeRanges(text);
  const out: Link[] = [];
  let m: RegExpExecArray | null;

  WIKI.lastIndex = 0;
  while ((m = WIKI.exec(text))) {
    if (inAny(code, m.index)) continue;
    const embed = m[1] === "!";
    const inner = m[2] ?? "";
    const innerStart = m.index + (embed ? 3 : 2);
    // "\|" separates too: it is how a "|" is written inside a table cell.
    const pipe = /\\?\|/.exec(inner);
    const left = pipe ? inner.slice(0, pipe.index) : inner;
    const display = pipe ? inner.slice(pipe.index + pipe[0].length) : null;
    const hash = left.indexOf("#");
    const target = hash === -1 ? left : left.slice(0, hash);
    const heading = hash === -1 ? null : left.slice(hash + 1);
    const width =
      embed && display !== null && /^\d+(x\d+)?$/.test(display.trim())
        ? parseInt(display.trim(), 10)
        : null;
    out.push({
      kind: "wikilink",
      embed,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      target,
      targetStart: innerStart,
      targetEnd: innerStart + target.length,
      heading,
      display,
      width,
    });
  }

  MD.lastIndex = 0;
  while ((m = MD.exec(text))) {
    if (inAny(code, m.index)) continue;
    const embed = m[1] === "!";
    const display = m[2] ?? "";
    const written = m[3] ?? "";
    const angle = written.startsWith("<");
    const dest = angle ? written.slice(1, -1) : written;
    if (dest === "" || dest.startsWith("#") || SCHEME.test(dest) || dest.startsWith("//")) continue;
    const destStart = m.index + m[1]!.length + 1 + display.length + 2 + (angle ? 1 : 0);
    const hash = dest.indexOf("#");
    const pathPart = hash === -1 ? dest : dest.slice(0, hash);
    const heading = hash === -1 ? null : dest.slice(hash + 1);
    out.push({
      kind: "mdlink",
      embed,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      target: angle ? pathPart : safeDecode(pathPart),
      targetStart: destStart,
      targetEnd: destStart + pathPart.length,
      heading: heading === null ? null : angle ? heading : safeDecode(heading),
      display,
      angle,
    });
  }

  return out.sort((a, b) => a.start - b.start);
}
