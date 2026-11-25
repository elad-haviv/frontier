/**
 * What the keep-going pieces work out from the published index: each entry's facts (words, empty
 * headings, to-do marks), who links to whom, and the names that are linked and have no entry.
 * Built once for each build of the index and shared by every request, so a library of a few
 * thousand entries costs one pass over its links, not one for each request.
 */
import {
  basename,
  bodyWords,
  codeRanges,
  dirname,
  isImage,
  isInAppendix,
  isNote,
  splitFrontmatter,
  stem,
} from "@frontier/vault";
import type { IndexedNote, VaultIndex } from "../index/build.js";

export interface NoteFacts {
  /** Words of body text. */
  words: number;
  /** The text of each heading with nothing under it. */
  emptyHeadings: string[];
  /** Which of `TODO`, `TBD` and `??` the body holds. */
  marks: string[];
  /** The entry has a `type` field of its own. */
  hasType: boolean;
  /** A picture is linked or embedded in it. */
  hasPicture: boolean;
}

const facts = new WeakMap<IndexedNote, NoteFacts>();

/** Headings with no text before the next heading of the same or a higher level. */
function emptyHeadingsOf(note: IndexedNote): string[] {
  const lines = note.text.split("\n");
  const headingLines = new Set(note.headings.map((h) => h.line));
  const out: string[] = [];
  note.headings.forEach((heading, i) => {
    const next = note.headings.slice(i + 1).find((h) => h.level <= heading.level);
    const stop = next ? next.line - 1 : lines.length;
    let text = false;
    for (let at = heading.line; at < stop; at++) {
      if (!headingLines.has(at + 1) && (lines[at] ?? "").trim() !== "") {
        text = true;
        break;
      }
    }
    if (!text) out.push(heading.text);
  });
  return out;
}

/** The to-do marks in a body, leaving out code, where `??` and `TODO` are just characters. */
function marksOf(body: string): string[] {
  let text = body;
  const ranges = codeRanges(body);
  // Blank the code from the end, so earlier positions stay where they are.
  for (const [a, b] of [...ranges].reverse()) text = text.slice(0, a) + " " + text.slice(b);
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(TODO|TBD)\b|\?\?/g)) found.add(m[1] ?? "??");
  return ["TODO", "TBD", "??"].filter((mark) => found.has(mark));
}

export function factsOf(note: IndexedNote): NoteFacts {
  const known = facts.get(note);
  if (known) return known;
  const made: NoteFacts = {
    words: bodyWords(note.text),
    emptyHeadings: emptyHeadingsOf(note),
    marks: marksOf(splitFrontmatter(note.text).body),
    hasType: note.fields.type !== null,
    hasPicture: note.links.some(
      ({ resolution }) => resolution.kind === "file" && isImage(resolution.path),
    ),
  };
  facts.set(note, made);
  return made;
}

/** The entries the work queue may list: no README, no appendix, nothing of Frontier's own. */
export function listable(path: string): boolean {
  return isNote(path) && !isInAppendix(path) && stem(path).toLowerCase() !== "readme";
}

export interface Wanted {
  /** The name as the first link writes it. */
  name: string;
  /** The entries that link to it, once each. */
  sources: Set<string>;
}

export interface Derived {
  generation: number;
  /** Every published note, in the order of the tree. */
  notes: IndexedNote[];
  byPath: Map<string, IndexedNote>;
  /** The notes the work queue may list. */
  entries: IndexedNote[];
  /** The entries that link to each entry, once each. */
  inbound: Map<string, string[]>;
  /** The entries each entry links to, once each, not counting itself. */
  outbound: Map<string, string[]>;
  /** Names that are linked and have no entry, by lower-case name. */
  wanted: Map<string, Wanted>;
  /** The notes of each folder, in the tree's order. */
  siblings: Map<string, string[]>;
  /** Entries linked either way, for each entry; made when first asked. */
  neighbours(path: string): Set<string>;
}

const derivedBy = new WeakMap<VaultIndex, Derived>();

/** The key a wanted name is counted under: its last part, without ".md", letter case aside. */
export function wantedKey(target: string): string {
  return basename(target.trim()).replace(/\.md$/i, "").trim().toLowerCase();
}

export function derive(index: VaultIndex): Derived {
  const known = derivedBy.get(index);
  if (known && known.generation === index.generation) return known;

  const notes = index.allNotes();
  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  const wanted = new Map<string, Wanted>();
  const siblings = new Map<string, string[]>();
  for (const note of notes) {
    const out = new Set<string>();
    for (const { link, resolution } of note.links) {
      if (resolution.kind === "note") {
        if (resolution.path !== note.path) out.add(resolution.path);
      } else if (
        resolution.kind === "unresolved" &&
        link.kind === "wikilink" &&
        !link.embed &&
        !isImage(link.target.trim())
      ) {
        const key = wantedKey(link.target);
        // A link to a heading of the same entry has no name.
        if (key === "") continue;
        const entry = wanted.get(key) ?? {
          name: basename(link.target.trim()).replace(/\.md$/i, "").trim(),
          sources: new Set<string>(),
        };
        entry.sources.add(note.path);
        wanted.set(key, entry);
      }
    }
    outbound.set(note.path, [...out]);
    for (const to of out) {
      const list = inbound.get(to) ?? [];
      list.push(note.path);
      inbound.set(to, list);
    }
    const dir = dirname(note.path);
    const list = siblings.get(dir) ?? [];
    list.push(note.path);
    siblings.set(dir, list);
  }

  const around = new Map<string, Set<string>>();
  const made: Derived = {
    generation: index.generation,
    notes,
    byPath: new Map(notes.map((n) => [n.path, n])),
    entries: notes.filter((n) => listable(n.path)),
    inbound,
    outbound,
    wanted,
    siblings,
    neighbours(path) {
      let set = around.get(path);
      if (!set) {
        set = new Set([...(outbound.get(path) ?? []), ...(inbound.get(path) ?? [])]);
        around.set(path, set);
      }
      return set;
    },
  };
  derivedBy.set(index, made);
  return made;
}

/** The folder most of the given entries are in; null when none is in a folder worth suggesting. */
export function likelyFolder(sources: Iterable<string>): string | null {
  const votes = new Map<string, number>();
  for (const path of sources) {
    const dir = dirname(path);
    if (dir === "" || isInAppendix(path)) continue;
    votes.set(dir, (votes.get(dir) ?? 0) + 1);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? null;
}
