import { describe, expect, it } from "vitest";
import { offerFor, offerMove } from "../src/index.js";
import { event, len, rel, rough, span } from "./helpers.js";

const b = span("B", { start: rough(100, 110), end: rough(300, 320) });

describe("offered starts", () => {
  it("after: the start is B's end range", () => {
    expect(offerFor("after", span("A"), b)).toEqual({ start: { lo: 300, hi: 320 }, end: null });
    expect(offerFor("after", span("A"), span("B", { start: rough(0) }))).toBeNull();
  });

  it("before: the end is B's start range, and the start that minus A's length", () => {
    expect(offerFor("before", span("A"), b)).toEqual({ start: null, end: { lo: 100, hi: 110 } });
    expect(offerFor("before", span("A", { length: len(20, 30) }), b)).toEqual({
      start: { lo: 70, hi: 90 },
      end: { lo: 100, hi: 110 },
    });
    expect(offerFor("before", event("A"), b)).toEqual({ start: { lo: 100, hi: 110 }, end: null });
    expect(offerFor("before", span("A"), span("B", { end: rough(0) }))).toBeNull();
  });

  it("during: from B's earliest start to B's latest end less A's length", () => {
    expect(offerFor("during", span("A"), b)).toEqual({ start: { lo: 100, hi: 320 }, end: null });
    expect(offerFor("during", span("A", { length: len(20, 30) }), b)).toEqual({
      start: { lo: 100, hi: 290 },
      end: null,
    });
    expect(offerFor("during", span("A", { length: len(500) }), b)).toBeNull();
    expect(offerFor("during", span("A"), span("B", { start: rough(0) }))).toBeNull();
    expect(offerFor("during", span("A"), span("B", { end: rough(0) }))).toBeNull();
  });

  it("starts_with: the start is B's start range", () => {
    expect(offerFor("starts_with", span("A"), b)).toEqual({
      start: { lo: 100, hi: 110 },
      end: null,
    });
    expect(offerFor("starts_with", span("A"), span("B"))).toBeNull();
  });

  it("ends_with: the end is B's end range, or the one point of an event", () => {
    expect(offerFor("ends_with", span("A"), b)).toEqual({ start: null, end: { lo: 300, hi: 320 } });
    expect(offerFor("ends_with", event("A"), b)).toEqual({
      start: { lo: 300, hi: 320 },
      end: null,
    });
    expect(offerFor("ends_with", span("A"), span("B"))).toBeNull();
  });

  it("overlaps: from B's earliest start to B's latest end", () => {
    expect(offerFor("overlaps", span("A"), b)).toEqual({ start: { lo: 100, hi: 320 }, end: null });
    expect(offerFor("overlaps", span("A"), span("B", { start: rough(1) }))).toBeNull();
  });

  it("offers nothing for lengths or an unknown kind", () => {
    expect(offerFor("longer_than", span("A"), b)).toBeNull();
    expect(offerFor("shorter_than", span("A"), b)).toBeNull();
    expect(offerFor("sings_to", span("A"), b)).toBeNull();
  });

  it("offers nothing that would be an open end", () => {
    const old = span("B", { start: "open", end: rough(5) });
    expect(offerFor("starts_with", span("A"), old)).toBeNull();
    expect(offerFor("before", span("A", { length: len(5) }), old)).toBeNull();
    expect(offerFor("after", span("A"), span("B", { start: rough(0), end: "open" }))).toBeNull();
  });
});

describe("Move A and Move B", () => {
  const a = span("A", { start: rough(0), length: len(20, 30) });
  const spans = [a, b];

  it("Move A reads the table as it stands", () => {
    expect(offerMove(rel("r", "A", "after", "B"), "a", spans)).toEqual({
      start: { lo: 300, hi: 320 },
      end: null,
    });
  });

  it("Move B reads it with the two exchanged", () => {
    // A after B, moving B: B is before A, so B ends where A starts.
    expect(offerMove(rel("r", "A", "after", "B"), "b", spans)).toEqual({
      start: { lo: -220, hi: -190 },
      end: { lo: 0, hi: 0 },
    });
    expect(offerMove(rel("r", "A", "before", "B"), "b", spans)).toEqual({
      start: { lo: 20, hi: 30 },
      end: null,
    });
    expect(offerMove(rel("r", "A", "starts_with", "B"), "b", spans)).toEqual({
      start: { lo: 0, hi: 0 },
      end: null,
    });
    expect(offerMove(rel("r", "A", "ends_with", "B"), "b", spans)).toEqual({
      start: null,
      end: { lo: 20, hi: 30 },
    });
    expect(offerMove(rel("r", "A", "overlaps", "B"), "b", spans)).toEqual({
      start: { lo: 0, hi: 30 },
      end: null,
    });
  });

  it("offers nothing for Move B on during, on lengths, or with a span gone", () => {
    expect(offerMove(rel("r", "A", "during", "B"), "b", spans)).toBeNull();
    expect(offerMove(rel("r", "A", "longer_than", "B"), "b", spans)).toBeNull();
    expect(offerMove(rel("r", "A", "after", "gone"), "a", spans)).toBeNull();
    expect(offerMove(rel("r", "gone", "after", "B"), "b", spans)).toBeNull();
  });
});
