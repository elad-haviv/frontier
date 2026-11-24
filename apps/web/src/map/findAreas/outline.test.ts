import type { Position } from "@frontier/geo";
import type { MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import type { Mask, Px } from "./contour.ts";
import {
  edgeDistance,
  greatCircle,
  type ImageFrame,
  pixelAt,
  ringToPx,
  toPosition,
  toPx,
  wrapRing,
} from "./frame.ts";
import { outlineMask, pointCount } from "./outline.ts";
import { refineRing } from "./refine.ts";
import { segmentDistance } from "./simplify.ts";
import { snapRing } from "./snapRings.ts";
import { addToZone, holeCount, makeZones, numbered } from "./zones.ts";

const flat: ImageFrame = { extent: [0, 0, 200, 100], sphere: false, w: 100, h: 50 };
const globe: ImageFrame = { extent: [-180, -90, 180, 90], sphere: true, w: 360, h: 180 };

function maskOf(w: number, h: number, on: (x: number, y: number) => boolean): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = on(x, y) ? 1 : 0;
  return { ox: 0, oy: 0, w, h, data };
}

describe("where the picture's pixels lie on the map", () => {
  it("maps a flat picture through its extent, and back", () => {
    expect(toPosition(flat, [-0.5, -0.5])).toEqual([0, 0]);
    expect(toPosition(flat, [99.5, 49.5])).toEqual([200, 100]);
    const p: Px = [12.25, 30.5];
    const back = toPx(flat, toPosition(flat, p));
    expect(back[0]).toBeCloseTo(p[0], 9);
    expect(back[1]).toBeCloseTo(p[1], 9);
    expect(pixelAt(flat, [201, 50])).toBeNull();
    expect(pixelAt(flat, [3, 3])).toEqual([1, 1]);
  });

  it("maps a globe's plate to longitude and latitude, north up", () => {
    expect(toPosition(globe, [-0.5, -0.5])).toEqual([-180, 90]);
    expect(toPosition(globe, [179.5, 89.5])).toEqual([0, 0]);
    // Any turn of the globe finds the same pixel.
    expect(pixelAt(globe, [190, 0])).toEqual(pixelAt(globe, [-170, 0]));
  });

  it("keeps a ring across the 180th meridian continuous in pixels", () => {
    const px = ringToPx(globe, [
      [170, 10],
      [-170, 10],
      [-170, -10],
      [170, -10],
    ]);
    expect(px[1]![0] - px[0]![0]).toBeCloseTo(20, 6);
  });

  it("writes longitudes back onto the globe, and a run of points on a pole as one", () => {
    expect(
      wrapRing(globe, [
        [190, 80],
        [200, 90],
        [100, 90],
        [100, 80],
      ]),
    ).toEqual([
      [-170, 80],
      [-160, 90],
      [100, 80],
    ]);
  });

  it("measures an edge on a globe along its great circle, which bends towards the pole", () => {
    // Along a parallel at 60° north the great circle bows north, so the parallel's middle is off it.
    const a = toPx(globe, [-40, 60]);
    const b = toPx(globe, [40, 60]);
    const mid = toPx(globe, [0, 60]);
    expect(segmentDistance(mid, a, b)).toBeCloseTo(0, 6);
    expect(edgeDistance(globe)(mid, a, b)).toBeGreaterThan(3);
    const arc = greatCircle([-40, 60], [40, 60], 4);
    expect(arc[2]![1]).toBeGreaterThan(60);
  });
});

describe("snapping a found outline", () => {
  const neighbour: Position[] = [
    [0, 0],
    [50, 0],
    [50, 25],
    [50, 50],
    [0, 50],
  ];
  const frame: ImageFrame = { extent: [0, 0, 100, 100], sphere: false, w: 100, h: 100 };

  it("lands on the neighbour's corners exactly, and takes its corners along a shared border", () => {
    // A square to the right whose left side runs near the neighbour's right side.
    const ring: Px[] = [
      [51.5, -1.5],
      [98, 0],
      [98, 50],
      [52, 49],
    ];
    const snapped = snapRing(
      ring.map(([x, y]) => [x - 0.5, y - 0.5]),
      [{ points: neighbour, px: ringToPx(frame, neighbour) }],
    );
    const exact = snapped.filter((c) => c.at).map((c) => c.at);
    expect(exact).toEqual(
      expect.arrayContaining([
        [50, 0],
        [50, 25],
        [50, 50],
      ]),
    );
  });

  it("leaves an outline alone when no zone is near", () => {
    const ring: Px[] = [
      [80, 80],
      [90, 80],
      [90, 90],
    ];
    expect(snapRing(ring, [{ points: neighbour, px: ringToPx(frame, neighbour) }])).toEqual(
      ring.map((px) => ({ px })),
    );
  });
});

describe("outlining a mask", () => {
  it("gives a flat map's square as a few points in map positions", () => {
    const pieces = outlineMask(
      maskOf(100, 50, (x, y) => x >= 10 && x < 40 && y >= 10 && y < 40),
      { frame: flat, eps: 1.5 },
    );
    expect(pieces).toHaveLength(1);
    const xs = pieces[0]!.outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(18);
    expect(Math.max(...xs)).toBeLessThan(82);
    expect(pointCount(pieces)).toBeLessThan(12);
  });

  it("shares the border points of a zone beside it", () => {
    const left = outlineMask(
      maskOf(100, 50, (x) => x < 50),
      { frame: flat, eps: 1.5 },
    )[0]!.outer;
    const right = outlineMask(
      maskOf(100, 50, (x) => x >= 50),
      {
        frame: flat,
        eps: 1.5,
        targets: [left],
      },
    )[0]!.outer;
    const shared = right.filter((p) => left.some((q) => q[0] === p[0] && q[1] === p[1]));
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps pieces and holes apart", () => {
    const pieces = outlineMask(
      maskOf(100, 50, (x, y) => {
        const land =
          x >= 5 && x < 45 && y >= 5 && y < 45 && !(x >= 15 && x < 35 && y >= 15 && y < 35);
        return land || (x >= 60 && x < 80 && y >= 10 && y < 30);
      }),
      { frame: flat, eps: 1 },
    );
    expect(pieces).toHaveLength(2);
    expect(holeCount(pieces)).toBe(1);
    expect(pieces[0]!.holes).toHaveLength(1);
  });

  it("gives a globe's area in longitude and latitude, its edges bent to follow the plate", () => {
    // A band from 60° to 30° north between 40° west and 40° east.
    const pieces = outlineMask(
      maskOf(360, 180, (x, y) => x >= 140 && x < 220 && y >= 30 && y < 60),
      { frame: globe, eps: 1 },
    );
    expect(pieces).toHaveLength(1);
    const outer = pieces[0]!.outer;
    for (const [lon, lat] of outer) {
      expect(Math.abs(lon)).toBeLessThanOrEqual(41);
      expect(lat).toBeGreaterThan(29);
      expect(lat).toBeLessThan(61);
    }
    // The northern edge, straight on the plate, needs more than its two corners on a globe.
    expect(outer.filter(([, lat]) => lat > 59).length).toBeGreaterThan(2);
  });

  it("joins an area across the 180th meridian into one ring", () => {
    const data = new Uint8Array(360 * 180);
    for (let y = 80; y < 100; y++)
      for (let x = 0; x < 360; x++) if (x < 10 || x >= 350) data[y * 360 + x] = 1;
    // As areaMask turns it: from x = 350 once round.
    const rolled = new Uint8Array(20 * 20);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) rolled[y * 20 + x] = data[(y + 80) * 360 + ((x + 350) % 360)]!;
    const pieces = outlineMask(
      { ox: 350, oy: 80, w: 20, h: 20, data: rolled },
      { frame: globe, eps: 1 },
    );
    expect(pieces).toHaveLength(1);
    for (const [lon] of pieces[0]!.outer) expect(Math.abs(lon)).toBeGreaterThanOrEqual(169);
  });
});

describe("finishing sharp", () => {
  it("moves a point onto the darkest point of a line in the full-size picture", () => {
    // A vertical dark line at full-size x = 21; the working copy is a quarter of the size.
    const full = {
      scale: 4,
      sample: (x: number): [number, number, number] => (x === 21 ? [20, 20, 20] : [220, 220, 200]),
    };
    const ring: Px[] = [
      [5, 0],
      [5, 10],
      [6, 20],
    ];
    const [, middle] = refineRing(ring, full, () => true);
    expect((middle![0] + 0.5) * 4 - 0.5).toBeCloseTo(21, 0);
  });

  it("leaves a full-size working copy alone", () => {
    const ring: Px[] = [
      [1, 1],
      [2, 2],
      [3, 1],
    ];
    expect(refineRing(ring, { scale: 1, sample: () => [0, 0, 0] }, () => true)).toEqual(ring);
  });
});

describe("making zones of the pieces", () => {
  const map = {
    version: 1,
    id: "abcdefgh",
    title: "T",
    space: { kind: "flat", width: 100, height: 100, scale: null, unit: "km" },
    images: [],
    markerSets: [],
    layers: [{ id: "l1", name: "L", visible: true, color: "#000000" }],
    features: [
      {
        id: "z1",
        kind: "zone",
        layer: "l1",
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        label: "Skerra",
        style: "abcd1234",
        entry: "e1",
        child: null,
      },
    ],
  } as unknown as MapFile;
  const piece = (x: number) => ({
    outer: [
      [x, 0],
      [x + 5, 0],
      [x + 5, 5],
    ] as Position[],
    holes: [
      [
        [x + 1, 1],
        [x + 2, 1],
        [x + 2, 2],
      ] as Position[],
    ],
    area: 10,
  });

  it("makes one zone per piece in the layer and style, its holes filled", () => {
    const made = makeZones(map, "l1", "zzzz1111", [piece(20), piece(40)])!;
    expect(made.ids).toHaveLength(2);
    const zones = made.map.features.filter((f) => made.ids.includes(f.id));
    expect(zones.every((z) => z.kind === "zone" && z.layer === "l1" && z.label === null)).toBe(
      true,
    );
    expect((zones[0] as { style?: string }).style).toBe("zzzz1111");
    expect(makeZones(map, "l1", null, [])).toBeNull();
  });

  it("adds to a zone: it keeps the largest piece, the others are new zones named after it", () => {
    const drawn = {
      feature: map.features[0]!,
      shape: null,
      presence: "timeless",
      opacity: 1,
      dashed: false,
    } as const;
    const done = addToZone(map, drawn, [piece(0), piece(30)])!;
    expect(done.ids[0]).toBe("z1");
    const kept = done.map.features.find((f) => f.id === "z1") as {
      points: Position[];
      entry: string;
    };
    expect(kept.points).toEqual(piece(0).outer);
    expect(kept.entry).toBe("e1");
    const other = done.map.features.find((f) => f.id === done.ids[1]) as {
      label: string;
      entry: null;
      style: string;
    };
    expect(other).toMatchObject({ label: "Skerra 2", entry: null, style: "abcd1234" });
    expect(numbered(null, 3)).toBeNull();
  });
});
