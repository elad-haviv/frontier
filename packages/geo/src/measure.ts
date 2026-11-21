/** Distances in a map's space. Each space measures in its own way. */
import { geoDistance, geoInterpolate } from "d3-geo";
import type { Position, Space } from "./space.js";

export interface Length {
  /** On a sphere: the angle in degrees along great circles. On a flat map: map pixels. */
  raw: number;
  /** On a sphere: the share of the full circumference, from 0 to 1 and beyond for long paths. */
  fraction: number | null;
  /** The real distance, when the map has a radius or a scale. */
  distance: number | null;
  unit: string;
}

/** The length of a line through the given positions. */
export function measure(space: Space, points: Position[]): Length {
  let raw = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    raw +=
      space.kind === "sphere"
        ? (geoDistance(a, b) * 180) / Math.PI
        : Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (space.kind === "sphere") {
    return {
      raw,
      fraction: raw / 360,
      distance: space.radius === null ? null : ((raw * Math.PI) / 180) * space.radius,
      unit: space.unit,
    };
  }
  return {
    raw,
    fraction: null,
    distance: space.scale === null ? null : raw * space.scale,
    unit: space.unit,
  };
}

/** The scale (units per pixel) at which a measured line has the given real length. */
export function scaleFrom(points: Position[], realLength: number): number | null {
  let pixels = 0;
  for (let i = 1; i < points.length; i++) {
    pixels += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return pixels > 0 && realLength > 0 ? realLength / pixels : null;
}

/**
 * The positions to draw a line through. On a sphere each stretch follows the great circle, in
 * steps of at most `stepDegrees`, and longitudes run on without jumping at the 180th meridian so
 * the result can be drawn as one continuous line.
 */
export function densify(space: Space, points: Position[], stepDegrees = 3): Position[] {
  if (space.kind === "flat" || points.length < 2) return points.map((p) => [p[0], p[1]]);
  const out: Position[] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const steps = Math.max(1, Math.ceil((geoDistance(a, b) * 180) / Math.PI / stepDegrees));
    const at = geoInterpolate(a, b);
    for (let s = 1; s <= steps; s++) {
      const p = s === steps ? b : at(s / steps);
      const previous = out[out.length - 1]!;
      let lon = p[0];
      while (lon - previous[0] > 180) lon -= 360;
      while (lon - previous[0] < -180) lon += 360;
      out.push([lon, p[1]]);
    }
  }
  return out;
}
