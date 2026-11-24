import { spanPoints } from "./points.js";
import { subtractRanges } from "./rough.js";
import type { Range, Relation, Span } from "./types.js";

/** A start, an end, or both, offered to the author for one span. At least one is not null. */
export interface Offer {
  readonly start: Range | null;
  readonly end: Range | null;
}

// An open start or end is not a number that could be written into a start or end, so an offer
// that would reach one is not made.
function finite(offer: Offer): Offer | null {
  for (const range of [offer.start, offer.end]) {
    if (range && !(Number.isFinite(range.lo) && Number.isFinite(range.hi))) return null;
  }
  return offer;
}

/**
 * What the design's table offers for A in "A kind B". `mover` is A and `other` is B. Null
 * where the table offers nothing or what it needs is missing.
 */
export function offerFor(kind: string, mover: Span, other: Span): Offer | null {
  const a = spanPoints(mover);
  const b = spanPoints(other);
  switch (kind) {
    case "after":
      return b.end && finite({ start: b.end, end: null });
    case "before":
      if (!b.start) return null;
      // An event has no end to set: its one point goes where the end would.
      if (mover.point) return finite({ start: b.start, end: null });
      return finite({ start: a.length && subtractRanges(b.start, a.length), end: b.start });
    case "during": {
      if (!b.start || !b.end) return null;
      const start = { lo: b.start.lo, hi: b.end.hi - (a.length?.hi ?? 0) };
      // A is longer than B has room for, so no start would put it inside.
      if (start.hi < start.lo) return null;
      return finite({ start, end: null });
    }
    case "starts_with":
      return b.start && finite({ start: b.start, end: null });
    case "ends_with":
      if (!b.end) return null;
      return finite(mover.point ? { start: b.end, end: null } : { start: null, end: b.end });
    case "overlaps":
      if (!b.start || !b.end) return null;
      return finite({ start: { lo: b.start.lo, hi: b.end.hi }, end: null });
    default:
      return null;
  }
}

// "B kind A" said from B's side. The table has no row for "B contains A", so moving B on a
// `during` offers nothing: reading the `during` row with the two exchanged would put B inside
// A, the opposite of what was said.
const EXCHANGED: Record<string, string | undefined> = {
  after: "before",
  before: "after",
  starts_with: "starts_with",
  ends_with: "ends_with",
  overlaps: "overlaps",
};

/**
 * The offer for one span of a relation: "Move A" or "Move B" on a red flag, or the unplaced
 * span when a relation is added.
 */
export function offerMove(
  relation: Pick<Relation, "a" | "kind" | "b">,
  move: "a" | "b",
  spans: readonly Span[],
): Offer | null {
  const a = spans.find((s) => s.id === relation.a);
  const b = spans.find((s) => s.id === relation.b);
  if (!a || !b) return null;
  if (move === "a") return offerFor(relation.kind, a, b);
  const kind = EXCHANGED[relation.kind];
  return kind ? offerFor(kind, b, a) : null;
}
