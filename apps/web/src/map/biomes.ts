/**
 * Biome zones on the map page: which biome a place lies in (the smallest biome zone that holds
 * it, as an oasis in a desert), the Biomes layer new biome zones go to, the legend's biomes, and
 * a zone's biome set or cleared. Pure, so the overlay, Find paths, the hover tag and the tests
 * all read the same answers. See docs/designs/stage-21-biome-zones.md.
 */
import { outline, type Position, type Space } from "@frontier/geo";
import {
  type Biome,
  biomeById,
  type CustomBiome,
  type MapFeature,
  type MapFile,
  type MapStyle,
  orderLayer,
  usualStyleOf,
} from "@frontier/schema";
import { newItemId } from "./viewUrl.ts";

/** The name of the layer biome zones go to. It is an ordinary layer, known only by its name. */
export const BIOMES_LAYER = "Biomes";

/** The area of a ring by the shoelace formula, in the square of its units. */
export function ringArea(ring: readonly Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  }
  return Math.abs(a) / 2;
}

function inside(p: Position, ring: readonly Position[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}

/** A zone with a biome there is, as drawn now. */
export interface BiomeZone {
  feature: Extract<MapFeature, { kind: "zone" }>;
  biome: Biome;
  /** Its outline as drawn: along its curve when curved. */
  ring: Position[];
  /** In the square of the map's units. */
  area: number;
}

/**
 * The biome zones among features as drawn at the year shown (each with the shape in force then),
 * the largest first: the order they are drawn in, so that a smaller one lies over a larger.
 */
export function biomeZones(
  space: Space,
  drawn: readonly MapFeature[],
  custom: readonly CustomBiome[],
): BiomeZone[] {
  const out: BiomeZone[] = [];
  for (const f of drawn) {
    if (f.kind !== "zone" || !f.biome) continue;
    const biome = biomeById(f.biome, custom);
    if (!biome) continue;
    const ring = outline(space, f.points, { curve: f.curve === "smooth", closed: true }).line;
    out.push({ feature: f, biome, ring, area: ringArea(ring) });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** The biome zone a place lies in: the smallest that holds it, or null. */
export function biomeAt(zones: readonly BiomeZone[], at: Position): BiomeZone | null {
  let best: BiomeZone | null = null;
  for (const z of zones) {
    if ((best === null || z.area < best.area) && inside(at, z.ring)) best = z;
  }
  return best;
}

/** A zone with this biome, or none: a missing key means none. Paths and markers are left as they are. */
export function withBiome(feature: MapFeature, biome: string | null): MapFeature {
  if (feature.kind !== "zone") return feature;
  const next = { ...feature };
  if (biome) next.biome = biome;
  else delete next.biome;
  return next;
}

/** A zone with its biome's pattern drawn or not (drawn is the default, left out of the file). */
export function withPattern(feature: MapFeature, on: boolean): MapFeature {
  if (feature.kind !== "zone") return feature;
  const next = { ...feature };
  if (on) delete next.pattern;
  else next.pattern = false;
  return next;
}

/**
 * The Biomes layer: the one named so, or a new one put first, so that it is drawn under the
 * rest. The same map comes back when there is one already.
 */
export function biomesLayer(map: MapFile): { map: MapFile; layer: string; made: boolean } {
  const found = map.layers.find((l) => l.name === BIOMES_LAYER && l.parent == null);
  if (found) return { map, layer: found.id, made: false };
  const layer = orderLayer({
    id: newItemId(),
    name: BIOMES_LAYER,
    visible: true,
    color: "#7a8a5a",
  });
  return { map: { ...map, layers: [layer, ...map.layers] }, layer: layer.id, made: true };
}

/**
 * The style a new zone of a biome is drawn in: the one asked for when there is one, else the
 * biome's usual style. `missing` says the usual style is not in the library yet and must be added.
 */
export function styleForBiome(
  biome: Biome,
  styles: readonly MapStyle[],
  asked: string | null,
): { style: string; missing: MapStyle | null } {
  if (asked) return { style: asked, missing: null };
  const usual = usualStyleOf(biome);
  const there = styles.some((s) => s.id === usual.id && s.for === "zone");
  return { style: usual.id, missing: there ? null : usual };
}

/** One row of the legend's biomes: the biome and the colour its zones are mostly drawn in. */
export interface BiomeKey {
  biome: Biome;
  colour: string;
  /** Only suggested, not on the map yet: drawn dashed. */
  ghost?: boolean;
}

/**
 * The biomes of the zones drawn now, in the order of the biome list, each with the colour most
 * of its zones are drawn in. `colourOf` gives a zone's colour from its style or layer.
 */
export function biomeLegend(
  zones: readonly BiomeZone[],
  colourOf: (f: MapFeature) => string,
  order: readonly Biome[],
): BiomeKey[] {
  const tally = new Map<string, Map<string, number>>();
  for (const z of zones) {
    const colours = tally.get(z.biome.id) ?? new Map<string, number>();
    const c = colourOf(z.feature);
    colours.set(c, (colours.get(c) ?? 0) + 1);
    tally.set(z.biome.id, colours);
  }
  const out: BiomeKey[] = [];
  for (const biome of order) {
    const colours = tally.get(biome.id);
    if (!colours) continue;
    const colour = [...colours].sort((a, b) => b[1] - a[1])[0]![0];
    out.push({ biome, colour });
  }
  return out;
}
