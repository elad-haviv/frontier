/**
 * Where everything on the timeline goes (stage 17): the zoom levels, the ruler, the rows, and the
 * shape of each bar, worked out from a chronicle and its points. No drawing happens here.
 */
import type { ChronicleFile, ChronicleLane, ChronicleSpan } from "@frontier/schema";
import { type Range, type SpanPoints, formatRange } from "@frontier/time";
import { rulerStep } from "./scaleLayout.ts";

export interface ZoomLevel {
  id: "years" | "decades" | "centuries" | "millennia";
  label: string;
  /** The word on a phone's chip. */
  short: string;
  perYear: number;
  /** Years a drag or a nudge moves by. */
  snap: number;
}

/** About 7 pixels a year, then a tenth of that at each level. */
export const ZOOMS: readonly ZoomLevel[] = [
  { id: "years", label: "Years", short: "Yrs", perYear: 7, snap: 1 },
  { id: "decades", label: "Decades", short: "Decades", perYear: 0.7, snap: 5 },
  { id: "centuries", label: "Centuries", short: "Cent.", perYear: 0.07, snap: 10 },
  { id: "millennia", label: "Millennia", short: "Mill.", perYear: 0.007, snap: 100 },
];

/** The closest and farthest the timeline zooms: from a few weeks to about 100,000 years a screen. */
export const MOST_PER_YEAR = 40;
export const LEAST_PER_YEAR = 0.0008;

export const clampZoom = (perYear: number): number =>
  Math.min(MOST_PER_YEAR, Math.max(LEAST_PER_YEAR, perYear));

/** The level a zoom is nearest to, on a logarithmic scale. */
export function levelOf(perYear: number): ZoomLevel {
  let best = ZOOMS[0]!;
  for (const z of ZOOMS) {
    if (Math.abs(Math.log(z.perYear / perYear)) < Math.abs(Math.log(best.perYear / perYear))) {
      best = z;
    }
  }
  return best;
}

/** Rounds a number of years to the snap of the zoom. */
export const snapYears = (years: number, snap: number): number => Math.round(years / snap) * snap;

const finite = (r: Range | null | undefined): r is Range =>
  !!r && Number.isFinite(r.lo) && Number.isFinite(r.hi);

/** The earliest and latest year anything placed may be; null when nothing is. */
export function placedBounds(points: Iterable<SpanPoints>): Range | null {
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

export interface Extent {
  /** The first and last year of the chart. */
  from: number;
  to: number;
  /** The chart's width in pixels. */
  width: number;
}

/**
 * The years the chart covers: everything placed and the map year, with room around them to drag
 * into, and at least the width of the screen. With nothing placed, 0 to 100.
 */
export function extentOf(
  bounds: Range | null,
  mapYear: number | null,
  perYear: number,
  viewport: number,
): Extent {
  let lo = bounds?.lo ?? 0;
  let hi = bounds?.hi ?? 100;
  if (mapYear !== null) {
    lo = Math.min(lo, mapYear);
    hi = Math.max(hi, mapYear);
  }
  const pad = Math.max(viewport / perYear / 3, 10 / perYear);
  let from = lo - pad;
  let to = hi + pad;
  const least = viewport / perYear;
  if (to - from < least) {
    const grow = (least - (to - from)) / 2;
    from -= grow;
    to += grow;
  }
  return { from, to, width: Math.ceil((to - from) * perYear) };
}

export interface Tick {
  year: number;
  x: number;
}

/** The ruler: labelled marks at least 80 pixels apart, and finer marks between when there is room. */
export function ticksOf(extent: Extent, perYear: number): { major: Tick[]; minor: Tick[] } {
  const step = rulerStep(80 / perYear);
  let fine = 0;
  for (const by of [10, 5, 2]) {
    if ((step / by) * perYear >= 7 && Number.isInteger(step / by)) {
      fine = step / by;
      break;
    }
  }
  const major: Tick[] = [];
  const minor: Tick[] = [];
  const x = (year: number) => (year - extent.from) * perYear;
  const first = Math.ceil(extent.from / (fine || step)) * (fine || step);
  const most = 4000;
  for (let year = first; year <= extent.to && major.length + minor.length < most;) {
    if (Math.abs(year / step - Math.round(year / step)) < 1e-9) major.push({ year, x: x(year) });
    else minor.push({ year, x: x(year) });
    year = Math.round((year + (fine || step)) * 1e6) / 1e6;
  }
  return { major, minor };
}

export type Row =
  | { kind: "group"; lane: ChronicleLane; folded: boolean; count: number }
  | { kind: "event"; span: ChronicleSpan; lane: ChronicleLane }
  | { kind: "add"; lane: ChronicleLane };

/**
 * One row per group header, per event in it (in the order of the file), and a last row to add to
 * it. A folded group shows only its header.
 */
export function rowsOf(chronicle: ChronicleFile, folded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  for (const lane of chronicle.lanes) {
    const spans = chronicle.spans.filter((s) => s.lane === lane.id);
    const shut = folded.has(lane.id);
    rows.push({ kind: "group", lane, folded: shut, count: spans.length });
    if (shut) continue;
    for (const span of spans) rows.push({ kind: "event", span, lane });
    rows.push({ kind: "add", lane });
  }
  return rows;
}

/** The span a group's events cover, for the thin bar on its header row. */
export function groupBounds(
  spans: readonly ChronicleSpan[],
  points: ReadonlyMap<string, SpanPoints>,
): Range | null {
  return placedBounds(spans.map((s) => points.get(s.id)).filter((p) => p !== undefined));
}

/** How long a broken edge is drawn, where a start or end is not known, in pixels. */
export const STUB = 36;

export type Bar =
  | {
      kind: "range";
      /** The outside: every year it may cover. */
      x0: number;
      x1: number;
      /** Where it is surely going on; null when its two soft ends meet. */
      core: [number, number] | null;
      /** The soft ends: from the earliest to the latest possible year. */
      soft0: [number, number] | null;
      soft1: [number, number] | null;
      /** Older than shown / still going on: runs off the chart's edge. */
      openStart: boolean;
      openEnd: boolean;
      /** Not given at all: drawn as a short broken edge. */
      unknownStart: boolean;
      unknownEnd: boolean;
    }
  | { kind: "moment"; x: number; whisker: [number, number] | null; open: boolean }
  /** No dates yet; `length` when only a length is known. */
  | { kind: "none"; length: Range | null };

/** The shape of one event's bar along the chart. */
export function barOf(
  span: Pick<ChronicleSpan, "point">,
  p: SpanPoints | undefined,
  extent: Extent,
  perYear: number,
): Bar {
  const x = (year: number) => (year - extent.from) * perYear;
  const S = p?.start ?? null;
  const E = p?.end ?? null;
  if (span.point) {
    if (!S) return { kind: "none", length: null };
    if (!finite(S)) return { kind: "moment", x: 0, whisker: null, open: true };
    return {
      kind: "moment",
      x: x((S.lo + S.hi) / 2),
      whisker: S.lo === S.hi ? null : [x(S.lo), x(S.hi)],
      open: false,
    };
  }
  if (!S && !E) return { kind: "none", length: finite(p?.length) ? p!.length : null };
  const openStart = S !== null && S.lo === -Infinity;
  const openEnd = E !== null && E.hi === Infinity;
  const s0 = finite(S) ? x(S.lo) : null;
  const s1 = finite(S) ? x(S.hi) : null;
  const e0 = finite(E) ? x(E.lo) : null;
  const e1 = finite(E) ? x(E.hi) : null;
  const x0 = openStart ? 0 : (s0 ?? (e0 ?? 0) - STUB);
  const x1 = openEnd ? extent.width : (e1 ?? (s1 ?? x0) + STUB);
  const inner0 = s1 ?? x0;
  const inner1 = e0 ?? x1;
  return {
    kind: "range",
    x0,
    x1: Math.max(x1, x0 + 2),
    core: inner1 > inner0 ? [inner0, inner1] : null,
    soft0: s0 !== null && s1 !== null && s1 > s0 ? [s0, s1] : null,
    soft1: e0 !== null && e1 !== null && e1 > e0 ? [e0, e1] : null,
    openStart,
    openEnd,
    unknownStart: S === null,
    unknownEnd: E === null,
  };
}

/** The When cell: "270–290 → 300", "open → 380–450", "300" for a moment, "No dates yet". */
export function whenText(span: Pick<ChronicleSpan, "point">, p: SpanPoints | undefined): string {
  const S = p?.start ?? null;
  const E = p?.end ?? null;
  if (span.point) return S ? formatRange(S) : "No dates yet";
  if (!S && !E) return "No dates yet";
  return `${S ? formatRange(S) : "?"} → ${E ? formatRange(E) : "?"}`;
}

/** Headings of the list view: "Before year 0", "Year 0 to 99", "Year 100 to 199", … */
export function centuryOf(year: number): string {
  if (year < 0) return "Before year 0";
  const from = Math.floor(year / 100) * 100;
  return `Year ${from.toLocaleString("en-GB")} to ${(from + 99).toLocaleString("en-GB")}`;
}
