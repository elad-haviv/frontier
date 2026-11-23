/**
 * What the editor opens for a path when the server cannot be reached (stage 15c): the same
 * open-or-create rule as online, decided against this device's unsent changes and the compact
 * index instead of the server. Pure, so the rule is tested on its own.
 */
import type { FolderFile } from "@frontier/schema";

export type OfflineOpen =
  /** A change not sent yet holds the entry's text: the editor opens from it. */
  | "record"
  /** The library has an entry there, but its text is not on this device. */
  | "not-on-device"
  /** Nothing is there: a new entry starts, as for a 404 online. */
  | "create"
  /** Nothing is there, and no new entry was asked for: as a 404 online. */
  | "missing";

export function openOrCreate(input: {
  path: string;
  /** Whether the save queue holds a change for the path that is not a delete. */
  hasRecord: boolean;
  /** The paths of the entries in the compact index; null when none is stored. */
  indexPaths: Iterable<string> | null;
  /** Whether a new entry was asked for (`?new=1`). */
  creating: boolean;
}): OfflineOpen {
  if (input.hasRecord) return "record";
  // Only the very same path is the same entry: the same name in another folder is another one.
  for (const p of input.indexPaths ?? []) if (p === input.path) return "not-on-device";
  return input.creating ? "create" : "missing";
}

/** The type a new entry at `path` takes: its folder's, or the nearest folder's above it. */
export function folderTypeOf(path: string, file: FolderFile | null | undefined): string | null {
  if (!file) return null;
  const types = new Map(file.folders.filter((l) => l.type).map((l) => [l.path, l.type!]));
  let folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  while (folder !== "") {
    const type = types.get(folder);
    if (type) return type;
    folder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
  }
  return null;
}
