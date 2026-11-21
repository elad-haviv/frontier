import type { Order } from "@frontier/time";

/** Sizes along the time axis, in pixels. The view picks them for a row or for a column. */
export interface OrderSizes {
  /** The distance between two ranks. */
  unit: number;
  /** Room at each end of a block. */
  pad: number;
  /** Room between two blocks, where the view says they are not related. */
  gap: number;
  /** How far an event reaches before and after its place, mark and name together. */
  eventBefore: number;
  eventAfter: number;
}

export interface PlacedSpan {
  id: string;
  lane: string;
  point: boolean;
  /** Where it begins and ends along the time axis. Equal for an event. */
  t0: number;
  t1: number;
  /** Which of its lane's tracks it sits on, from 0, so spans that overlap do not cover each other. */
  track: number;
}

export interface OrderLayout {
  spans: PlacedSpan[];
  /** One per group: where the block begins and how long it is. */
  blocks: { at: number; length: number }[];
  /** How many tracks each lane needs; at least 1. */
  tracks: Map<string, number>;
  /** The whole length along the time axis. */
  length: number;
}

/**
 * Turns ranks into places. Each group is a block of its own, one after another, so nothing is
 * drawn as before or after something the author did not relate it to.
 */
export function layoutOrder(
  order: Order,
  points: ReadonlySet<string>,
  lanes: readonly string[],
  sizes: OrderSizes,
): OrderLayout {
  const spans: PlacedSpan[] = [];
  const blocks: { at: number; length: number }[] = [];
  let at = 0;
  for (const group of order.groups) {
    const eventAtEnd = group.spans.some((s) => points.has(s.id) && s.end === group.depth);
    const tail = eventAtEnd ? Math.max(sizes.pad, sizes.eventAfter) : sizes.pad;
    const head = Math.max(sizes.pad, sizes.eventBefore);
    const length = head + group.depth * sizes.unit + tail;
    for (const s of group.spans) {
      spans.push({
        id: s.id,
        lane: s.lane,
        point: points.has(s.id),
        t0: at + head + s.start * sizes.unit,
        t1: at + head + s.end * sizes.unit,
        track: 0,
      });
    }
    blocks.push({ at, length });
    at += length + sizes.gap;
  }

  const tracks = new Map<string, number>(lanes.map((id) => [id, 1]));
  for (const lane of new Set(spans.map((s) => s.lane))) {
    const inLane = spans
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.lane === lane)
      .sort((a, b) => a.s.t0 - b.s.t0 || a.i - b.i);
    const ends: number[] = [];
    for (const { s } of inLane) {
      const from = s.point ? s.t0 - sizes.eventBefore : s.t0;
      const to = s.point ? s.t0 + sizes.eventAfter : s.t1;
      let track = ends.findIndex((end) => end <= from);
      if (track === -1) track = ends.length;
      ends[track] = to;
      s.track = track;
    }
    tracks.set(lane, Math.max(1, ends.length));
  }

  return { spans, blocks, tracks, length: Math.max(0, at - sizes.gap) };
}
