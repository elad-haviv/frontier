/**
 * The small rules of comments between people (stage 31e), with no React in them: which threads are
 * open, how a selection on the page becomes a passage of the entry's Markdown, and the words.
 */
import type { CommentPerson, PassageComment } from "../../api.ts";
import { type Anchor, CONTEXT } from "../anchor.ts";

/** The most characters of a selection that become a comment's passage. */
export const MOST_QUOTED = 800;

/** Threads still open, then those resolved, each in the order they were made. */
export function splitThreads(list: readonly PassageComment[]): {
  open: PassageComment[];
  resolved: PassageComment[];
} {
  const byTime = [...list].sort((a, b) => a.at.localeCompare(b.at));
  return {
    open: byTime.filter((c) => !c.resolved),
    resolved: byTime.filter((c) => c.resolved),
  };
}

/** How many threads wait for an answer: the number on the Comments button. */
export const openCount = (list: readonly PassageComment[]): number =>
  list.filter((c) => !c.resolved).length;

/** "Writer", "Reader", "Owner"; nothing for someone who has left the project. */
export function roleTag(p: CommentPerson): string {
  return p.role ? p.role[0]!.toUpperCase() + p.role.slice(1) : "";
}

/** "Comments, 2 open" for the button's name; just "Comments" with none. */
export const commentsLabel = (open: number): string =>
  open > 0 ? `Comments, ${open} open` : "Comments";

const escape = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks that may sit between two characters of a passage in the Markdown but not on the page. */
const NOISE = "(?:[*_~`]|<\\/?u>|\\]\\([^)\\n]*\\)|\\[|\\]|\\[\\[|\\]\\])*";
/** What stands for a space: spaces, line breaks, and the marks that start a line. */
const SPACE = "(?:\\s|[>#*_~`+-])+";

/**
 * The passage in the entry's Markdown that reads as `selected` on the page: the selection has no
 * marks (bold, links, list dashes), so each word is looked for with the marks allowed between its
 * letters. `nth` is which occurrence on the page was selected, counted from 0. Null when it cannot
 * be found (a selection across a table or an image, say).
 */
export function sourceAnchor(text: string, selected: string, nth = 0): Anchor | null {
  const plain = selected.replace(/\s+/g, " ").trim().slice(0, MOST_QUOTED).trim();
  if (plain.replace(/\s/g, "").length < 3) return null;
  const pieces = [...plain].map((ch) => (ch === " " ? SPACE : escape(ch)));
  let re: RegExp;
  try {
    re = new RegExp(pieces.join(NOISE), "g");
  } catch {
    return null;
  }
  const found: RegExpExecArray[] = [];
  for (let m = re.exec(text); m && found.length <= nth; m = re.exec(text)) {
    if (m[0] === "") break;
    found.push(m);
    re.lastIndex = m.index + 1;
  }
  const m = found[Math.min(nth, found.length - 1)];
  if (!m) return null;
  const from = m.index;
  const to = from + m[0].length;
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
  };
}

/** How many times `needle` occurs in `hay`, with runs of spaces as one. */
export function countSpaced(hay: string, needle: string): number {
  const h = hay.replace(/\s+/g, " ");
  const n = needle.replace(/\s+/g, " ").trim();
  if (n === "") return 0;
  let count = 0;
  for (let at = h.indexOf(n); at !== -1; at = h.indexOf(n, at + 1)) count++;
  return count;
}

/**
 * The stream's count of comment changes while it is about this entry, else 0: a change to another
 * entry's comments is not a reason to read this one's again.
 */
export function changesOf(
  status: { changes: number; path: string | null } | undefined,
  path: string,
): number {
  return status && status.path === path ? status.changes : 0;
}
