/**
 * The work queue on Home: entries that need love, names that are wanted, orphans, dead ends and
 * the stub count of each top folder. Every list is worked out from the published index.
 */
import {
  type EntryRow,
  type FolderFile,
  type FolderStubs,
  isStub,
  type NeedsLoveReason,
  type NeedsLoveRow,
  type NeedsLoveRules,
  PICTURE_WORDS,
  QUEUE_ROWS,
  type QueueResponse,
  sortFolders,
  type WantedRow,
} from "@frontier/schema";
import { dirname } from "@frontier/vault";
import type { IndexedNote } from "../index/build.js";
import { type Derived, factsOf, likelyFolder, type Wanted } from "./derived.js";

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The rules an entry trips, each with its words; empty for an entry that needs nothing. */
export function reasonsFor(
  d: Derived,
  note: IndexedNote,
  rules: NeedsLoveRules,
  comments: ReadonlyMap<string, number>,
): NeedsLoveReason[] {
  const f = factsOf(note);
  const linkedFrom = d.inbound.get(note.path)?.length ?? 0;
  const out: NeedsLoveReason[] = [];
  if (rules.stub && isStub(f.words) && linkedFrom >= 3) {
    out.push({
      rule: "stub",
      text: `Stub: ${plural(f.words, "word", "words")}, linked from ${linkedFrom} entries`,
    });
  }
  if (rules.emptyHeadings && f.emptyHeadings.length > 0) {
    const [first] = f.emptyHeadings;
    out.push({
      rule: "emptyHeadings",
      text:
        f.emptyHeadings.length === 1
          ? `Empty heading: "${first}"`
          : `${f.emptyHeadings.length} empty headings, from "${first}"`,
    });
  }
  if (rules.noType && !f.hasType) out.push({ rule: "noType", text: "No type" });
  if (rules.noPicture && !f.hasPicture && f.words >= PICTURE_WORDS) {
    out.push({ rule: "noPicture", text: `No picture (${f.words} words)` });
  }
  const open = comments.get(note.path) ?? 0;
  if (rules.openComments && open > 0) {
    out.push({ rule: "openComments", text: plural(open, "open comment", "open comments") });
  }
  if (rules.todoMarks && f.marks.length > 0) {
    out.push({ rule: "todoMarks", text: `Marked ${f.marks.join(", ")}` });
  }
  return out;
}

export function entryRow(d: Derived, note: IndexedNote): EntryRow {
  return {
    path: note.path,
    title: note.title,
    folder: dirname(note.path),
    type: note.fields.type,
    words: factsOf(note).words,
    linkedFrom: d.inbound.get(note.path)?.length ?? 0,
    linksTo: d.outbound.get(note.path)?.length ?? 0,
  };
}

export function wantedRow(d: Derived, wanted: Wanted): WantedRow {
  const sources = [...wanted.sources];
  return {
    name: wanted.name,
    mentions: sources.length,
    folder: likelyFolder(sources),
    examples: sources
      .map((path) => ({ path, title: d.byPath.get(path)?.title ?? path }))
      .sort(byTitle)
      .slice(0, 3),
  };
}

/** The wanted names, most mentioned first. */
export function wantedRows(d: Derived): WantedRow[] {
  return [...d.wanted.values()]
    .map((w) => wantedRow(d, w))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}

/** Entries that trip a rule, ranked by how many entries link to them, then by how many rules. */
export function needsLoveRows(
  d: Derived,
  rules: NeedsLoveRules,
  comments: ReadonlyMap<string, number>,
): NeedsLoveRow[] {
  const rows: NeedsLoveRow[] = [];
  for (const note of d.entries) {
    const reasons = reasonsFor(d, note, rules, comments);
    if (reasons.length > 0) rows.push({ ...entryRow(d, note), reasons });
  }
  return rows.sort(
    (a, b) => b.linkedFrom - a.linkedFrom || b.reasons.length - a.reasons.length || byTitle(a, b),
  );
}

/** The top folders with how many of their entries are stubs, in the tree's order. */
export function folderStubs(d: Derived, folders: FolderFile): FolderStubs[] {
  const counts = new Map<string, FolderStubs>();
  for (const note of d.entries) {
    const top = note.path.split("/")[0]!;
    if (top === note.path) continue;
    const row = counts.get(top) ?? { folder: top, entries: 0, stubs: 0 };
    row.entries++;
    if (isStub(factsOf(note).words)) row.stubs++;
    counts.set(top, row);
  }
  const lines = new Map(folders.folders.map((l) => [l.path, l.order]));
  return sortFolders(
    [...counts.values()].map((c) => ({ name: c.folder, order: lines.get(c.folder), c })),
  ).map((x) => x.c);
}

const cut = <T>(rows: T[]) => ({ total: rows.length, rows: rows.slice(0, QUEUE_ROWS) });

export function buildQueue(
  d: Derived,
  rules: NeedsLoveRules,
  comments: ReadonlyMap<string, number>,
  folders: FolderFile,
): QueueResponse {
  const rows = d.entries.map((n) => entryRow(d, n));
  return {
    rules,
    needsLove: cut(needsLoveRows(d, rules, comments)),
    wanted: cut(wantedRows(d)),
    orphans: cut(
      rows.filter((r) => r.linkedFrom === 0).sort((a, b) => b.linksTo - a.linksTo || byTitle(a, b)),
    ),
    deadEnds: cut(
      rows
        .filter((r) => r.linksTo === 0)
        .sort((a, b) => b.linkedFrom - a.linkedFrom || byTitle(a, b)),
    ),
    folders: folderStubs(d, folders),
    entries: rows.length,
  };
}
