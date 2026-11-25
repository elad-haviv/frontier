/**
 * The geometry of a star map: a camera that turns about a point, the flat plane that places are
 * put on, and the distances between places. Everything here is pure, so the page only draws.
 *
 * Axes: x runs "coreward", y "spinward", z up from the plane. A place is `{ x, y, z }` in the
 * map's own unit (light-years by default).
 */

export type Point3 = { x: number; y: number; z: number };

export type Camera = {
  /** Turn about the vertical axis, in radians. */
  yaw: number;
  /** Looking along the plane (small) to straight down (π/2). */
  pitch: number;
  /** Pixels per unit at the centre of the view. */
  zoom: number;
  /** The point the camera turns about. */
  target: Point3;
};

export type Screen = { x: number; y: number; depth: number; scale: number };

/** How far the eye is from the target, in pixels: it sets how strong the perspective is. */
export const EYE = 900;
export const MIN_PITCH = 0.16;
export const MAX_PITCH = Math.PI / 2;
export const MIN_ZOOM = 6;
export const MAX_ZOOM = 160;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function makeCamera(): Camera {
  return { yaw: 0.55, pitch: 0.6, zoom: 22, target: { x: 0, y: 0, z: 0 } };
}

/** Where a place falls on a screen of this size, or null when it is behind the camera. */
export function project(cam: Camera, p: Point3, width: number, height: number): Screen | null {
  const dx = p.x - cam.target.x;
  const dy = p.y - cam.target.y;
  const dz = p.z - cam.target.z;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const x1 = (dx * cy - dy * sy) * cam.zoom;
  const y1 = (dx * sy + dy * cy) * cam.zoom;
  const z1 = dz * cam.zoom;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const depth = y1 * cp - z1 * sp;
  const den = EYE + depth;
  if (den < EYE * 0.15) return null;
  const scale = EYE / den;
  return { x: width / 2 + x1 * scale, y: height / 2 - (y1 * sp + z1 * cp) * scale, depth, scale };
}

/**
 * The place on the plane at a given height that lies under a screen point: where a click lands
 * when a marker is put down, or a marker is slid level. Null when the point looks at the sky.
 */
export function pointOnPlane(
  cam: Camera,
  sx: number,
  sy: number,
  height: number,
  width: number,
  heightPx: number,
): Point3 | null {
  const a = sx - width / 2;
  const b = heightPx / 2 - sy;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const z1 = (height - cam.target.z) * cam.zoom;
  const den = b * cp - EYE * sp;
  if (Math.abs(den) < 1e-6) return null;
  const y1 = (EYE * z1 * cp - EYE * b + b * z1 * sp) / den;
  const depth = y1 * cp - z1 * sp;
  if (EYE + depth < EYE * 0.15 || EYE + depth > EYE * 6) return null;
  const x1 = (a * (EYE + depth)) / EYE;
  const ux = x1 / cam.zoom;
  const uy = y1 / cam.zoom;
  const cy = Math.cos(cam.yaw);
  const sy2 = Math.sin(cam.yaw);
  return {
    x: cam.target.x + ux * cy + uy * sy2,
    y: cam.target.y - ux * sy2 + uy * cy,
    z: height,
  };
}

export const distance = (a: Point3, b: Point3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The length of a route through these places, in the map's unit. */
export function routeLength(stops: Point3[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distance(stops[i - 1]!, stops[i]!);
  return total;
}

/** Days at a given speed (units a day), at least one; null when no speed is known. */
export function travelDays(length: number, speed: number | undefined): number | null {
  if (!speed || speed <= 0) return null;
  return Math.max(1, Math.round(length / speed));
}

/** Rounds to a tenth, as places are kept. */
export const tenth = (v: number): number => Math.round(v * 10) / 10;

/** A number for a person: one decimal, a real minus sign, no "-0.0". */
export function numberText(v: number, digits = 1): string {
  const t = v.toFixed(digits);
  return (Number(t) === 0 ? (0).toFixed(digits) : t).replace("-", "−");
}

/** Where a place is, in words: its height against the plane. */
export function heightText(z: number, unit: string): string {
  if (Math.abs(z) < 0.05) return "on the plane";
  return `${numberText(Math.abs(z))} ${unit} ${z > 0 ? "above" : "below"} the plane`;
}

/** A camera that keeps a view of everything: centred on the places, zoomed to fit the screen. */
export function fitCamera(cam: Camera, points: Point3[], width: number, height: number): Camera {
  if (points.length === 0) {
    return {
      ...cam,
      target: { x: 0, y: 0, z: 0 },
      zoom: clamp(Math.min(width, height) / 27, 9, 26),
    };
  }
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    for (const k of ["x", "y", "z"] as const) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  const span = Math.max(hi.x - lo.x, hi.y - lo.y, (hi.z - lo.z) * 1.3, 6);
  return {
    ...cam,
    target: { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 },
    zoom: clamp((Math.min(width, height) * 0.62) / span, MIN_ZOOM, 60),
  };
}

/** The dot a place makes: radius in pixels by its size, and how far away fades it. */
export function dotRadius(size: 1 | 2 | 3, scale: number): number {
  return [3, 4.5, 6][size - 1]! * clamp(scale, 0.6, 1.35);
}

export function fade(scale: number): number {
  return clamp(0.55 + (0.45 * (scale - 0.6)) / 0.5, 0.55, 1);
}

/**
 * The nearest of some screen points to a pointer, within a reach (larger for a finger).
 * `points` are in drawing order; ties go to the later one, which is drawn on top.
 */
export function nearest<T extends { x: number; y: number; reach?: number }>(
  points: T[],
  x: number,
  y: number,
  reach: number,
): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= Math.max(reach, p.reach ?? 0) && d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** The distance from a screen point to a segment, in pixels. */
export function toSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
  const u = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2, 0, 1);
  return Math.hypot(px - (ax + u * (bx - ax)), py - (ay + u * (by - ay)));
}
