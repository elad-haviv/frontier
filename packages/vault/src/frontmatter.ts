import { isMap, isScalar, parseDocument, stringify } from "yaml";

export interface SplitNote {
  /** The frontmatter block including both "---" lines and the line break after the closing one. */
  frontmatter: string | null;
  body: string;
}

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

const OPEN = /^---[ \t]*(\r?\n)/;

/**
 * Splits a note into its frontmatter block and its body without changing a byte of either.
 * `frontmatter + body` always equals the input.
 */
export function splitFrontmatter(text: string): SplitNote {
  const open = OPEN.exec(text);
  if (!open) return { frontmatter: null, body: text };
  let pos = open[0].length;
  while (pos <= text.length) {
    let lineEnd = text.indexOf("\n", pos);
    const last = lineEnd === -1;
    if (last) lineEnd = text.length;
    const line = text.slice(pos, lineEnd).replace(/\r$/, "");
    if (/^---[ \t]*$/.test(line)) {
      const end = last ? text.length : lineEnd + 1;
      return { frontmatter: text.slice(0, end), body: text.slice(end) };
    }
    if (last) break;
    pos = lineEnd + 1;
  }
  return { frontmatter: null, body: text };
}

function innerOf(frontmatter: string): { head: string; inner: string; tail: string } {
  const open = OPEN.exec(frontmatter);
  /* c8 ignore next */
  if (!open) throw new FrontmatterError("Not a frontmatter block.");
  const head = open[0];
  const rest = frontmatter.slice(head.length);
  const close = /(^|\n)(---[ \t]*\r?\n?)$/.exec(rest);
  /* c8 ignore next */
  if (!close) throw new FrontmatterError("Frontmatter block has no closing line.");
  const tail = close[2] ?? "";
  return { head, inner: rest.slice(0, rest.length - tail.length), tail };
}

export interface FrontmatterRead {
  /** The parsed keys, or null when the note has no frontmatter or it cannot be parsed. */
  data: Record<string, unknown> | null;
  /** Set when a frontmatter block exists but is not a valid YAML mapping. */
  error: string | null;
}

/** Reads the frontmatter keys. A malformed block is reported, never thrown. */
export function readFrontmatter(text: string): FrontmatterRead {
  const { frontmatter } = splitFrontmatter(text);
  if (frontmatter === null) return { data: null, error: null };
  const { inner } = innerOf(frontmatter);
  const doc = parseDocument(inner.replace(/\r\n/g, "\n"));
  if (doc.errors.length > 0) return { data: null, error: doc.errors[0]?.message ?? "Invalid YAML" };
  if (doc.contents === null) return { data: {}, error: null };
  if (!isMap(doc.contents)) return { data: null, error: "Frontmatter is not a list of keys." };
  return { data: doc.toJS() as Record<string, unknown>, error: null };
}

interface KeySpan {
  key: string;
  /** Offset in the inner text where the key's first line starts. */
  start: number;
  /** Offset where the key's own lines end (start of what follows). */
  end: number;
}

function lineStart(text: string, offset: number): number {
  const i = text.lastIndexOf("\n", offset - 1);
  return i === -1 ? 0 : i + 1;
}

/** Finds the lines each top-level key occupies, leaving comments and blank lines with the key after them. */
function keySpans(inner: string): KeySpan[] {
  const doc = parseDocument(inner, { keepSourceTokens: false });
  if (doc.errors.length > 0) {
    throw new FrontmatterError(doc.errors[0]?.message ?? "Invalid YAML");
  }
  if (doc.contents === null) return [];
  if (!isMap(doc.contents)) throw new FrontmatterError("Frontmatter is not a list of keys.");
  const starts: { key: string; start: number }[] = [];
  for (const pair of doc.contents.items) {
    const k = pair.key;
    /* c8 ignore next 3 */
    if (!isScalar(k) || !k.range) {
      throw new FrontmatterError("Frontmatter has a key that is not plain text.");
    }
    starts.push({ key: String(k.value), start: lineStart(inner, k.range[0]) });
  }
  const spans: KeySpan[] = [];
  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i]!;
    let end = i + 1 < starts.length ? starts[i + 1]!.start : inner.length;
    // Comments and blank lines directly above the next key stay with that key.
    while (end > cur.start) {
      const prevStart = lineStart(inner, end - 1);
      if (prevStart <= cur.start) break;
      const line = inner.slice(prevStart, end).trim();
      if (line === "" || line.startsWith("#")) end = prevStart;
      else break;
    }
    spans.push({ key: cur.key, start: cur.start, end });
  }
  return spans;
}

function eolOf(text: string): string {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

function serialisePair(key: string, value: unknown, eol: string): string {
  const out = stringify({ [key]: value }, { lineWidth: 0 });
  return eol === "\n" ? out : out.replace(/\n/g, eol);
}

/**
 * Sets one frontmatter key. Only that key's own lines change; every other line, the key order,
 * comments and line endings stay as they were. A note without frontmatter gets a new block.
 * Throws FrontmatterError when the existing block cannot be parsed.
 */
export function setFrontmatterKey(text: string, key: string, value: unknown): string {
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter === null) {
    const eol = eolOf(text);
    return `---${eol}${serialisePair(key, value, eol)}---${eol}${text}`;
  }
  const { head, inner, tail } = innerOf(frontmatter);
  const eol = eolOf(frontmatter);
  const normalised = inner.replace(/\r\n/g, "\n");
  const spans = keySpans(normalised);
  const pair = serialisePair(key, value, "\n");
  const span = spans.find((s) => s.key === key);
  let next: string;
  if (span) {
    next = normalised.slice(0, span.start) + pair + normalised.slice(span.end);
  } else {
    const needsBreak = normalised !== "" && !normalised.endsWith("\n");
    next = normalised + (needsBreak ? "\n" : "") + pair;
  }
  return head + (eol === "\n" ? next : next.replace(/\n/g, eol)) + tail + body;
}

/** Removes one frontmatter key, leaving every other line as it was. A missing key changes nothing. */
export function removeFrontmatterKey(text: string, key: string): string {
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter === null) return text;
  const { head, inner, tail } = innerOf(frontmatter);
  const eol = eolOf(frontmatter);
  const normalised = inner.replace(/\r\n/g, "\n");
  const span = keySpans(normalised).find((s) => s.key === key);
  if (!span) return text;
  const next = normalised.slice(0, span.start) + normalised.slice(span.end);
  return head + (eol === "\n" ? next : next.replace(/\n/g, eol)) + tail + body;
}

/** The aliases declared in a note's frontmatter, as a list of strings. */
export function aliasesOf(text: string): string[] {
  const { data } = readFrontmatter(text);
  const raw = data?.["aliases"];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((a): a is string => typeof a === "string");
  return [];
}
