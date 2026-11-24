/** Which globes lie under which: caves under a surface, reached by Up and Down in the map's bar. */
import type { MapFile } from "@frontier/schema";

/** Another map of the library, as the map page knows it. */
export interface OtherMap {
  id: string;
  title: string;
  space: MapFile["space"];
  under: string | null;
}

/** Whether a map lies, directly or through others, under this one: it cannot be put above it. */
export function lies(id: string, other: string, maps: OtherMap[]): boolean {
  const seenIds = new Set<string>();
  let at: string | null | undefined = other;
  while (at && !seenIds.has(at)) {
    if (at === id) return true;
    seenIds.add(at);
    at = maps.find((m) => m.id === at)?.under;
  }
  return false;
}

/** The map this one lies under, and those that lie under it. Both must be globes. */
export function aboveAndBelow(
  map: MapFile | null,
  id: string,
  maps: OtherMap[],
): { above: OtherMap | undefined; below: OtherMap[] } {
  const above =
    map?.space.kind === "sphere"
      ? maps.find((m) => m.id === map.under && m.space.kind === "sphere")
      : undefined;
  const below =
    map?.space.kind === "sphere"
      ? maps.filter((m) => m.under === id && m.space.kind === "sphere")
      : [];
  return { above, below };
}
