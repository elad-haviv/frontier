/** A touch's place, in pixels from the panel's left edge and its top. */
export interface Point {
  x: number;
  y: number;
}

/** A swipe back starts this near the panel's left edge, so it is not mistaken for a tap or scroll. */
export const EDGE = 32;
/** It must travel at least this far to the right. */
export const DISTANCE = 56;

/**
 * Whether a touch that began at `from` and ended at `to` is a swipe right from the panel's left
 * edge: the way back from the library to the menu. A mostly vertical gesture is a scroll of the
 * folders and never counts.
 */
export function isSwipeBack(from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = Math.abs(to.y - from.y);
  return from.x <= EDGE && dx >= DISTANCE && dx > dy * 1.5;
}
