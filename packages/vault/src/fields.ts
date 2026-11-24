/**
 * Structured fields of an entry: its id, its type and its dates. They live in the frontmatter as
 * readable text. A date is kept exactly as the lore words it; nothing here reads it as a number.
 */
import { parse, Scalar } from "yaml";
import { readFrontmatter, removeFrontmatterKey, setFrontmatterKey } from "./frontmatter.js";

export interface TimeItem {
  what: string;
  when: string;
  /** Other keys the item carries. They are kept as they are and not read. */
  extra?: Record<string, unknown>;
}

export interface Fields {
  id: string | null;
  /** The `type` key as written, or null. */
  type: string | null;
  time: TimeItem[];
  /** Values that are present and cannot be read, in words for the author. */
  problems: string[];
}

export interface Schema {
  version: number;
  types: Record<string, { folders: string[] }>;
  what: Record<string, { begins?: boolean; ends?: boolean }>;
}

export const BUILT_IN_SCHEMA_TEXT = `version: 1
types:
  place: { folders: ["03 Gazetteer (Places & Locations)"] }
  person: { folders: ["04 Inhabitants/Notable Individuals"] }
  deity: { folders: ["04 Inhabitants/Deities", "04 Inhabitants/Archdemons"] }
  people: { folders: ["04 Inhabitants/Sapient Races"] }
  creature: { folders: ["04 Inhabitants/Creatures & Beastiary"] }
  group: { folders: ["05 Society & Culture"] }
  item: { folders: ["06 Compendium (Items & Mechanics)"] }
  event: { folders: ["02 History & Lore"] }
  concept: { folders: ["01 Universe & Concepts", "00 Overview"] }
what:
  born: { begins: true }
  founded: { begins: true }
  created: { begins: true }
  began: { begins: true }
  died: { ends: true }
  destroyed: { ends: true }
  ended: { ends: true }
  happened: {}
  changed: {}
`;

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a schema file. Throws SchemaError with the reason when it does not have the expected form. */
export function parseSchema(text: string): Schema {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new SchemaError(err instanceof Error ? err.message : "Invalid YAML");
  }
  if (!isRecord(raw)) throw new SchemaError("The schema is not a list of keys.");
  if (typeof raw["version"] !== "number")
    throw new SchemaError("The schema has no version number.");
  const types: Schema["types"] = {};
  if (raw["types"] !== undefined && !isRecord(raw["types"])) {
    throw new SchemaError("`types` is not a list of names.");
  }
  for (const [name, value] of Object.entries((raw["types"] as Record<string, unknown>) ?? {})) {
    const folders = isRecord(value) ? value["folders"] : undefined;
    if (
      folders !== undefined &&
      !(Array.isArray(folders) && folders.every((f) => typeof f === "string"))
    ) {
      throw new SchemaError(`The folders of type "${name}" are not a list of paths.`);
    }
    types[name] = { folders: (folders as string[] | undefined) ?? [] };
  }
  if (!isRecord(raw["what"])) throw new SchemaError("`what` is missing or not a list of names.");
  const what: Schema["what"] = {};
  for (const [name, value] of Object.entries(raw["what"])) {
    const v = isRecord(value) ? value : {};
    what[name] = {
      ...(v["begins"] === true ? { begins: true } : {}),
      ...(v["ends"] === true ? { ends: true } : {}),
    };
  }
  return { version: raw["version"], types, what };
}

export const BUILT_IN_SCHEMA: Schema = parseSchema(BUILT_IN_SCHEMA_TEXT);

/** The type whose folder is the longest match for the path, or null. Letter case is ignored. */
export function typeFromFolder(schema: Schema, path: string): string | null {
  const lower = path.toLowerCase();
  let best: { name: string; length: number } | null = null;
  for (const [name, { folders }] of Object.entries(schema.types)) {
    for (const folder of folders) {
      const prefix = folder.toLowerCase().replace(/\/+$/, "") + "/";
      if (lower.startsWith(prefix) && (!best || prefix.length > best.length)) {
        best = { name, length: prefix.length };
      }
    }
  }
  return best?.name ?? null;
}

export const ENTRY_ID = /^[a-z0-9]{8}$/;

/** Reads the structured fields. Never throws: what cannot be read is listed in `problems`. */
export function readFields(text: string): Fields {
  const out: Fields = { id: null, type: null, time: [], problems: [] };
  const { data, error } = readFrontmatter(text);
  if (error) out.problems.push("The properties block cannot be read.");
  if (!data) return out;

  const id = data["id"];
  if (typeof id === "string" && ENTRY_ID.test(id)) out.id = id;
  else if (id !== undefined && id !== null) out.problems.push("`id` is not 8 letters and digits.");

  const type = data["type"];
  if (typeof type === "string" && type.trim() !== "") out.type = type.trim();
  else if (type !== undefined && type !== null) out.problems.push("`type` is not a name.");

  const time = data["time"];
  if (time !== undefined && time !== null) {
    if (!Array.isArray(time)) {
      out.problems.push("`time` is not a list.");
    } else {
      time.forEach((item, i) => {
        if (!isRecord(item) || typeof item["what"] !== "string" || item["what"].trim() === "") {
          out.problems.push(`Item ${i + 1} of \`time\` has no \`what\`.`);
          return;
        }
        const when = item["when"];
        if (when === undefined || when === null || typeof when === "object") {
          out.problems.push(`Item ${i + 1} of \`time\` has no \`when\`.`);
          return;
        }
        const extra = Object.fromEntries(
          Object.entries(item).filter(([k]) => k !== "what" && k !== "when"),
        );
        out.time.push({
          what: item["what"].trim(),
          // A bare number such as `when: 340` is kept as the text "340".
          when: String(when),
          ...(Object.keys(extra).length > 0 ? { extra } : {}),
        });
      });
    }
  }
  return out;
}

/**
 * Writes the `time` list in one standard form: `what`, then `when` in double quotes, then the
 * item's other keys. No line outside the `time` key changes. An empty list removes the key.
 * Items the reader could not read are not written back, so callers refuse to write while
 * `readFields` reports a problem with `time`.
 */
export function setTime(text: string, items: TimeItem[]): string {
  if (items.length === 0) return removeFrontmatterKey(text, "time");
  return setFrontmatterKey(
    text,
    "time",
    items.map((i) => {
      const when = new Scalar(i.when);
      when.type = Scalar.QUOTE_DOUBLE;
      return { what: i.what, when, ...i.extra };
    }),
  );
}

/** Writes or removes the `type` key, changing no other key. */
export function setType(text: string, type: string | null): string {
  return type ? setFrontmatterKey(text, "type", type) : removeFrontmatterKey(text, "type");
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Makes an entry id of 8 characters. The caller supplies the random bytes. */
export function makeEntryId(random: (bytes: number) => Uint8Array): string {
  let out = "";
  while (out.length < 8) {
    for (const byte of random(8)) {
      if (byte < 252 && out.length < 8) out += ALPHABET[byte % 36];
    }
  }
  return out;
}
