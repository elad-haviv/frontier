/**
 * The map's height map, read for points of interest: the grey under a place, its height in
 * metres when the terrain says, and whether it is sea. Read in Find paths' worker, at a small
 * size, once per terrain.
 */
import type { MapFile, MapTerrain } from "@frontier/schema";
import { mapImageUrl } from "../../api.ts";
import { lookAtTerrain } from "../findPaths/client.ts";
import { terrainExtent, terrainMetres } from "../findPaths/page.ts";
import { LOWEST_SEA } from "../findPaths/terrain.ts";
import type { HeightAt } from "./spots.ts";

export interface Greys {
  w: number;
  h: number;
  data: Float32Array;
}

/** Heights at places of the map, from a height picture's greys and the terrain's settings. */
export function heightsFrom(
  greys: Greys,
  terrain: MapTerrain,
  extent: readonly [number, number, number, number],
): HeightAt {
  const [x0, y0, x1, y1] = extent;
  // The metres between the lowest grey and the highest, and the lowest grey's own height.
  const span = terrainMetres(terrain);
  const base =
    span !== null && terrain.range
      ? (terrain.range[0] * span) / (terrain.range[1] - terrain.range[0])
      : 0;
  const sea = terrain.seaLevel ?? LOWEST_SEA;
  return ([x, y]) => {
    if (x < x0 || y < y0 || x > x1 || y > y1) return null;
    const u = Math.min(greys.w - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0)) * greys.w)));
    const v = Math.min(greys.h - 1, Math.max(0, Math.floor(((y - y0) / (y1 - y0)) * greys.h)));
    const raw = greys.data[v * greys.w + u]!;
    const grey = terrain.invert ? 1 - raw : raw;
    const wet = grey < sea;
    return {
      grey: wet ? 0 : (grey - sea) / (1 - sea || 1),
      metres: span !== null ? Math.max(0, base + grey * span) : null,
      sea: wet,
    };
  };
}

/** Reads a map's height map; null when it has none or it cannot be read. */
export async function loadHeights(map: MapFile): Promise<HeightAt | null> {
  const terrain = map.terrain;
  if (!terrain || map.space.kind !== "flat") return null;
  const look = await lookAtTerrain(null, mapImageUrl(terrain.image, 2560));
  if (!look.heights) return null;
  return heightsFrom(look.heights, terrain, terrainExtent(map, terrain));
}
