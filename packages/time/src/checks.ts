import { asTested, type TestedKind } from "./kinds.js";
import { orderOf } from "./order.js";
import { spanPoints, type SpanPoints } from "./points.js";
import { rangeWidth, rangesOverlap } from "./rough.js";
import type { ChronicleInput, Part, Range, Relation, Span } from "./types.js";

export type RelationState =
  | "holds"
  | "does_not_fit"
  | "may_not_fit"
  | "cannot_tell"
  | "contradicts"
  | "broken"
  | "not_checked";

/** The number a test needs and does not have. */
export interface Missing {
  readonly span: string;
  /** For an event this is always "start" or "length": its one point is its start. */
  readonly part: Part;
  /** True when a length is missing because the span has an open start or end. */
  readonly open: boolean;
}

/** The one range that decides an amber relation. */
export interface Deciding {
  readonly span: string;
  readonly part: Part;
  readonly range: Range;
  /** Which end of the range the true value must be near for the relation to hold. */
  readonly toward: "low" | "high";
}

export interface Check {
  readonly relation: Relation;
  readonly state: RelationState;
  /** For `does_not_fit` on `during`: true when the lengths alone show A is longer than B. */
  readonly longer: boolean;
  /** For `cannot_tell`: the first missing number. */
  readonly missing: Missing | null;
  /** For `may_not_fit`: the widest range tested, or null when no single range decides. */
  readonly deciding: Deciding | null;
  /** For `contradicts`: the ids of the relations in its circle, itself included. */
  readonly circle: readonly string[];
}

type Verdict = "holds" | "does_not_fit" | "may_not_fit";

interface Side {
  readonly span: Span;
  readonly points: SpanPoints;
}

interface Candidate {
  readonly side: Side;
  readonly part: Part;
  readonly range: Range;
  readonly toward: "low" | "high";
}

interface Outcome {
  readonly state: Verdict | "cannot_tell";
  readonly longer?: true;
  readonly missing?: Missing;
  readonly candidates?: readonly Candidate[];
}

/** "p at or after q", exactly as the design states it. */
function atOrAfter(p: Range, q: Range): Verdict {
  if (p.lo >= q.hi) return "holds";
  if (p.hi < q.lo) return "does_not_fit";
  return "may_not_fit";
}

// An event's end is its start, so that is the number to ask for and to name.
function partOf(side: Side, part: Part): Part {
  return side.span.point && part === "end" ? "start" : part;
}

/** Two tests that must both hold: `during` and `overlaps` share this shape. */
function both(
  first: Verdict | null,
  second: Verdict | null,
  missing: readonly Missing[],
  firstCandidates: readonly Candidate[],
  secondCandidates: readonly Candidate[],
): Outcome {
  // One half that already fails settles it, whatever is missing from the other half.
  if (first === "does_not_fit" || second === "does_not_fit") return { state: "does_not_fit" };
  if (missing[0]) return { state: "cannot_tell", missing: missing[0] };
  if (first === "holds" && second === "holds") return { state: "holds" };
  // Only a half that is still undecided can hold the range that decides.
  return {
    state: "may_not_fit",
    candidates: [
      ...(first === "may_not_fit" ? firstCandidates : []),
      ...(second === "may_not_fit" ? secondCandidates : []),
    ],
  };
}

function test(kind: TestedKind, a: Side, b: Side): Outcome {
  // Missing numbers are gathered in the order they are asked for below: A's before B's, start
  // before end. "The first missing number" is the first in that order.
  const missing: Missing[] = [];
  const need = (side: Side, part: Part): Range | null => {
    const range = side.points[part];
    if (!range) {
      const open = part === "length" && (side.span.start === "open" || side.span.end === "open");
      missing.push({ span: side.span.id, part: partOf(side, part), open });
    }
    return range;
  };
  const candidate = (side: Side, part: Part, range: Range, toward: "low" | "high"): Candidate => ({
    side,
    part,
    range,
    toward,
  });

  switch (kind) {
    case "after": {
      const aStart = need(a, "start");
      const bEnd = need(b, "end");
      if (aStart && bEnd) {
        return {
          state: atOrAfter(aStart, bEnd),
          candidates: [candidate(a, "start", aStart, "high"), candidate(b, "end", bEnd, "low")],
        };
      }
      // B ends no earlier than it starts, so A beginning before B's start is already enough.
      if (aStart && b.points.start && aStart.hi < b.points.start.lo) {
        return { state: "does_not_fit" };
      }
      return { state: "cannot_tell", missing: missing[0]! };
    }
    case "during": {
      const aStart = need(a, "start");
      const aEnd = need(a, "end");
      const bStart = need(b, "start");
      const bEnd = need(b, "end");
      const aLength = a.points.length;
      const bLength = b.points.length;
      if (aLength && bLength && aLength.lo > bLength.hi) {
        return { state: "does_not_fit", longer: true };
      }
      return both(
        aStart && bStart ? atOrAfter(aStart, bStart) : null,
        aEnd && bEnd ? atOrAfter(bEnd, aEnd) : null,
        missing,
        aStart && bStart
          ? [candidate(a, "start", aStart, "high"), candidate(b, "start", bStart, "low")]
          : [],
        aEnd && bEnd ? [candidate(b, "end", bEnd, "high"), candidate(a, "end", aEnd, "low")] : [],
      );
    }
    case "starts_with":
    case "ends_with": {
      const part = kind === "starts_with" ? "start" : "end";
      const p = need(a, part);
      const q = need(b, part);
      if (!p || !q) return { state: "cannot_tell", missing: missing[0]! };
      return { state: rangesOverlap(p, q) ? "holds" : "does_not_fit" };
    }
    case "overlaps": {
      const aStart = need(a, "start");
      const aEnd = need(a, "end");
      const bStart = need(b, "start");
      const bEnd = need(b, "end");
      // With an event, "overlaps" means the event falls within the span, ends included, so
      // touching counts. Between two spans it does not.
      const touching = a.span.point || b.span.point;
      const startsBeforeEnd = (start: Range, end: Range): Verdict => {
        if (touching ? start.hi <= end.lo : start.hi < end.lo) return "holds";
        if (touching ? start.lo > end.hi : start.lo >= end.hi) return "does_not_fit";
        return "may_not_fit";
      };
      return both(
        aStart && bEnd ? startsBeforeEnd(aStart, bEnd) : null,
        bStart && aEnd ? startsBeforeEnd(bStart, aEnd) : null,
        missing,
        aStart && bEnd
          ? [candidate(a, "start", aStart, "low"), candidate(b, "end", bEnd, "high")]
          : [],
        bStart && aEnd
          ? [candidate(b, "start", bStart, "low"), candidate(a, "end", aEnd, "high")]
          : [],
      );
    }
    case "longer_than": {
      const aLength = need(a, "length");
      const bLength = need(b, "length");
      if (!aLength || !bLength) return { state: "cannot_tell", missing: missing[0]! };
      if (aLength.lo > bLength.hi) return { state: "holds" };
      if (aLength.hi < bLength.lo) return { state: "does_not_fit" };
      return {
        state: "may_not_fit",
        candidates: [
          candidate(a, "length", aLength, "high"),
          candidate(b, "length", bLength, "low"),
        ],
      };
    }
  }
}

/**
 * The widest range among those tested. The design says "when no single range decides" without
 * saying when that is; here it is when two ranges are equally the widest, when the widest has
 * no width, or when the widest is an event's one point that the test pulls both ways.
 */
function decide(candidates: readonly Candidate[]): Deciding | null {
  const merged = new Map<string, Deciding & { pulledBothWays: boolean }>();
  for (const c of candidates) {
    const part = partOf(c.side, c.part);
    const key = `${part} ${c.side.span.id}`;
    const seen = merged.get(key);
    if (seen) {
      if (seen.toward !== c.toward) seen.pulledBothWays = true;
    } else {
      merged.set(key, {
        span: c.side.span.id,
        part,
        range: c.range,
        toward: c.toward,
        pulledBothWays: false,
      });
    }
  }
  let widest: (Deciding & { pulledBothWays: boolean }) | null = null;
  let shared = false;
  for (const c of merged.values()) {
    const width = rangeWidth(c.range);
    const best = widest ? rangeWidth(widest.range) : 0;
    if (width > best) {
      widest = c;
      shared = false;
    } else if (width === best) {
      shared = true;
    }
  }
  if (!widest || shared || widest.pulledBothWays) return null;
  return { span: widest.span, part: widest.part, range: widest.range, toward: widest.toward };
}

/**
 * The state of every relation, in file order. `circles` is `orderOf(input).circles`; it is
 * worked out here when not passed.
 *
 * A relation is looked at in this order: a missing span makes it broken (even when its kind is
 * also unknown); an unknown kind makes it not checked; being in a circle makes it contradicts;
 * otherwise its numbers decide.
 */
export function checkRelations(
  input: ChronicleInput,
  circles: readonly (readonly string[])[] = orderOf(input).circles,
): Check[] {
  const sides = new Map<string, Side>();
  for (const span of input.spans) {
    if (!sides.has(span.id)) sides.set(span.id, { span, points: spanPoints(span) });
  }
  const fileOrder = new Map(input.relations.map((relation, i) => [relation.id, i]));

  return input.relations.map((relation): Check => {
    const blank = { relation, longer: false, missing: null, deciding: null, circle: [] };
    if (!sides.has(relation.a) || !sides.has(relation.b)) return { ...blank, state: "broken" };
    const tested = asTested(relation);
    if (!tested) return { ...blank, state: "not_checked" };

    const around = circles.filter((circle) => circle.includes(relation.id));
    if (around.length > 0) {
      const circle = [...new Set(around.flat())].sort(
        (x, y) => (fileOrder.get(x) ?? 0) - (fileOrder.get(y) ?? 0),
      );
      return { ...blank, state: "contradicts", circle };
    }

    const outcome = test(tested.kind, sides.get(tested.a)!, sides.get(tested.b)!);
    return {
      ...blank,
      state: outcome.state,
      longer: outcome.longer ?? false,
      missing: outcome.missing ?? null,
      deciding: outcome.state === "may_not_fit" ? decide(outcome.candidates ?? []) : null,
    };
  });
}
