import type { ChronicleInput, End, Relation, Rough, RoughLength, Span } from "../src/index.js";

export function rough(low: number, high: number = low): Rough {
  return { words: "", low, high };
}

export function len(low: number, high: number = low): RoughLength {
  return { words: "", low, high, clock: "ezob" };
}

/** A span named after its id, in lane "l1" unless told otherwise. */
export function span(
  id: string,
  given: { start?: End; end?: End; length?: RoughLength | null; lane?: string; name?: string } = {},
): Span {
  return {
    id,
    lane: given.lane ?? "l1",
    name: given.name ?? id,
    point: false,
    start: given.start ?? null,
    end: given.end ?? null,
    length: given.length ?? null,
  };
}

export function event(id: string, start: End = null, lane = "l1"): Span {
  return { id, lane, name: id, point: true, start, end: null, length: null };
}

/** `rel("r1", "A", "after", "B")`. */
export function rel(id: string, a: string, kind: string, b: string): Relation {
  return { id, a, kind, b };
}

export function chronicle(spans: Span[], relations: Relation[] = []): ChronicleInput {
  return { lanes: [{ id: "l1" }, { id: "l2" }], spans, relations };
}
