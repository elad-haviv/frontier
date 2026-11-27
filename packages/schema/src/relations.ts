/**
 * Relations between entries and the trees that draw them (stage 29). The relations themselves
 * are written on the entries (`relations:` in the frontmatter); this file holds the kinds of
 * relation, the trees file (`.frontier/trees.json`, one saved view per line) and the shape of
 * `/api/relations`, which gathers every entry's relations into one list of facts.
 */
import { z } from "zod";
import type { LibraryFileKind, ParsedLibraryFile } from "./libraryFiles.js";
import { mergeLibraryFile, parseLibraryFile, serialiseLibraryFile } from "./libraryFiles.js";
import { VaultPath } from "./state.js";

const Word = z.string().trim().min(1).max(40);

/**
 * A kind of relation. With `reverse` it is above and below: the word is written on the lower
 * entry and names the upper one ("parent: Corin" on Wren), the reverse on the upper ("child:
 * Wren" on Corin). Without it, it reads the same both ways ("partner", "rival").
 */
export const RelKind = z
  .object({
    name: Word,
    reverse: Word.optional(),
    /** Other words for the kind, written on the same side ("mother", "father"). */
    also: z.array(Word).optional(),
    /** Other words for the reverse ("son", "daughter"). */
    reverseAlso: z.array(Word).optional(),
    /** Drawn as a family: partners side by side, children hanging from the couple. */
    family: z.boolean().optional(),
    /** Drawn as a couple beside each other in a family. */
    couple: z.boolean().optional(),
  })
  .passthrough();
export type RelKind = z.infer<typeof RelKind>;

export const BUILT_IN_KINDS: RelKind[] = [
  {
    name: "parent",
    reverse: "child",
    also: ["mother", "father"],
    reverseAlso: ["son", "daughter"],
    family: true,
  },
  { name: "partner", also: ["wife", "husband", "consort", "spouse"], couple: true },
  { name: "descends from", reverse: "gave rise to" },
  { name: "serves", reverse: "served by", also: ["reports to", "vassal of"] },
  { name: "rival", also: ["enemy"] },
];

/** The kinds in use: the built-in ones, then the ones the author made, each name once. */
export function kindsOf(made: RelKind[] | undefined): RelKind[] {
  const out = [...BUILT_IN_KINDS];
  for (const k of made ?? []) {
    if (!wordIn(out, k.name) && !(k.reverse && wordIn(out, k.reverse))) out.push(k);
  }
  return out;
}

function wordIn(kinds: RelKind[], word: string) {
  return findKind(kinds, word) !== null;
}

/** Which kind a written word is, and whether it is the kind's reverse. Letter case is ignored. */
export function findKind(
  kinds: RelKind[],
  word: string,
): { kind: RelKind; reversed: boolean } | null {
  const w = word.trim().toLowerCase();
  for (const kind of kinds) {
    if (kind.name.toLowerCase() === w || kind.also?.some((a) => a.toLowerCase() === w))
      return { kind, reversed: false };
    if (
      kind.reverse &&
      (kind.reverse.toLowerCase() === w || kind.reverseAlso?.some((a) => a.toLowerCase() === w))
    )
      return { kind, reversed: true };
  }
  return null;
}

export const isAboveBelow = (k: RelKind): boolean => k.reverse !== undefined;

// ---------- The trees file ----------

export const TREES_FILE = ".frontier/trees.json";
const TreeId = z.string().regex(/^[a-z0-9]{8}$/);

/** What a tree looks like, chosen in the New tree dialog. */
export const TreeLook = z.enum(["family", "descent", "hierarchy", "other"]);
export type TreeLook = z.infer<typeof TreeLook>;

export const TreeLine = z
  .object({
    id: TreeId,
    name: z.string().trim().min(1).max(120),
    /** The kind of relation that builds it, by name. */
    kind: Word,
    look: TreeLook,
    /** The entry it starts from. */
    start: VaultPath,
    /** Descendants of the start, or the ancestors of `from`. */
    way: z.enum(["down", "up"]).optional(),
    from: VaultPath.optional(),
    /** Down the page, or across it. */
    dir: z.enum(["down", "right"]),
    /** How many generations show before the rest is folded; absent for all. */
    gens: z.number().int().min(1).max(30).optional(),
    /** Kinds drawn over the tree as lines, such as "rival". */
    show: z.array(Word).optional(),
    /** Entries whose branch is folded, and entries opened past `gens`. */
    folded: z.array(VaultPath).optional(),
    opened: z.array(VaultPath).optional(),
  })
  .passthrough();
export type TreeLine = z.infer<typeof TreeLine>;

export const TreesFile = z
  .object({
    version: z.literal(1),
    trees: z.array(TreeLine),
    /** Kinds of relation the author made, beside the built-in ones. */
    kinds: z.array(RelKind).optional(),
    /** Checks the author said are right, as "check|entry|other entry". */
    fine: z.array(z.string()).optional(),
  })
  .passthrough()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const t of file.trees) {
      if (seen.has(t.id))
        ctx.addIssue({ code: "custom", message: `Two trees have the id ${t.id}.` });
      seen.add(t.id);
    }
  });
export type TreesFile = z.infer<typeof TreesFile>;

const moved = (p: string, from: string, to: string) =>
  p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p;

/** The trees file after a rename of an entry or a folder. */
export function renameInTrees(file: TreesFile, from: string, to: string): TreesFile {
  const m = (p: string) => moved(p, from, to);
  return {
    ...file,
    trees: file.trees.map((t) => ({
      ...t,
      start: m(t.start),
      ...(t.from ? { from: m(t.from) } : {}),
      ...(t.folded ? { folded: t.folded.map(m) } : {}),
      ...(t.opened ? { opened: t.opened.map(m) } : {}),
    })),
    ...(file.fine
      ? {
          fine: file.fine.map((f) =>
            f
              .split("|")
              .map((part, i) => (i === 0 ? part : m(part)))
              .join("|"),
          ),
        }
      : {}),
  };
}

export const TREES: LibraryFileKind<TreesFile> = {
  name: "trees",
  path: TREES_FILE,
  label: "Trees",
  noun: "trees",
  schema: TreesFile,
  list: "trees",
  topKeys: ["version", "trees", "kinds", "fine"],
  itemKeys: [
    "id",
    "name",
    "kind",
    "look",
    "start",
    "way",
    "from",
    "dir",
    "gens",
    "show",
    "folded",
    "opened",
  ],
  key: (item) => (item as TreeLine).id,
  conflict: "trees_changed_on_both",
  empty: () => ({ version: 1, trees: [] }),
  follow: (file, from, to) => renameInTrees(file, from, to),
};

export const parseTrees = (text: string): ParsedLibraryFile<TreesFile> =>
  parseLibraryFile(TREES, text);
export const serialiseTrees = (file: TreesFile): string => serialiseLibraryFile(TREES, file);
export const mergeTrees = (
  base: TreesFile,
  mine: TreesFile,
  theirs: TreesFile,
): { file: TreesFile; clashes: string[] } => mergeLibraryFile(TREES, base, mine, theirs);

// ---------- /api/relations ----------

/**
 * Someone or something a relation names. `key` is the entry's path, or "?" and the name for a
 * name with no entry yet.
 */
export const RelPerson = z.object({
  key: z.string(),
  title: z.string(),
  path: VaultPath.nullable(),
  type: z.string().nullable(),
  /** Years read from the entry's beginning and ending dates, when they hold a number. */
  born: z.number().nullable(),
  died: z.number().nullable(),
  /** The dates as written, for the card: "212 – 281". */
  dates: z.string().nullable(),
});
export type RelPerson = z.infer<typeof RelPerson>;

/** Where a fact is written: the entry and the item's place in its `relations` list. */
export const RelSource = z.object({
  path: VaultPath,
  index: z.number().int().min(0),
  word: z.string(),
});
export type RelSource = z.infer<typeof RelSource>;

/**
 * One relation, as Frontier reads it from either side. For a kind with a reverse, `a` is the
 * upper one (the parent) and `b` the lower (the child); otherwise the order means nothing.
 */
export const RelFact = z.object({
  kind: z.string(),
  a: z.string(),
  b: z.string(),
  /** The other parent, when the child was written with one. */
  with: z.string().nullable(),
  how: z.string().nullable(),
  when: z.string().nullable(),
  sources: z.array(RelSource).min(1),
  /** Set when the entries that write it disagree on `how` or `when`, in words. */
  disagree: z.string().nullable(),
});
export type RelFact = z.infer<typeof RelFact>;

export const RelationsResponse = z.object({
  kinds: z.array(RelKind),
  people: z.array(RelPerson),
  facts: z.array(RelFact),
  /** Words written that are not a kind, with where. They are kept and not drawn. */
  unknown: z.array(z.object({ path: VaultPath, index: z.number().int(), word: z.string() })),
});
export type RelationsResponse = z.infer<typeof RelationsResponse>;

/** `POST /api/relations`: adds one item to one entry's list. */
export const AddRelationRequest = z.object({
  /** The entry it is written on. */
  path: VaultPath,
  what: Word,
  /** A title, a path or a wikilink. */
  who: z.string().trim().min(1).max(200),
  with: z.string().trim().min(1).max(200).optional(),
  how: z.string().trim().min(1).max(60).optional(),
  when: z.string().trim().min(1).max(120).optional(),
  /** Also make an entry for `who`, in the same folder as `path`. */
  create: z.boolean().optional(),
});
export type AddRelationRequest = z.infer<typeof AddRelationRequest>;

/** `POST /api/relations/remove`: takes one item off an entry's list, if it is still that item. */
export const RemoveRelationRequest = z.object({
  path: VaultPath,
  index: z.number().int().min(0),
  what: z.string(),
  who: z.string(),
});
export type RemoveRelationRequest = z.infer<typeof RemoveRelationRequest>;
