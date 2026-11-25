/**
 * A short hash of a map's terrain hints in use: what a built height map depends on. Kept in
 * `terrain.generated.hints`, it tells a height map from hints changed since (another device, a
 * review on this one). Small and alone, so the map page can check it without the builder.
 */
import type { MapTerrainHint } from "@frontier/schema";

export function hintsHash(hints: readonly MapTerrainHint[]): string {
  const used = hints
    .filter((h) => h.state === "accepted")
    .map((h) => [
      h.id,
      h.kind,
      h.at ?? null,
      h.points ?? null,
      h.h ?? null,
      h.h2 ?? null,
      h.strength ?? null,
      h.flip ?? null,
    ])
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  const text = JSON.stringify(used);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Whether a terrain built from hints was built from other hints than the map has now. */
export function hintsChanged(map: {
  terrain?: { generated?: { hints: string } | undefined } | null | undefined;
  terrainHints?: readonly MapTerrainHint[] | undefined;
}): boolean {
  const g = map.terrain?.generated;
  return !!g && g.hints !== hintsHash(map.terrainHints ?? []);
}
