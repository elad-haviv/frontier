import type { Range, SpanPoints } from "@frontier/time";

export interface ScaleSizes {
  /** How far an event reaches before and after its place, mark and name together. */
  eventBefore: number;
  eventAfter: number;
  /** How long a broken edge is drawn, for a span whose other end is not known. */
  open: number;
  /** A bar narrower than this is drawn as a tick and marked "not to scale". */
  least: number;
  /** The width a tick is given so it can be seen and tapped. */
  tick: number;
  /** The least distance between two marks of the ruler. */
  mark: number;
}

export interface ScaleSpan {
  id: string;
  lane: string;
  point: boolean;
  /** Where it is drawn from and to along the time axis. */
  t0: number;
  t1: number;
  track: number;
  /** How much of each end fades: the width of the start's and the end's range. */
  fade0: number;
  fade1: number;
  /** A broken edge: the start is older than shown or not known; the end goes on or is not known. */
  openStart: boolean;
  openEnd: boolean;
  /** True when the bar was too narrow to draw at its true width. */
  small: boolean;
}

export interface ScaleLayout {
  spans: ScaleSpan[];
  tracks: Map<string, number>;
  /** The whole length along the time axis, in pixels. */
  length: number;
  /** The marks of the ruler. */
  marks: { at: number; year: number }[];
  /** Spans with a length and no place: drawn apart, at their length. */
  notPlaced: { id: string; lane: string; low: number; high: number }[];
  /** Spans with no number at all. */
  unnumbered: string[];
  /** Pixels per year, for drawing a length that has no place. */
  perYear: number;
}

interface In {
  id: string;
  lane: string;
  point: boolean;
}

const finite = (r: Range | null): r is Range =>
  r !== null && Number.isFinite(r.lo) && Number.isFinite(r.hi);

/** The earliest and latest year any placed point may be, or null when nothing is placed. */
export function scaleBounds(points: Iterable<SpanPoints>): Range | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    for (const r of [p.start, p.end]) {
      if (!finite(r)) continue;
      lo = Math.min(lo, r.lo);
      hi = Math.max(hi, r.hi);
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

/** A round step in years so that marks are at least `least` years apart: 1, 2 or 5 times ten. */
export function rulerStep(least: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(least, 1e-9)));
  for (const m of [1, 2, 5, 10]) if (m * power >= least) return Math.max(1, m * power);
  return Math.max(1, 10 * power);
}

/**
 * Places spans on a straight ruler in years. `room` is the length in pixels the placed years are
 * fitted into; zooming is asking for more room.
 */
export function layoutScale(
  spans: readonly In[],
  points: ReadonlyMap<string, SpanPoints>,
  lanes: readonly string[],
  room: number,
  sizes: ScaleSizes,
  /** The years to rule, when two chronicles share one ruler; otherwise fitted to what is placed. */
  within: Range | null = null,
): ScaleLayout {
  const bounds = within ?? scaleBounds(points.values());
  const tracks = new Map<string, number>(lanes.map((id) => [id, 1]));
  const notPlaced: ScaleLayout["notPlaced"] = [];
  const unnumbered: string[] = [];
  if (!bounds) {
    for (const s of spans) {
      const length = points.get(s.id)?.length;
      if (!s.point && finite(length ?? null) && length!.hi > 0) {
        notPlaced.push({ id: s.id, lane: s.lane, low: length!.lo, high: length!.hi });
      } else unnumbered.push(s.id);
    }
    const most = Math.max(1, ...notPlaced.map((n) => n.high));
    return {
      spans: [],
      tracks,
      length: 0,
      marks: [],
      notPlaced,
      unnumbered,
      perYear: room / most,
    };
  }

  // A single moment still needs some years around it to be drawn in.
  const width = Math.max(bounds.hi - bounds.lo, 1);
  const edge = Math.max(sizes.open + sizes.eventBefore, room * 0.04);
  const perYear = Math.max(room - 2 * edge, 1) / width;
  const length = edge * 2 + width * perYear;
  const x = (year: number): number => edge + (year - bounds.lo) * perYear;

  const placed: ScaleSpan[] = [];
  for (const s of spans) {
    const p = points.get(s.id);
    const start = p?.start ?? null;
    const end = p?.end ?? null;
    const blank = { id: s.id, lane: s.lane, point: s.point, track: 0, small: false };
    if (s.point) {
      if (!start) {
        unnumbered.push(s.id);
        continue;
      }
      // An event older than shown sits at the edge, with room for its mark.
      const at = finite(start) ? x((start.lo + start.hi) / 2) : sizes.eventBefore;
      const fade = finite(start) ? ((start.hi - start.lo) * perYear) / 2 : 0;
      placed.push({
        ...blank,
        t0: at,
        t1: at,
        fade0: fade,
        fade1: fade,
        openStart: !finite(start),
        openEnd: false,
      });
      continue;
    }
    if (!start && !end) {
      const len = p?.length ?? null;
      if (finite(len) && len.hi > 0) {
        notPlaced.push({ id: s.id, lane: s.lane, low: len.lo, high: len.hi });
      } else unnumbered.push(s.id);
      continue;
    }
    // Each end is drawn where it may be at the outside: the bar covers every year it may cover.
    const from = finite(start)
      ? x(start.lo)
      : finite(end)
        ? start
          ? 0
          : x(end.lo) - sizes.open
        : 0;
    const to = finite(end)
      ? x(end.hi)
      : finite(start)
        ? end
          ? length
          : x(start.hi) + sizes.open
        : length;
    const t0 = Math.max(0, Math.min(from, to));
    let t1 = Math.min(length, Math.max(from, to));
    const whole = finite(start) && finite(end);
    const small = whole && t1 - t0 < sizes.least;
    if (t1 - t0 < sizes.tick) t1 = t0 + sizes.tick;
    placed.push({
      ...blank,
      t0,
      t1,
      fade0: finite(start) ? Math.min((start.hi - start.lo) * perYear, t1 - t0) : 0,
      fade1: finite(end) ? Math.min((end.hi - end.lo) * perYear, t1 - t0) : 0,
      openStart: !finite(start),
      openEnd: !finite(end),
      small,
    });
  }

  for (const lane of new Set(placed.map((s) => s.lane))) {
    const inLane = placed
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

  const step = rulerStep(sizes.mark / perYear);
  const marks: ScaleLayout["marks"] = [];
  const first = Math.ceil((bounds.lo - edge / perYear) / step) * step;
  const most = Math.ceil(length / sizes.mark) + 2;
  for (let year = first; x(year) <= length && marks.length < most; year += step) {
    marks.push({ at: x(year), year });
  }

  return { spans: placed, tracks, length, marks, notPlaced, unnumbered, perYear };
}
