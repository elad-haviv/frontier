import { describe, expect, it } from "vitest";
import { orderOf, type Order } from "../src/index.js";
import { chronicle, event, len, rel, rough, span } from "./helpers.js";

/** `{ a: [0, 1] }` for each span of each group. */
function ranks(order: Order): Record<string, [number, number]>[] {
  return order.groups.map((group) =>
    Object.fromEntries(group.spans.map((s) => [s.id, [s.start, s.end] as [number, number]])),
  );
}

describe("order", () => {
  it("ranks a chain", () => {
    const order = orderOf(
      chronicle(
        [span("a"), span("b"), span("c")],
        [rel("r1", "b", "after", "a"), rel("r2", "b", "before", "c")],
      ),
    );
    expect(ranks(order)).toEqual([{ a: [0, 1], b: [2, 3], c: [4, 5] }]);
    expect(order.groups[0]?.depth).toBe(5);
    expect(order.notOrdered).toEqual([]);
    expect(order.circles).toEqual([]);
  });

  it("makes tied starts one point, and tied ends one point", () => {
    const starts = orderOf(
      chronicle(
        [span("a"), span("b"), event("e")],
        [rel("r1", "a", "starts_with", "b"), rel("r2", "e", "starts_with", "a")],
      ),
    );
    expect(ranks(starts)).toEqual([{ a: [0, 1], b: [0, 1], e: [0, 0] }]);

    const ends = orderOf(
      chronicle(
        [span("a"), span("b"), span("c")],
        [rel("r1", "a", "ends_with", "b"), rel("r2", "a", "after", "c")],
      ),
    );
    // b ends where a ends, though nothing says where b starts.
    expect(ranks(ends)).toEqual([{ a: [2, 3], b: [0, 3], c: [0, 1] }]);
  });

  it("draws a span during another inside it", () => {
    const order = orderOf(chronicle([span("a"), span("b")], [rel("r1", "a", "during", "b")]));
    expect(ranks(order)).toEqual([{ a: [1, 2], b: [0, 3] }]);
  });

  it("lets a span start with another and be during it", () => {
    const order = orderOf(
      chronicle(
        [span("a"), span("b")],
        [rel("r1", "a", "starts_with", "b"), rel("r2", "a", "during", "b")],
      ),
    );
    expect(order.circles).toEqual([]);
    expect(ranks(order)).toEqual([{ a: [0, 1], b: [0, 2] }]);
  });

  it("orders overlapping spans only as far as was said", () => {
    const order = orderOf(chronicle([span("a"), span("b")], [rel("r1", "a", "overlaps", "b")]));
    expect(ranks(order)).toEqual([{ a: [0, 1], b: [0, 1] }]);
  });

  it("lets two events overlap by being one moment", () => {
    const order = orderOf(chronicle([event("e"), event("f")], [rel("r1", "e", "overlaps", "f")]));
    expect(order.circles).toEqual([]);
    expect(ranks(order)).toEqual([{ e: [0, 0], f: [0, 0] }]);
  });

  it("keeps unrelated groups apart, in lane order then file order", () => {
    const order = orderOf(
      chronicle(
        [
          span("n1", { lane: "l2" }),
          span("h1"),
          span("n2", { lane: "l2" }),
          span("h2"),
          span("gone", { lane: "missing" }),
          span("h3"),
        ],
        [
          rel("r1", "n2", "after", "n1"),
          rel("r2", "h2", "after", "h1"),
          rel("r3", "gone", "after", "h3"),
        ],
      ),
    );
    expect(ranks(order)).toEqual([
      { h1: [0, 1], h2: [2, 3] },
      { h3: [0, 1], gone: [2, 3] },
      { n1: [0, 1], n2: [2, 3] },
    ]);
  });

  it("lists a span with no ordering relation and no number as not ordered", () => {
    const order = orderOf(
      chronicle(
        [span("a"), span("b"), span("c", { length: len(5) }), span("d", { lane: "l2" }), span("x")],
        [
          rel("r1", "a", "after", "b"),
          rel("r2", "c", "longer_than", "a"),
          rel("r3", "d", "sings_to", "a"),
          rel("r4", "x", "after", "nobody"),
        ],
      ),
    );
    expect(order.notOrdered).toEqual(["c", "x", "d"]);
    expect(order.groups).toHaveLength(1);
  });

  it("gives a lone placed span a group of its own", () => {
    const order = orderOf(chronicle([span("a", { start: rough(5) }), span("b")]));
    expect(ranks(order)).toEqual([{ a: [0, 1] }]);
    expect(order.notOrdered).toEqual(["b"]);
  });

  it("takes a step from number ranges that do not overlap, and none from ranges that do", () => {
    const apart = orderOf(
      chronicle([
        span("a", { start: rough(0), end: rough(10, 20) }),
        span("b", { start: rough(30, 40), end: rough(50) }),
      ]),
    );
    expect(ranks(apart)).toEqual([{ a: [0, 1], b: [2, 3] }]);

    const across = orderOf(
      chronicle([
        span("a", { start: rough(0, 52), end: rough(35, 60) }),
        span("b", { start: rough(30, 40), end: rough(50, 55) }),
      ]),
    );
    // Every pair of ranges overlaps, so the two are not joined at all.
    expect(ranks(across)).toEqual([{ a: [0, 1] }, { b: [0, 1] }]);
  });

  it("places an open start before every number and an open end after", () => {
    const order = orderOf(
      chronicle([
        span("a", { start: "open", end: rough(10) }),
        span("b", { start: rough(5), end: "open" }),
      ]),
    );
    expect(ranks(order)).toEqual([{ a: [0, 2], b: [1, 3] }]);
  });

  it("orders an event by its number", () => {
    const order = orderOf(
      chronicle([event("e", rough(50)), span("a", { start: rough(0), end: rough(10) })]),
    );
    expect(ranks(order)).toEqual([{ e: [2, 2], a: [0, 1] }]);
  });

  it("marks every relation in a circle and leaves out the greatest id until none is left", () => {
    const order = orderOf(
      chronicle(
        [span("a"), span("b"), span("c"), span("d")],
        [
          rel("r1", "a", "after", "b"),
          rel("r2", "b", "after", "c"),
          rel("r3", "c", "after", "a"),
          rel("r4", "d", "after", "a"),
        ],
      ),
    );
    expect(order.circles).toEqual([["r1", "r2", "r3"]]);
    expect(order.leftOut).toEqual(["r3"]);
    expect(ranks(order)).toEqual([{ a: [4, 5], b: [2, 3], c: [0, 1], d: [6, 7] }]);
  });

  it("breaks two circles that share a relation one at a time", () => {
    const order = orderOf(
      chronicle(
        [span("a"), span("b"), span("c")],
        [
          rel("r1", "a", "after", "b"),
          rel("r2", "b", "after", "a"),
          rel("r3", "b", "after", "c"),
          rel("r4", "c", "after", "a"),
        ],
      ),
    );
    expect(order.circles).toEqual([["r1", "r2", "r3", "r4"]]);
    expect(order.leftOut).toEqual(["r4", "r2"]);
  });

  it("sees a circle made of ties alone, and leaves a harmless tie beside it unmarked", () => {
    const order = orderOf(
      chronicle(
        [span("a"), span("b"), span("c")],
        [
          // a starts where b ends and b starts where a ends.
          rel("r1", "a", "after", "b"),
          rel("r2", "b", "after", "a"),
          rel("r3", "c", "starts_with", "a"),
        ],
      ),
    );
    expect(order.circles).toEqual([["r1", "r2"]]);

    const ties = orderOf(
      chronicle(
        [span("a"), span("b"), event("e"), event("f")],
        [
          rel("r1", "e", "starts_with", "a"),
          rel("r2", "e", "ends_with", "b"),
          rel("r3", "f", "starts_with", "b"),
          rel("r4", "f", "ends_with", "a"),
        ],
      ),
    );
    expect(ties.circles).toEqual([["r1", "r2", "r3", "r4"]]);
    expect(ties.leftOut).toEqual(["r4"]);
  });

  it("calls a span after itself a circle of one", () => {
    const order = orderOf(chronicle([span("a")], [rel("r1", "a", "after", "a")]));
    expect(order.circles).toEqual([["r1"]]);
    expect(order.leftOut).toEqual(["r1"]);
  });

  it("drops a number step that disagrees with a stated relation, keeping the relation", () => {
    const order = orderOf(
      chronicle(
        [
          span("a", { start: rough(0), end: rough(10) }),
          span("b", { start: rough(20), end: rough(30) }),
        ],
        [rel("r1", "a", "after", "b")],
      ),
    );
    expect(order.circles).toEqual([]);
    expect(ranks(order)).toEqual([{ a: [2, 3], b: [0, 1] }]);
    expect(order.droppedNumberSteps).toContainEqual({
      earlier: { span: "a", part: "start" },
      later: { span: "b", part: "end" },
    });
    expect(order.droppedNumberSteps).toHaveLength(4);
  });

  it("drops the number step between tied points whose numbers are apart", () => {
    const order = orderOf(
      chronicle([event("e", rough(0)), event("f", rough(9))], [rel("r1", "e", "starts_with", "f")]),
    );
    expect(ranks(order)).toEqual([{ e: [0, 0], f: [0, 0] }]);
    expect(order.droppedNumberSteps).toHaveLength(1);
  });

  it("reads the first of two spans that share an id", () => {
    const order = orderOf(
      chronicle([span("a"), span("a"), span("b")], [rel("r1", "b", "after", "a")]),
    );
    expect(ranks(order)).toEqual([{ a: [0, 1], b: [2, 3] }]);
    expect(order.notOrdered).toEqual([]);
  });
});
