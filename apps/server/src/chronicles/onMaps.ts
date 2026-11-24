import type { ChronicleFile, MapFile } from "@frontier/schema";

/** One map that has features following a span: which map, its title, and how many features. */
export interface OnMap {
  map: string;
  title: string;
  features: number;
}

/**
 * Which spans of a chronicle something on a map follows (stage 17's 🗺 marks), decided as a map
 * seen through this chronicle decides it (stage 6): a feature tied to a span follows that span; a
 * feature with no tie and an entry follows the first span linked to that entry. Read only: the
 * chronicle page shows it and never saves it.
 */
export function onMapsOf(
  chronicle: ChronicleFile,
  maps: readonly MapFile[],
): Record<string, OnMap[]> {
  const ids = new Set(chronicle.spans.map((s) => s.id));
  const byEntry = new Map<string, string>();
  for (const s of chronicle.spans) {
    if (s.entry && !byEntry.has(s.entry)) byEntry.set(s.entry, s.id);
  }
  const out: Record<string, OnMap[]> = {};
  for (const map of maps) {
    const counts = new Map<string, number>();
    for (const f of map.features) {
      const span =
        f.span != null ? (ids.has(f.span) ? f.span : null) : f.entry ? byEntry.get(f.entry) : null;
      if (span) counts.set(span, (counts.get(span) ?? 0) + 1);
    }
    for (const [span, features] of counts) {
      (out[span] ??= []).push({ map: map.id, title: map.title, features });
    }
  }
  return out;
}
