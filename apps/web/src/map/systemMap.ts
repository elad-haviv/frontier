/**
 * A system model's file: each body is a marker with a `body` record, so it can have a name, an
 * entry and a map of this place like any marker. These functions turn the file into the bodies
 * `orbits.ts` works on, and make the edits, each returning the next map.
 */
import type { MapFeature, MapFile } from "@frontier/schema";
import {
  type Body,
  type BodyType,
  companion,
  distanceFor,
  drawnPosition,
  drawnRadius,
  drawnRadiusInverse,
  isLocal,
  isStar,
  localRadius,
  localRadiusInverse,
  makeBody,
  meanAnomaly,
  orbitAt,
  period,
  type Point,
  PRESETS,
  primary,
  type Scale,
  totalMass,
} from "./orbits.ts";
import { newItemId } from "./viewUrl.ts";

export type BodyFeature = Extract<MapFeature, { kind: "marker" }> & {
  body: NonNullable<BodyRecord>;
};
type BodyRecord = Extract<MapFeature, { kind: "marker" }>["body"];

export const hasBody = (f: MapFeature): f is BodyFeature =>
  f.kind === "marker" && f.body !== undefined;

/** The features that are bodies, in file order. */
export const bodyFeatures = (map: MapFile): BodyFeature[] => map.features.filter(hasBody);

/** The bodies of a map, as `orbits.ts` wants them. */
export function bodiesOf(map: MapFile): Body[] {
  const star = bodyFeatures(map).find((f) => f.body.type === "star");
  return bodyFeatures(map).map((f) => {
    const r = f.body;
    const base = makeBody(f.id, r.type, {});
    return {
      ...base,
      // A body with no parent circles the star at the centre; the stars circle nothing.
      parent: r.type === "star" || r.type === "companion" ? null : (r.parent ?? star?.id ?? null),
      a: r.a,
      e: r.e ?? 0,
      phase: r.phase ?? 0,
      peri: r.peri ?? 0,
      retro: r.retro ?? false,
      mass: r.mass ?? 1,
      inner: r.inner ?? 0,
      outer: r.outer ?? 0,
      home: r.home ?? false,
    };
  });
}

/** The colour a body is drawn in: its own, else its kind's. */
export const colourOf = (f: BodyFeature): string => f.tone ?? PRESETS[f.body.type].colour;

const record = (b: Body): NonNullable<BodyRecord> => {
  const r: Record<string, unknown> = { type: b.type, a: round(b.a) };
  if (b.parent) r.parent = b.parent;
  if (b.e) r.e = round(b.e, 1000);
  if (b.phase) r.phase = round(b.phase);
  if (b.peri) r.peri = round(b.peri);
  if (b.retro) r.retro = true;
  if (isStar(b)) r.mass = b.mass;
  if (b.type === "belt") {
    r.inner = round(b.inner);
    r.outer = round(b.outer);
  }
  if (b.home) r.home = true;
  return r as NonNullable<BodyRecord>;
};

const round = (v: number, k = 10000) => Math.round(v * k) / k;

/** A system model begins with its star at the centre. */
export function firstStar(map: MapFile, layer: string, name = "The star"): MapFile {
  const id = newItemId();
  const f = {
    id,
    kind: "marker",
    layer,
    at: [0, 0],
    entry: null,
    label: name,
    icon: null,
    child: null,
    body: { type: "star", a: 0, mass: 1 },
  } as unknown as MapFeature;
  return { ...map, features: [...map.features, f] };
}

/** Puts a body in the file: kind, what it circles, distance, and where it is at the given day. */
export function addBody(
  map: MapFile,
  layer: string,
  type: BodyType,
  parent: string | null,
  a: number,
  angle: number,
  day: number,
): { map: MapFile; id: string } {
  const bodies = bodiesOf(map);
  const id = newItemId();
  const body = makeBody(id, type, {
    parent,
    a,
    e: type === "comet" ? 0.85 : 0,
    peri: type === "comet" ? angle + Math.PI : 0,
  });
  if (type === "belt") {
    body.inner = a * 0.88;
    body.outer = a * 1.12;
  }
  if (type === "companion") {
    body.parent = null;
    body.mass = 0.6;
    body.a = Math.min(a, 3);
  }
  if (type === "comet") body.a = a / 1.85;
  // Where it is at this day is where it was put: the phase is what makes that so.
  const all = [...bodies, body];
  const P = period(body, all);
  body.phase =
    type === "comet" ? Math.PI - (2 * Math.PI * day) / P : angle - (2 * Math.PI * day) / P;
  if (type === "belt") body.phase = 0;
  const f = {
    id,
    kind: "marker",
    layer,
    at: [0, 0],
    entry: null,
    label: `New ${PRESETS[type].label.toLowerCase()}`,
    icon: null,
    child: null,
    body: record(body),
  } as unknown as MapFeature;
  return { map: { ...map, features: [...map.features, f] }, id };
}

/** Changes a body's numbers and flags; a change of distance or shape keeps it where it is on the given day. */
export function patchBody(
  map: MapFile,
  id: string,
  fields: Partial<Body>,
  keepAt?: number,
): MapFile {
  const bodies = bodiesOf(map);
  const was = bodies.find((b) => b.id === id);
  if (!was) return map;
  let next: Body = { ...was, ...fields };
  if (
    keepAt !== undefined &&
    (fields.a !== undefined || fields.retro !== undefined) &&
    was.type !== "star"
  ) {
    const all = bodies.map((b) => (b.id === id ? next : b));
    const before = ((was.retro ? -1 : 1) * 2 * Math.PI * keepAt) / period(was, bodies) + was.phase;
    next = {
      ...next,
      phase: before - ((next.retro ? -1 : 1) * 2 * Math.PI * keepAt) / period(next, all),
    };
  }
  return replaceRecord(map, id, record(next));
}

/** Sets a body's distance so that one circuit takes this many days. */
export function setCircuit(map: MapFile, id: string, days: number, keepAt: number): MapFile {
  const bodies = bodiesOf(map);
  const b = bodies.find((x) => x.id === id);
  if (!b || !(days > 0)) return map;
  return patchBody(map, id, { a: distanceFor(b, days, bodies) }, keepAt);
}

function replaceRecord(map: MapFile, id: string, rec: NonNullable<BodyRecord>): MapFile {
  return {
    ...map,
    features: map.features.map((f) =>
      f.id === id && hasBody(f) ? ({ ...f, body: { ...f.body, ...rec } } as MapFeature) : f,
    ),
  };
}

/** Makes one body the home world, whose circuit is the year. */
export function setHome(map: MapFile, id: string | null): MapFile {
  return {
    ...map,
    features: map.features.map((f) => {
      if (!hasBody(f)) return f;
      const body = { ...f.body } as Record<string, unknown>;
      if (f.id === id) body.home = true;
      else delete body.home;
      return { ...f, body } as MapFeature;
    }),
  };
}

/** Removes a body and everything that circles it. The first star cannot be removed. */
export function removeBody(map: MapFile, id: string): MapFile {
  const bodies = bodiesOf(map);
  const target = bodies.find((b) => b.id === id);
  if (!target || target.type === "star") return map;
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of bodies) {
      if (b.parent && gone.has(b.parent) && !gone.has(b.id)) {
        gone.add(b.id);
        grew = true;
      }
    }
  }
  return { ...map, features: map.features.filter((f) => !gone.has(f.id)) };
}

/** Whether the system already has two stars. */
export const hasPair = (map: MapFile): boolean => companion(bodiesOf(map)) !== undefined;

/** Planets a moon or station may circle: not stars, belts, comets or other moons. */
export function planetsOf(bodies: Body[]): Body[] {
  return bodies.filter(
    (b) => !isStar(b) && b.type !== "belt" && b.type !== "comet" && !isLocal(b, bodies),
  );
}

const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Moves a body by dragging it to a place on the drawing: outward or inward changes its distance,
 * and round about its parent changes where it is on the given day. A second star's drag changes how
 * far apart the two are. A belt and the first star do not drag.
 */
export function dragBody(map: MapFile, id: string, to: Point, day: number, scale: Scale): MapFile {
  const bodies = bodiesOf(map);
  const b = bodies.find((x) => x.id === id);
  if (!b || b.type === "belt" || b.type === "star") return map;
  if (b.type === "companion") {
    const star = primary(bodies);
    if (!star) return map;
    const share = star.mass / totalMass(bodies);
    const a = clampTo(drawnRadiusInverse(Math.hypot(to.x, to.y) / share, scale), 0.05, 3);
    return patchBody(map, id, { a: Math.round(a * 100) / 100 }, day);
  }
  const local = isLocal(b, bodies);
  const parent = bodies.find((x) => x.id === b.parent);
  const origin = local && parent ? drawnPosition(parent, day, bodies, scale) : { x: 0, y: 0 };
  const dx = to.x - origin.x;
  const dy = to.y - origin.y;
  const now = orbitAt(b, meanAnomaly(b, day, bodies));
  const wanted = local
    ? localRadiusInverse(Math.hypot(dx, dy))
    : drawnRadiusInverse(Math.hypot(dx, dy), scale);
  const a = clampTo((b.a * wanted) / now.r, local ? 60 : 0.08, local ? 5000 : 80);
  const kept = patchBody(map, id, { a: local ? Math.round(a) : Math.round(a * 100) / 100 }, day);
  const after = bodiesOf(kept);
  const nb = after.find((x) => x.id === id)!;
  const o = orbitAt(nb, meanAnomaly(nb, day, after));
  let turn = Math.atan2(dy, dx) - o.theta;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  return patchBody(kept, id, { phase: nb.phase + (nb.retro ? -1 : 1) * turn });
}

/** Where a new body of a kind would go if put at a place on the drawing. */
export interface Placement {
  parent: string | null;
  /** Distance: AU, or thousand km round a planet. */
  a: number;
  /** Drawn radius of its orbit, in pixels at the normal view. */
  px: number;
  /** The angle about its parent. */
  angle: number;
}

export function placement(
  map: MapFile,
  type: BodyType,
  at: Point,
  day: number,
  scale: Scale,
): Placement | null {
  const bodies = bodiesOf(map);
  const star = primary(bodies);
  if (!star) return null;
  if (PRESETS[type].local) {
    let best: Body | null = null;
    let bd = Infinity;
    for (const b of planetsOf(bodies)) {
      const p = drawnPosition(b, day, bodies, scale);
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return null;
    const p = drawnPosition(best, day, bodies, scale);
    const a = clampTo(localRadiusInverse(bd), 80, 4000);
    return { parent: best.id, a, px: localRadius(a), angle: Math.atan2(at.y - p.y, at.x - p.x) };
  }
  const a = clampTo(drawnRadiusInverse(Math.hypot(at.x, at.y), scale), 0.1, 60);
  return { parent: star.id, a, px: drawnRadius(a, scale), angle: Math.atan2(at.y, at.x) };
}
