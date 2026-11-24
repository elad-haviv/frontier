/**
 * From a mask of chosen pixels to outlines in the map's positions: traced, refined against the
 * full-size picture, smoothed, simplified (along great circles on a globe), snapped to the zones
 * beside it, and turned into positions. Pieces and holes are kept apart, for zones.ts to decide
 * what to make of them.
 */
import type { Position } from "@frontier/geo";
import { groupRings, type Mask, type Px, traceMask } from "./contour.ts";
import {
  edgeDistance,
  greatCircle,
  arcDegrees,
  type ImageFrame,
  ringToPx,
  shiftNear,
  toPosition,
  wrapRing,
} from "./frame.ts";
import { type FullPicture, refineRing } from "./refine.ts";
import { simplifyRing, smoothRing } from "./simplify.ts";
import { type SnapTarget, snapRing } from "./snapRings.ts";

/** A piece of the found land in the map's positions, with its holes, largest first. */
export interface FoundPiece {
  outer: Position[];
  holes: Position[][];
  /** In square pixels of the picture looked at, to tell pieces apart by size. */
  area: number;
}

export interface OutlineOptions {
  frame: ImageFrame;
  /** How far, in pixels of the picture, the outline may stray from the traced edge. */
  eps: number;
  /** The outlines of other zones to snap to, in positions; none when snapping is off. */
  targets?: readonly Position[][];
  /** The full-size picture, to finish the outline sharp; none when the copy is full size. */
  full?: FullPicture | null;
  /** Whether a point of the picture lies on a drawn line. */
  onLine?: (p: Px) => boolean;
  /** Rings smaller than this many square pixels are dropped. */
  smallest?: number;
}

/**
 * A zone's outline as the picture's pixels, with its edges stepped along great circles on a
 * globe so the plate shows them as the globe draws them.
 */
export function zonePx(frame: ImageFrame, points: readonly Position[]): Px[] {
  if (!frame.sphere) return ringToPx(frame, points);
  const stepped: Position[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const steps = Math.max(1, Math.min(64, Math.ceil(arcDegrees(a, b) / 0.5)));
    stepped.push(...greatCircle(a, b, steps).slice(0, -1));
  }
  return ringToPx(frame, stepped);
}

/** One traced ring, made ready: refined, smoothed, simplified, snapped and placed. */
function finish(ring: Px[], o: OutlineOptions): Position[] {
  const { frame } = o;
  const refined = o.full ? refineRing(ring, o.full, o.onLine ?? (() => false)) : ring;
  const simple = simplifyRing(smoothRing(refined), o.eps, edgeDistance(frame));
  let corners: { px: Px; at?: Position }[] = simple.map((px) => ({ px }));
  if (o.targets && o.targets.length > 0) {
    const centre = simple.reduce((s, p) => s + p[0], 0) / Math.max(1, simple.length);
    const targets: SnapTarget[] = o.targets.map((points) => ({
      points: [...points],
      px: shiftNear(frame, ringToPx(frame, points), centre),
    }));
    corners = snapRing(simple, targets, 5, o.eps);
  }
  const placed = corners.map((c) => c.at ?? toPosition(frame, c.px));
  return wrapRing(frame, placed);
}

/** The outlines of a mask, as pieces with holes in the map's positions, largest first. */
export function outlineMask(mask: Mask, o: OutlineOptions): FoundPiece[] {
  if (mask.w === 0 || mask.h === 0) return [];
  const pieces = groupRings(traceMask(mask, o.smallest ?? 30));
  const out: FoundPiece[] = [];
  for (const piece of pieces) {
    const outer = finish(piece.outer, o);
    if (outer.length < 3) continue;
    const holes = piece.holes.map((h) => finish(h, o)).filter((h) => h.length >= 3);
    out.push({ outer, holes, area: piece.area });
  }
  return out;
}

/** How many points the pieces have, holes included. */
export const pointCount = (pieces: readonly FoundPiece[]): number =>
  pieces.reduce((s, p) => s + p.outer.length + p.holes.reduce((t, h) => t + h.length, 0), 0);
