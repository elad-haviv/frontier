import { asTested } from "./kinds.js";
import { spanPoints } from "./points.js";
import type { ChronicleInput, Range } from "./types.js";

/** One span in the order view. Ranks are counted from 0 inside its group. */
export interface OrderedSpan {
  readonly id: string;
  readonly lane: string;
  /** The rank of its start. */
  readonly start: number;
  /** The rank of its end. Equal to `start` for an event. */
  readonly end: number;
}

/** Spans joined by some chain of ties and steps. Drawn as one block. */
export interface OrderGroup {
  /** By lane order, then by span order in the file. */
  readonly spans: readonly OrderedSpan[];
  /** The greatest rank in the group, so ranks run from 0 to `depth`. */
  readonly depth: number;
}

/** A step taken from two number ranges that do not overlap. */
export interface NumberStep {
  readonly earlier: { readonly span: string; readonly part: "start" | "end" };
  readonly later: { readonly span: string; readonly part: "start" | "end" };
}

export interface Order {
  /** By the place of each group's first span: lane order, then span order in the file. */
  readonly groups: readonly OrderGroup[];
  /** Ids of spans with no relation that orders them and no placed number, in the same order. */
  readonly notOrdered: readonly string[];
  /** Each circle of statements, as relation ids in file order. */
  readonly circles: readonly (readonly string[])[];
  /** Relations in circles that were left out so the rest could be drawn. */
  readonly leftOut: readonly string[];
  /** Steps from numbers that were dropped because they disagree with what was stated. */
  readonly droppedNumberSteps: readonly NumberStep[];
}

interface Step {
  readonly from: number;
  readonly to: number;
  /** True for "before"; false for "before or at". */
  readonly strict: boolean;
  /** The id of the relation that states it, or null for a span's own start-before-end. */
  readonly relation: string | null;
}

/** Which points can be reached from which by following steps. Grows one step at a time. */
class Reach {
  private readonly cells: Uint8Array;

  constructor(private readonly size: number) {
    this.cells = new Uint8Array(size * size);
  }

  /** Whether some chain of at least one step leads from `from` to `to`. */
  has(from: number, to: number): boolean {
    return this.cells[from * this.size + to] === 1;
  }

  add(from: number, to: number): void {
    if (this.has(from, to)) return;
    for (let x = 0; x < this.size; x++) {
      if (x !== from && !this.has(x, from)) continue;
      // Everything past `to` is already known to be reachable from x when `to` itself is.
      if (this.has(x, to)) continue;
      for (let y = 0; y < this.size; y++) {
        if (y === to || this.has(to, y)) this.cells[x * this.size + y] = 1;
      }
    }
  }

  static of(size: number, steps: readonly Step[]): Reach {
    const reach = new Reach(size);
    for (const step of steps) reach.add(step.from, step.to);
    return reach;
  }

  /**
   * For each point, the lowest-numbered point it shares a loop with (itself when there is
   * none). Points with the same answer can each be reached from the other.
   */
  loops(): number[] {
    const loop: number[] = [];
    for (let u = 0; u < this.size; u++) {
      let lowest = u;
      for (let w = 0; w < u; w++) {
        if (this.has(u, w) && this.has(w, u)) {
          lowest = w;
          break;
        }
      }
      loop.push(lowest);
    }
    return loop;
  }
}

interface Stated {
  readonly id: string;
  readonly tie: boolean;
  readonly steps: readonly Step[];
}

/**
 * The order of a chronicle's points, from its relations and placed numbers.
 *
 * Choices made where the design leaves room:
 *
 * - A tie is kept as two "before or at" steps, one each way, so that a tie can be part of a
 *   circle (A starts where B ends and B starts where A ends is a circle with no other
 *   relation in it).
 * - A circle is a loop of steps with at least one strict "before" in it. A loop made only of
 *   "before or at" steps is no contradiction: its points are at the same moment and share a
 *   rank. So "A starts with B" plus "A during B" is fine.
 * - `overlaps` gives strict steps between two spans, and "before or at" steps when either is an
 *   event, because the check then counts the ends as included.
 * - Every step, strict or not, adds one to a rank, so a stated order always shows.
 * - "The greatest id" is by plain string comparison.
 */
export function orderOf(input: ChronicleInput): Order {
  const { spans } = input;
  const indexOf = new Map<string, number>();
  spans.forEach((span, i) => {
    if (!indexOf.has(span.id)) indexOf.set(span.id, i);
  });

  // Two points per span: start at 2i, end at 2i + 1. An event uses its start for both.
  const size = spans.length * 2;
  const startOf = (i: number): number => 2 * i;
  const endOf = (i: number): number => (spans[i]?.point ? 2 * i : 2 * i + 1);

  const own: Step[] = [];
  spans.forEach((span, i) => {
    if (!span.point) own.push({ from: startOf(i), to: endOf(i), strict: true, relation: null });
  });

  let active: Stated[] = [];
  for (const relation of input.relations) {
    const tested = asTested(relation);
    if (!tested) continue;
    const a = indexOf.get(tested.a);
    const b = indexOf.get(tested.b);
    if (a === undefined || b === undefined) continue;
    const step = (from: number, to: number, strict: boolean): Step => ({
      from,
      to,
      strict,
      relation: relation.id,
    });
    const tie = (p: number, q: number): Step[] => [step(p, q, false), step(q, p, false)];
    let steps: Step[];
    switch (tested.kind) {
      case "starts_with":
        steps = tie(startOf(a), startOf(b));
        break;
      case "ends_with":
        steps = tie(endOf(a), endOf(b));
        break;
      case "after":
        steps = [step(endOf(b), startOf(a), false)];
        break;
      case "during":
        steps = [step(startOf(b), startOf(a), false), step(endOf(a), endOf(b), false)];
        break;
      case "overlaps": {
        const strict = !spans[a]?.point && !spans[b]?.point;
        steps = [step(startOf(a), endOf(b), strict), step(startOf(b), endOf(a), strict)];
        break;
      }
      case "longer_than":
        continue;
    }
    active.push({
      id: relation.id,
      tie: tested.kind === "starts_with" || tested.kind === "ends_with",
      steps,
    });
  }

  // Circles: find the relations in them, then leave out the one with the greatest id and look
  // again, until no circle is left.
  let circles: string[][] | null = null;
  const leftOut: string[] = [];
  let steps: Step[];
  let reach: Reach;
  for (;;) {
    steps = [...own, ...active.flatMap((stated) => stated.steps)];
    reach = Reach.of(size, steps);
    const inCircle = relationsInCircles(size, steps, reach, active);
    circles ??= [...inCircle.values()];
    const marked = [...inCircle.values()].flat();
    if (marked.length === 0) break;
    const greatest = marked.reduce((x, y) => (y > x ? y : x));
    leftOut.push(greatest);
    active = active.filter((stated) => stated.id !== greatest);
  }

  // Steps from numbers. They are taken in file order, and one that would close a circle with
  // what is already there is dropped: the stated order wins, and the check on the relation
  // reports the disagreement. Where several number steps close a circle only together, the
  // later ones in file order are the ones dropped.
  const placed: { node: number; span: string; part: "start" | "end"; range: Range }[] = [];
  spans.forEach((span, i) => {
    if (indexOf.get(span.id) !== i) return;
    const points = spanPoints(span);
    if (points.start) {
      placed.push({ node: startOf(i), span: span.id, part: "start", range: points.start });
    }
    if (points.end && !span.point) {
      placed.push({ node: endOf(i), span: span.id, part: "end", range: points.end });
    }
  });
  const droppedNumberSteps: NumberStep[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i]!;
      const q = placed[j]!;
      let earlier = p;
      let later = q;
      if (q.range.hi < p.range.lo) {
        earlier = q;
        later = p;
      } else if (!(p.range.hi < q.range.lo)) {
        continue;
      }
      if (reach.has(later.node, earlier.node)) {
        droppedNumberSteps.push({
          earlier: { span: earlier.span, part: earlier.part },
          later: { span: later.span, part: later.part },
        });
      } else if (!reach.has(earlier.node, later.node)) {
        // A step that already follows from others would change neither ranks nor groups.
        steps.push({ from: earlier.node, to: later.node, strict: true, relation: null });
        reach.add(earlier.node, later.node);
      }
    }
  }

  // Ranks. What loops remain are only of "before or at" steps, so each loop is one moment.
  const moment = reach.loops();
  const into = new Map<number, number[]>();
  for (const step of steps) {
    const from = moment[step.from]!;
    const to = moment[step.to]!;
    if (from === to) continue;
    const list = into.get(to);
    if (list) list.push(from);
    else into.set(to, [from]);
  }
  const ranks = new Map<number, number>();
  const rankOf = (m: number): number => {
    const known = ranks.get(m);
    if (known !== undefined) return known;
    let rank = 0;
    for (const from of into.get(m) ?? []) rank = Math.max(rank, rankOf(from) + 1);
    ranks.set(m, rank);
    return rank;
  };

  // Groups: spans joined by any step.
  const groupOf = spans.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (groupOf[root] !== root) root = groupOf[root]!;
    return root;
  };
  for (const step of steps) {
    const a = find(step.from >> 1);
    const b = find(step.to >> 1);
    // The lower index becomes the root, so a group is named by its first span in the file.
    if (a !== b) groupOf[Math.max(a, b)] = Math.min(a, b);
  }

  const laneIndex = new Map(input.lanes.map((lane, i) => [lane.id, i]));
  // A span in a lane that is gone sorts after every lane.
  const laneOf = (i: number): number => laneIndex.get(spans[i]!.lane) ?? input.lanes.length;
  const inOrder = spans
    .map((_, i) => i)
    .filter((i) => indexOf.get(spans[i]!.id) === i)
    .sort((x, y) => laneOf(x) - laneOf(y) || x - y);

  const members = new Map<number, number[]>();
  for (const i of inOrder) {
    const root = find(i);
    const list = members.get(root);
    if (list) list.push(i);
    else members.set(root, [i]);
  }

  const groups: OrderGroup[] = [];
  const notOrdered: string[] = [];
  const isPlaced = new Set(placed.map((p) => p.span));
  // Map keeps insertion order, and spans were added in drawing order, so groups come out by
  // their first span.
  for (const list of members.values()) {
    const first = spans[list[0]!]!;
    if (list.length === 1 && !isPlaced.has(first.id)) {
      notOrdered.push(first.id);
      continue;
    }
    const ordered = list.map((i): OrderedSpan => {
      const span = spans[i]!;
      return {
        id: span.id,
        lane: span.lane,
        start: rankOf(moment[startOf(i)]!),
        end: rankOf(moment[endOf(i)]!),
      };
    });
    groups.push({ spans: ordered, depth: Math.max(...ordered.map((span) => span.end)) });
  }

  return { groups, notOrdered, circles: circles ?? [], leftOut, droppedNumberSteps };
}

/**
 * The relations that are part of a circle, gathered by the loop they are in.
 *
 * A step is in a circle when it lies inside a loop that holds a strict step. A tie is tested
 * more carefully, because its two steps always form a loop of their own: it is in a circle
 * only when, with the tie taken away, its two points are still joined by a chain with a
 * strict step in it. Otherwise a harmless tie to a span that is in a circle would be marked.
 */
function relationsInCircles(
  size: number,
  steps: readonly Step[],
  reach: Reach,
  active: readonly Stated[],
): Map<number, string[]> {
  const loop = reach.loops();
  const bad = new Set<number>();
  for (const step of steps) {
    if (step.strict && (step.from === step.to || reach.has(step.to, step.from))) {
      bad.add(loop[step.from]!);
    }
  }
  const found = new Map<number, string[]>();
  if (bad.size === 0) return found;

  for (const stated of active) {
    const inside = stated.steps.find(
      (step) => loop[step.from] === loop[step.to] && bad.has(loop[step.from]!),
    );
    if (!inside) continue;
    if (stated.tie) {
      const others = steps.filter((step) => step.relation !== stated.id);
      const without = Reach.of(size, others);
      const joins = (p: number, q: number): boolean =>
        others.some(
          (step) =>
            step.strict &&
            (step.from === p || without.has(p, step.from)) &&
            (step.to === q || without.has(step.to, q)),
        );
      if (!joins(inside.from, inside.to) && !joins(inside.to, inside.from)) continue;
    }
    const key = loop[inside.from]!;
    const list = found.get(key);
    if (list) list.push(stated.id);
    else found.set(key, [stated.id]);
  }
  return found;
}
