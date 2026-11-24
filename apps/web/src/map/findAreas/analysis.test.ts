import { describe, expect, it } from "vitest";
import { groupRings, inRing, type Mask, signedArea, traceMask } from "./contour.ts";
import { findInk } from "./ink.ts";
import { toLab } from "./lab.ts";
import { areaMask, withPolygon } from "./masks.ts";
import { type AreaOptions, DEFAULT_OPTIONS, findAreas, INK } from "./segment.ts";
import { simplifyRing, smoothRing } from "./simplify.ts";

type RGB = [number, number, number];

/** A picture painted pixel by pixel. */
function paint(w: number, h: number, colour: (x: number, y: number) => RGB) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colour(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return toLab(data, w, h);
}

const areasOf = (pic: ReturnType<typeof paint>, options: Partial<AreaOptions> = {}, wrap = false) =>
  findAreas(pic, findInk(pic), { ...DEFAULT_OPTIONS, ...options }, wrap);

/** The area under a pixel. */
const at = (a: ReturnType<typeof areasOf>, x: number, y: number) => a.labels[y * a.w + x]!;

const GREEN: RGB = [169, 185, 138];
const OCHRE: RGB = [220, 184, 113];
const SEA: RGB = [170, 197, 196];
const LINE: RGB = [60, 47, 33];

function maskOf(w: number, h: number, on: (x: number, y: number) => boolean): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = on(x, y) ? 1 : 0;
  return { ox: 0, oy: 0, w, h, data };
}

describe("tracing a mask", () => {
  it("gives one outside ring round a square, running clockwise on the screen", () => {
    const rings = traceMask(maskOf(30, 30, (x, y) => x >= 5 && x < 25 && y >= 5 && y < 25));
    expect(rings).toHaveLength(1);
    expect(rings[0]!.role).toBe("outer");
    expect(signedArea(rings[0]!.points)).toBeGreaterThan(0);
    // The cut is at the middle of each edge between inside and outside: 20 × 20, less the four corners cut.
    expect(rings[0]!.area).toBeCloseTo(400 - 0.5, 5);
  });

  it("tells a hole from a piece, and groups the hole into its piece", () => {
    const rings = traceMask(
      maskOf(40, 40, (x, y) => {
        const outer = x >= 2 && x < 38 && y >= 2 && y < 38;
        const hole = x >= 12 && x < 28 && y >= 12 && y < 28;
        const island = x >= 17 && x < 23 && y >= 17 && y < 23;
        return (outer && !hole) || island;
      }),
    );
    expect(rings.map((r) => r.role).sort()).toEqual(["hole", "outer", "outer"]);
    const pieces = groupRings(rings);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.holes).toHaveLength(1);
    expect(pieces[1]!.holes).toHaveLength(0);
    expect(inRing(pieces[1]!.outer[0]!, pieces[0]!.holes[0]!)).toBe(true);
  });

  it("keeps apart two squares that touch only at a corner", () => {
    const rings = traceMask(
      maskOf(
        30,
        30,
        (x, y) =>
          (x >= 3 && x < 13 && y >= 3 && y < 13) || (x >= 13 && x < 23 && y >= 13 && y < 23),
      ),
    );
    expect(rings.filter((r) => r.role === "outer")).toHaveLength(2);
  });

  it("traces an L-shape as one ring, offset by the mask's place", () => {
    const mask = maskOf(
      20,
      20,
      (x, y) => (x >= 2 && x < 8 && y >= 2 && y < 18) || (y >= 12 && y < 18 && x >= 2 && x < 18),
    );
    const rings = traceMask({ ...mask, ox: 100, oy: 50 });
    expect(rings).toHaveLength(1);
    const xs = rings[0]!.points.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(101.5, 5);
    expect(Math.max(...xs)).toBeCloseTo(117.5, 5);
  });

  it("drops a fleck of a few pixels", () => {
    expect(traceMask(maskOf(20, 20, (x, y) => x === 5 && y === 5))).toHaveLength(0);
  });
});

describe("simplifying an outline", () => {
  it("brings a traced square down to its corners", () => {
    const ring = traceMask(maskOf(60, 60, (x, y) => x >= 10 && x < 50 && y >= 10 && y < 50))[0]!;
    const simple = simplifyRing(smoothRing(ring.points), 1.5);
    expect(simple.length).toBeGreaterThanOrEqual(4);
    expect(simple.length).toBeLessThanOrEqual(8);
  });
});

describe("finding areas", () => {
  it("finds two countries either side of a border, and splits the line between them", () => {
    const pic = paint(120, 80, (x) => (Math.abs(x - 60) <= 1 ? LINE : x < 60 ? GREEN : OCHRE));
    const a = areasOf(pic);
    expect(a.count).toBe(2);
    expect(at(a, 10, 40)).not.toBe(at(a, 110, 40));
    // The line's pixels are shared out: none is left without an area.
    expect([...a.labels].every((l) => l >= 0)).toBe(true);
    expect(a.size[0]! + a.size[1]!).toBe(120 * 80);
  });

  it("closes a dashed border, and lets the colour join two halves when lines are not walls", () => {
    // Two halves of the same colour with a dashed line between them.
    const pic = paint(160, 100, (x, y) => (Math.abs(x - 80) <= 1 && y % 10 < 6 ? LINE : GREEN));
    expect(areasOf(pic).count).toBe(2);
    expect(areasOf(pic, { stopAtLines: false }).count).toBe(1);
  });

  it("looks past a mark inside an area, or shows it as ink when asked to", () => {
    // A small dark letter-like blot in the middle of one country.
    const pic = paint(100, 100, (x, y) =>
      x >= 45 && x < 52 && y >= 45 && y < 52 && (x + y) % 3 ? LINE : GREEN,
    );
    const looked = areasOf(pic);
    expect(looked.count).toBe(1);
    expect(at(looked, 48, 48)).toBe(0);
    const shown = areasOf(pic, { ignoreMarks: false });
    expect(shown.labels.includes(INK)).toBe(true);
  });

  it("keeps a slow gradient one area when loose, and bands it when strict", () => {
    const pic = paint(200, 40, (x) => {
      const t = x / 199;
      return [Math.round(150 + 60 * t), Math.round(180 - 20 * t), Math.round(200 - 60 * t)];
    });
    expect(areasOf(pic, { tolerance: 36 }).count).toBe(1);
    expect(areasOf(pic, { tolerance: 3 }).count).toBeGreaterThan(1);
  });

  it("joins the left and right edges of a picture that goes round", () => {
    const pic = paint(120, 60, (x) => (x < 20 || x >= 100 ? OCHRE : SEA));
    expect(areasOf(pic).count).toBe(3);
    const round = areasOf(pic, {}, true);
    expect(round.count).toBe(2);
    expect(at(round, 5, 30)).toBe(at(round, 115, 30));
  });
});

describe("masks", () => {
  it("turns a mask across the 180th meridian into one stretch", () => {
    const pic = paint(120, 60, (x, y) => ((x < 20 || x >= 100) && y > 10 && y < 50 ? OCHRE : SEA));
    const a = areasOf(pic, {}, true);
    const land = at(a, 5, 30);
    const mask = areaMask(a, [land], true);
    // From about x = 100 (just after the empty run) once round to about x = 139.
    expect(Math.abs(mask.ox - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(mask.w - 40)).toBeLessThanOrEqual(4);
    const rings = traceMask(mask);
    expect(rings.filter((r) => r.role === "outer")).toHaveLength(1);
  });

  it("adds a polygon to a mask, growing it", () => {
    const mask = maskOf(10, 10, (x, y) => x < 5 && y < 5);
    const grown = withPolygon(
      mask,
      [
        [3, 3],
        [15, 3],
        [15, 8],
        [3, 8],
      ],
      [-100, -100, 100, 100],
    );
    expect(grown.w).toBeGreaterThanOrEqual(16);
    const rings = traceMask(grown, 1);
    expect(rings.filter((r) => r.role === "outer")).toHaveLength(1);
  });
});
