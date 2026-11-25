/**
 * The words and small decisions behind an entry's "From here" strip, the backlinks line and the
 * nudge after Publish, kept apart from the components so they can be tested without a browser.
 */
import type { AfterPublishStep, NeedsLoveRule } from "@frontier/schema";
import { dirname, stem } from "@frontier/vault";
import type { Recents } from "./recents.ts";

/** How many entries the backlinks line names before "and n more". */
export const BACKLINKS_NAMED = 3;
/** How many unlinked mentions show before "Show the other n". */
export const MENTIONS_SHOWN = 3;

export interface Backlink {
  path: string;
  title: string;
}

/** The entries that link here, each once, and the one line that names the first few. */
export function backlinksLine(backlinks: readonly Backlink[]): {
  all: Backlink[];
  named: string[];
  more: number;
} {
  const all = [...new Map(backlinks.map((b) => [b.path, b])).values()];
  return {
    all,
    named: all.slice(0, BACKLINKS_NAMED).map((b) => b.title),
    more: Math.max(0, all.length - BACKLINKS_NAMED),
  };
}

/** A sentence cut at a mention: the words before it, the name as written, the words after. */
export function splitMention(
  sentence: string,
  at: readonly [number, number],
): [string, string, string] {
  const from = Math.max(0, Math.min(at[0], sentence.length));
  const to = Math.max(from, Math.min(at[1], sentence.length));
  return [sentence.slice(0, from), sentence.slice(from, to), sentence.slice(to)];
}

/** The short tag shown beside a thin neighbour for each rule it trips. */
export const RULE_TAG: Record<NeedsLoveRule, string> = {
  stub: "stub",
  emptyHeadings: "empty headings",
  noType: "no type",
  noPicture: "no picture",
  openComments: "open comments",
  todoMarks: "to-do",
};

/** The last part of a folder path, for "Previous in Places"; "the library" at the top. */
export function folderName(path: string): string {
  const folder = dirname(path);
  return folder ? (folder.split("/").pop() ?? folder) : "the library";
}

/** "1 entry", "9 entries". */
export const entries = (n: number): string => `${n} ${n === 1 ? "entry" : "entries"}`;

/**
 * The words of one next step after Publish, in parts, so the page can make a link of a name.
 * `old` says it in general words: the Roll button picks the entry.
 */
export function stepWords(step: AfterPublishStep): {
  lead: string;
  name: string;
  tail: string;
} {
  switch (step.kind) {
    case "stub":
      return {
        lead: `${step.from.title} links to `,
        name: step.title,
        tail: `, which is still a stub of ${step.words} ${step.words === 1 ? "word" : "words"}.`,
      };
    case "missing":
      return {
        lead: "",
        name: step.name,
        tail: ` is named in ${entries(step.mentions)} and does not exist yet.`,
      };
    case "old":
      return { lead: "Or a random entry nobody has touched in 6 months.", name: "", tail: "" };
  }
}

/**
 * What a publish did to the entries this device remembers: a saved rename moves an entry (or,
 * for a folder, every entry in it) to its new path, and a saved delete removes it. `deleted` and
 * the `renames` are paths as the publish plan gives them.
 */
export function followPublish(
  recents: Pick<Recents, "snapshot" | "renamed" | "forget">,
  change: { renames: readonly { from: string; to: string }[]; deleted: readonly string[] },
): void {
  for (const r of change.renames) {
    for (const entry of recents.snapshot().recents) {
      if (entry.path === r.from) {
        recents.renamed(entry.path, r.to, stem(r.to));
      } else if (entry.path.startsWith(`${r.from}/`)) {
        recents.renamed(entry.path, r.to + entry.path.slice(r.from.length), entry.title);
      }
    }
  }
  for (const path of change.deleted) recents.forget(path);
}

/** The entries (not other files) among the paths a publish wrote, once each. */
export function publishedEntries(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((p) => /\.md$/i.test(p) && !p.startsWith(".frontier/")))];
}

/**
 * Whether the page was reached by the browser's back or forward, where the reader looks for the
 * place itself and the entry does not scroll back to where reading stopped. `key` is the
 * location's key ("default" for the first page of a load, which has no history type of its own),
 * and `loadType` that load's navigation type from the browser ("back_forward" for a load by the
 * back button).
 */
export function arrivedByHistory(type: string, key: string, loadType: string | undefined): boolean {
  return key === "default" ? loadType === "back_forward" : type === "POP";
}
