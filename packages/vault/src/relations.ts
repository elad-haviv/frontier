/**
 * An entry's relations (stage 29): who it is related to and how, as readable text in the
 * frontmatter, beside its dates. Each item names a kind (`what`) and an entry (`who`, usually a
 * wikilink), with an optional other parent (`with`), manner (`how`) and time (`when`). Nothing
 * here knows the kinds; the reader of the index does.
 */
import { Scalar } from "yaml";
import { readFrontmatter, removeFrontmatterKey, setFrontmatterKey } from "./frontmatter.js";

export interface RelationItem {
  what: string;
  who: string;
  with?: string;
  how?: string;
  when?: string;
  /** Other keys the item carries. They are kept as they are and not read. */
  extra?: Record<string, unknown>;
}

export interface Relations {
  items: RelationItem[];
  /** Values that are present and cannot be read, in words for the author. */
  problems: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const OWN = ["what", "who", "with", "how", "when"];

/** A value that may be text: a string, or a number or flag written bare. */
function textOf(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() === "" ? undefined : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/**
 * A `who` written as `[[Name]]` in YAML without quotes reads as a list holding a list holding the
 * name. It is taken back to the link it was meant to be.
 */
function linkOf(v: unknown): string | undefined {
  if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1) {
    const inner = textOf(v[0][0]);
    return inner ? `[[${inner}]]` : undefined;
  }
  return textOf(v);
}

/** Reads the `relations` list. Never throws: what cannot be read is listed in `problems`. */
export function readRelations(text: string): Relations {
  const out: Relations = { items: [], problems: [] };
  const { data } = readFrontmatter(text);
  const list = data?.["relations"];
  if (list === undefined || list === null) return out;
  if (!Array.isArray(list)) {
    out.problems.push("`relations` is not a list.");
    return out;
  }
  list.forEach((item, i) => {
    const what = isRecord(item) ? textOf(item["what"]) : undefined;
    const who = isRecord(item) ? linkOf(item["who"]) : undefined;
    if (!isRecord(item) || !what) {
      out.problems.push(`Item ${i + 1} of \`relations\` has no \`what\`.`);
      return;
    }
    if (!who) {
      out.problems.push(`Item ${i + 1} of \`relations\` has no \`who\`.`);
      return;
    }
    const extra = Object.fromEntries(Object.entries(item).filter(([k]) => !OWN.includes(k)));
    const withWho = linkOf(item["with"]);
    const how = textOf(item["how"]);
    const when = textOf(item["when"]);
    out.items.push({
      what,
      who,
      ...(withWho ? { with: withWho } : {}),
      ...(how ? { how } : {}),
      ...(when ? { when } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    });
  });
  return out;
}

const quoted = (s: string) => {
  const q = new Scalar(s);
  q.type = Scalar.QUOTE_DOUBLE;
  return q;
};

/**
 * Writes the `relations` list in one standard form: `what`, `who`, then `with`, `how` and `when`,
 * then the item's other keys; links and times in double quotes. No line outside the key changes.
 * An empty list removes the key. Callers refuse to write while `readRelations` reports a problem.
 */
export function setRelations(text: string, items: RelationItem[]): string {
  if (items.length === 0) return removeFrontmatterKey(text, "relations");
  return setFrontmatterKey(
    text,
    "relations",
    items.map((i) => ({
      what: i.what,
      who: quoted(i.who),
      ...(i.with ? { with: quoted(i.with) } : {}),
      ...(i.how ? { how: i.how } : {}),
      ...(i.when ? { when: quoted(i.when) } : {}),
      ...i.extra,
    })),
  );
}
