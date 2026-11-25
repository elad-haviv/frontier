/**
 * "From here" at the foot of an entry: what it links to that has no entry, who names it without
 * linking, which neighbours need love, which entries are related, and the entries either side of
 * it in its folder.
 */
import {
  type EntryRef,
  type FromHereResponse,
  type NeedsLoveRules,
  type RelatedEntry,
  type ThinNeighbour,
} from "@frontier/schema";
import { dirname } from "@frontier/vault";
import type { IndexedNote, VaultIndex } from "../index/build.js";
import { type Derived, factsOf, listable, wantedKey } from "./derived.js";
import { reasonsFor, wantedRow } from "./queue.js";

const RELATED = 6;
const THIN = 10;

const ref = (n: IndexedNote): EntryRef => ({ path: n.path, title: n.title });

export function fromHereParts(
  index: VaultIndex,
  d: Derived,
  note: IndexedNote,
  rules: NeedsLoveRules,
  comments: ReadonlyMap<string, number>,
): Pick<FromHereResponse, "missing" | "thin" | "related" | "previous" | "next"> {
  const missing = new Map<string, ReturnType<typeof wantedRow>>();
  for (const { link, resolution } of note.links) {
    if (resolution.kind !== "unresolved" || link.kind !== "wikilink" || link.embed) continue;
    const wanted = d.wanted.get(wantedKey(link.target));
    if (wanted && !missing.has(wantedKey(link.target))) {
      missing.set(wantedKey(link.target), wantedRow(d, wanted));
    }
  }

  const outbound = new Set(d.outbound.get(note.path) ?? []);
  const inbound = new Set(d.inbound.get(note.path) ?? []);
  const thin: ThinNeighbour[] = [];
  for (const path of d.neighbours(note.path)) {
    const other = index.note(path);
    if (!other || !listable(path)) continue;
    const reasons = reasonsFor(d, other, rules, comments);
    if (reasons.length === 0) continue;
    thin.push({
      path,
      title: other.title,
      words: factsOf(other).words,
      reasons,
      direction:
        outbound.has(path) && inbound.has(path)
          ? "both"
          : outbound.has(path)
            ? "links"
            : "linkedFrom",
    });
  }
  thin.sort(
    (a, b) =>
      (d.inbound.get(b.path)?.length ?? 0) - (d.inbound.get(a.path)?.length ?? 0) ||
      b.reasons.length - a.reasons.length ||
      a.title.localeCompare(b.title),
  );

  // Entries that share links with this one: count, for each, the entries both are linked with.
  const mine = d.neighbours(note.path);
  const shared = new Map<string, number>();
  for (const between of mine) {
    for (const other of d.neighbours(between)) {
      if (other === note.path || mine.has(other) || !listable(other)) continue;
      shared.set(other, (shared.get(other) ?? 0) + 1);
    }
  }
  const related: RelatedEntry[] = [...shared]
    .map(([path, n]) => ({ path, title: index.note(path)?.title ?? path, shared: n }))
    .sort((a, b) => b.shared - a.shared || a.title.localeCompare(b.title))
    .slice(0, RELATED);

  const folder = d.siblings.get(dirname(note.path)) ?? [];
  const at = folder.indexOf(note.path);
  const around = (path: string | undefined): EntryRef | null => {
    const other = path ? index.note(path) : undefined;
    return other ? ref(other) : null;
  };
  return {
    missing: [...missing.values()].sort(
      (a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name),
    ),
    thin: thin.slice(0, THIN),
    related,
    previous: around(at > 0 ? folder[at - 1] : undefined),
    next: around(at >= 0 ? folder[at + 1] : undefined),
  };
}
