/**
 * Everything a map knows about time: which span of a chronicle says when a feature exists,
 * which of its shapes is in force at a year, and how the features are to be drawn then. The
 * overlay and the pointer code are handed features with the right shape already in place.
 */
import {
  type ChronicleFile,
  type ChronicleSpan,
  type LaterShape,
  isLined,
  type MapFeature,
  type MapFile,
  orderFeature,
} from "@frontier/schema";
import { type Presence, type SpanPoints, allSpanPoints, presenceAt } from "@frontier/time";
import { rulerStep, scaleBounds } from "../components/chronicle/scaleLayout.ts";

type Pair = [number, number];
/** A marker's position, or a path's or zone's points. */
export type Shape = { at: Pair } | { points: Pair[] };

/** A chronicle as a map reads it. Worked out once per chronicle, not per frame. */
export interface MapTime {
  chronicle: ChronicleFile;
  points: Map<string, SpanPoints>;
  spans: Map<string, ChronicleSpan>;
  /** The first span in the file for each entry id. */
  byEntry: Map<string, ChronicleSpan>;
  /** The years the slider runs over, or null when nothing is placed in years. */
  range: { from: number; to: number; step: number; latest: number } | null;
}

export function readTime(chronicle: ChronicleFile): MapTime {
  const points = allSpanPoints(chronicle.spans);
  const byEntry = new Map<string, ChronicleSpan>();
  for (const s of chronicle.spans) if (s.entry && !byEntry.has(s.entry)) byEntry.set(s.entry, s);
  const bounds = scaleBounds(points.values());
  let range: MapTime["range"] = null;
  if (bounds) {
    const step = Math.max(1, rulerStep(Math.max(bounds.hi - bounds.lo, 1) / 200));
    // A twentieth of the width beyond each end, and never less than one step, on round years.
    const beyond = Math.max(step, Math.ceil(((bounds.hi - bounds.lo) * 0.05) / step) * step);
    range = {
      from: Math.floor(bounds.lo / step) * step - beyond,
      to: Math.ceil(bounds.hi / step) * step + beyond,
      step,
      latest: Math.round(bounds.hi),
    };
  }
  return {
    chronicle,
    points,
    spans: new Map(chronicle.spans.map((s) => [s.id, s])),
    byEntry,
    range,
  };
}

/** A year as the slider holds it: whole, and inside the range. */
export function clampYear(time: MapTime, year: number): number {
  if (!time.range || !Number.isFinite(year)) return 0;
  return Math.min(time.range.to, Math.max(time.range.from, Math.round(year)));
}

export type SpanFor =
  | { how: "tied" | "entry"; span: ChronicleSpan }
  | { how: "tie_missing" | "no_span" | "timeless"; span: null };

/** Which span of the chosen chronicle says when a feature exists, and by what rule. */
export function spanFor(feature: MapFeature, time: MapTime): SpanFor {
  if (feature.span != null) {
    const span = time.spans.get(feature.span);
    return span ? { how: "tied", span } : { how: "tie_missing", span: null };
  }
  if (feature.entry) {
    const span = time.byEntry.get(feature.entry);
    return span ? { how: "entry", span } : { how: "no_span", span: null };
  }
  return { how: "timeless", span: null };
}

const fits = (feature: MapFeature, shape: LaterShape): boolean => {
  const pairs = (p: unknown): p is Pair[] =>
    Array.isArray(p) && p.every((q) => Array.isArray(q) && q.length === 2);
  if (!isLined(feature)) return Array.isArray(shape.at) && shape.points === undefined;
  return pairs(shape.points) && shape.points.length >= (feature.kind === "zone" ? 3 : 2);
};

/**
 * The year a later shape comes into force, or why it never does: its span is not in this
 * chronicle or has no start that is a number ("unplaced"), or the shape does not fit the
 * feature's kind ("broken").
 */
export function shapeStart(
  feature: MapFeature,
  shape: LaterShape,
  time: MapTime,
): number | "unplaced" | "broken" {
  if (!fits(feature, shape)) return "broken";
  const start = time.points.get(shape.from)?.start;
  return start && Number.isFinite(start.lo) ? start.lo : "unplaced";
}

/** The later shape in force at a year, or null for the feature's first shape. */
export function shapeAt(feature: MapFeature, time: MapTime, year: number): LaterShape | null {
  let best: LaterShape | null = null;
  let from = -Infinity;
  for (const shape of feature.shapes ?? []) {
    const at = shapeStart(feature, shape, time);
    if (typeof at !== "number" || at > year || at < from) continue;
    best = shape;
    from = at;
  }
  return best;
}

/** How far a revolving marker has turned at a year, in degrees, counter-clockwise on screen. */
export function orbitAngle(period: number, year: number): number {
  return ((((360 * year) / period) % 360) + 360) % 360;
}

/** Turns `p` about `centre` by `degrees`, counter-clockwise as seen on a screen whose y runs down. */
export function turnAbout(p: Pair, centre: Pair, degrees: number): Pair {
  const a = (-degrees * Math.PI) / 180;
  const dx = p[0] - centre[0];
  const dy = p[1] - centre[1];
  return [
    centre[0] + dx * Math.cos(a) - dy * Math.sin(a),
    centre[1] + dx * Math.sin(a) + dy * Math.cos(a),
  ];
}

/**
 * Where a revolving marker is drawn at a year, or null when it does not revolve: on a flat map,
 * around a marker that exists, while the map is seen in time. Orbits do not chain: the centre is
 * taken where it is placed at that year, without its own orbit.
 */
export function orbitAt(
  map: MapFile,
  feature: MapFeature,
  time: MapTime | null,
  year: number,
): { centre: Pair; degrees: number } | null {
  if (feature.kind !== "marker" || !feature.orbit || !time || map.space.kind !== "flat")
    return null;
  const centre = map.features.find((f) => f.id === feature.orbit!.around);
  if (!centre || centre.kind !== "marker" || centre.id === feature.id) return null;
  const shape = shapeAt(centre, time, year);
  const at = (shape?.at as Pair | undefined) ?? centre.at;
  return { centre: at, degrees: orbitAngle(feature.orbit.period, year) };
}

/** A feature as it is drawn at one moment. */
export interface Resolved {
  /** The feature with the shape on screen in its `at` or `points`. */
  feature: MapFeature;
  /** The id of the later shape on screen, or null for the first shape. */
  shape: string | null;
  presence: Presence | "timeless" | "no_span";
  opacity: number;
  dashed: boolean;
}

export interface ResolveOptions {
  selected: string | null;
  /** A shape the author chose to edit: drawn for its feature whatever the year. */
  pin: { feature: string; shape: string | null } | null;
  editing: boolean;
  showAll: boolean;
}

export function presenceOf(feature: MapFeature, time: MapTime, year: number): Resolved["presence"] {
  const found = spanFor(feature, time);
  if (found.how === "tie_missing") return "undated";
  if (!found.span) return found.how === "no_span" ? "no_span" : "timeless";
  const points = time.points.get(found.span.id);
  return points ? presenceAt(points, found.span.point, year) : "undated";
}

const withShape = (feature: MapFeature, shape: LaterShape | null): MapFeature =>
  !shape
    ? feature
    : !isLined(feature)
      ? { ...feature, at: shape.at as Pair }
      : ({ ...feature, points: shape.points as Pair[] } as MapFeature);

/**
 * The features as they are drawn at a year, in the map's order. Those that are not yet there, or
 * gone, are left out, unless the author is editing and has one selected or asked to see all.
 */
export function resolve(
  map: MapFile,
  time: MapTime | null,
  year: number,
  options: ResolveOptions,
): Resolved[] {
  if (!time) {
    return map.features.map((feature) => ({
      feature,
      shape: null,
      presence: "timeless",
      opacity: 1,
      dashed: false,
    }));
  }
  const out: Resolved[] = [];
  for (const feature of map.features) {
    const presence = presenceOf(feature, time, year);
    const away = presence === "not_yet" || presence === "gone";
    const kept = options.showAll || feature.id === options.selected;
    if (away && !(options.editing && kept)) continue;
    const pinned = options.pin?.feature === feature.id ? options.pin : null;
    const shape = pinned
      ? ((feature.shapes ?? []).find((h) => h.id === pinned.shape && fits(feature, h)) ?? null)
      : shapeAt(feature, time, year);
    let drawn = withShape(feature, shape);
    const orbit = orbitAt(map, feature, time, year);
    if (orbit && drawn.kind === "marker") {
      drawn = { ...drawn, at: turnAbout(drawn.at, orbit.centre, orbit.degrees) };
    }
    out.push({
      feature: drawn,
      shape: shape?.id ?? null,
      presence,
      opacity: away ? 0.25 : presence === "perhaps" ? 0.45 : 1,
      dashed: presence === "undated",
    });
  }
  return out;
}

/** Writes a shape into a feature: into the later shape with this id, or the first shape. */
export function writeShape(feature: MapFeature, shapeId: string | null, shape: Shape): MapFeature {
  if (shapeId === null) return orderFeature({ ...feature, ...shape } as MapFeature);
  return orderFeature({
    ...feature,
    shapes: (feature.shapes ?? []).map((h) => {
      if (h.id !== shapeId) return h;
      const rest: Record<string, unknown> = { ...h };
      delete rest.at;
      delete rest.points;
      return { ...rest, ...shape };
    }),
  } as MapFeature);
}

/** The shape a feature has on screen, read back from a resolved feature. */
export function shapeOf(feature: MapFeature): Shape {
  if (feature.kind === "route") return { points: [] };
  return !isLined(feature) ? { at: feature.at } : { points: feature.points };
}

export function addShape(feature: MapFeature, id: string, from: string, shape: Shape): MapFeature {
  return orderFeature({
    ...feature,
    shapes: [...(feature.shapes ?? []), { id, from, ...shape }],
  } as MapFeature);
}

export function removeShape(feature: MapFeature, id: string): MapFeature {
  return orderFeature({
    ...feature,
    shapes: (feature.shapes ?? []).filter((h) => h.id !== id),
  } as MapFeature);
}

/** Ties a feature to a span, or unties it with null. */
export function tie(feature: MapFeature, span: string | null): MapFeature {
  const rest: Record<string, unknown> = { ...feature };
  delete rest.span;
  return orderFeature((span === null ? rest : { ...rest, span }) as MapFeature);
}

/** The years at which something on this map changes, in order, inside the slider's range. */
export function changeYears(map: MapFile, time: MapTime): number[] {
  if (!time.range) return [];
  const years = new Set<number>();
  const add = (year: number | undefined) => {
    if (year === undefined || !Number.isFinite(year)) return;
    years.add(clampYear(time, year));
  };
  for (const feature of map.features) {
    const { span } = spanFor(feature, time);
    const points = span && time.points.get(span.id);
    if (points) {
      add(points.start?.lo);
      add(points.start?.hi);
      if (!span.point) {
        add(points.end?.lo);
        add(points.end?.hi);
        // The first year at which it is surely over.
        if (points.end && Number.isFinite(points.end.hi)) add(Math.floor(points.end.hi) + 1);
      }
    }
    for (const shape of feature.shapes ?? []) {
      const at = shapeStart(feature, shape, time);
      if (typeof at === "number") add(Math.ceil(at));
    }
  }
  return [...years].sort((a, b) => a - b);
}

export interface TimeCounts {
  follows: number;
  undated: number;
  noSpan: number;
  timeless: number;
}

/** How the features of the shown layers stand to the chosen chronicle. */
export function countFeatures(
  map: MapFile,
  time: MapTime,
  hidden: ReadonlySet<string>,
): TimeCounts {
  const counts = { follows: 0, undated: 0, noSpan: 0, timeless: 0 };
  for (const feature of map.features) {
    if (hidden.has(feature.layer) || hidden.has(feature.id)) continue;
    const found = spanFor(feature, time);
    const points = found.span && time.points.get(found.span.id);
    const numbered = points && (found.span!.point ? points.start : points.start || points.end);
    if (found.how === "tie_missing" || (found.span && !numbered)) counts.undated += 1;
    else if (found.span) counts.follows += 1;
    else if (found.how === "no_span") counts.noSpan += 1;
    else if ((feature.shapes ?? []).length > 0) counts.follows += 1;
    else counts.timeless += 1;
  }
  return counts;
}

const yearText = (lo: number, hi: number): string =>
  lo === hi ? `year ${Math.round(lo)}` : `year ${Math.round(lo)} to ${Math.round(hi)}`;

/** Why a feature is faded, dashed or hidden at this year, in words; null when there is nothing to say. */
export function reasonFor(
  feature: MapFeature,
  time: MapTime,
  year: number,
  nameOf: (span: ChronicleSpan) => string,
): string | null {
  const found = spanFor(feature, time);
  if (found.how === "tie_missing") return "Undated: tied to a span that is not in this chronicle.";
  if (!found.span) return null;
  const points = time.points.get(found.span.id);
  if (!points) return null;
  const { start, end } = points;
  const begins = start && Number.isFinite(start.lo) ? yearText(start.lo, start.hi) : null;
  const ended = end && Number.isFinite(end.lo) ? yearText(end.lo, end.hi) : null;
  switch (presenceAt(points, found.span.point, year)) {
    case "undated":
      return `Undated: ${nameOf(found.span)} has no numbers that say when.`;
    case "not_yet":
      return begins && `Not yet: begins ${begins}.`;
    case "gone":
      return ended && `Gone: ended ${ended}.`;
    case "perhaps":
      // Either its start may still lie ahead, or its end may already be past.
      return start && year < start.hi
        ? begins && `Perhaps: begins ${begins}.`
        : ended && `Perhaps: ends ${ended}.`;
    default:
      return null;
  }
}
