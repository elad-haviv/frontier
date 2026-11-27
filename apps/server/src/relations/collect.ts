/**
 * Gathers every entry's relations into one list of facts (stage 29). Each entry's own text is
 * read, its draft's when it has one, so a relation added a moment ago is in the tree at once.
 * A fact written on both entries (`child: Nessa` on Wren, `parent: Wren` on Nessa) becomes one
 * fact with two sources; if the two disagree on `how` or `when`, the fact says so.
 */
import {
  findKind,
  type RelFact,
  type RelKind,
  type RelationsResponse,
  type RelPerson,
  type RelSource,
} from "@frontier/schema";
import {
  createResolver,
  findLinks,
  readFields,
  readRelations,
  type Schema,
  stem,
  typeFromFolder,
} from "@frontier/vault";

export interface CollectInput {
  /** Each entry's path and its text as the author sees it (a draft's, when there is one). */
  notes: { path: string; text: string }[];
  /** Every file in the library, drafts' new files included, for resolving links. */
  files: string[];
  schema: Schema;
  kinds: RelKind[];
}

/** The first whole number in a date as written ("c. 340 EM" is 340, "-50" is -50), or null. */
export function yearOf(when: string | undefined): number | null {
  if (!when) return null;
  const m = /(^|[^\w-])(-?\d{1,6})(?![\w])/.exec(when);
  return m ? Number(m[2]) : null;
}

function datesOf(text: string, schema: Schema) {
  const time = readFields(text).time;
  const pick = (which: "begins" | "ends", first: string) =>
    time.find((t) => t.what === first) ?? time.find((t) => schema.what[t.what]?.[which]);
  const b = pick("begins", "born")?.when;
  const d = pick("ends", "died")?.when;
  const short = (w: string) => {
    const y = yearOf(w);
    if (y !== null && w.replace(/\[\[|\]\]/g, "").length > 12) return String(y);
    return w.replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1");
  };
  const dates = b && d ? `${short(b)} – ${short(d)}` : b ? `b. ${short(b)}` : d ? `d. ${short(d)}` : null;
  return { born: yearOf(b), died: yearOf(d), dates };
}

export function collectRelations(input: CollectInput): RelationsResponse {
  const { notes, schema, kinds } = input;
  const resolver = createResolver(input.files);
  const people = new Map<string, RelPerson>();
  const texts = new Map(notes.map((n) => [n.path, n.text]));

  const person = (key: string): void => {
    if (people.has(key)) return;
    if (key.startsWith("?")) {
      people.set(key, { key, title: key.slice(1), path: null, type: null, born: null, died: null, dates: null });
      return;
    }
    const text = texts.get(key) ?? "";
    const fields = readFields(text);
    people.set(key, {
      key,
      title: stem(key),
      path: key,
      type: fields.type ?? typeFromFolder(schema, key),
      ...datesOf(text, schema),
    });
  };

  /** The entry a `who` names: its path, or "?" and the name when there is no such entry. */
  const keyOf = (who: string, from: string): string | null => {
    const written = who.includes("[[") ? who : `[[${who}]]`;
    const link = findLinks(written)[0];
    if (!link || link.target.trim() === "") return null;
    const r = resolver.resolve(link, from);
    if (r.kind === "note") return r.path;
    if (r.kind === "ambiguous") return `?${link.target}`;
    return `?${stem(link.target)}`;
  };

  const facts = new Map<string, RelFact & { seen: { how: string | null; when: string | null }[] }>();
  const unknown: RelationsResponse["unknown"] = [];

  for (const { path, text } of notes) {
    const { items } = readRelations(text);
    items.forEach((item, index) => {
      const found = findKind(kinds, item.what);
      if (!found) {
        unknown.push({ path, index, word: item.what });
        return;
      }
      const other = keyOf(item.who, path);
      if (!other || other === path) return;
      const withKey = item.with ? keyOf(item.with, path) : null;
      const { kind, reversed } = found;
      let a: string, b: string;
      if (kind.reverse) {
        // "parent: X" on me: X is above me. "child: X" on me: I am above X.
        [a, b] = reversed ? [path, other] : [other, path];
      } else {
        [a, b] = path < other ? [path, other] : [other, path];
      }
      person(a);
      person(b);
      if (withKey && withKey !== a && withKey !== b) person(withKey);
      const id = `${kind.name}|${a}|${b}`;
      const source: RelSource = { path, index, word: item.what };
      const how = item.how ?? null;
      const when = item.when ?? null;
      const known = facts.get(id);
      if (!known) {
        facts.set(id, {
          kind: kind.name,
          a,
          b,
          with: withKey && withKey !== a && withKey !== b ? withKey : null,
          how,
          when,
          sources: [source],
          disagree: null,
          seen: [{ how, when }],
        });
        return;
      }
      known.sources.push(source);
      known.seen.push({ how, when });
      known.how ??= how;
      known.when ??= when;
      if (!known.with && withKey && withKey !== a && withKey !== b) known.with = withKey;
    });
  }

  const out: RelFact[] = [];
  for (const { seen, ...fact } of facts.values()) {
    const hows = new Set(seen.map((s) => s.how).filter(Boolean));
    const whens = new Set(seen.map((s) => s.when).filter(Boolean));
    const names = fact.sources.map((s) => stem(s.path));
    if (hows.size > 1) fact.disagree = `${names[0]} and ${names[1]} say it differently: ${[...hows].join(" / ")}.`;
    else if (whens.size > 1)
      fact.disagree = `${names[0]} and ${names[1]} give different times: ${[...whens].join(" / ")}.`;
    else if (fact.sources.length > 1 && seen.some((s) => s.how) && seen.some((s) => !s.how))
      fact.disagree = `Only one of ${names[0]} and ${names[1]} says it is ${[...hows][0]}.`;
    out.push(fact);
  }
  return {
    kinds,
    people: [...people.values()].sort((x, y) => x.title.localeCompare(y.title)),
    facts: out,
    unknown,
  };
}
