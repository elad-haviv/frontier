/**
 * Terrain hints on the page: hints as the map keeps them (map positions), what the picture found
 * turned into them, hints tied to the map's own features by their styles' "counts as", Find
 * again's merge, the hash that says a built map is stale, and the words the dialog shows.
 * Plain functions, so the tests can call them. See docs/designs/stage-21-infer-height-map.md.
 */
import { outline, type Position, type Space } from "@frontier/geo";
import {
  countsAs,
  type MapFeature,
  type MapStyle,
  type MapTerrainHint,
  type TerrainHintKind,
} from "@frontier/schema";
import type { Px } from "../findAreas/contour.ts";
import { type ImageFrame, toPosition, toPx } from "../findAreas/frame.ts";
import { newItemId } from "../viewUrl.ts";
import { DEFAULT_HEIGHT } from "./build.ts";
import { compass, LIKELY } from "./find.ts";
import type { HintsFound } from "./protocol.ts";
import type { PxHint } from "./types.ts";

/** A hint in the dialog: as the map keeps it, with what is said of it while the dialog is open. */
export type Hint = MapTerrainHint & {
  /** Why it was found, in words; not kept in the map. */
  why?: string;
  /** Moved or changed by the owner since it was found: Find again leaves it as it is. */
  touched?: boolean;
};

/** The kinds in the order the Hints tab lists them, with their names. */
export const KINDS: { kind: TerrainHintKind; name: string; one: string }[] = [
  { kind: "sea", name: "Sea", one: "The sea" },
  { kind: "coast", name: "Coast", one: "The coast" },
  { kind: "lake", name: "Lakes", one: "Lake" },
  { kind: "river", name: "Rivers", one: "River" },
  { kind: "ridge", name: "Ridges", one: "Ridge" },
  { kind: "peak", name: "Peaks", one: "Peak" },
  { kind: "highland", name: "Highlands", one: "Highland" },
  { kind: "hollow", name: "Hollows", one: "Hollow" },
  { kind: "valley", name: "Valleys", one: "Valley" },
  { kind: "cliff", name: "Cliffs", one: "Cliff" },
  { kind: "lowland", name: "Lowlands", one: "Lowland" },
  { kind: "plain", name: "Plains", one: "Plain" },
  { kind: "marsh", name: "Marsh", one: "Marsh" },
  { kind: "road", name: "Roads", one: "Road" },
];
export const kindName = (k: TerrainHintKind): string => KINDS.find((x) => x.kind === k)!.one;

/** Kinds that are a point, a line, a ring, or the picture's water. */
export const POINT_KINDS: TerrainHintKind[] = ["peak", "hollow"];
export const LINE_KINDS: TerrainHintKind[] = ["river", "ridge", "valley", "cliff", "road"];
export const ZONE_KINDS: TerrainHintKind[] = ["lake", "highland", "lowland", "plain", "marsh"];

const round = (p: readonly number[]): [number, number] => [
  Math.round(p[0]! * 1000) / 1000,
  Math.round(p[1]! * 1000) / 1000,
];
const frameOf = (extent: readonly number[], w: number, h: number): ImageFrame => ({
  extent: extent as [number, number, number, number],
  sphere: false,
  w,
  h,
});

/** What the picture found, as hints of the map: likely ones in use, the rest waiting (decision 2). */
export function foundHints(found: HintsFound, extent: readonly number[]): Hint[] {
  const f = frameOf(extent, found.w, found.h);
  return found.hints.map((x) => {
    const hint: Hint = {
      id: newItemId(),
      kind: x.kind,
      ...(x.at ? { at: round(toPosition(f, x.at)) } : {}),
      ...(x.points ? { points: x.points.map((p) => round(toPosition(f, p))) } : {}),
      ...(x.h !== undefined ? { h: Math.round(x.h * 1000) / 1000 } : {}),
      ...(x.h2 !== undefined ? { h2: Math.round(x.h2 * 1000) / 1000 } : {}),
      state: x.conf >= LIKELY ? "accepted" : "waiting",
      by: "found",
      conf: Math.round(x.conf * 100) / 100,
      why: x.why,
    };
    return hint;
  });
}

const middle = (h: MapTerrainHint): Position | null => {
  if (h.at) return h.at;
  const pts = h.points;
  if (!pts || pts.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
};

/** Whether two hints are the same thing found twice: one kind, about one place. */
function sameHint(a: MapTerrainHint, b: MapTerrainHint, near: number): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "sea" || a.kind === "coast") return true;
  const ma = middle(a);
  const mb = middle(b);
  return !!ma && !!mb && Math.hypot(ma[0] - mb[0], ma[1] - mb[1]) < near;
}

/**
 * Find again: what the picture says now, merged with the hints there are. The owner's own hints,
 * hints tied to features, rejected ones and ones he moved or changed stay as they are; a found
 * hint that is the same as one of those is not added again.
 */
export function mergeFound(now: readonly Hint[], fresh: readonly Hint[], near: number): Hint[] {
  const kept = now.filter((h) => h.by !== "found" || h.state === "rejected" || h.touched);
  const out = [...kept];
  for (const f of fresh) {
    const was = now.find(
      (h) => h.by === "found" && !h.touched && h.state !== "rejected" && sameHint(h, f, near),
    );
    if (kept.some((k) => sameHint(k, f, near))) continue;
    // A suggestion he already accepted stays accepted when found again.
    out.push(was ? { ...f, id: was.id, state: was.state } : f);
  }
  return out;
}

/** "Mt. Corran", "Mount Arn", "Grey Peak": a marker named as a mountain. */
const PEAK_NAME = /^(mt\.?|mount|mont|monte)\s|\bpeak$|\bpeaks?\s|\bmountain$/i;

/** The shape of a feature as it is drawn, in map positions. */
function shapeOf(space: Space, f: MapFeature): Position[] | null {
  if (f.kind !== "path" && f.kind !== "zone") return null;
  const { line } = outline(space, f.points, {
    curve: f.curve === "smooth",
    closed: f.kind === "zone",
  });
  return line.map(round);
}

/**
 * Hints from the map's own features, by their styles' "counts as": a zone that counts as water is
 * a lake, as mountains a highland, as marsh a marsh; a path that counts as a river is a river, as
 * a road a road. Markers named as mountains are peaks (a suggestion). Each is tied to its feature
 * and takes its shape from it; what the map keeps of one (its state, its height) is kept here.
 */
export function tiedHints(
  space: Space,
  drawn: readonly MapFeature[],
  styles: readonly MapStyle[],
  kept: readonly MapTerrainHint[],
): Hint[] {
  const out: Hint[] = [];
  for (const f of drawn) {
    const by = `feature:${f.id}`;
    const was = kept.find((h) => h.by === by);
    let kind: TerrainHintKind | null = null;
    let at: Position | undefined;
    let points: Position[] | undefined;
    let conf = 1;
    let label = f.label ?? "";
    if (f.kind === "marker" || f.kind === "label") {
      if (!PEAK_NAME.test(label.trim())) continue;
      kind = "peak";
      at = round(f.at);
      conf = 0.6;
    } else {
      const counts = f.style
        ? countsAs(styles.find((s) => s.id === f.style && s.for === f.kind))
        : null;
      const as: Partial<Record<string, TerrainHintKind>> =
        f.kind === "zone"
          ? { water: "lake", mountains: "highland", marsh: "marsh" }
          : { river: "river", road: "road" };
      kind = counts ? (as[counts] ?? null) : null;
      if (!kind) continue;
      points = shapeOf(space, f) ?? undefined;
      label = label || (styles.find((s) => s.id === f.style)?.name ?? "");
    }
    const hint: Hint = {
      ...(was ?? {}),
      id: was?.id ?? newItemId(),
      kind,
      state: was?.state ?? (conf >= LIKELY ? "accepted" : "waiting"),
      by,
      ...(conf < 1 ? { conf } : {}),
      why:
        kind === "peak"
          ? `A marker named ${label}.`
          : `From the ${f.kind} ${label ? `“${label}”` : "on your map"}: its style counts as ${kind === "lake" ? "water" : kind === "highland" ? "mountains" : kind}.`,
    };
    delete hint.at;
    delete hint.points;
    if (at) hint.at = at;
    if (points) hint.points = points;
    out.push(hint);
  }
  return out;
}

/** The hints as the map keeps them: no words, and no shape for a hint tied to a feature. */
export function forStore(hints: readonly Hint[]): MapTerrainHint[] {
  return hints.map((h) => {
    const { why, touched, ...rest } = h;
    void why;
    void touched;
    if (rest.by.startsWith("feature:")) {
      delete rest.at;
      delete rest.points;
    }
    return rest;
  });
}

/** The hints in use, in the worker's pixels. */
export function inUse(
  hints: readonly MapTerrainHint[],
  extent: readonly number[],
  w: number,
  h: number,
): PxHint[] {
  const f = frameOf(extent, w, h);
  const out: PxHint[] = [];
  for (const x of hints) {
    if (x.state !== "accepted") continue;
    const at = x.at ? (toPx(f, x.at) as Px) : undefined;
    const points = x.points ? x.points.map((p) => toPx(f, p) as Px) : undefined;
    if ((POINT_KINDS.includes(x.kind) && !at) || (LINE_KINDS.includes(x.kind) && !points)) continue;
    out.push({
      id: x.id,
      kind: x.kind,
      ...(at ? { at } : {}),
      ...(points ? { points } : {}),
      ...(x.h !== undefined ? { h: x.h } : {}),
      ...(x.h2 !== undefined ? { h2: x.h2 } : {}),
      ...(x.strength !== undefined ? { strength: x.strength } : {}),
      ...(x.flip ? { flip: true } : {}),
    });
  }
  return out;
}

export { hintsHash } from "./hash.ts";

// ---- Words ------------------------------------------------------------------------------------

const RELATIVE: [number, string][] = [
  [0.03, "at sea level"],
  [0.15, "lowland"],
  [0.35, "hills"],
  [0.6, "highland"],
  [0.85, "mountains"],
  [Infinity, "high peaks"],
];

/** A height in words: relative ("hills") until the highest point is given, then in its unit. */
export function heightWords(h: number, top: { value: number; unit: string } | null): string {
  if (top) return `${Math.round(h * top.value).toLocaleString("en")} ${top.unit}`;
  return RELATIVE.find(([below]) => h < below)![1];
}

/** The height a hint holds, as given or by its kind. */
export const heightOf = (h: MapTerrainHint): number => h.h ?? DEFAULT_HEIGHT[h.kind] ?? 0.3;

/** A hint's name in the list: "River, flowing north-east", "Peak · high peaks". */
export function hintName(
  h: MapTerrainHint,
  top: { value: number; unit: string } | null,
  kmPerUnit: number | null,
): string {
  const words = (v: number) => heightWords(v, top);
  const line = (h.points ?? []) as Px[];
  const length = () => {
    let l = 0;
    for (let i = 1; i < line.length; i++) {
      l += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
    }
    return kmPerUnit ? `, ${Math.round(l * kmPerUnit).toLocaleString("en")} km` : "";
  };
  const way = () => (line.length >= 2 ? compass(h.flip ? [...line].reverse() : line) : "");
  switch (h.kind) {
    case "sea":
      return "The sea · below 0";
    case "coast":
      return "The coast · held at 0";
    case "lake":
      return "Lake · flat water in a hollow";
    case "river":
      return `River, flowing ${way()}`;
    case "valley":
      return `Valley, falling ${way()}`;
    case "ridge":
      return `Ridge · ${words(heightOf(h))}${length()}`;
    case "cliff":
      return `Cliff · a step${length()}`;
    case "highland":
      return `Highland · ${words(heightOf(h))} to ${words(h.h2 ?? Math.max(heightOf(h), 0.75))}`;
    case "marsh":
      return "Marsh · very low and flat";
    case "road":
      return "Road · gentle ground";
    default:
      return `${kindName(h.kind)} · ${words(heightOf(h))}`;
  }
}

/** Why a hint is there, for one that has no words of its own (kept from an earlier visit). */
export function reasonOf(h: Hint): string {
  if (h.why) return h.why;
  if (h.by === "you") return "Drawn by you.";
  if (h.by.startsWith("feature:"))
    return "From a feature of your map, by what its style counts as.";
  return "Found in the picture.";
}
