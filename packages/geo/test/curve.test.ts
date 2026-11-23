import { geoDistance } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  catmullRom,
  densify,
  measure,
  midpointOn,
  outline,
  type Position,
  type Space,
  spanEnd,
} from "../src/index.js";

const SPHERE: Space = { kind: "sphere", radius: null, unit: "km" };
const FLAT: Space = { kind: "flat", width: 2000, height: 1000, scale: null, unit: "km" };

const has = (line: Position[], p: Position, digits = 9) =>
  line.some((q) => Math.abs(q[0] - p[0]) < 10 ** -digits && Math.abs(q[1] - p[1]) < 10 ** -digits);
const degrees = (a: Position, b: Position) => (geoDistance(a, b) * 180) / Math.PI;
/** The longest step between neighbours of a line on a sphere, in degrees. */
const longestStep = (line: Position[]) =>
  Math.max(...line.slice(1).map((p, i) => degrees(line[i]!, p)));
/** The distance from a point of a flat map to the nearest piece of a line. */
const offLine = (line: Position[], p: Position) =>
  Math.min(
    ...line.slice(1).map((b, i) => {
      const a = line[i]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
      );
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    }),
  );

const RIVER: Position[] = [
  [100, 100],
  [300, 160],
  [420, 380],
  [700, 420],
  [820, 200],
];

describe("the outline of a path or zone", () => {
  it("passes through every control point, curved or not", () => {
    for (const curve of [true, false]) {
      const flat = outline(FLAT, RIVER, { curve, closed: false });
      for (const p of RIVER) expect(has(flat.line, p)).toBe(true);
      const globe: Position[] = [
        [0, 0],
        [20, 10],
        [40, -5],
        [60, 15],
      ];
      const round = outline(SPHERE, globe, { curve, closed: true });
      for (const p of globe) expect(has(round.line, p)).toBe(true);
      // Each stored point is where its segment starts.
      globe.forEach((p, i) => expect(round.line[round.spans[i]!]).toEqual(p));
    }
  });

  it("gives today's densified line for a straight feature", () => {
    const points: Position[] = [
      [170, 10],
      [-170, 20],
      [-150, -10],
    ];
    expect(outline(SPHERE, points, { curve: false, closed: false }).line).toEqual(
      densify(SPHERE, points),
    );
    expect(outline(SPHERE, points, { curve: false, closed: true }).line).toEqual(
      densify(SPHERE, [...points, points[0]!]),
    );
    expect(outline(FLAT, RIVER, { curve: false, closed: false }).line).toEqual(RIVER);
  });

  it("has one span per stored segment, each where its segment starts in the line", () => {
    const path = outline(FLAT, RIVER, { curve: true, closed: false });
    expect(path.spans).toHaveLength(RIVER.length - 1);
    RIVER.slice(0, -1).forEach((p, i) => expect(path.line[path.spans[i]!]).toEqual(p));
    expect(path.spans).toEqual([...path.spans].sort((a, b) => a - b));
    const zone = outline(
      SPHERE,
      RIVER.map(([x, y]): Position => [x / 20, y / 20]),
      {
        curve: true,
        closed: true,
      },
    );
    expect(zone.spans).toHaveLength(RIVER.length);
    // A closed outline repeats its first position last.
    expect(zone.line[zone.line.length - 1]).toEqual(zone.line[0]);
    expect(spanEnd(zone, RIVER.length - 1)).toBe(zone.line.length - 1);
  });

  it("keeps repeated points as segments of no length, aligned with the stored points", () => {
    const points: Position[] = [
      [0, 0],
      [0, 0],
      [100, 0],
      [100, 100],
      [100, 100],
      [0, 100],
      [0, 0],
    ];
    const zone = outline(FLAT, points, { curve: true, closed: true });
    expect(zone.spans).toHaveLength(7);
    expect(spanEnd(zone, 0)).toBe(zone.spans[0]);
    expect(spanEnd(zone, 3)).toBe(zone.spans[3]);
    // The last point repeats the first: its segments stand at the close.
    expect(zone.spans[6]).toBe(zone.line.length - 1);
    expect(spanEnd(zone, 6)).toBe(zone.spans[6]);
    expect(midpointOn(FLAT, zone, 0)).toBeNull();
    expect(midpointOn(FLAT, zone, 6)).toBeNull();
    expect(midpointOn(FLAT, zone, 2)).not.toBeNull();
    // The same zone without its repeats has the same line.
    const plain = outline(
      FLAT,
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      { curve: true, closed: true },
    );
    expect(zone.line).toEqual(plain.line);
  });

  it("draws one distinct point as a dot, and two as the straight line between them", () => {
    expect(outline(FLAT, [], { curve: true, closed: false })).toEqual({ line: [], spans: [] });
    expect(outline(FLAT, [[5, 5]], { curve: true, closed: false })).toEqual({
      line: [[5, 5]],
      spans: [],
    });
    expect(
      outline(
        FLAT,
        [
          [5, 5],
          [5, 5],
          [5, 5],
        ],
        { curve: true, closed: true },
      ),
    ).toEqual({ line: [[5, 5]], spans: [0, 0, 0] });
    const two: Position[] = [
      [0, 0],
      [100, 50],
    ];
    expect(outline(FLAT, two, { curve: true, closed: false }).line).toEqual(two);
    // A zone of two distinct points goes there and back.
    const there = outline(FLAT, [...two, [0, 0]], { curve: true, closed: true });
    expect(there.line).toEqual([...two, [0, 0]]);
    expect(there.spans).toEqual([0, 1, 2]);
  });

  it("is the same line every time: it depends on the space and the points alone", () => {
    const a = outline(
      SPHERE,
      [
        [0, 0],
        [30, 20],
        [60, 0],
      ],
      { curve: true, closed: false },
    );
    const b = outline(
      SPHERE,
      [
        [0, 0],
        [30, 20],
        [60, 0],
      ],
      { curve: true, closed: false },
    );
    expect(a).toEqual(b);
  });

  it("samples a flat curve by its chord, between 8 and 64 pieces a segment", () => {
    const short = outline(
      FLAT,
      [
        [0, 0],
        [10, 0],
        [20, 10],
      ],
      { curve: true, closed: false },
    );
    expect(short.spans).toEqual([0, 8]);
    const long = outline(
      FLAT,
      [
        [0, 0],
        [1000, 0],
        [1000, 1000],
      ],
      { curve: true, closed: false },
    );
    expect(long.spans).toEqual([0, 64]);
    expect(long.line).toHaveLength(129);
  });

  it("bends smoothly: a curve is longer than its chord, and leaves along its first segment", () => {
    const curve = outline(FLAT, RIVER, { curve: true, closed: false });
    const straight = outline(FLAT, RIVER, { curve: false, closed: false });
    expect(measure(FLAT, curve.line).raw).toBeGreaterThan(measure(FLAT, straight.line).raw);
    // Every piece of the curve is short: no jump, no loop out of the way.
    const pieces = curve.line
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - curve.line[i]![0], p[1] - curve.line[i]![1]));
    expect(Math.max(...pieces)).toBeLessThan(40);
  });

  it("turns a sharp corner without a loop", () => {
    const sharp: Position[] = [
      [0, 0],
      [100, 0],
      [0, 5],
    ];
    const line = outline(FLAT, sharp, { curve: true, closed: false }).line;
    // Centripetal: the curve stays near the two segments, never far beyond the corner.
    expect(Math.max(...line.map((p) => p[0]))).toBeLessThan(115);
  });

  it("on a globe works on the sphere: across the 180th meridian it runs on without a jump", () => {
    const points: Position[] = [
      [170, 0],
      [178, 10],
      [-175, 5],
      [-165, 12],
    ];
    const o = outline(SPHERE, points, { curve: true, closed: false });
    const jumps = o.line.slice(1).map((p, i) => Math.abs(p[0] - o.line[i]![0]));
    expect(Math.max(...jumps)).toBeLessThan(3.01);
    expect(longestStep(o.line)).toBeLessThanOrEqual(3 + 1e-9);
    // The same curve shifted by 40 degrees of longitude is the same shape.
    const shifted = outline(
      SPHERE,
      points.map(([lon, lat]): Position => [lon - 40, lat]),
      { curve: true, closed: false },
    );
    expect(shifted.line).toHaveLength(o.line.length);
    shifted.line.forEach((p, i) => {
      expect(p[1]).toBeCloseTo(o.line[i]![1], 9);
    });
  });

  it("curves over a pole", () => {
    const points: Position[] = [
      [0, 70],
      [90, 80],
      [180, 70],
      [-90, 80],
    ];
    const o = outline(SPHERE, points, { curve: true, closed: true });
    // Longitudes run on, so a point is found by its distance, not by its numbers.
    for (const p of points) expect(o.line.some((q) => degrees(p, q) < 1e-9)).toBe(true);
    expect(Math.max(...o.line.map((p) => p[1]))).toBeLessThanOrEqual(90);
    expect(longestStep(o.line)).toBeLessThan(3.01);
  });

  it("draws a segment over 90 degrees, and points 179 degrees apart, as great circles", () => {
    const wide: Position[] = [
      [0, 0],
      [120, 0],
      [130, 20],
    ];
    const o = outline(SPHERE, wide, { curve: true, closed: false });
    // The first segment is the equator, unbent.
    for (const p of o.line.slice(0, o.spans[1]! + 1)) expect(p[1]).toBeCloseTo(0, 9);
    const apart = outline(
      SPHERE,
      [
        [0, 0],
        [179, 0],
        [179, 30],
      ],
      { curve: true, closed: false },
    );
    expect(apart.line.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
    expect(apart.spans[1]).toBe(60);
  });

  it("samples a globe's curve by its angle, one degree a piece, 8 to 64 a segment", () => {
    const o = outline(
      SPHERE,
      [
        [0, 0],
        [2, 0],
        [4, 2],
      ],
      { curve: true, closed: false },
    );
    expect(o.spans).toEqual([0, 8]);
  });
});

describe('the middle of a segment, where its "+" goes', () => {
  it("lies on the line as drawn, curved or straight", () => {
    const curve = outline(FLAT, RIVER, { curve: true, closed: false });
    for (let i = 0; i < RIVER.length - 1; i++) {
      const mid = midpointOn(FLAT, curve, i)!;
      expect(offLine(curve.line, mid)).toBeLessThan(1e-6);
    }
    const straight = outline(FLAT, RIVER, { curve: false, closed: false });
    expect(midpointOn(FLAT, straight, 0)).toEqual([200, 130]);
  });

  it("is the great-circle middle of a straight segment on a globe", () => {
    const o = outline(
      SPHERE,
      [
        [170, 0],
        [-170, 0],
      ],
      { curve: false, closed: false },
    );
    const mid = midpointOn(SPHERE, o, 0)!;
    expect(mid[0]).toBeCloseTo(-180, 9);
    expect(mid[1]).toBeCloseTo(0, 9);
    expect(midpointOn(SPHERE, o, 1)).toBeNull();
  });

  it("splits a curved segment on a globe into two of equal length", () => {
    const points: Position[] = [
      [0, 0],
      [20, 10],
      [40, -5],
    ];
    const o = outline(SPHERE, points, { curve: true, closed: false });
    const mid = midpointOn(SPHERE, o, 0)!;
    const run = o.line.slice(0, o.spans[1]! + 1);
    const total = measure(SPHERE, run).raw;
    const k = run.findIndex(
      (p, i) => i > 0 && measure(SPHERE, run.slice(0, i + 1)).raw >= total / 2,
    );
    const first = measure(SPHERE, [...run.slice(0, k), mid]).raw;
    expect(first).toBeCloseTo(total / 2, 6);
  });
});

describe("the centripetal spline", () => {
  it("ends at the segment's end, and copes with a neighbour on the same spot", () => {
    const out = catmullRom([0, 0], [0, 0], [10, 0], [20, 0], 4);
    expect(out).toHaveLength(4);
    expect(out[3]).toEqual([10, 0]);
    expect(out.every((v) => v.every(Number.isFinite))).toBe(true);
  });
});
