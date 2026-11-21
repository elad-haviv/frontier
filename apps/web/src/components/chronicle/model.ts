import type {
  ChronicleFile,
  ChronicleLane,
  ChronicleSpan,
  Rough,
  RoughLength,
} from "@frontier/schema";
import {
  type Check,
  type Order,
  type Range,
  type SpanPoints,
  allSpanPoints,
  checkRelations,
  orderOf,
} from "@frontier/time";

/** Changes that follow each other with the same `tag` are one step for undo. */
export type Change = (fn: (chronicle: ChronicleFile) => ChronicleFile, tag?: string) => void;

const LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Eight random characters, as every id in a chronicle is. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => LETTERS[b % LETTERS.length]).join("");
}

export const LANE_COLORS = ["#9a3b1f", "#2f6f73", "#6b5b95", "#8a7a2c", "#3f6b3a", "#a2557a"];

export const KIND_WORDS: Record<string, string> = {
  after: "is after",
  before: "is before",
  during: "is during",
  starts_with: "starts with",
  ends_with: "ends with",
  overlaps: "overlaps",
  longer_than: "is longer than",
  shorter_than: "is shorter than",
};

/** Everything worked out from a chronicle: never stored. */
export interface Worked {
  order: Order;
  checks: Check[];
  points: Map<string, SpanPoints>;
  /** The worst state among the relations each span is part of. */
  marks: Map<string, "red" | "amber">;
}

export function work(chronicle: ChronicleFile): Worked {
  const order = orderOf(chronicle);
  const checks = checkRelations(chronicle, order.circles);
  const points = allSpanPoints(chronicle.spans);
  const marks = new Map<string, "red" | "amber">();
  for (const check of checks) {
    const mark =
      check.state === "does_not_fit" || check.state === "contradicts"
        ? "red"
        : check.state === "may_not_fit"
          ? "amber"
          : null;
    if (!mark) continue;
    for (const id of [check.relation.a, check.relation.b]) {
      if (mark === "red" || !marks.has(id)) marks.set(id, mark);
    }
  }
  for (const [id, p] of points) if (p.disagrees) marks.set(id, "red");
  return { order, checks, points, marks };
}

/** A number as the author would write it: no long tails, thousands apart. */
export function num(n: number): string {
  return Number(n.toFixed(2)).toLocaleString("en-GB");
}

/** "60 to 175 years", or "400 years" when the two are the same. */
export function years(range: Range): string {
  if (!Number.isFinite(range.lo) || !Number.isFinite(range.hi)) return "open";
  if (range.lo === range.hi) return `${num(range.lo)} ${range.lo === 1 ? "year" : "years"}`;
  return `${num(range.lo)} to ${num(range.hi)} years`;
}

/** A place in time counted from the origin: "year 120 to 150", "40 years before". */
export function yearAt(range: Range): string {
  if (range.lo === -Infinity) return "older than shown";
  if (range.hi === Infinity) return "still going on";
  if (range.lo === range.hi) return `year ${num(range.lo)}`;
  return `year ${num(range.lo)} to ${num(range.hi)}`;
}

export const spanName = (span: Pick<ChronicleSpan, "name">): string => span.name || "(unnamed)";

export function laneOf(chronicle: ChronicleFile, span: ChronicleSpan): ChronicleLane {
  return chronicle.lanes.find((l) => l.id === span.lane) ?? chronicle.lanes[0]!;
}

export function newSpan(lane: string, point: boolean, name: string): ChronicleSpan {
  return {
    id: newId(),
    lane,
    name,
    point,
    start: null,
    end: null,
    length: null,
    entry: null,
    note: "",
  };
}

/** Replaces one span. */
export function withSpan(
  chronicle: ChronicleFile,
  id: string,
  fn: (span: ChronicleSpan) => ChronicleSpan,
): ChronicleFile {
  return { ...chronicle, spans: chronicle.spans.map((s) => (s.id === id ? fn(s) : s)) };
}

/**
 * Removes a span. Statements about it are kept and shown as broken, so the author sees what he
 * had said; the comparison forgets it.
 */
export function withoutSpan(chronicle: ChronicleFile, id: string): ChronicleFile {
  return {
    ...chronicle,
    spans: chronicle.spans.filter((s) => s.id !== id),
    compare: { ...chronicle.compare, spans: chronicle.compare.spans.filter((s) => s !== id) },
  };
}

export const rough = (low: number, high: number, words = ""): Rough => ({ words, low, high });

export function lengthOf(
  low: number,
  high: number,
  words: string,
  clock: string,
  unit?: { id: string; count: [number, number] },
): RoughLength {
  return {
    words,
    low,
    high,
    clock,
    ...(unit ? { unit: unit.id, count: unit.count } : {}),
  };
}

/** Reads a typed number; null when the field is empty or not a number. */
export function typed(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

type Shiftable = Rough | "open" | null;
const moved = (end: Shiftable, by: number): Shiftable =>
  end && end !== "open" ? { ...end, words: "", low: end.low + by, high: end.high + by } : end;

/** Moves a span's start and end by a number of years. Its length does not change. */
export function shiftSpan(span: ChronicleSpan, by: number): ChronicleSpan {
  return { ...span, start: moved(span.start, by), end: moved(span.end, by) };
}

/**
 * Puts a span where an offer says. A span with both a start and an end keeps its length: the
 * end that was not offered moves along by the same number of years.
 */
export function applyOffer(
  span: ChronicleSpan,
  offer: { start: Range | null; end: Range | null },
): ChronicleSpan {
  const was = (end: Shiftable): number | null => (end && end !== "open" ? end.low : null);
  let next = span;
  if (offer.start) {
    const from = was(span.start);
    next = { ...next, start: rough(offer.start.lo, offer.start.hi) };
    if (!offer.end && from !== null)
      next = { ...next, end: moved(span.end, offer.start.lo - from) };
  }
  if (offer.end && !span.point) {
    const from = was(span.end);
    next = { ...next, end: rough(offer.end.lo, offer.end.hi) };
    if (!offer.start && from !== null) {
      next = { ...next, start: moved(span.start, offer.end.lo - from) };
    }
  }
  return next;
}

/** Counts years from another span's start: every stored start and end moves by one amount. */
export function countFrom(chronicle: ChronicleFile, id: string): ChronicleFile {
  const at = chronicle.spans.find((s) => s.id === id)?.start;
  if (!at || at === "open") return chronicle;
  return {
    ...chronicle,
    origin: id,
    spans: chronicle.spans.map((s) => shiftSpan(s, -at.low)),
  };
}
