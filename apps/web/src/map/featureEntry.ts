/**
 * Making an entry from the map, for a feature: its text, the folder it is offered in, and its
 * creation through the save queue, so it is made offline as an entry made in the editor is.
 */
import { type MapFeature, type MapFile } from "@frontier/schema";
import { setFrontmatterKey } from "@frontier/vault";
import { newDraftId } from "../api.ts";
import { projectWork } from "../projectWork.ts";
import type { Names } from "./useMapFile.ts";

/** The title an entry's path gives it. */
export const titleOfPath = (path: string): string =>
  (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** A new entry's text: its title, what it says, and the type its folder gives. */
export function newEntryText(path: string, body: string, type: string | null | undefined): string {
  const text = `# ${titleOfPath(path)}\n\n${body.trim() ? `${body.trim()}\n` : ""}`;
  return type ? setFrontmatterKey(text, "type", type) : text;
}

/**
 * The folder a feature's new entry is offered in: the one holding most of the entries linked to
 * features of its kind on this map, else of any kind; "" (the top) when none is linked.
 */
export function folderFor(map: MapFile, kind: MapFeature["kind"], names: Names): string {
  const count = (features: MapFeature[]) => {
    const seen = new Map<string, number>();
    for (const f of features) {
      const path = f.entry ? names[f.entry]?.path : undefined;
      if (!path || !path.includes("/")) continue;
      const folder = path.slice(0, path.lastIndexOf("/"));
      seen.set(folder, (seen.get(folder) ?? 0) + 1);
    }
    return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  };
  return count(map.features.filter((f) => f.kind === kind)) ?? count(map.features) ?? "";
}

/**
 * Makes the entry through the save queue, which keeps it on this device until the server has it.
 * When the library already has an entry at that path, nothing is made: it is linked instead.
 */
export async function makeEntry(path: string, text: string): Promise<void> {
  // The project the map is in: the person may switch while the names are being read.
  const work = projectWork();
  const known = await work.api.names(titleOfPath(path)).catch(() => null);
  if (known?.results.some((r) => r.path === path)) return;
  const key = `entry:${path}` as const;
  await work.queue.put(key, text, {
    kind: "create",
    draftId: newDraftId(),
    revision: 0,
    baseBlob: "",
  });
  // Sent now when there is a connection; offline it waits with the map's link behind it.
  void work.queue.sendNow(key);
}
