/**
 * Relations the AI read in an entry's text (stage 33), checked before the author sees them. A
 * relation is kept only when its sentence is in the entry, the words that state it are in the
 * sentence and hold the name, and its word is a kind of relation. Who it names is matched to an
 * entry by title, then by another name; with no match, the closest entry is offered. A relation
 * already written, or already proposed from the other entry, is not proposed again: the second
 * reading is added to the first proposal as more evidence.
 */
import { findKind, type RelKind } from "@frontier/schema";
import { readFields, type Schema } from "@frontier/vault";
import { collapse } from "../proposals/store.js";
import { yearOf } from "../relations/collect.js";

export interface ReadRelation {
  what: string;
  who: string;
  with: string | null;
  how: string | null;
  when: string | null;
  quote: string;
  words: string;
  stated: boolean;
}

export interface NamedEntry {
  path: string;
  title: string;
  aliases: string[];
}

export interface RelationOp {
  op: "add_relation";
  what: string;
  who: string;
  whoPath: string | null;
  match: "title" | "alias" | "none";
  maybe: string | null;
  with: string | null;
  withPath: string | null;
  how: string | null;
  when: string | null;
  quote: string;
  words: string;
  stated: boolean;
}

/** A pending relation proposal elsewhere, by its proposal and operation ids. */
export interface PendingRelation {
  proposal: string;
  id: string;
  path: string;
  what: string;
  whoPath: string | null;
  who: string;
  also: { path: string }[];
}

const lower = (s: string) => collapse(s).toLowerCase();
/** "[[Corin Vane|Corin]]" and "Corin Vane" are both "Corin Vane". */
export const plainName = (s: string): string =>
  s
    .replace(
      /\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
      (_m, t: string, shown?: string) => shown ?? t,
    )
    .trim();
const linkTarget = (s: string): string => {
  const m = /\[\[([^\]|#]*)/.exec(s);
  return (m ? m[1]! : s).trim();
};

/** The entry a name means: by title, then by another name, else the closest, if any. */
export function matchName(
  name: string,
  entries: NamedEntry[],
  context: string,
): { path: string | null; match: "title" | "alias" | "none"; maybe: string | null } {
  const wanted = lower(linkTarget(name));
  const shown = lower(plainName(name));
  for (const e of entries) {
    const t = e.title.toLowerCase();
    if (t === wanted || t === shown) return { path: e.path, match: "title", maybe: null };
  }
  for (const e of entries) {
    if (e.aliases.some((a) => [wanted, shown].includes(a.toLowerCase())))
      return { path: e.path, match: "alias", maybe: null };
  }
  // The closest: an entry whose title starts with the name as a first name ("Pell" for "Pell
  // Holt"), best when the rest of its title is in the sentence or the entry ("kept the Holt name").
  const words = shown.split(" ").filter(Boolean);
  if (words.length === 0) return { path: null, match: "none", maybe: null };
  const ctx = context.toLowerCase();
  let best: { path: string; score: number } | null = null;
  for (const e of entries) {
    const t = e.title.toLowerCase().split(/\s+/);
    if (t.length <= words.length || words.some((w, i) => t[i] !== w)) continue;
    const rest = t.slice(words.length);
    const score = 1 + rest.filter((r) => r.length > 2 && ctx.includes(r)).length;
    if (!best || score > best.score) best = { path: e.path, score };
  }
  return { path: null, match: "none", maybe: best?.path ?? null };
}

/** The upper and lower ends of a relation, as the relations reader keys them. */
export function factKey(
  kinds: RelKind[],
  what: string,
  path: string,
  whoKey: string,
): string | null {
  const found = findKind(kinds, what);
  if (!found) return null;
  const { kind, reversed } = found;
  let a: string, b: string;
  if (kind.reverse) [a, b] = reversed ? [path, whoKey] : [whoKey, path];
  else [a, b] = path < whoKey ? [path, whoKey] : [whoKey, path];
  return `${kind.name}|${a}|${b}`;
}

export interface RelationCheckInput {
  path: string;
  body: string;
  read: ReadRelation[];
  kinds: RelKind[];
  entries: NamedEntry[];
  /** The keys of relations already written, on either side (`factKey`). */
  written: Set<string>;
  pending: PendingRelation[];
}

/** The relations worth showing, and the proposals elsewhere that gain this entry as evidence. */
export function checkRelations(input: RelationCheckInput): {
  ops: RelationOp[];
  merges: { proposal: string; op: string; also: { path: string; quote: string; words: string } }[];
} {
  const { path, body, kinds, entries } = input;
  const flat = lower(body);
  const ops: RelationOp[] = [];
  const merges: ReturnType<typeof checkRelations>["merges"] = [];
  const seen = new Set<string>();
  for (const r of input.read) {
    const quote = r.quote.trim();
    const words = r.words.trim();
    const who = r.who.trim();
    if (!quote || !words || !who) continue;
    if (!flat.includes(lower(quote))) continue;
    if (!lower(quote).includes(lower(words))) continue;
    // The marked words hold the name: "daughter of Corin Vane", not "daughter of".
    if (!lower(words).includes(lower(plainName(who)))) continue;
    if (!findKind(kinds, r.what)) continue;
    const m = matchName(
      who,
      entries.filter((e) => e.path !== path),
      `${quote} ${body}`,
    );
    const whoKey = m.path ?? `?${plainName(who)}`;
    const key = factKey(kinds, r.what, path, whoKey);
    if (!key || input.written.has(key) || seen.has(key)) continue;
    seen.add(key);
    // The other entry may have proposed the same relation already: one proposal, two sentences.
    // "Wren" in Corin's text is the "Wren Vane" whose own text proposed it, if that is the closest.
    const nearKey = m.maybe ? factKey(kinds, r.what, path, m.maybe) : null;
    const twin = input.pending.find((p) => {
      if (p.path === path) return false;
      const k = factKey(kinds, p.what, p.path, p.whoPath ?? `?${plainName(p.who)}`);
      return k === key || (nearKey !== null && k === nearKey && p.path === m.maybe);
    });
    if (twin) {
      if (!twin.also.some((a) => a.path === path))
        merges.push({ proposal: twin.proposal, op: twin.id, also: { path, quote, words } });
      continue;
    }
    // "how" and "when" stay only where their own words are in what was marked.
    const inWords = (s: string | null) => (s && lower(words).includes(lower(s)) ? s.trim() : null);
    const withMatch = r.with ? matchName(r.with, entries, quote) : null;
    ops.push({
      op: "add_relation",
      what: r.what.trim(),
      who: plainName(who),
      whoPath: m.path,
      match: m.match,
      maybe: m.maybe,
      with: r.with ? plainName(r.with) : null,
      withPath: withMatch?.path ?? null,
      how: inWords(r.how),
      when: inWords(r.when),
      quote,
      words,
      stated: r.stated,
    });
  }
  return { ops, merges };
}

/** Years of an entry's birth and death, from its dates. */
export function yearsOf(
  text: string,
  schema: Schema,
): { born: number | null; died: number | null } {
  const time = readFields(text).time;
  const pick = (which: "begins" | "ends", first: string) =>
    time.find((t) => t.what === first) ?? time.find((t) => schema.what[t.what]?.[which]);
  return { born: yearOf(pick("begins", "born")?.when), died: yearOf(pick("ends", "died")?.when) };
}

/**
 * What accepting a family relation would break: a child born when a parent was under 14, or a
 * year or more after a parent died. Null when nothing, or when the kind is not a family.
 */
export function relationWarning(
  kinds: RelKind[],
  what: string,
  path: string,
  whoPath: string | null,
  textOf: (path: string) => string | null,
  schema: Schema,
): string | null {
  const found = findKind(kinds, what);
  if (!found?.kind.family || !whoPath) return null;
  const [parent, child] = found.reversed ? [path, whoPath] : [whoPath, path];
  const pt = textOf(parent);
  const ct = textOf(child);
  if (pt === null || ct === null) return null;
  const p = yearsOf(pt, schema);
  const c = yearsOf(ct, schema);
  const name = (x: string) => x.split("/").pop()!.replace(/\.md$/i, "");
  if (c.born === null) return null;
  if (p.born !== null && c.born - p.born < 14)
    return `${name(child)} was born in ${c.born}, when ${name(parent)} was ${c.born - p.born}.`;
  if (p.died !== null && c.born > p.died + 1)
    return `${name(child)} was born in ${c.born}, ${c.born - p.died} years after ${name(parent)} died.`;
  return null;
}
