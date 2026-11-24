import { describe, expect, it } from "vitest";
import { type ChronicleFile, type ChronicleSpan, emptyChronicle } from "@frontier/schema";
import { placeFromStatements, setTie, withSpan, withTies } from "./model.ts";

const span = (id: string, extra: Partial<ChronicleSpan> = {}): ChronicleSpan => ({
  id,
  lane: "l1",
  name: id,
  point: false,
  start: null,
  end: null,
  length: null,
  entry: null,
  note: "",
  ...extra,
});
const at = (low: number, high = low) => ({ words: "", low, high });

const cuj: ChronicleFile = {
  ...emptyChronicle("c4h7x2ab", "Ezob", "l1"),
  origin: "landing",
  spans: [
    span("landing", { point: true, start: at(0) }),
    span("fading", { length: { words: "3-5 generations", low: 60, high: 175, clock: "ezob" } }),
  ],
  relations: [{ id: "r1", a: "fading", kind: "starts_with", b: "landing" }],
};

describe("ties on the page", () => {
  it("places what was said once asked, and keeps the statement", () => {
    const placed = placeFromStatements(cuj);
    const fading = placed.spans[1]!;
    expect(fading.startFrom).toEqual({ span: "landing", edge: "start", plus: { low: 0, high: 0 } });
    expect(fading.start).toEqual(at(0));
    expect(placed.relations).toHaveLength(1);
    expect(placeFromStatements(placed)).toBe(placed);
  });

  it("follows the anchor when it moves, and comes back unchanged when nothing moved", () => {
    const placed = placeFromStatements(cuj);
    expect(withTies(placed)).toBe(placed);
    const moved = withTies(withSpan(placed, "landing", (s) => ({ ...s, start: at(-20) })));
    expect(moved.spans[1]!.start).toEqual(at(-20));
  });

  it("unties a point and keeps its number", () => {
    const fading = placeFromStatements(cuj).spans[1]!;
    const loose = setTie(fading, "start", null);
    expect("startFrom" in loose).toBe(false);
    expect(loose.start).toEqual(at(0));
  });
});
