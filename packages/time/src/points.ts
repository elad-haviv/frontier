import { addRanges, rangeOf, rangesOverlap, subtractRanges } from "./rough.js";
import type { End, Range, Span } from "./types.js";

/** The ranges of one span's two points and of its length. Null means not known. */
export interface SpanPoints {
  /** `−Infinity` at both ends for an open start. */
  readonly start: Range | null;
  /** `+Infinity` at both ends for an open end. An event's end is its start. */
  readonly end: Range | null;
  /** 0 for an event. Null for a span with an open start or end. */
  readonly length: Range | null;
  /** True when the span's own numbers disagree. */
  readonly disagrees: boolean;
}

const OPEN_START: Range = { lo: -Infinity, hi: -Infinity };
const OPEN_END: Range = { lo: Infinity, hi: Infinity };
const NO_LENGTH: Range = { lo: 0, hi: 0 };

function given(end: End): Range | null {
  return end === null || end === "open" ? null : rangeOf(end);
}

/** The range of a span's start, end and length: what the author gave, or worked out from it. */
export function spanPoints(span: Span): SpanPoints {
  if (span.point) {
    // An event has one point. Any end or length left on it in the file is not read.
    const at = span.start === "open" ? OPEN_START : given(span.start);
    return { start: at, end: at, length: NO_LENGTH, disagrees: false };
  }

  const start = given(span.start);
  const end = given(span.end);
  // The design says a span with an open end has no length. An open start is treated the same
  // way: its length would be infinite, and a stored length cannot place the missing point from
  // an end that is not a number.
  const open = span.start === "open" || span.end === "open";
  const length = !open && span.length ? rangeOf(span.length) : null;

  let between: Range | null = null;
  let disagrees = false;
  if (start && end) {
    const raw = subtractRanges(end, start);
    // A length is never negative, however far the two ranges reach past each other.
    between = { lo: Math.max(0, raw.lo), hi: Math.max(0, raw.hi) };
    // The design names one case: all three given and the length outside what the start and end
    // allow. A given end that lies wholly before the given start is counted too, since those
    // two numbers disagree by themselves.
    disagrees = end.hi < start.lo || (length !== null && !rangesOverlap(length, between));
  }

  let startRange = start;
  if (span.start === "open") startRange = OPEN_START;
  else if (!start && end && length) startRange = subtractRanges(end, length);

  let endRange = end;
  if (span.end === "open") endRange = OPEN_END;
  else if (!end && start && length) endRange = addRanges(start, length);

  return { start: startRange, end: endRange, length: length ?? between, disagrees };
}

/** The points of every span, by span id. */
export function allSpanPoints(spans: readonly Span[]): Map<string, SpanPoints> {
  return new Map(spans.map((span) => [span.id, spanPoints(span)]));
}
