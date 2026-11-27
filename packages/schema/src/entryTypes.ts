/**
 * The types file, `.frontier/types.json` (stage 34): what an entry can be, the properties each
 * type gives its entries, the dates a type usually has, and the names a date can carry. A type is
 * a template: its entries show its properties as fields, empty until filled, and a value the type
 * gives holds for every entry that has not set its own. Nothing of a type is copied into entries.
 */
import { z } from "zod";
import {
  type LibraryFileKind,
  mergeLibraryFile,
  type ParsedLibraryFile,
  parseLibraryFile,
  serialiseLibraryFile,
} from "./libraryFiles.js";

export const TYPES_FILE = ".frontier/types.json";

/** The kinds a type's property can be: the kinds an entry's own property has, and a choice. */
export const TYPE_PROP_KINDS = [
  "text",
  "number",
  "date",
  "checkbox",
  "list",
  "choice",
  "link",
  "map",
  "chronicle",
  "tree",
] as const;
export type TypePropKind = (typeof TYPE_PROP_KINDS)[number];

/** What each kind is called in the app. */
export const TYPE_PROP_KIND_NAMES: Record<TypePropKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  list: "List of text",
  choice: "One of a few choices",
  link: "Link to an entry",
  map: "Link to a map",
  chronicle: "Link to a chronicle",
  tree: "Link to a tree",
};

/** A type's name, as the folder file writes it: one word. */
export const TypeName = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[^\s/:]+$/, "A type is one word.");

/** A property's name: a key of the frontmatter, one line. */
export const PropKey = z
  .string()
  .min(1)
  .max(100)
  .refine((k) => k.trim() === k && !/[\n\r]/.test(k), "A property's name is one line.");

export const TypeProp = z
  .object({
    key: PropKey,
    kind: z.enum(TYPE_PROP_KINDS),
    /** For a link: the type of entry it usually points at, offered first when choosing. */
    to: TypeName.optional(),
    /** For a choice: what can be chosen. */
    options: z.array(z.string().min(1).max(100)).max(50).optional(),
    /** The value every entry of the type has unless it sets its own. */
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  })
  .passthrough();
export type TypeProp = z.infer<typeof TypeProp>;

export const TypeLine = z
  .object({
    name: TypeName,
    props: z.array(TypeProp).max(60),
    /** The names of the dates an entry of this type usually has, offered ready to fill. */
    dates: z.array(z.string().min(1).max(60)).max(20),
  })
  .passthrough();
export type TypeLine = z.infer<typeof TypeLine>;

/** A name a date can carry, and whether it is where the entry's span starts or ends. */
export const DateName = z
  .object({
    name: z.string().min(1).max(60),
    begins: z.literal(true).optional(),
    ends: z.literal(true).optional(),
  })
  .passthrough();
export type DateName = z.infer<typeof DateName>;

const lower = (s: string) => s.toLowerCase();

export const TypesFile = z
  .object({
    version: z.literal(1),
    types: z.array(TypeLine).max(200),
    what: z.array(DateName).max(200),
  })
  .passthrough()
  .superRefine((file, ctx) => {
    const names = new Set<string>();
    for (const t of file.types) {
      if (names.has(lower(t.name)))
        ctx.addIssue({ code: "custom", message: `Two types are called “${t.name}”.` });
      names.add(lower(t.name));
      const keys = new Set<string>();
      for (const p of t.props) {
        if (keys.has(lower(p.key)))
          ctx.addIssue({
            code: "custom",
            message: `The type “${t.name}” has two properties called “${p.key}”.`,
          });
        keys.add(lower(p.key));
        if (RESERVED_KEYS.includes(lower(p.key)))
          ctx.addIssue({ code: "custom", message: `“${p.key}” has a field of its own.` });
        const system = SYSTEM_PROPS[lower(p.key)];
        if (system && p.kind !== system.kind)
          ctx.addIssue({ code: "custom", message: `“${p.key}” is always a ${system.kind}.` });
      }
    }
    const dates = new Set<string>();
    for (const d of file.what) {
      if (dates.has(lower(d.name)))
        ctx.addIssue({ code: "custom", message: `Two dates are called “${d.name}”.` });
      dates.add(lower(d.name));
    }
  });
export type TypesFile = z.infer<typeof TypesFile>;

/** Keys of the frontmatter with fields of their own; a type cannot give them. */
const RESERVED_KEYS = ["id", "type", "time", "aliases", "tags", "relations"];

/**
 * Properties that mean something to Frontier, by their key. An entry is `chattable` when its own
 * value says so, or else when its type gives it.
 */
export const SYSTEM_PROPS: Record<string, { kind: TypePropKind; label: string; hint: string }> = {
  chattable: {
    kind: "checkbox",
    label: "Can be talked with",
    hint: "Readers can talk with the entry as a character. An entry can switch it off.",
  },
};

/** The types that are chattable when a library first gets a types file, as the app always did. */
export const CHATTABLE_AT_FIRST = ["person", "deity"];

/** The types file's entry in the table of library files. */
export const TYPES: LibraryFileKind<TypesFile> = {
  name: "types",
  path: TYPES_FILE,
  label: "Types and dates",
  noun: "types",
  schema: TypesFile,
  list: "types",
  topKeys: ["version", "types", "what"],
  itemKeys: ["name", "props", "dates"],
  key: (item) => (item as TypeLine).name,
  conflict: "types_changed_on_both",
  empty: () => ({ version: 1, types: [], what: [] }),
};

export const parseTypes = (text: string): ParsedLibraryFile<TypesFile> =>
  parseLibraryFile(TYPES, text);
export const serialiseTypes = (file: TypesFile): string => serialiseLibraryFile(TYPES, file);
export const mergeTypes = (
  base: TypesFile,
  mine: TypesFile,
  theirs: TypesFile,
): { file: TypesFile; clashes: string[] } => mergeLibraryFile(TYPES, base, mine, theirs);

/** The types file a library starts with, from the names its schema had. */
export function typesFromNames(
  types: string[],
  what: { name: string; begins?: boolean; ends?: boolean }[],
): TypesFile {
  return {
    version: 1,
    types: types.map((name) => ({
      name,
      props: CHATTABLE_AT_FIRST.includes(name)
        ? [{ key: "chattable", kind: "checkbox" as const, value: true }]
        : [],
      dates: [],
    })),
    what: what.map((w) => ({
      name: w.name,
      ...(w.begins ? { begins: true as const } : {}),
      ...(w.ends ? { ends: true as const } : {}),
    })),
  };
}

/** The type with this name, letter case aside, or undefined. */
export const typeNamed = (file: TypesFile, name: string | null): TypeLine | undefined =>
  name === null ? undefined : file.types.find((t) => lower(t.name) === lower(name));

/** The value of a key in an entry's frontmatter, letter case of the key aside. */
function own(data: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!data) return undefined;
  for (const [k, v] of Object.entries(data)) if (lower(k) === lower(key)) return v;
  return undefined;
}

/**
 * Whether readers can talk with an entry: what the entry itself says, or else what its type
 * gives. `data` is the entry's frontmatter.
 */
export function isChattable(
  type: TypeLine | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  const mine = own(data, "chattable");
  if (typeof mine === "boolean") return mine;
  return type?.props.find((p) => lower(p.key) === "chattable")?.value === true;
}

/** One of a type's properties as an entry has it. */
export interface GivenProp {
  prop: TypeProp;
  /** The entry's own value, when it wrote one that is not empty. */
  own: unknown;
  /** The value in use: the entry's own, or else the type's. */
  value: unknown;
  /** True when the value in use is the type's. */
  fromType: boolean;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** A type's properties with an entry's values: the entry's own where it set one. */
export function givenProps(
  type: TypeLine | undefined,
  data: Record<string, unknown> | null | undefined,
): GivenProp[] {
  return (type?.props ?? []).map((prop) => {
    const mine = own(data, prop.key);
    // A checkbox an entry wrote, on or off, is its own; any other empty value is no value.
    const set = prop.kind === "checkbox" ? typeof mine === "boolean" : !isEmpty(mine);
    return {
      prop,
      own: set ? mine : undefined,
      value: set ? mine : prop.value,
      fromType: !set && prop.value !== undefined,
    };
  });
}

/** The types file with a type renamed: its line, and the links of other types that point at it. */
export function renameTypeIn(file: TypesFile, from: string, to: string): TypesFile {
  return {
    ...file,
    types: file.types.map((t) => ({
      ...t,
      ...(lower(t.name) === lower(from) ? { name: to } : {}),
      props: t.props.map((p) => (p.to && lower(p.to) === lower(from) ? { ...p, to } : p)),
    })),
  };
}

/** The types file with a date name renamed: the name, and each type's usual dates. */
export function renameDateIn(file: TypesFile, from: string, to: string): TypesFile {
  return {
    ...file,
    types: file.types.map((t) => ({ ...t, dates: t.dates.map((d) => (d === from ? to : d)) })),
    what: file.what.map((w) => (w.name === from ? { ...w, name: to } : w)),
  };
}
