/**
 * The other side of an item clash (stage 15c). When a map, a chronicle or a library item file was
 * changed on two devices and the same item on both, the save queue keeps this device's item and
 * the server keeps the replaced file as a kept copy, naming the clashing items by their keys. This
 * file knows, for each kind, where an item with a key lives, so the server can combine two kept
 * copies and the compare screen can show one item from each side.
 */
import { chronicleIdOf, parseChronicle, serialiseChronicle } from "./chronicles.js";
import { parseLibraryFile, serialiseLibraryFile } from "./libraryFiles.js";
import { libraryFileOf } from "./libraryKinds.js";
import { mapIdOf, parseMap, serialiseMap } from "./maps.js";

export interface ItemShape {
  kind: "map" | "chronicle" | "library";
  /** The lists that hold items, each known by `keyOf`. */
  lists: string[];
  /** Values at the top of the file that clash as a whole, named by their own key. */
  tops: string[];
  keyOf: (item: unknown) => string;
  /** The file read from its text; null when it cannot be read. */
  parse: (text: string) => Record<string, unknown> | null;
  serialise: (file: Record<string, unknown>) => string;
}

const byId = (item: unknown): string => String((item as { id?: unknown } | null)?.id ?? "");

const MAP: ItemShape = {
  kind: "map",
  lists: ["images", "layers", "features", "terrainHints"],
  tops: ["title", "space", "markerSets", "under", "terrain"],
  keyOf: byId,
  parse: (text) => {
    const parsed = parseMap(text);
    return parsed.ok ? (parsed.map as unknown as Record<string, unknown>) : null;
  },
  serialise: (file) => serialiseMap(file as never),
};

const CHRONICLE: ItemShape = {
  kind: "chronicle",
  lists: ["lanes", "units", "spans", "relations"],
  tops: ["title", "main", "clock", "origin", "compare"],
  keyOf: byId,
  parse: (text) => {
    const parsed = parseChronicle(text);
    return parsed.ok ? (parsed.chronicle as unknown as Record<string, unknown>) : null;
  },
  serialise: (file) => serialiseChronicle(file as never),
};

/** How the items of the file at `path` are kept; undefined for a file that has no items. */
export function itemShapeOf(path: string): ItemShape | undefined {
  if (mapIdOf(path) !== null) return MAP;
  if (chronicleIdOf(path) !== null) return CHRONICLE;
  const library = libraryFileOf(path);
  if (!library) return undefined;
  return {
    kind: "library",
    lists: [library.list],
    // A library file's other top values are always this side's: only items clash.
    tops: [],
    keyOf: library.key,
    parse: (text) => {
      const parsed = parseLibraryFile(library, text);
      return parsed.ok ? (parsed.file as Record<string, unknown>) : null;
    },
    serialise: (file) => serialiseLibraryFile(library, file),
  };
}

/** Where an item is in a file: in a list, or a value at the top (`list` null). */
export interface FoundItem {
  list: string | null;
  value: unknown;
}

/** The item a clash key names in a file; undefined when the file does not have it. */
export function findItem(
  shape: ItemShape,
  file: Record<string, unknown>,
  key: string,
): FoundItem | undefined {
  if (shape.tops.includes(key)) {
    return key in file ? { list: null, value: file[key] } : undefined;
  }
  for (const list of shape.lists) {
    const items = file[list];
    if (!Array.isArray(items)) continue;
    const item = items.find((i) => shape.keyOf(i) === key);
    if (item !== undefined) return { list, value: item };
  }
  return undefined;
}

/**
 * Two kept copies of the other side combined: `newer` as it is, with each of `keep`'s items as
 * `older` had it, so a later clash on other items does not lose what an earlier one kept. An item
 * `older` did not have is left out.
 */
export function combineKept(
  shape: ItemShape,
  older: Record<string, unknown>,
  newer: Record<string, unknown>,
  keep: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...newer };
  for (const list of shape.lists) {
    if (Array.isArray(out[list])) out[list] = [...(out[list] as unknown[])];
  }
  for (const key of keep) {
    const was = findItem(shape, older, key);
    if (shape.tops.includes(key)) {
      if (was) out[key] = was.value;
      else delete out[key];
      continue;
    }
    let placed = false;
    for (const list of shape.lists) {
      const items = out[list];
      if (!Array.isArray(items)) continue;
      const at = items.findIndex((i) => shape.keyOf(i) === key);
      if (at === -1) continue;
      if (was?.list === list) {
        items[at] = was.value;
        placed = true;
      } else items.splice(at, 1);
    }
    if (was && !placed && was.list !== null) {
      out[was.list] = [...((out[was.list] as unknown[] | undefined) ?? []), was.value];
    }
  }
  return out;
}

/** Two lists of clash keys as one, in the order first seen. */
export const unionClashes = (a: string[] = [], b: string[] = []): string[] => [
  ...new Set([...a, ...b]),
];
