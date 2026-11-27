/**
 * The World Wizard's biome zones (stage 34): the biome of each cell of the world made into zones
 * for the map, with the outliner Suggest biomes uses, so two neighbours meet on the same line.
 * The sea is not a zone; ice is, on land and sea alike. A region that crosses the edge of the
 * picture (180° east and west) becomes two zones that meet there.
 */
import { BIOME_KINDS, type BiomeKind } from "@frontier/schema";
import { SEA } from "../map/findPaths/climate.ts";
import { regionsOf } from "../map/findPaths/regions.ts";
import { ensure, H, isWater, N, W, type World } from "./model.ts";

export interface WorldZone {
  kind: BiomeKind;
  /** Its outline as `[longitude, latitude]`, in degrees. */
  points: [number, number][];
  /** How many cells of the world it covers. */
  cells: number;
}

/** A zone's edge never runs further than this many degrees of longitude between two points. */
export const MAX_STEP = 3;
/** The outline stays this far from a pole, where every longitude is one place. */
const POLE = 89.5;

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The zones of the world's biomes, the largest first. Patches of fewer than `smallest` cells join
 * a neighbour. On a globe a zone's edge is the shortest way between two points, which is not along
 * a line of latitude, so long edges are given points in between.
 */
export function worldZones(world: World, smallest = 24): WorldZone[] {
  ensure(world, "biome");
  const label = new Uint8Array(N);
  for (let i = 0; i < N; i++) label[i] = isWater(world.biome[i]!) ? SEA : world.biome[i]!;
  const zones: WorldZone[] = [];
  for (const region of regionsOf(label, W, H, null, smallest)) {
    const ring = region.ring.map(([x, y]): [number, number] => [
      Math.max(-180, Math.min(180, (x / W) * 360 - 180)),
      Math.max(-POLE, Math.min(POLE, 90 - (y / H) * 180)),
    ]);
    const points: [number, number][] = [];
    for (let n = 0; n < ring.length; n++) {
      const a = ring[n]!;
      const b = ring[(n + 1) % ring.length]!;
      points.push([round(a[0]), round(a[1])]);
      const steps = Math.ceil(Math.abs(b[0] - a[0]) / MAX_STEP);
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        points.push([round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)]);
      }
    }
    const distinct = points.filter((p, n) => {
      const before = points[(n + points.length - 1) % points.length]!;
      return p[0] !== before[0] || p[1] !== before[1];
    });
    if (distinct.length < 3) continue;
    zones.push({ kind: region.kind, points: distinct, cells: region.cells });
  }
  return zones;
}

/** How many zones there are of each biome, in the order of the biome list. */
export function zoneCounts(zones: readonly WorldZone[]): { kind: BiomeKind; count: number }[] {
  return BIOME_KINDS.map((kind) => ({
    kind,
    count: zones.filter((z) => z.kind === kind).length,
  })).filter((c) => c.count > 0);
}
