import { describe, expect, it } from "vitest";
import type { Px } from "../findAreas/contour.ts";
import { inkMasks } from "./classes.ts";
import { joinLines, lineLength, meander, nearestOn, resample, simplifyOpen, smoothOpen } from "./lines.ts";
import { Painter, rgb } from "./paint.ts";
import { Tracer } from "./trace.ts";

const TAN = rgb("#ded2a2");
const BLUE = rgb("#4a7391");
const RED = rgb("#8a3520");
const INK = rgb("#3c2f21");

function tracer(p: Painter): Tracer {
  const pic = p.lab();
  // The middle of a tan picture with a little ink is the tan itself.
  const ref = { l: 84, a: -3, b: 25 };
  return new Tracer({ ...pic, ink: inkMasks(pic).faint, ref });
}
const far = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** The farthest any point of a line is from another line. */
const strays = (line: Px[], from: Px[]) => Math.max(...line.map((p) => nearestOn(p, from).d));

describe("tracing a painted line", () => {
  it("brings back a thin dashed diagonal whole, through its gaps", () => {
    const road: [number, number][] = [
      [20, 20],
      [180, 140],
    ];
    const t = tracer(new Painter(200, 160, TAN).line(road, 2, RED, [8, 4]));
    const traced = t.trace([100, 80], null, true);
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    expect(traced.kind).toBe("road");
    expect(traced.loop).toBe(false);
    expect(traced.branches).toHaveLength(0);
    // From end to end (a dash's length short at most), and on the line.
    expect(lineLength(traced.points)).toBeGreaterThan(lineLength(road) - 12);
    expect(strays(traced.points.slice(2, -2), road)).toBeLessThan(0.6);
    expect(strays(traced.points, road)).toBeLessThan(2.5);
  });

  it("stops at a second click on the same line, and refuses one on another line", () => {
    const p = new Painter(200, 160, TAN)
      .line(
        [
          [10, 30],
          [190, 30],
        ],
        2,
        BLUE,
      )
      .line(
        [
          [10, 120],
          [190, 120],
        ],
        2,
        BLUE,
      );
    const t = tracer(p);
    const part = t.trace([40, 30], [120, 30], true);
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    expect(part.kind).toBe("river");
    expect(lineLength(part.points)).toBeGreaterThan(74);
    expect(lineLength(part.points)).toBeLessThan(86);
    expect(t.trace([40, 30], [120, 120], true)).toEqual({ ok: false, why: "other" });
  });

  it("gives a Y as a main line and one branch that ends on it", () => {
    const main: [number, number][] = [
      [20, 80],
      [100, 80],
      [180, 30],
    ];
    const side: [number, number][] = [
      [100, 80],
      [150, 140],
    ];
    const t = tracer(new Painter(200, 160, TAN).line(main, 2, BLUE).line(side, 2, BLUE));
    const traced = t.trace([50, 80], null, true);
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    expect(traced.branches).toHaveLength(1);
    const branch = traced.branches[0]!;
    // The branch is the shorter arm; it ends exactly on the main line.
    expect(lineLength(branch)).toBeLessThan(lineLength(traced.points));
    expect(nearestOn(branch[branch.length - 1]!, traced.points).d).toBeLessThan(1e-9);
    // Without asking for branches (while only pointing), none are looked for.
    const pointed = t.trace([50, 80], null, false);
    expect(pointed.ok && pointed.branches).toEqual([]);
  });

  it("follows a closed line all the way round", () => {
    const ring: [number, number][] = [];
    for (let k = 0; k <= 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      ring.push([100 + 60 * Math.cos(a), 80 + 45 * Math.sin(a)]);
    }
    const t = tracer(new Painter(200, 160, TAN).line(ring, 2, INK));
    const traced = t.trace([160, 80], null, true);
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    expect(traced.loop).toBe(true);
    expect(traced.kind).toBe("line");
    expect(far(traced.points[0]!, traced.points[traced.points.length - 1]!)).toBe(0);
    expect(lineLength(traced.points)).toBeGreaterThan(lineLength(ring) * 0.9);
  });

  it("calls a letter too short, and bare ground no line", () => {
    const p = new Painter(200, 160, TAN).line(
      [
        [50, 50],
        [58, 50],
        [58, 60],
      ],
      2,
      INK,
    );
    const t = tracer(p);
    expect(t.trace([52, 50], null, true)).toEqual({ ok: false, why: "short" });
    expect(t.trace([150, 120], null, true)).toEqual({ ok: false, why: "none" });
  });
});

describe("lines made into points", () => {
  const zigzag: Px[] = Array.from({ length: 41 }, (_, i) => [i * 5, i % 2 ? 0.4 : -0.4]);

  it("thins an open line and keeps both ends", () => {
    const thin = simplifyOpen(zigzag, 1);
    expect(thin).toEqual([zigzag[0], zigzag[40]]);
    const corner: Px[] = [
      [0, 0],
      [50, 0],
      [100, 0],
      [100, 50],
      [100, 100],
    ];
    expect(simplifyOpen(corner, 1)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });

  it("smooths without moving the ends, and steps evenly", () => {
    const smooth = smoothOpen(zigzag, 3);
    expect(smooth[0]).toEqual(zigzag[0]);
    expect(smooth[40]).toEqual(zigzag[40]);
    expect(Math.abs(smooth[20]![1])).toBeLessThan(0.1);
    const stepped = resample(
      [
        [0, 0],
        [10, 0],
      ],
      3,
    );
    expect(stepped.map((p) => p[0])).toEqual([0, 3, 6, 9, 10]);
  });

  it("winds a river between its ends, the same way each time", () => {
    const straight: Px[] = Array.from({ length: 101 }, (_, i) => [i * 2, 50]);
    const wound = meander(straight, 6);
    expect(wound[0]).toEqual(straight[0]);
    expect(far(wound[100]!, straight[100]!)).toBeLessThan(1e-9);
    expect(Math.max(...wound.map((p) => Math.abs(p[1] - 50)))).toBeGreaterThan(1.5);
    expect(meander(straight, 6)).toEqual(wound);
    expect(meander(straight, 0)).toEqual(straight);
    // On steep ground it hardly winds.
    const steep = meander(straight, 6, () => 0);
    expect(Math.max(...steep.map((p) => Math.abs(p[1] - 50)))).toBeLessThan(
      Math.max(...wound.map((p) => Math.abs(p[1] - 50))) * 0.5,
    );
  });

  it("joins two paths end to end, whichever way each was drawn", () => {
    const a: Px[] = [
      [0, 0],
      [10, 0],
    ];
    const b: Px[] = [
      [30, 0],
      [10, 0],
    ];
    expect(joinLines(a, b)).toEqual([
      [0, 0],
      [10, 0],
      [30, 0],
    ]);
    expect(
      joinLines(a, [
        [-5, 5],
        [-20, 5],
      ]),
    ).toEqual([
      [-20, 5],
      [-5, 5],
      [0, 0],
      [10, 0],
    ]);
  });
});
