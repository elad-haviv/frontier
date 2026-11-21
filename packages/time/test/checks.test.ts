import { describe, expect, it } from "vitest";
import { checkRelations, sentenceFor, type ChronicleInput, type Span } from "../src/index.js";
import { chronicle, event, len, rel, rough, span } from "./helpers.js";

/** The state and sentence of the one relation "A kind B". */
function one(a: Span, kind: string, b: Span): { state: string; says: string | null } {
  const input = chronicle([a, b], [rel("r1", a.id, kind, b.id)]);
  const check = checkRelations(input)[0]!;
  return { state: check.state, says: sentenceFor(check, input) };
}

const placed = (id: string, start: [number, number], end: [number, number]): Span =>
  span(id, { start: rough(...start), end: rough(...end) });

describe("after and before", () => {
  const b = placed("B", [0, 0], [100, 120]);

  it("holds when A starts at or after B's end", () => {
    expect(one(span("A", { start: rough(120, 130) }), "after", b)).toEqual({
      state: "holds",
      says: null,
    });
  });

  it("does not fit when A starts before B's end could be", () => {
    expect(one(span("A", { start: rough(50, 99) }), "after", b)).toEqual({
      state: "does_not_fit",
      says: "A begins before B has ended; you said A is after B.",
    });
  });

  it("may not fit in between, and names the widest range", () => {
    expect(one(span("A", { start: rough(90, 200) }), "after", b)).toEqual({
      state: "may_not_fit",
      says: "A is after B only if A begins nearer year 200 than year 90.",
    });
    expect(one(span("A", { start: rough(110, 115) }), "after", b)).toEqual({
      state: "may_not_fit",
      says: "A is after B only if B ends nearer year 100 than year 120.",
    });
  });

  it("says your ranges are narrower when two ranges are equally the widest", () => {
    expect(one(span("A", { start: rough(110, 130) }), "after", b)).toEqual({
      state: "may_not_fit",
      says: "A is after B only if your ranges are narrower.",
    });
  });

  it("cannot tell without A's start, then without B's end", () => {
    expect(one(span("A"), "after", span("B"))).toEqual({
      state: "cannot_tell",
      says: "To check this, give A a start.",
    });
    expect(one(span("A", { start: rough(5) }), "after", span("B", { start: rough(0) }))).toEqual({
      state: "cannot_tell",
      says: "To check this, give B an end.",
    });
  });

  it("already does not fit when A starts before B's start and B's end is unknown", () => {
    expect(one(span("A", { start: rough(5) }), "after", span("B", { start: rough(9) })).state).toBe(
      "does_not_fit",
    );
  });

  it("tests before as after with the two exchanged", () => {
    expect(one(b, "before", span("A", { start: rough(120) })).state).toBe("holds");
    expect(one(b, "before", span("A", { start: rough(50) }))).toEqual({
      state: "does_not_fit",
      says: "A begins before B has ended; you said B is before A.",
    });
    expect(one(span("B"), "before", span("A", { start: rough(1) })).says).toBe(
      "To check this, give B an end.",
    );
  });

  it("treats an event's one point as its start and its end", () => {
    expect(one(event("A", rough(10)), "after", event("B", rough(10))).state).toBe("holds");
    expect(one(event("A", rough(5)), "after", event("B", rough(10))).state).toBe("does_not_fit");
    expect(one(event("A", rough(5)), "after", event("B"))).toEqual({
      state: "cannot_tell",
      says: "To check this, give B a start.",
    });
    expect(one(event("A", rough(5, 15)), "after", event("B", rough(10)))).toEqual({
      state: "may_not_fit",
      says: "A is after B only if A is nearer year 15 than year 5.",
    });
  });

  it("holds after an open start and never after an open end", () => {
    const old = span("B", { start: "open", end: rough(0) });
    expect(one(span("A", { start: rough(0) }), "after", old).state).toBe("holds");
    const going = span("B", { start: rough(0), end: "open" });
    expect(one(span("A", { start: rough(1000) }), "after", going).state).toBe("does_not_fit");
  });
});

describe("during", () => {
  const b = placed("B", [0, 10], [100, 110]);

  it("holds when both ends are inside", () => {
    expect(one(placed("A", [10, 20], [80, 100]), "during", b).state).toBe("holds");
  });

  it("does not fit when either end is outside", () => {
    expect(one(placed("A", [-50, -1], [80, 100]), "during", b)).toEqual({
      state: "does_not_fit",
      says: "A is not inside B; you said A is during B.",
    });
    expect(one(placed("A", [10, 20], [111, 120]), "during", b).state).toBe("does_not_fit");
  });

  it("does not fit when the lengths alone show A is longer", () => {
    expect(
      one(span("A", { length: len(200, 300) }), "during", span("B", { length: len(50) })),
    ).toEqual({ state: "does_not_fit", says: "A is longer than B; you said A is during B." });
  });

  it("does not fit on one known half even when the other half is missing", () => {
    expect(
      one(span("A", { start: rough(-5) }), "during", span("B", { start: rough(0) })).state,
    ).toBe("does_not_fit");
  });

  it("may not fit, naming a range from the half that is undecided", () => {
    expect(one(placed("A", [5, 20], [80, 100]), "during", b)).toEqual({
      state: "may_not_fit",
      says: "A is during B only if A begins nearer year 20 than year 5.",
    });
    expect(
      one(placed("A", [10, 10], [80, 300]), "during", placed("B", [0, 0], [100, 110])),
    ).toEqual({
      state: "may_not_fit",
      says: "A is during B only if A ends nearer year 80 than year 300.",
    });
  });

  it("cannot tell and names the first missing number", () => {
    expect(one(span("A"), "during", b).says).toBe("To check this, give A a start.");
    expect(one(span("A", { start: rough(20) }), "during", b).says).toBe(
      "To check this, give A an end.",
    );
    expect(one(placed("A", [20, 20], [30, 30]), "during", span("B")).says).toBe(
      "To check this, give B a start.",
    );
    expect(one(placed("A", [20, 20], [30, 30]), "during", span("B", { start: rough(0) }))).toEqual({
      state: "cannot_tell",
      says: "To check this, give B an end.",
    });
  });

  it("checks an event during a span", () => {
    expect(one(event("A", rough(50)), "during", b).state).toBe("holds");
    expect(one(event("A", rough(500)), "during", b).state).toBe("does_not_fit");
    // The event's one point is pulled both ways, so no single direction can be named.
    expect(one(event("A", rough(-500, 500)), "during", b)).toEqual({
      state: "may_not_fit",
      says: "A is during B only if your ranges are narrower.",
    });
    expect(one(event("A"), "during", b).says).toBe("To check this, give A a start.");
  });

  it("holds during a span with open ends", () => {
    const always = span("B", { start: "open", end: "open" });
    expect(one(placed("A", [0, 0], [5, 5]), "during", always).state).toBe("holds");
  });
});

describe("starts_with and ends_with", () => {
  it("holds when the two ranges overlap and does not fit when they do not; never amber", () => {
    const b = placed("B", [0, 10], [100, 110]);
    expect(one(placed("A", [10, 30], [50, 99]), "starts_with", b).state).toBe("holds");
    expect(one(placed("A", [11, 30], [50, 99]), "starts_with", b)).toEqual({
      state: "does_not_fit",
      says: "A and B do not begin together; you said they do.",
    });
    expect(one(placed("A", [11, 30], [50, 100]), "ends_with", b).state).toBe("holds");
    expect(one(placed("A", [11, 30], [50, 99]), "ends_with", b)).toEqual({
      state: "does_not_fit",
      says: "A and B do not end together; you said they do.",
    });
  });

  it("cannot tell without both numbers", () => {
    expect(one(span("A"), "starts_with", span("B", { start: rough(0) })).says).toBe(
      "To check this, give A a start.",
    );
    expect(one(span("A", { start: rough(0) }), "starts_with", span("B")).says).toBe(
      "To check this, give B a start.",
    );
    expect(
      one(span("A", { start: rough(0) }), "ends_with", span("B", { end: rough(1) })).says,
    ).toBe("To check this, give A an end.");
  });

  it("ties events and open ends", () => {
    expect(one(span("A", { start: rough(0, 5) }), "starts_with", event("B", rough(5))).state).toBe(
      "holds",
    );
    expect(one(event("A", rough(7)), "ends_with", span("B", { end: rough(0, 5) })).state).toBe(
      "does_not_fit",
    );
    expect(one(event("A"), "ends_with", span("B", { end: rough(0, 5) })).says).toBe(
      "To check this, give A a start.",
    );
    expect(
      one(span("A", { start: "open" }), "starts_with", span("B", { start: "open" })).state,
    ).toBe("holds");
    expect(one(span("A", { end: "open" }), "ends_with", span("B", { end: rough(9) })).state).toBe(
      "does_not_fit",
    );
  });
});

describe("overlaps", () => {
  const b = placed("B", [50, 60], [100, 110]);

  it("holds when each starts before the other ends", () => {
    expect(one(placed("A", [0, 0], [70, 80]), "overlaps", b).state).toBe("holds");
  });

  it("does not fit when one starts at or after the other's end", () => {
    expect(one(placed("A", [110, 120], [200, 200]), "overlaps", b)).toEqual({
      state: "does_not_fit",
      says: "A and B do not overlap; you said they do.",
    });
    expect(one(placed("A", [0, 0], [40, 50]), "overlaps", b).state).toBe("does_not_fit");
  });

  it("may not fit in between", () => {
    expect(one(placed("A", [0, 0], [55, 80]), "overlaps", b)).toEqual({
      state: "may_not_fit",
      says: "A overlaps B only if A ends nearer year 80 than year 55.",
    });
    expect(one(placed("A", [90, 105], [200, 200]), "overlaps", b)).toEqual({
      state: "may_not_fit",
      says: "A overlaps B only if A begins nearer year 90 than year 105.",
    });
  });

  it("cannot tell, or already does not fit on the half it knows", () => {
    expect(one(span("A", { start: rough(0) }), "overlaps", b).says).toBe(
      "To check this, give A an end.",
    );
    expect(one(span("A", { start: rough(500) }), "overlaps", b).state).toBe("does_not_fit");
    expect(one(placed("A", [0, 0], [70, 80]), "overlaps", span("B")).says).toBe(
      "To check this, give B a start.",
    );
  });

  it("with an event, means the event falls within the span, ends included", () => {
    expect(one(event("A", rough(110)), "overlaps", placed("B", [50, 50], [110, 110])).state).toBe(
      "holds",
    );
    expect(one(placed("B", [50, 50], [110, 110]), "overlaps", event("A", rough(50))).state).toBe(
      "holds",
    );
    expect(one(event("A", rough(111)), "overlaps", placed("B", [50, 50], [110, 110])).state).toBe(
      "does_not_fit",
    );
    expect(one(event("A", rough(105)), "overlaps", b).state).toBe("may_not_fit");
    expect(one(event("A", rough(7)), "overlaps", event("B", rough(7))).state).toBe("holds");
    expect(one(event("A"), "overlaps", b).says).toBe("To check this, give A a start.");
  });

  it("holds with a span that is still going on", () => {
    const going = span("B", { start: rough(50), end: "open" });
    expect(one(placed("A", [0, 0], [70, 80]), "overlaps", going).state).toBe("holds");
  });
});

describe("longer_than and shorter_than", () => {
  const b = span("B", { length: len(60, 175) });

  it("holds, does not fit, and may not fit by the lengths", () => {
    expect(one(span("A", { length: len(176, 200) }), "longer_than", b).state).toBe("holds");
    expect(one(span("A", { length: len(10, 59) }), "longer_than", b)).toEqual({
      state: "does_not_fit",
      says: "A is shorter than B; you said it is longer.",
    });
    expect(one(span("A", { length: len(170, 180) }), "longer_than", b)).toEqual({
      state: "may_not_fit",
      says: "A is longer than B only if B is nearer 60 years than 175.",
    });
    expect(one(span("A", { length: len(100, 900) }), "longer_than", b).says).toBe(
      "A is longer than B only if A is nearer 900 years than 100.",
    );
  });

  it("uses a length worked out from a start and an end", () => {
    expect(one(placed("A", [0, 0], [500, 500]), "longer_than", b).state).toBe("holds");
  });

  it("tests shorter_than as longer_than with the two exchanged", () => {
    expect(one(b, "shorter_than", span("A", { length: len(200) })).state).toBe("holds");
    expect(one(b, "shorter_than", span("A", { length: len(10) }))).toEqual({
      state: "does_not_fit",
      says: "B is longer than A; you said it is shorter.",
    });
    expect(one(b, "shorter_than", span("A", { length: len(100) })).says).toBe(
      "B is shorter than A only if B is nearer 60 years than 175.",
    );
  });

  it("gives an event length 0", () => {
    expect(one(b, "longer_than", event("E")).state).toBe("holds");
    expect(one(event("E"), "longer_than", b).state).toBe("does_not_fit");
    expect(one(event("E"), "longer_than", event("F"))).toEqual({
      state: "may_not_fit",
      says: "E is longer than F only if your ranges are narrower.",
    });
  });

  it("cannot tell without a length, and says so differently for an open end", () => {
    expect(one(span("A"), "longer_than", b).says).toBe("To check this, give A a length.");
    expect(one(b, "longer_than", span("A")).says).toBe("To check this, give A a length.");
    expect(one(span("A", { start: rough(0), end: "open" }), "longer_than", b)).toEqual({
      state: "cannot_tell",
      says: "This cannot be checked while A has an open start or end.",
    });
  });
});

describe("states that do not come from numbers", () => {
  it("is broken when it names a span that is gone, whatever its kind", () => {
    const input = chronicle(
      [span("A")],
      [rel("r1", "A", "after", "gone"), rel("r2", "x", "odd", "A")],
    );
    const checks = checkRelations(input);
    expect(checks.map((c) => c.state)).toEqual(["broken", "broken"]);
    expect(sentenceFor(checks[0]!, input)).toBe("This names a span that was removed.");
  });

  it("is not checked when its kind is unknown", () => {
    const input = chronicle([span("A"), span("B")], [rel("r1", "A", "sings_to", "B")]);
    const check = checkRelations(input)[0]!;
    expect(check.state).toBe("not_checked");
    expect(sentenceFor(check, input)).toBe(
      "This kind of statement is not checked by this version.",
    );
  });

  it("contradicts when it is part of a circle, and lists the circle", () => {
    const input: ChronicleInput = chronicle(
      [
        span("A", { start: rough(0), end: rough(1) }),
        span("B", { start: rough(2), end: rough(3) }),
        span("C", { name: "" }),
      ],
      [
        rel("r1", "A", "after", "B"),
        rel("r2", "B", "after", "C"),
        rel("r3", "C", "after", "A"),
        rel("r4", "B", "after", "A"),
      ],
    );
    const checks = checkRelations(input);
    expect(checks.map((c) => c.state)).toEqual([
      "contradicts",
      "contradicts",
      "contradicts",
      "contradicts",
    ]);
    expect(checks[0]?.circle).toEqual(["r1", "r2", "r3", "r4"]);
    expect(sentenceFor(checks[0]!, input)).toBe(
      "These statements go in a circle: A is after B; B is after (unnamed); (unnamed) is after A; B is after A.",
    );
  });

  it("takes circles passed in, and names spans as the caller asks", () => {
    const input = chronicle([span("A"), span("B")], [rel("r1", "A", "after", "B")]);
    const check = checkRelations(input, [["r1", "r9"]])[0]!;
    expect(check.state).toBe("contradicts");
    expect(sentenceFor(check, input, (s) => `<${s.id}>`)).toBe(
      "These statements go in a circle: <A> is after <B>.",
    );
  });

  it("still checks a relation by its numbers when a number step against it was dropped", () => {
    const input = chronicle(
      [
        span("A", { start: rough(0), end: rough(10) }),
        span("B", { start: rough(20), end: rough(30) }),
      ],
      [rel("r1", "A", "after", "B")],
    );
    expect(checkRelations(input)[0]?.state).toBe("does_not_fit");
  });
});
