/**
 * The live decorations of stage 31d: who else has unsaved changes to an entry, and who is reading
 * it. They come from the status stream and mean nothing without it, so none of them is shown while
 * the connection is down or for an answer the device copy gave, and a reader never sees them.
 */
import { useMemo } from "react";
import type { OtherUnsaved, StatusSnapshot } from "@frontier/schema";
import { useCanWrite } from "../components/projectContext.ts";
import { useConnection } from "../sync/connection.ts";
import { othersByPath, readersOf } from "./model.ts";

const NONE: OtherUnsaved[] = [];

/** The live part of the status, or null while it is not live (offline, or a reader). */
function useLiveStatus(): StatusSnapshot | null {
  const { state, snapshot } = useConnection();
  const canWrite = useCanWrite();
  return state === "online" && canWrite ? snapshot : null;
}

/**
 * The people with unsaved changes to the entry at `path`, now. `fromEntry` is what the entry's own
 * read said, used until the stream has said anything; `stale` is true for an answer that came from
 * the device copy, which is not live.
 */
export function useOthersUnsaved(
  path: string,
  fromEntry?: OtherUnsaved[] | undefined,
  stale = false,
): OtherUnsaved[] {
  const live = useLiveStatus();
  const list = live?.othersUnsaved;
  return useMemo(() => {
    if (!live || stale) return NONE;
    if (list !== undefined) return othersByPath(list).get(path) ?? NONE;
    return fromEntry ?? NONE;
  }, [live, list, path, fromEntry, stale]);
}

/** The people reading the entry at `path`, apart from the person. */
export function useReaders(path: string, stale = false): { id: string; name: string }[] {
  const live = useLiveStatus();
  const presence = live?.presence;
  return useMemo(
    () => (live && !stale ? readersOf(presence, path) : []),
    [live, presence, path, stale],
  );
}

/**
 * For the tree: null while nothing live is known (offline, or a reader), the stream's list by
 * entry when the server sends one, and "flags" for a server that does not, where the tree's own
 * `othersUnsaved` flag decides.
 */
export function useOthersLookup(): Map<string, OtherUnsaved[]> | "flags" | null {
  const live = useLiveStatus();
  const list = live?.othersUnsaved;
  return useMemo(() => {
    if (!live) return null;
    return list === undefined ? "flags" : othersByPath(list);
  }, [live, list]);
}

/** Who has unsaved changes to the entry at `path` as a tree row shows it: names, or true when only a flag says so. */
export function othersAt(
  lookup: Map<string, OtherUnsaved[]> | "flags" | null,
  path: string,
  flag: boolean | undefined,
): OtherUnsaved[] | true | null {
  if (lookup === null) return null;
  if (lookup === "flags") return flag ? true : null;
  const people = lookup.get(path);
  return people && people.length > 0 ? people : null;
}
