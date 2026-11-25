/**
 * Work small, finish sharp: the areas are found on a copy of the picture of at most 2 megapixels,
 * so a traced outline can be a source pixel or two off. Each traced point is moved, across the
 * outline, to where the full-size picture says the edge is: the darkest point of a drawn line, or
 * the steepest change of colour. Only a short strip across the outline is read.
 */
import type { Px } from "./contour.ts";

export interface FullPicture {
  /** Full-size pixels per pixel of the working copy. */
  scale: number;
  /** The colour of a full-size pixel, as red, green and blue 0–255. */
  sample: (x: number, y: number) => [number, number, number];
}

/** How far a point may move, either way, in pixels of the working copy. */
export const REFINE_REACH = 2.5;

export function refineRing(
  ring: readonly Px[],
  full: FullPicture,
  /** Whether the outline runs along a drawn line at this point of the working copy. */
  onLine: (p: Px) => boolean,
): Px[] {
  const n = ring.length;
  if (n < 3 || full.scale < 1.2) return [...ring];
  const count = Math.min(41, Math.round(2 * REFINE_REACH * full.scale) + 1);
  const step = (2 * REFINE_REACH) / (count - 1);
  const toFull = (v: number) => Math.round((v + 0.5) * full.scale - 0.5);
  const lum = new Float32Array(count);
  const rgb = new Float32Array(count * 3);
  return ring.map((p, i) => {
    const a = ring[(i - 1 + n) % n]!;
    const b = ring[(i + 1) % n]!;
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty);
    if (tl === 0) return p;
    const nx = -ty / tl;
    const ny = tx / tl;
    for (let k = 0; k < count; k++) {
      const t = -REFINE_REACH + k * step;
      const [r, g, bl] = full.sample(toFull(p[0] + t * nx), toFull(p[1] + t * ny));
      rgb[k * 3] = r;
      rgb[k * 3 + 1] = g;
      rgb[k * 3 + 2] = bl;
      lum[k] = 0.299 * r + 0.587 * g + 0.114 * bl;
    }
    let best = -1;
    if (onLine(p)) {
      // The darkest point of the line, preferring to stay put when two are alike.
      let lo = Infinity;
      let hi = -Infinity;
      let cost = Infinity;
      for (let k = 0; k < count; k++) {
        const t = -REFINE_REACH + k * step;
        lo = Math.min(lo, lum[k]!);
        hi = Math.max(hi, lum[k]!);
        const c = lum[k]! + 2 * Math.abs(t);
        if (c < cost) {
          cost = c;
          best = k;
        }
      }
      if (hi - lo < 20) return p;
      const t = -REFINE_REACH + best * step;
      return [p[0] + t * nx, p[1] + t * ny];
    }
    // The steepest change of colour between two neighbouring samples.
    let most = 0;
    for (let k = 0; k + 1 < count; k++) {
      const d = Math.hypot(
        rgb[k * 3]! - rgb[k * 3 + 3]!,
        rgb[k * 3 + 1]! - rgb[k * 3 + 4]!,
        rgb[k * 3 + 2]! - rgb[k * 3 + 5]!,
      );
      if (d > most) {
        most = d;
        best = k;
      }
    }
    if (most < 12 || best < 0) return p;
    const t = -REFINE_REACH + (best + 0.5) * step;
    return [p[0] + t * nx, p[1] + t * ny];
  });
}
