/**
 * Changes to a star map's file, each returning the next map. A star is a marker on a map whose
 * space is open space: `at` is its place on the plane, `z` its height above it. A route is a
 * feature that runs through stars, in order. Like the tools of the flat map, these are pure.
 */
import type { MapFeature, MapFile } from "@frontier/schema";
import { type Point3, tenth } from "./space3d.ts";
import { newItemId } from "./viewUrl.ts";

export type Star = Extract<MapFeature, { kind: "marker" }>;
export type Route = Extract<MapFeature, { kind: "route" }>;

/** The colours of a star by its kind, as dots; a station is paper-coloured. */
export const TONES = [
  { name: "Blue-white", hex: "#a9c4e8" },
  { name: "White", hex: "#dfe6ee" },
  { name: "Cream", hex: "#f6edd8" },
  { name: "Yellow", hex: "#f2d28a" },
  { name: "Orange", hex: "#e8a15c" },
  { name: "Red", hex: "#d9694a" },
] as const;

export const LANES = {
  jump: { name: "Jump lane", colour: "#e3c58a", width: 1.6, dash: [] as number[] },
  trade: { name: "Trade route", colour: "#7fb3a6", width: 1.6, dash: [6, 4] },
  patrol: { name: "Patrol", colour: "#c98aa0", width: 1.4, dash: [1, 5] },
} as const;
export type Lane = keyof typeof LANES;

export const SIZE_NAMES = {
  1: "Small, named on hover",
  2: "Normal",
  3: "Large, always named",
} as const;

export const isStar = (f: MapFeature): f is Star => f.kind === "marker";
export const isRoute = (f: MapFeature): f is Route => f.kind === "route";

export const stars = (map: MapFile): Star[] => map.features.filter(isStar);
export const routes = (map: MapFile): Route[] => map.features.filter(isRoute);

export const placeOf = (s: Star): Point3 => ({ x: s.at[0], y: s.at[1], z: s.z ?? 0 });

/** Whether a star is drawn as a light dot or a pin: its own choice, else its layer's, else a dot. */
export function lookOf(map: MapFile, s: Star): "dot" | "pin" {
  return s.look ?? map.layers.find((l) => l.id === s.layer)?.look ?? "dot";
}

/** The colour a star is drawn in: its own, else its layer's. */
export function toneOf(map: MapFile, s: Star): string {
  return s.tone ?? map.layers.find((l) => l.id === s.layer)?.color ?? "#f2d28a";
}

/** The stars a route runs through, in order; one that has gone is skipped. */
export function stopsOf(map: MapFile, r: Route): Star[] {
  const out: Star[] = [];
  for (const id of r.stops) {
    const s = map.features.find((f) => f.id === id);
    if (s && isStar(s)) out.push(s);
  }
  return out;
}

/** A new star on the plane at a place, in a layer; selected by the caller through the id. */
export function addStar(
  map: MapFile,
  layer: string,
  x: number,
  y: number,
  z = 0,
): { map: MapFile; id: string } {
  const id = newItemId();
  const feature: Star = {
    id,
    kind: "marker",
    layer,
    at: [tenth(x), tenth(y)],
    entry: null,
    label: "New star",
    icon: null,
    child: null,
    z: tenth(z),
    size: 2,
  };
  return { map: { ...map, features: [...map.features, feature] }, id };
}

/** A star at a new place; any of the three numbers may be left as they were. */
export function moveStar(map: MapFile, id: string, to: Partial<Point3>): MapFile {
  return {
    ...map,
    features: map.features.map((f) => {
      if (f.id !== id || !isStar(f)) return f;
      const x = to.x ?? f.at[0];
      const y = to.y ?? f.at[1];
      const z = to.z ?? f.z ?? 0;
      return { ...f, at: [tenth(x), tenth(y)], z: tenth(z) };
    }),
  };
}

/** Changes the fields of a feature. */
export function patchFeature(map: MapFile, id: string, patch: Record<string, unknown>): MapFile {
  return {
    ...map,
    features: map.features.map((f) => (f.id === id ? ({ ...f, ...patch } as MapFeature) : f)),
  };
}

/** Takes a field away, as when a star goes back to being drawn as its layer is. */
export function clearField(map: MapFile, id: string, field: string): MapFile {
  return {
    ...map,
    features: map.features.map((f) => {
      if (f.id !== id) return f;
      const next = { ...f } as Record<string, unknown>;
      delete next[field];
      return next as MapFeature;
    }),
  };
}

/**
 * Removes a star, and takes it out of every route; a route left with fewer than two stops goes
 * too. Removing a route removes only the route.
 */
export function removeFeature(map: MapFile, id: string): MapFile {
  const gone = map.features.find((f) => f.id === id);
  if (!gone) return map;
  const features: MapFeature[] = [];
  for (const f of map.features) {
    if (f.id === id) continue;
    if (isRoute(f) && isStar(gone) && f.stops.includes(id)) {
      const stops = f.stops.filter((s) => s !== id);
      if (stops.length < 2) continue;
      features.push({ ...f, stops });
    } else {
      features.push(f);
    }
  }
  return { ...map, features };
}

/** A route through stars. Fewer than two stops, or two the same in a row, make none. */
export function addRoute(
  map: MapFile,
  layer: string,
  stops: string[],
  lane: Lane = "jump",
): { map: MapFile; id: string } | null {
  const clean = stops.filter((s, i) => i === 0 || s !== stops[i - 1]);
  if (clean.length < 2) return null;
  const id = newItemId();
  const feature: Route = {
    id,
    kind: "route",
    layer,
    entry: null,
    label: "New route",
    child: null,
    stops: clean,
    lane,
  };
  return { map: { ...map, features: [...map.features, feature] }, id };
}

/** Moves a stop of a route one place earlier or later. */
export function moveStop(map: MapFile, route: string, index: number, by: -1 | 1): MapFile {
  return {
    ...map,
    features: map.features.map((f) => {
      if (f.id !== route || !isRoute(f)) return f;
      const to = index + by;
      if (to < 0 || to >= f.stops.length) return f;
      const stops = [...f.stops];
      [stops[index], stops[to]] = [stops[to]!, stops[index]!];
      return { ...f, stops };
    }),
  };
}

/** Takes a stop out of a route, unless it would leave fewer than two. */
export function removeStop(map: MapFile, route: string, index: number): MapFile {
  return {
    ...map,
    features: map.features.map((f) => {
      if (f.id !== route || !isRoute(f) || f.stops.length <= 2) return f;
      return { ...f, stops: f.stops.filter((_, i) => i !== index) };
    }),
  };
}

/** Puts a star on the layer; its place stays, so it only changes how it is drawn and listed. */
export const setLayer = (map: MapFile, id: string, layer: string): MapFile =>
  patchFeature(map, id, { layer });

/** The nearest others to a star, for its card. */
export function nearestStars(map: MapFile, of: Star, count: number): { star: Star; far: number }[] {
  const a = placeOf(of);
  return stars(map)
    .filter((s) => s.id !== of.id)
    .map((star) => {
      const b = placeOf(star);
      return { star, far: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) };
    })
    .sort((p, q) => p.far - q.far)
    .slice(0, count);
}
