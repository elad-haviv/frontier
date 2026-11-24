/**
 * The folder file, `.frontier/folders.json`: one line per folder the author has done something
 * with, keyed by its path. A line keeps a folder that holds nothing yet, its icon, its colour, its
 * place among its siblings and the type its new entries are given.
 */
import { z } from "zod";
import {
  type LibraryFileKind,
  mergeLibraryFile,
  type ParsedLibraryFile,
  parseLibraryFile,
  serialiseLibraryFile,
} from "./libraryFiles.js";

export const FOLDER_FILE = ".frontier/folders.json";

/** The icons a folder can have: lucide icon names. */
export const FOLDER_ICONS = [
  "folder",
  "book",
  "book-open",
  "scroll",
  "feather",
  "pen-tool",
  "map",
  "map-pin",
  "compass",
  "globe",
  "mountain",
  "mountain-snow",
  "trees",
  "tree-pine",
  "leaf",
  "flower",
  "waves",
  "droplet",
  "flame",
  "sun",
  "moon",
  "star",
  "sparkles",
  "cloud",
  "snowflake",
  "castle",
  "landmark",
  "church",
  "house",
  "tent",
  "ship",
  "anchor",
  "sword",
  "swords",
  "shield",
  "crown",
  "gem",
  "coins",
  "key",
  "lock",
  "skull",
  "ghost",
  "eye",
  "heart",
  "users",
  "user",
  "baby",
  "bird",
  "fish",
  "bug",
  "paw-print",
  "cat",
  "dog",
  "rabbit",
  "hourglass",
  "clock",
  "calendar",
  "flask-conical",
  "wand",
  "music",
  "languages",
  "archive",
] as const;
export type FolderIcon = (typeof FOLDER_ICONS)[number];

/** The colours a folder can have, for the light and the dark page; each at least 5.4:1 on both. */
export const FOLDER_COLORS = {
  ember: { light: "#9a3b1c", dark: "#e08a5f" },
  sea: { light: "#1f5f8b", dark: "#7fb6dd" },
  moss: { light: "#3f6b2a", dark: "#9cc47f" },
  gold: { light: "#7a5a00", dark: "#d9b24c" },
  plum: { light: "#6b3a7a", dark: "#c79bd6" },
  slate: { light: "#4a5560", dark: "#a7b2bd" },
  rose: { light: "#9b2f55", dark: "#e88aa8" },
  teal: { light: "#1d6b63", dark: "#74c4b9" },
} as const;
export type FolderColor = keyof typeof FOLDER_COLORS;
export const FOLDER_COLOR_NAMES = Object.keys(FOLDER_COLORS) as FolderColor[];

/** Folders Frontier keeps for itself or that Obsidian and Git own; none of them is a folder line. */
const HIDDEN = new Set([".git", ".obsidian", ".frontier", ".claude", ".gemini"]);

/** A folder's path: inside the library, never one of the hidden folders, no "." or "..". */
export const FolderPath = z
  .string()
  .min(1)
  .max(400)
  .refine((p) => {
    const parts = p.split("/");
    return (
      !p.includes("\\") &&
      parts.every((s) => s !== "" && s !== "." && s !== ".." && s.trim() === s) &&
      !HIDDEN.has(parts[0]!)
    );
  }, "A folder inside the library, outside Frontier's own and the hidden folders.");

/**
 * A place among siblings: digits and letters, compared as text. It never ends in "0", so there is
 * always room for another key before it.
 */
export const OrderKey = z
  .string()
  .max(64)
  .regex(/^[0-9A-Za-z]*[1-9A-Za-z]$/, "An order key is letters and digits, not ending in 0.");

export const FolderLine = z
  .object({
    path: FolderPath,
    icon: z.enum(FOLDER_ICONS).optional(),
    color: z.enum(FOLDER_COLOR_NAMES as [FolderColor, ...FolderColor[]]).optional(),
    order: OrderKey.optional(),
    /** The type its new entries are given, and what entries without their own type are. */
    type: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[^\s/:]+$/, "A type is one word.")
      .optional(),
  })
  .passthrough();
export type FolderLine = z.infer<typeof FolderLine>;

/** At most this many lines, so a broken file cannot grow without end. */
export const MAX_FOLDER_LINES = 5000;

export const FolderFile = z
  .object({
    version: z.literal(1),
    folders: z.array(FolderLine).max(MAX_FOLDER_LINES),
  })
  .passthrough()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const line of file.folders) {
      if (seen.has(line.path)) {
        ctx.addIssue({ code: "custom", message: `"${line.path}" has two lines.` });
        return;
      }
      seen.add(line.path);
    }
  });
export type FolderFile = z.infer<typeof FolderFile>;

/** The folder file's entry in the table of library files. */
export const FOLDERS: LibraryFileKind<FolderFile> = {
  name: "folders",
  path: FOLDER_FILE,
  label: "Folders",
  noun: "folders",
  schema: FolderFile,
  list: "folders",
  topKeys: ["version", "folders"],
  itemKeys: ["path", "icon", "color", "order", "type"],
  key: (item) => (item as FolderLine).path,
  conflict: "folders_changed_on_both",
  empty: () => ({ version: 1, folders: [] }),
  follow: (file, from, to) => renameInFolders(file, from, to),
};

// ---- Order -----------------------------------------------------------------------------------

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A key strictly between `a` and `b` ("" is before everything, null after everything). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // The common start is kept; the rest is worked out after it.
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a ? DIGITS.indexOf(a[0]!) : 0;
  const high = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]!;
  // The first digits are next to each other.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

/**
 * An order key that sorts after `before` and before `after`; null for either end. Two keys in the
 * wrong order, or equal, are refused.
 */
export function orderBetween(before: string | null, after: string | null): string {
  for (const k of [before, after]) {
    if (k !== null && !OrderKey.safeParse(k).success) {
      throw new Error(`"${k}" is not an order key.`);
    }
  }
  if (before !== null && after !== null && before >= after) {
    throw new Error(`"${before}" does not come before "${after}".`);
  }
  return midpoint(before ?? "", after);
}

/** Compares two names as the tree does: numbers in order, letter case aside. */
export const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Sorts siblings as the tree shows them: those with an order first, by it; then the rest by name.
 */
export function sortFolders<T extends { name: string; order?: string | undefined }>(
  folders: T[],
): T[] {
  return [...folders].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order < b.order ? -1 : a.order > b.order ? 1 : byName(a.name, b.name);
    }
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return byName(a.name, b.name);
  });
}

// ---- Reading and merging ---------------------------------------------------------------------

/** Reads the folder file's text. */
export const parseFolders = (text: string): ParsedLibraryFile<FolderFile> =>
  parseLibraryFile(FOLDERS, text);

/** The folder file's text: one line per folder. */
export const serialiseFolders = (file: FolderFile): string => serialiseLibraryFile(FOLDERS, file);

/** Merges two versions of the folder file line by line, by path. */
export const mergeFolders = (
  base: FolderFile,
  mine: FolderFile,
  theirs: FolderFile,
): { file: FolderFile; clashes: string[] } => mergeLibraryFile(FOLDERS, base, mine, theirs);

/** Where a path ends up when the folder `from` becomes `to`; null when it is not under it. */
export function movedFolderPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(from + "/") ? to + path.slice(from.length) : null;
}

/** The folder file with every line at or under `from` moved to `to`. */
export function renameInFolders(file: FolderFile, from: string, to: string): FolderFile {
  return {
    ...file,
    folders: file.folders.map((l) => {
      const moved = movedFolderPath(l.path, from, to);
      return moved === null ? l : { ...l, path: moved };
    }),
  };
}
