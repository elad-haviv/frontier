/**
 * Ties (stage 17): a start or an end placed from a point of another span. A tie is the one thing
 * that moves a span the author did not touch: when the span it is tied to moves, the tied number
 * follows. The worked-out number is stored in the span's own `start` or `end` as well, so maps and
 * checks read plain numbers and never look at ties.
 *
 * Statements (relations) still only check. They are not ties; `placeable` finds the statements
 * that could become ties, for a one-time offer.
 */
import { asTested } from "./kinds.js";
import { spanPoints } from "./points.js";
import type { End, Range, Relation, Span, Tie } from "./types.js";

/** The point of a span a tie reads: its start or its end range, or null when not known. */
export function tiePoint(anchor: Span, edge: "start" | "end"): Range | null {
  const p = spanPoints(anchor);
  return edge === "start" ? p.start : p.end;
}

/** The number a tie gives, or null when the point it reads has no number yet. */
export function tiedValue(at: Range | null, tie: Tie, part: "start" | "end", words: string): End {
  if (!at) return null;
  if (!Number.isFinite(at.lo) || !Number.isFinite(at.hi)) {
    // Tied to an open point: an open start stays older than shown; an end still going on.
    if (part === "start" && at.lo === -Infinity) return "open";
    if (part === "end" && at.hi === Infinity) return "open";
    return null;
  }
  return { words, low: at.lo + tie.plus.low, high: at.hi + tie.plus.high };
}

const sameEnd = (a: End, b: End): boolean => {
  if (a === null || b === null || a === "open" || b === "open") return a === b;
  return a.low === b.low && a.high === b.high;
};

const wordsOf = (end: End): string => (end && end !== "open" ? end.words : "");

/** The spans a span's ties name. An event's end is not read, so its end tie names nothing. */
function anchorsOf(span: Span): string[] {
  const out: string[] = [];
  if (span.startFrom) out.push(span.startFrom.span);
  if (span.endFrom && !span.point) out.push(span.endFrom.span);
  return out;
}

export interface Resolved<S extends Span> {
  /** The spans with every tied number worked out again; the same array when nothing moved. */
  spans: S[];
  /** Ids of spans whose ties go in a circle; their numbers are left as stored. */
  circles: string[];
  /** Ids of spans whose stored numbers changed. */
  moved: string[];
}

/**
 * Works out every tied start and end, each after the span it is tied to, so a chain of ties
 * settles in one pass. A tie to a span that is gone, or a circle of ties (which only a merge of
 * two devices can make, since the page refuses one), leaves the stored number as it is.
 */
export function resolveTies<S extends Span>(spans: readonly S[]): Resolved<S> {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const done = new Map<string, S>();
  const visiting = new Set<string>();
  const circles = new Set<string>();
  const moved: string[] = [];

  const resolve = (id: string): S | undefined => {
    const span = byId.get(id);
    if (!span) return undefined;
    const settled = done.get(id);
    if (settled) return settled;
    if (visiting.has(id)) {
      for (const v of visiting) circles.add(v);
      return span;
    }
    visiting.add(id);
    let next: S = span;
    for (const part of ["start", "end"] as const) {
      const tie = part === "start" ? span.startFrom : span.endFrom;
      if (!tie || (part === "end" && span.point)) continue;
      const anchor = resolve(tie.span);
      if (!anchor || circles.has(id)) continue;
      const value = tiedValue(tiePoint(anchor, tie.edge), tie, part, wordsOf(next[part]));
      if (!sameEnd(value, next[part])) next = { ...next, [part]: value };
    }
    visiting.delete(id);
    if (circles.has(id)) next = span;
    done.set(id, next);
    if (next !== span) moved.push(id);
    return next;
  };

  for (const s of spans) resolve(s.id);
  if (moved.length === 0) return { spans: spans as S[], circles: [...circles], moved };
  return { spans: spans.map((s) => done.get(s.id) ?? s), circles: [...circles], moved };
}

/**
 * Whether tying a point of `from` to `to` would go in a circle: `to` is `from` itself, or is
 * already tied, by any chain, to `from`.
 */
export function wouldCircle(spans: readonly Span[], from: string, to: string): boolean {
  if (from === to) return true;
  const byId = new Map(spans.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const span = byId.get(id);
    if (span) stack.push(...anchorsOf(span));
  }
  return false;
}

/** A statement that can become a tie, placing a span that has no number there yet. */
export interface Placeable {
  readonly span: string;
  readonly part: "start" | "end";
  readonly tie: Tie;
  readonly relation: string;
}

/**
 * The statements that could place a span (stage 17's one-time offer): a span with no start
 * that starts with, or is after, a span with a number there; or with no end and ends with one.
 * Each span part is offered once, from its first such statement.
 */
export function placeable(input: {
  readonly spans: readonly Span[];
  readonly relations: readonly Relation[];
}): Placeable[] {
  const byId = new Map(input.spans.map((s) => [s.id, s]));
  const out: Placeable[] = [];
  const taken = new Set<string>();
  const offer = (
    id: string,
    part: "start" | "end",
    anchor: string,
    edge: "start" | "end",
    r: string,
  ) => {
    const span = byId.get(id);
    const other = byId.get(anchor);
    if (!span || !other || taken.has(`${id}:${part}`)) return;
    if (part === "end" && span.point) return;
    if (span[part] !== null || (part === "start" ? span.startFrom : span.endFrom)) return;
    // A start worked out from an end and a length is already placed.
    if (part === "start" ? spanPoints(span).start : spanPoints(span).end) return;
    const at = tiePoint(other, edge);
    if (!at || !Number.isFinite(at.lo) || !Number.isFinite(at.hi)) return;
    if (wouldCircle(input.spans, id, anchor)) return;
    taken.add(`${id}:${part}`);
    out.push({
      span: id,
      part,
      tie: { span: anchor, edge, plus: { low: 0, high: 0 } },
      relation: r,
    });
  };
  for (const r of input.relations) {
    const t = asTested(r);
    if (!t) continue;
    if (t.kind === "starts_with") {
      offer(t.a, "start", t.b, "start", r.id);
      offer(t.b, "start", t.a, "start", r.id);
    } else if (t.kind === "ends_with") {
      offer(t.a, "end", t.b, "end", r.id);
      offer(t.b, "end", t.a, "end", r.id);
    } else if (t.kind === "after") {
      offer(t.a, "start", t.b, "end", r.id);
    }
  }
  return out;
}
