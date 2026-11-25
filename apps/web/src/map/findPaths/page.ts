/**
 * What Find paths does to the map, and what it tells the engine of it, as plain functions: the
 * features that count as terrain by their styles, the paths Make path makes, a path extended by
 * Add to, and where a new stop goes in a route.
 */
import { outline, type Position, type Space } from "@frontier/geo";
import {
  countsAs,
  isLined,
  type MapFeature,
  type MapFile,
  type MapStyle,
  type MapTerrain,
  orderFeature,
  type PathStretch,
  wholeExtent,
} from "@frontier/schema";
import type { ImageFrame } from "../findAreas/frame.ts";
import { toPx } from "../findAreas/frame.ts";
import { type Resolved, writeShape } from "../time.ts";
import { newItemId } from "../viewUrl.ts";
import { joinLines } from "./lines.ts";
import type { TerrainFeature } from "./protocol.ts";
import { unitKm } from "./travel.ts";

/**
 * The features that count as terrain: paths in a style that counts as a river or a road, zones
 * in one that counts as water, forest, marsh or mountains. Each as it is drawn (a curved path
 * along its curve), in the picture's pixels.
 */
export function terrainFeatures(
  space: Space,
  frame: ImageFrame,
  drawn: readonly MapFeature[],
  styles: readonly MapStyle[],
): TerrainFeature[] {
  const out: TerrainFeature[] = [];
  for (const f of drawn) {
    if (!isLined(f) || !f.style) continue;
    const counts = countsAs(styles.find((s) => s.id === f.style && s.for === f.kind));
    if (!counts) continue;
    const { line } = outline(space, f.points, {
      curve: f.curve === "smooth",
      closed: f.kind === "zone",
    });
    out.push({ id: f.id, counts, line: line.map((p) => toPx(frame, p)) });
  }
  return out;
}

/** What counts as terrain on a map, in words, for the Terrain dialog: "3 paths count as River". */
export function terrainHints(
  drawn: readonly MapFeature[],
  styles: readonly MapStyle[],
): { counts: string; paths: number; zones: number }[] {
  const tally = new Map<string, { paths: number; zones: number }>();
  for (const f of drawn) {
    if (!isLined(f) || !f.style) continue;
    const counts = countsAs(styles.find((s) => s.id === f.style && s.for === f.kind));
    if (!counts) continue;
    const t = tally.get(counts) ?? { paths: 0, zones: 0 };
    if (f.kind === "path") t.paths++;
    else t.zones++;
    tally.set(counts, t);
  }
  return [...tally].map(([counts, t]) => ({ counts, ...t }));
}

/** Kilometres to a position unit of a map, or null when it has no scale or a unit of its own. */
export function kmPerUnit(space: MapFile["space"]): number | null {
  if (space.kind !== "flat" || space.scale === null) return null;
  const km = unitKm(space.unit);
  return km === null ? null : space.scale * km;
}

/** Where a map's terrain lies: its own extent, or the whole map. */
export const terrainExtent = (
  map: MapFile,
  terrain: MapTerrain,
): [number, number, number, number] => terrain.extent ?? wholeExtent(map.space);

/**
 * The metres between the lowest and the highest grey of a terrain, when its real heights are
 * given in a unit that can be told in metres (m, ft, or the map's own when that is known).
 */
export function terrainMetres(terrain: MapTerrain): number | null {
  if (!terrain.range) return null;
  const unit = (terrain.rangeUnit ?? "m").trim().toLowerCase();
  const km = unit === "m" ? 0.001 : unit === "ft" ? 0.0003048 : unitKm(unit);
  return km === null ? null : (terrain.range[1] - terrain.range[0]) * km * 1000;
}

const round = (p: Position): Position => [
  Math.round(p[0] * 1000) / 1000,
  Math.round(p[1] * 1000) / 1000,
];

/** A stretch of a path to make, between two of its points (indices into `points`). */
export interface NewStretch {
  kind: PathStretch["kind"];
  from: number;
  to: number;
  grade?: number;
}

/** A path to make: its points, and whether its ends must stay exactly where they are. */
export interface NewPath {
  points: Position[];
  /** It ends on another path: the end is not rounded, so it lies on that path exactly. */
  exactEnd?: boolean;
  /** It starts on another path (a branch from a road), likewise. */
  exactStart?: boolean;
  label?: string | null;
  /** Its tunnels, steps and climbs. */
  stretches?: NewStretch[];
  /** How a river ends inland. */
  endAs?: "sinks" | "dries";
  /** Its climbs' chevrons are hidden. */
  steepHidden?: boolean;
}

/**
 * Make path: a new path for each line, in `layer` with `style` (none: the layer's look), curved
 * when `curve` is on. Null when there is nothing to make. A stretch is kept by the coordinates
 * of its two corners, as they are written.
 */
export function makePaths(
  map: MapFile,
  layer: string,
  style: string | null,
  curve: boolean,
  paths: readonly NewPath[],
): { map: MapFile; ids: string[] } | null {
  const made = paths
    .filter((p) => p.points.length >= 2)
    .map((p) => {
      const last = p.points.length - 1;
      const points = p.points.map((q, i) =>
        (p.exactEnd && i === last) || (p.exactStart && i === 0) ? q : round(q),
      );
      const stretches = (p.stretches ?? [])
        .filter((x) => x.from >= 0 && x.to <= last && x.from < x.to)
        .map((x): PathStretch => ({
          kind: x.kind,
          from: points[x.from]!,
          to: points[x.to]!,
          ...(x.grade !== undefined ? { grade: Math.round(x.grade * 1000) / 1000 } : {}),
        }));
      return orderFeature({
        id: newItemId(),
        kind: "path",
        layer,
        points,
        ...(curve ? { curve: "smooth" } : {}),
        ...(style ? { style } : {}),
        entry: null,
        label: p.label ?? null,
        child: null,
        ...(stretches.length ? { stretches } : {}),
        ...(p.endAs ? { endAs: p.endAs } : {}),
        ...(p.steepHidden && stretches.some((x) => x.kind === "climb")
          ? { steepShown: false }
          : {}),
      } as MapFeature);
    });
  if (made.length === 0) return null;
  return { map: { ...map, features: [...map.features, ...made] }, ids: made.map((f) => f.id) };
}

/** A zone Find paths makes beside a river: the lake or the marsh of a basin, in `style`. */
export function makeZone(
  map: MapFile,
  layer: string,
  style: string | null,
  points: readonly Position[],
): { map: MapFile; id: string } | null {
  if (points.length < 3) return null;
  const zone = orderFeature({
    id: newItemId(),
    kind: "zone",
    layer,
    points: points.map(round),
    ...(style ? { style } : {}),
    entry: null,
    label: null,
    child: null,
  } as MapFeature);
  return { map: { ...map, features: [...map.features, zone] }, id: zone.id };
}

/**
 * Add to: the selected path's shape on screen with the proposed line joined to it end to end
 * (whichever ends are nearest meet). Null when the path is gone.
 */
export function addToPath(
  map: MapFile,
  drawn: Resolved,
  added: readonly Position[],
): MapFile | null {
  const feature = map.features.find((f) => f.id === drawn.feature.id);
  if (!feature || feature.kind !== "path" || drawn.feature.kind !== "path") return null;
  const points = joinLines(drawn.feature.points, added.map(round)) as Position[];
  const next = writeShape(feature, drawn.shape, { points });
  return { ...map, features: map.features.map((f) => (f.id === feature.id ? next : f)) };
}

/**
 * Where a new stop goes in a route: between the two stops it lengthens the straight way least.
 * Returns the index it is put at.
 */
export function stopIndex(stops: readonly Position[], at: Position): number {
  const d = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let best = 1;
  let least = Infinity;
  for (let i = 1; i < stops.length; i++) {
    const more = d(stops[i - 1]!, at) + d(at, stops[i]!) - d(stops[i - 1]!, stops[i]!);
    if (more < least) {
      least = more;
      best = i;
    }
  }
  return best;
}

/** "1 bridge", "2 fords". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
