/**
 * The edits the timeline makes by hand (stage 17): moving a bar, stretching one end, placing an
 * event that has no dates yet. Each is a plain function of the chronicle, so undo, saving and the
 * ties all work through the page's one `change`.
 */
import type { ChronicleFile, ChronicleSpan, Rough } from "@frontier/schema";
import {
  type Range,
  parseWhen,
  spanPoints,
  tiePoint,
  tiedValue,
  wouldCircle,
} from "@frontier/time";
import { setTie, withSpan } from "./model.ts";

export type Grip = "move" | "start" | "end";

type End = ChronicleSpan["start"];

const shift = (end: End, by: number): End =>
  end && end !== "open" ? { ...end, words: "", low: end.low + by, high: end.high + by } : end;

const asRough = (r: Range): Rough => ({ words: "", low: r.lo, high: r.hi });

const finite = (r: Range | null): r is Range =>
  r !== null && Number.isFinite(r.lo) && Number.isFinite(r.hi);

/** Moves a tie's years by `by`, keeping it tied. */
const shiftTie = (tie: NonNullable<ChronicleSpan["startFrom"]>, by: number) => ({
  ...tie,
  plus: { low: tie.plus.low + by, high: tie.plus.high + by },
});

/** Moves one point. A tied point keeps its tie and moves by its years; an open one stays open. */
function movePoint(span: ChronicleSpan, part: "start" | "end", by: number): ChronicleSpan {
  const key = part === "start" ? "startFrom" : "endFrom";
  const tie = span[key];
  if (tie) {
    const moved = shift(span[part], by);
    return { ...span, [key]: shiftTie(tie, by), [part]: moved };
  }
  return { ...span, [part]: shift(span[part], by) };
}

/**
 * One end moved and the other held still. A point that was worked out from a length is stored
 * from now on, and the length is let go: stretching a bar is saying how long it lasts.
 */
function stretch(span: ChronicleSpan, part: "start" | "end", by: number): ChronicleSpan {
  const other = part === "start" ? "end" : "start";
  const p = spanPoints(span);
  let next = span;
  // Hold the other end where it is drawn now.
  if (next[other] === null && finite(p[other])) {
    next = { ...next, [other]: asRough(p[other]) };
  }
  if (next[part] === null && finite(p[part])) {
    next = { ...next, [part]: asRough(p[part]) };
  }
  if (next.length && next.start !== null && next.end !== null) next = { ...next, length: null };
  next = movePoint(next, part, by);
  const after = spanPoints(next);
  // A stretch never turns a bar inside out.
  if (finite(after.start) && finite(after.end) && after.end.hi < after.start.lo) return span;
  return next;
}

/** Moves or stretches each of `ids` by a number of years. */
export function dragSpans(
  chronicle: ChronicleFile,
  ids: readonly string[],
  grip: Grip,
  by: number,
): ChronicleFile {
  if (by === 0) return chronicle;
  let next = chronicle;
  for (const id of ids) {
    next = withSpan(next, id, (s) => {
      if (grip === "move" || s.point) {
        const moved = movePoint(s, "start", by);
        return s.point ? moved : movePoint(moved, "end", by);
      }
      return stretch(s, grip, by);
    });
  }
  return next;
}

/**
 * Places an event that had no dates: a moment at `from`; a span from `from` to `to`, or, when it
 * has a length, from `from` for that long. With nothing placed yet, what is placed first is year 0
 * and every number is counted from it.
 */
export function placeSpan(
  chronicle: ChronicleFile,
  id: string,
  from: number,
  to: number | null,
): ChronicleFile {
  const span = chronicle.spans.find((s) => s.id === id);
  if (!span) return chronicle;
  const first = chronicle.origin === null || !hasPlaced(chronicle);
  const by = first ? -from : 0;
  const lo = Math.min(from, to ?? from) + by;
  const hi = Math.max(from, to ?? from) + by;
  const at = (n: number): Rough => ({ words: "", low: n, high: n });
  const next = withSpan(chronicle, id, (s) => {
    if (s.point) return { ...s, start: at(lo) };
    if (s.length || to === null) return { ...s, start: at(lo), end: null };
    return { ...s, start: at(lo), end: at(hi) };
  });
  return first ? { ...next, origin: id } : next;
}

/** Whether any span of the chronicle has a number. */
function hasPlaced(chronicle: ChronicleFile): boolean {
  return chronicle.spans.some((s) => {
    const p = spanPoints(s);
    return finite(p.start) || finite(p.end);
  });
}

export type Typed = { ok: true; chronicle: ChronicleFile } | { ok: false; message: string };

/**
 * Writes what was typed into a Starts, Ends or Lasts box. A tie replaces a number and a number
 * replaces a tie. The first start given makes its span the one years are counted from.
 */
export function typeWhen(
  chronicle: ChronicleFile,
  id: string,
  part: "start" | "end" | "length",
  text: string,
): Typed {
  const span = chronicle.spans.find((s) => s.id === id);
  if (!span) return { ok: false, message: "That event is gone." };
  const read = parseWhen(text, {
    part,
    units: chronicle.units,
    spans: chronicle.spans,
    self: id,
  });
  if (read.kind === "error") return { ok: false, message: read.message };
  const clock = chronicle.lanes.find((l) => l.id === span.lane)?.clock ?? chronicle.clock;

  let next: ChronicleSpan = span;
  if (part === "length") {
    if (read.kind === "empty") next = { ...span, length: null };
    else if (read.kind === "years") {
      next = { ...span, length: { words: read.words, low: read.low, high: read.high, clock } };
    } else if (read.kind === "count") {
      next = {
        ...span,
        length: {
          words: read.words,
          low: read.low,
          high: read.high,
          clock,
          unit: read.unit,
          count: [read.count[0], read.count[1]],
        },
      };
    }
  } else {
    const loose = setTie(span, part, null);
    if (read.kind === "empty") next = { ...loose, [part]: null };
    else if (read.kind === "open") next = { ...loose, [part]: "open" };
    else if (read.kind === "years" || read.kind === "count") {
      next = { ...loose, [part]: { words: read.words, low: read.low, high: read.high } };
    } else if (read.kind === "tie") {
      if (wouldCircle(chronicle.spans, id, read.tie.span)) {
        const anchor = chronicle.spans.find((s) => s.id === read.tie.span);
        return {
          ok: false,
          message: `${anchor?.name || "That event"} is already tied to this.`,
        };
      }
      const anchor = chronicle.spans.find((s) => s.id === read.tie.span)!;
      const value = tiedValue(tiePoint(anchor, read.tie.edge), read.tie, part, read.words);
      next = { ...setTie(span, part, read.tie), [part]: value };
    }
  }
  let out = withSpan(chronicle, id, () => next);
  const start = next.start;
  if (part !== "length" && out.origin === null && start && start !== "open") {
    out = { ...out, origin: id };
  }
  return { ok: true, chronicle: out };
}

/** A short label of a drag in progress: "The war: 280–300 → 310 (+10 yrs)". */
export function dragLabel(name: string, when: string, by: number): string {
  const sign = by > 0 ? "+" : "−";
  const amount = Math.abs(by).toLocaleString("en-GB");
  return `${name}: ${when} (${sign}${amount} ${Math.abs(by) === 1 ? "yr" : "yrs"})`;
}
