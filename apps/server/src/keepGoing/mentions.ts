/**
 * Unlinked mentions: places where an entry's text names another entry without linking to it, and
 * the change that turns the first one into a link ("Link it"). A name inside a code block, an
 * existing link, a heading, a comment, a web address or the frontmatter is never a mention.
 */
import { codeRanges, extractHeadings, findLinks, splitFrontmatter, stripMd } from "@frontier/vault";
import { MENTION_LIMIT, type UnlinkedMention } from "@frontier/schema";
import type { IndexedNote, VaultIndex } from "../index/build.js";
import { isOrdinaryWord } from "../ai/lore.js";
import { derive } from "./derived.js";

type Range = [number, number];

/** A name shorter than this is too likely to be part of other words to be offered. */
const SHORTEST = 3;
/** The longest sentence shown, in characters. */
const SENTENCE = 240;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names an entry answers to: its title, then its other names, each once. */
export function namesOf(note: Pick<IndexedNote, "title" | "aliases">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [note.title, ...note.aliases]) {
    const name = raw.trim();
    if (name.length < SHORTEST || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/** Where a name would not be a mention: frontmatter, code, links, headings, comments, addresses. */
function skipped(text: string): Range[] {
  const ranges: Range[] = [];
  const { frontmatter } = splitFrontmatter(text);
  if (frontmatter !== null) ranges.push([0, frontmatter.length]);
  ranges.push(...codeRanges(text));
  for (const link of findLinks(text)) ranges.push([link.start, link.end]);
  // Heading lines, as the heading reader sees them (it knows fences and frontmatter).
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  for (const h of extractHeadings(text)) {
    const from = starts[h.line - 1] ?? 0;
    ranges.push([from, starts[h.line] ?? text.length]);
  }
  for (const m of text.matchAll(
    /<!--[\s\S]*?-->|(?:https?:\/\/|www\.)[^\s)>\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi,
  )) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.push(...referenceRanges(text), ...blockRanges(text));
  return ranges;
}

/** Footnote marks, reference links (`[words][ref]`) and what points at a reference definition. */
function referenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const add = (m: RegExpMatchArray) => ranges.push([m.index!, m.index! + m[0].length]);
  for (const m of text.matchAll(/\[\^[^\]\n]*\]|\[[^\]\n]*\]\[[^\]\n]*\]/g)) add(m);
  // "[label]: address" lines, and the bare "[label]" shortcut references to them.
  const labels = new Set<string>();
  for (const m of text.matchAll(/^ {0,3}\[([^\]\n^][^\]\n]*)\]:[^\n]*/gm)) {
    add(m);
    labels.add(m[1]!.trim().toLowerCase());
  }
  if (labels.size > 0) {
    for (const m of text.matchAll(/\[([^\]\n]+)\]/g)) {
      if (labels.has(m[1]!.trim().toLowerCase())) add(m);
    }
  }
  return ranges;
}

/** Setext headings (a line underlined with = or -) and indented code blocks. */
function blockRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const lines: { from: number; to: number; text: string }[] = [];
  let from = 0;
  for (const line of text.split("\n")) {
    lines.push({ from, to: from + line.length, text: line });
    from += line.length + 1;
  }
  const blank = (i: number) => (lines[i]?.text ?? "").trim() === "";
  let code = false;
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(?: {4}|\t)/.test(line.text) && !blank(i)) {
      // Indented text is code only where no paragraph or list item is going on.
      if (code || ((i === 0 || blank(i - 1)) && !inList)) {
        code = true;
        ranges.push([line.from, line.to]);
      }
      continue;
    }
    if (!blank(i)) {
      code = false;
      inList = /^ {0,3}(?:[-*+]|\d+[.)])[ \t]/.test(line.text);
    }
    // The paragraph above an underline is a heading.
    if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(line.text) && i > 0 && !blank(i - 1)) {
      let top = i - 1;
      while (top > 0 && !blank(top - 1)) top--;
      ranges.push([lines[top]!.from, line.to]);
    }
  }
  return ranges;
}

export interface Found {
  start: number;
  end: number;
  /** The name that matched. */
  name: string;
}

/**
 * The first place in `text` that names one of `names` and is not linked, with the earliest start
 * and, at the same start, the longest name. A name that is also an ordinary word (`exact`) counts
 * only when written as the name is, capital and all; any other matches in any letter case.
 */
export function firstMention(
  text: string,
  names: readonly string[],
  exact: ReadonlySet<string> = new Set(),
): Found | null {
  const lower = text.toLowerCase();
  const candidates = names.filter((n) =>
    exact.has(n) ? text.includes(n) : lower.includes(n.toLowerCase()),
  );
  if (candidates.length === 0) return null;
  const out = skipped(text);
  let best: Found | null = null;
  for (const name of [...candidates].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`,
      exact.has(name) ? "gu" : "giu",
    );
    for (const m of text.matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (out.some(([a, b]) => start < b && end > a)) continue;
      if (best === null || start < best.start) best = { start, end, name: m[0] };
      break;
    }
  }
  return best;
}

/** The sentence a span is in, with where the span lies in it. */
export function sentenceAround(
  text: string,
  start: number,
  end: number,
): { sentence: string; at: [number, number] } {
  const isEnd = (i: number) => /[.!?]/.test(text[i] ?? "") && /\s|^$/.test(text[i + 1] ?? "");
  let from = start;
  while (from > 0 && text[from - 1] !== "\n" && !isEnd(from - 1)) from--;
  let to = end;
  while (to < text.length && text[to] !== "\n" && !isEnd(to)) to++;
  if (to < text.length && text[to] !== "\n") to++;
  // The marks of a list, a quote or a table at the start of the line are not the sentence.
  const lead = /^[ \t]*(?:[-*+>|]|\d+[.)])?[ \t]*/.exec(text.slice(from, start))?.[0].length ?? 0;
  from += Math.min(lead, start - from);
  let sentence = text.slice(from, to);
  let a = start - from;
  let b = end - from;
  const trimmed = sentence.length - sentence.trimStart().length;
  sentence = sentence.trim();
  a -= trimmed;
  b -= trimmed;
  if (sentence.length > SENTENCE) {
    // A long sentence is cut around the name, at spaces.
    const left = Math.max(0, a - Math.floor((SENTENCE - (b - a)) / 2));
    const right = Math.min(sentence.length, left + SENTENCE);
    const cutLeft = left > 0 ? sentence.indexOf(" ", left) + 1 || left : 0;
    const cutRight = right < sentence.length ? sentence.lastIndexOf(" ", right) : right;
    const slice = sentence.slice(cutLeft, Math.max(cutRight, b));
    sentence = `${cutLeft > 0 ? "… " : ""}${slice}${cutRight < sentence.length ? " …" : ""}`;
    const shift = (cutLeft > 0 ? 2 : 0) - cutLeft;
    a += shift;
    b += shift;
  }
  return { sentence, at: [Math.max(0, a), Math.max(0, b)] };
}

/** Names that count only in their own letter case, since the library also writes them as words. */
function exactNames(index: VaultIndex, names: readonly string[]): Set<string> {
  return new Set(names.filter((n) => isOrdinaryWord(index, n)));
}

/**
 * Other entries that name this one without linking to it, one mention each, in title order.
 * Entries that already link to it somewhere, appendices (which cannot be changed) and the README
 * are left out.
 */
export function unlinkedMentions(
  index: VaultIndex,
  target: IndexedNote,
): { mentions: UnlinkedMention[]; more: boolean } {
  const names = namesOf(target);
  const d = derive(index);
  if (names.length === 0) return { mentions: [], more: false };
  const exact = exactNames(index, names);
  const linking = new Set(d.inbound.get(target.path) ?? []);
  const mentions: UnlinkedMention[] = [];
  let more = false;
  for (const note of d.entries) {
    if (note.path === target.path || linking.has(note.path)) continue;
    const found = firstMention(note.text, names, exact);
    if (!found) continue;
    if (mentions.length >= MENTION_LIMIT) {
      more = true;
      break;
    }
    const { sentence, at } = sentenceAround(note.text, found.start, found.end);
    mentions.push({ path: note.path, title: note.title, sentence, at, name: found.name });
  }
  return { mentions, more };
}

/**
 * The link text that reaches `target` from `from`: its title, or its path when another entry
 * shares the title. Checked against the way links are resolved.
 */
export function linkTarget(index: VaultIndex, from: string, target: IndexedNote): string {
  const reaches = (written: string) => {
    const r = index.analyse(from, `[[${written}]]`).links[0]?.resolution;
    return r?.kind === "note" && r.path === target.path;
  };
  if (reaches(target.title)) return target.title;
  // The shortest tail of the path that points here and nowhere else.
  const parts = stripMd(target.path).split("/");
  for (let i = parts.length - 2; i >= 0; i--) {
    const tail = parts.slice(i).join("/");
    if (reaches(tail)) return tail;
  }
  return stripMd(target.path);
}

/**
 * Whether the line holds a "|" that is not part of a link, code or the found words: a table row,
 * with or without a pipe at its start, where a link's own "|" must be written "\|".
 */
function onTableLine(text: string, found: Found): boolean {
  const lineStart = text.lastIndexOf("\n", found.start - 1) + 1;
  const end = text.indexOf("\n", found.end);
  const lineEnd = end === -1 ? text.length : end;
  const chars = text.slice(lineStart, lineEnd).split("");
  const blot = (a: number, b: number) => {
    for (let i = Math.max(a, lineStart); i < Math.min(b, lineEnd); i++) chars[i - lineStart] = " ";
  };
  blot(found.start, found.end);
  for (const link of findLinks(text)) blot(link.start, link.end);
  for (const [a, b] of codeRanges(text)) blot(a, b);
  return /(?<!\\)\|/.test(chars.join(""));
}

/**
 * `text` with the first mention of `target` turned into a link, and what changed. Null when the
 * text holds no mention. The words as written stay as the link's visible text when they differ
 * from the entry's title; in a table a "|" is written "\|".
 */
export function linkFirstMention(
  index: VaultIndex,
  from: string,
  text: string,
  target: IndexedNote,
): { text: string; before: string; after: string } | null {
  const names = namesOf(target);
  const found = firstMention(text, names, exactNames(index, names));
  if (!found) return null;
  const shown = text.slice(found.start, found.end);
  const written = linkTarget(index, from, target);
  const bar = onTableLine(text, found) ? "\\|" : "|";
  const link = shown === written ? `[[${written}]]` : `[[${written}${bar}${shown}]]`;
  const next = text.slice(0, found.start) + link + text.slice(found.end);
  const before = sentenceAround(text, found.start, found.end).sentence;
  const after = sentenceAround(next, found.start, found.start + link.length).sentence;
  return { text: next, before, after };
}
