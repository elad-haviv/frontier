/**
 * Library item files: Frontier's own JSON files in the library that hold one item per line and
 * are merged item by item, such as the folder file. Each kind is one entry in a table; the server's
 * store, its routes, the publisher and the browser's save queue all work from that table, so a new
 * kind of file is a new entry rather than new code.
 */
import type { z } from "zod";
import type { ConflictReason } from "./api.js";
import { mergeItemLists, serialiseItemFile } from "./itemFile.js";

/** The names of the library item files: the save queue's key and the routes' `:name`. */
export type LibraryFileName = "folders" | "map-styles" | "biomes" | "pins" | "trees" | "types";
export const LIBRARY_FILE_NAMES: readonly LibraryFileName[] = [
  "folders",
  "map-styles",
  "biomes",
  "pins",
  "trees",
  "types",
];

export interface LibraryFileKind<F> {
  name: LibraryFileName;
  /** Where it lives in the library, such as ".frontier/folders.json". */
  path: string;
  /** The file's name in lists, such as "Folders". */
  label: string;
  /** What "Keep my …" names, such as "folders". */
  noun: string;
  schema: z.ZodType<F, z.ZodTypeDef, unknown>;
  /** The key of the list of items, such as "folders". */
  list: string;
  /** The keys of the file in the order they are written. */
  topKeys: string[];
  /** The keys of one item in the order they are written. */
  itemKeys: string[];
  /** What an item is known by in a merge: a path for folders, an id for most. */
  key: (item: unknown) => string;
  /** The reason a publish gives when both sides changed the same item. */
  conflict: z.infer<typeof ConflictReason>;
  /** What a missing file reads as. */
  empty: () => F;
  /**
   * For a file whose items name library paths: the file after the folder or file `from` is
   * renamed to `to`. Saving a rename then rewrites the file in the same commit.
   */
  follow?: (file: F, from: string, to: string) => F;
}

export type AnyLibraryFile = LibraryFileKind<unknown>;

export type ParsedLibraryFile<F> = { ok: true; file: F } | { ok: false; message: string };

/** Reads a library file's text. Says why when it does not have the kind's form. */
export function parseLibraryFile<F>(kind: LibraryFileKind<F>, text: string): ParsedLibraryFile<F> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "It is not valid JSON." };
  }
  const version = (raw as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version !== 1) {
    return { ok: false, message: `It has version ${version}; this Frontier reads version 1.` };
  }
  const parsed = kind.schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    return { ok: false, message: `${issue?.message ?? "It cannot be read."}${where}` };
  }
  return { ok: true, file: parsed.data };
}

/** The text the file is stored as: one item per line, the same content always the same bytes. */
export function serialiseLibraryFile<F>(kind: LibraryFileKind<F>, file: F): string {
  return serialiseItemFile(file as Record<string, unknown>, kind.topKeys, {
    [kind.list]: kind.itemKeys,
  });
}

/**
 * Merges two versions of a library file that started from `base`, item by item through the kind's
 * key; other top-level values are this side's. Clashing items keep `mine` and are named by
 * their key.
 */
export function mergeLibraryFile<F>(
  kind: LibraryFileKind<F>,
  base: F,
  mine: F,
  theirs: F,
): { file: F; clashes: string[] } {
  const list = (f: F) => ((f as Record<string, unknown>)[kind.list] as unknown[] | undefined) ?? [];
  const merged = mergeItemLists(list(base), list(mine), list(theirs), kind.key);
  return {
    file: { ...(theirs as object), ...(mine as object), [kind.list]: merged.items } as F,
    clashes: merged.clashes,
  };
}
