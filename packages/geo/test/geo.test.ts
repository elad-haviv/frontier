import { describe, expect, it } from "vitest";
import {
  centreOn,
  densify,
  distanceToSegment,
  fullExtent,
  globeMesh,
  initialView,
  makeView,
  measure,
  meshFor,
  panBy,
  pointInPolygon,
  type Position,
  scaleFrom,
  shapeAt,
  type Space,
  switchGlobeView,
  vertexAt,
  type ViewState,
  wrapLongitude,
  zoneOnPlate,
  zoomAt,
} from "../src/index.js";

const SPHERE: Space = { kind: "sphere", radius: null, unit: "km" };
const FLAT: Space = { kind: "flat", width: 2000, height: 1000, scale: null, unit: "km" };
const W = 800;
const H = 600;
const near = (a: number[] | null, b: number[], digits = 6) => {
  expect(a).not.toBeNull();
  a!.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
};

describe("space", () => {
  it("wraps longitudes and knows the whole extent", () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(540)).toBe(-180);
    expect(fullExtent(SPHERE)).toEqual([-180, -90, 180, 90]);
    expect(fullExtent(FLAT)).toEqual([0, 0, 2000, 1000]);
  });
});

describe("views", () => {
  const states: ViewState[] = [
    { kind: "flat", x: 400, y: 300, k: 0.5 },
    { kind: "plate", lon: 30, lat: 10, k: 4 },
    { kind: "globe", lon: 30, lat: 20, k: 250 },
  ];
  const samples: Position[] = [
    [30, 20],
    [10, -5],
    [75, 50],
    [-20, 30],
  ];

  it.each(states)("takes a position to the screen and back in the $kind view", (state) => {
    const view = makeView(state, W, H);
    for (const p of samples) {
      const s = view.project(p)!;
      near(view.unproject(s[0], s[1]), p, 5);
    }
  });

  it("puts the centre of each view in the middle of the screen", () => {
    near(makeView(states[0]!, W, H).project([400, 300]), [W / 2, H / 2]);
    near(makeView(states[1]!, W, H).project([30, 10]), [W / 2, H / 2]);
    near(makeView(states[2]!, W, H).project([30, 20]), [W / 2, H / 2]);
  });

  it("hides the far side of the globe and puts it on the edge when asked to clamp", () => {
    const view = makeView({ kind: "globe", lon: 0, lat: 0, k: 200 }, W, H);
    expect(view.project([179, 0])).toBeNull();
    expect(view.project([89, 0])).not.toBeNull();
    const clamped = view.projectClamped([150, 0]);
    expect(clamped.visible).toBe(false);
    expect(Math.hypot(clamped.point[0] - W / 2, clamped.point[1] - H / 2)).toBeCloseTo(200, 6);
    expect(view.projectClamped([10, 0]).visible).toBe(true);
    // Outside the disc there is no position.
    expect(view.unproject(5, 5)).toBeNull();
    expect(view.repeats()).toEqual([0]);
  });

  it("repeats a globe laid flat far enough to cover the screen, and has no position past the poles", () => {
    const view = makeView({ kind: "plate", lon: 170, lat: 0, k: 1 }, W, H);
    const repeats = view.repeats();
    expect(repeats).toContain(0);
    expect(repeats).toContain(360);
    expect(repeats).toContain(-360);
    expect(Math.max(...repeats)).toBeGreaterThanOrEqual(W / 2);
    // East of the 180th meridian the longitude wraps.
    near(view.unproject(W / 2 + 20, H / 2), [-170, 0]);
    expect(view.unproject(W / 2, H / 2 - 100)).toBeNull();
    // Positions are not wrapped going out, so a line across the edge is not torn.
    near(view.project([190, 0]), [W / 2 + 20, H / 2]);
  });

  it("opens a map fitted to the screen", () => {
    const flat = initialView(FLAT, W, H);
    expect(flat).toMatchObject({ kind: "flat", x: 1000, y: 500 });
    const view = makeView(flat, W, H);
    expect(view.project([0, 0])![0]).toBeGreaterThan(0);
    expect(view.project([2000, 1000])![0]).toBeLessThan(W);
    expect(initialView(SPHERE, W, H)).toEqual({ kind: "globe", lon: 0, lat: 0, k: 270 });
  });

  it("pans so that what was under the finger stays under it", () => {
    for (const state of states.slice(0, 2)) {
      const before = makeView(state, W, H).unproject(300, 200)!;
      const after = makeView(panBy(state, 40, -25), W, H).unproject(340, 175)!;
      near(after, before, 5);
    }
    // On the ball this holds at the centre of the disc.
    const globe = states[2]!;
    const moved = panBy(globe, 10, 0);
    expect(makeView(moved, W, H).project([30, 20])![0]).toBeCloseTo(
      W / 2 + 10 * Math.cos((20 * Math.PI) / 180),
      0,
    );
    expect(panBy({ kind: "globe", lon: 0, lat: 89, k: 100 }, 0, 500)).toMatchObject({ lat: 90 });
    expect(panBy({ kind: "plate", lon: 179, lat: 0, k: 1 }, -5, 0)).toMatchObject({ lon: -176 });
  });

  it("zooms about the point under the fingers, within limits", () => {
    for (const state of states.slice(0, 2)) {
      const before = makeView(state, W, H).unproject(600, 150)!;
      const zoomed = zoomAt(state, W, H, 600, 150, 2);
      expect(zoomed.k).toBe(state.k * 2);
      near(makeView(zoomed, W, H).unproject(600, 150), before, 5);
    }
    const globe = zoomAt(states[2]!, W, H, 10, 10, 2);
    expect(globe).toMatchObject({ lon: 30, lat: 20, k: 500 });
    expect(zoomAt(states[2]!, W, H, 0, 0, 1e-9).k).toBe(40);
    const tiny = { kind: "flat" as const, x: 0, y: 0, k: 64 };
    expect(zoomAt(tiny, W, H, 0, 0, 2)).toBe(tiny);
    // Zooming about a point with no position under it still zooms.
    expect(zoomAt({ kind: "plate", lon: 0, lat: 0, k: 1 }, W, H, 400, 0, 2).k).toBe(2);
  });

  it("switches a globe between its two views at the same size, and leaves a flat map alone", () => {
    const globe = states[2]!;
    const plate = switchGlobeView(globe, "plate");
    expect(plate.kind).toBe("plate");
    // A degree at the centre is as many pixels in both.
    const a = makeView(globe, W, H).project([31, 20])![0] - W / 2;
    const b = makeView(plate, W, H).project([31, 20])![0] - W / 2;
    expect(b).toBeCloseTo(a / Math.cos((20 * Math.PI) / 180), 0);
    expect(switchGlobeView(plate, "globe").k).toBeCloseTo(globe.k, 6);
    expect(switchGlobeView(globe, "globe")).toBe(globe);
    expect(switchGlobeView(states[0]!, "plate")).toBe(states[0]);
  });

  it("centres on a position", () => {
    expect(centreOn(states[0]!, [5, 6])).toMatchObject({ x: 5, y: 6 });
    expect(centreOn(states[2]!, [200, 95])).toMatchObject({ lon: -160, lat: 90 });
  });
});

describe("measuring", () => {
  it("gives an angle and a share of the circumference on a globe of unknown size", () => {
    const quarter = measure(SPHERE, [
      [0, 0],
      [90, 0],
    ]);
    expect(quarter.raw).toBeCloseTo(90, 9);
    expect(quarter.fraction).toBeCloseTo(0.25, 9);
    expect(quarter.distance).toBeNull();
    const pole = measure(SPHERE, [
      [0, 0],
      [0, 90],
      [90, 0],
    ]);
    expect(pole.raw).toBeCloseTo(180, 9);
  });

  it("gives a distance once the globe has a radius", () => {
    const earth = measure({ kind: "sphere", radius: 6371, unit: "km" }, [
      [0, 0],
      [180, 0],
    ]);
    expect(earth.distance).toBeCloseTo(Math.PI * 6371, 6);
    expect(earth.unit).toBe("km");
  });

  it("measures a flat map in pixels, and in units once it has a scale", () => {
    const line: Position[] = [
      [0, 0],
      [300, 400],
    ];
    expect(measure(FLAT, line)).toMatchObject({ raw: 500, fraction: null, distance: null });
    expect(measure({ ...FLAT, scale: 0.2 }, line).distance).toBeCloseTo(100, 9);
    expect(scaleFrom(line, 250)).toBe(0.5);
    expect(scaleFrom([[1, 1]], 250)).toBeNull();
    expect(scaleFrom(line, 0)).toBeNull();
    expect(measure(FLAT, []).raw).toBe(0);
  });

  it("draws a line on a globe along the great circle, without a jump at the 180th meridian", () => {
    const line = densify(SPHERE, [
      [170, 10],
      [-170, 10],
    ]);
    expect(line.length).toBeGreaterThan(3);
    expect(line[0]).toEqual([170, 10]);
    expect(line[line.length - 1]![0]).toBeCloseTo(190, 9);
    for (let i = 1; i < line.length; i++) {
      expect(Math.abs(line[i]![0] - line[i - 1]![0])).toBeLessThan(10);
    }
    // The great circle bulges towards the pole between two points of the same latitude.
    expect(line[Math.floor(line.length / 2)]![1]).toBeGreaterThan(10);
    // And back the other way.
    const back = densify(SPHERE, [
      [-170, 0],
      [170, 0],
    ]);
    expect(back[back.length - 1]![0]).toBeCloseTo(-190, 9);
    expect(
      densify(FLAT, [
        [0, 0],
        [9, 9],
      ]),
    ).toEqual([
      [0, 0],
      [9, 9],
    ]);
    expect(densify(SPHERE, [[1, 2]])).toEqual([[1, 2]]);
  });
});

describe("the grid of an image", () => {
  it("is one cell on a flat map", () => {
    const mesh = meshFor(FLAT, [0, 0, 2000, 1000]);
    expect([mesh.columns, mesh.rows]).toEqual([1, 1]);
    expect([...mesh.positions]).toEqual([0, 0, 2000, 0, 0, 1000, 2000, 1000]);
    expect([...mesh.uvs]).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    expect([...mesh.triangles]).toEqual([0, 2, 1, 1, 2, 3]);
  });

  it("covers the whole globe with north at the top of the image", () => {
    const mesh = meshFor(SPHERE, [-180, -90, 180, 90]);
    expect([mesh.columns, mesh.rows]).toEqual([64, 32]);
    expect(mesh.positions.length).toBe(65 * 33 * 2);
    expect([mesh.positions[0], mesh.positions[1]]).toEqual([-180, 90]);
    const last = mesh.positions.length - 2;
    expect([mesh.positions[last], mesh.positions[last + 1]]).toEqual([180, -90]);
    expect(mesh.triangles.length).toBe(64 * 32 * 6);
    expect(Math.max(...mesh.triangles)).toBe(65 * 33 - 1);
  });

  it("gives a partial image a share of the cells, never fewer than four a side", () => {
    const mesh = meshFor(SPHERE, [0, 0, 90, 45]);
    expect([mesh.columns, mesh.rows]).toEqual([16, 8]);
    expect([meshFor(SPHERE, [0, 0, 5, 5]).columns, meshFor(SPHERE, [0, 0, 5, 5]).rows]).toEqual([
      4, 4,
    ]);
  });
});

describe("the grid of an image on the globe", () => {
  const FULL: [number, number, number, number] = [-180, -90, 180, 90];

  it("stays within half a pixel of the true projection at every zoom", () => {
    for (const k of [270, 2000, 40_000]) {
      const state = { kind: "globe" as const, lon: 20, lat: 35, k };
      const view = makeView(state, W, H);
      const mesh = globeMesh(state, W, H, FULL);
      expect(mesh.triangles.length).toBeGreaterThan(0);
      let worst = 0;
      let checked = 0;
      for (let r = 0; r < mesh.rows; r++) {
        for (let c = 0; c < mesh.columns; c++) {
          const a = (r * (mesh.columns + 1) + c) * 2;
          const d = a + (mesh.columns + 1) * 2 + 2;
          const p0: Position = [mesh.positions[a]!, mesh.positions[a + 1]!];
          const p1: Position = [mesh.positions[d]!, mesh.positions[d + 1]!];
          const s0 = view.project(p0);
          const s1 = view.project(p1);
          const mid = view.project([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
          if (!s0 || !s1 || !mid) continue;
          // Only cells on screen matter.
          if (mid[0] < 0 || mid[0] > W || mid[1] < 0 || mid[1] > H) continue;
          worst = Math.max(
            worst,
            Math.hypot((s0[0] + s1[0]) / 2 - mid[0], (s0[1] + s1[1]) / 2 - mid[1]),
          );
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(5);
      expect(worst).toBeLessThan(0.5);
      expect(mesh.positions.length / 2).toBeLessThan(65_000);
    }
  });

  it("builds only what is on screen when zoomed in, and all of it when a pole shows", () => {
    const close = globeMesh({ lon: 20, lat: 35, k: 40_000 }, W, H, FULL);
    for (let i = 0; i < close.positions.length; i += 2) {
      expect(Math.abs(close.positions[i]! - 20)).toBeLessThan(3);
      expect(Math.abs(close.positions[i + 1]! - 35)).toBeLessThan(3);
    }
    const polar = globeMesh({ lon: 0, lat: 80, k: 600 }, W, H, FULL);
    expect(polar.positions[0]).toBe(-180);
    expect(Math.max(...polar.positions.filter((_, i) => i % 2 === 0))).toBe(180);
    // Across the 180th meridian the whole image is drawn.
    const seam = globeMesh({ lon: 179, lat: 0, k: 3000 }, W, H, FULL);
    expect(seam.columns).toBeGreaterThan(100);
  });

  it("keeps corners on a grid fixed to the image, with matching places in the picture", () => {
    const a = globeMesh({ lon: 20, lat: 35, k: 5000 }, W, H, FULL);
    const b = globeMesh({ lon: 20.4, lat: 35.2, k: 5000 }, W, H, FULL);
    const cell = (1.3 / Math.sqrt(5000)) * (180 / Math.PI);
    for (const m of [a, b]) {
      const steps = (m.positions[0]! + 180) / cell;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.001);
      expect(m.uvs[0]).toBeCloseTo((m.positions[0]! + 180) / 360, 6);
      expect(m.uvs[1]).toBeCloseTo((90 - m.positions[1]!) / 180, 6);
    }
  });

  it("gives nothing for an image out of view, and fewer cells when coarse", () => {
    const away = globeMesh({ lon: 0, lat: 0, k: 40_000 }, W, H, [100, 10, 120, 30]);
    expect(away.triangles.length).toBe(0);
    const partial = globeMesh({ lon: 110, lat: 20, k: 400 }, W, H, [100, 10, 120, 30]);
    expect(partial.positions[0]).toBe(100);
    expect(Math.max(...partial.positions.filter((_, i) => i % 2 === 0))).toBe(120);
    const fine = globeMesh({ lon: 0, lat: 0, k: 2000 }, W, H, FULL);
    const coarse = globeMesh({ lon: 0, lat: 0, k: 2000 }, W, H, FULL, true);
    expect(coarse.triangles.length).toBeLessThan(fine.triangles.length / 2);
  });
});

describe("finding what is under a point", () => {
  const square: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];

  it("measures to a segment and tests a polygon", () => {
    expect(distanceToSegment([50, 10], [0, 0], [100, 0])).toBe(10);
    expect(distanceToSegment([-30, 40], [0, 0], [100, 0])).toBe(50);
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
    expect(pointInPolygon([50, 50], square)).toBe(true);
    expect(pointInPolygon([150, 50], square)).toBe(false);
  });

  it("prefers a marker to a path and a path to a zone", () => {
    const shapes = [
      { id: "zone", kind: "zone" as const, points: square },
      {
        id: "path",
        kind: "path" as const,
        points: [
          [0, 50],
          [100, 50],
        ] as [number, number][],
      },
      { id: "far", kind: "marker" as const, at: [60, 60] as [number, number] },
      { id: "near", kind: "marker" as const, at: [52, 52] as [number, number] },
    ];
    expect(shapeAt(shapes, [50, 50])).toBe("near");
    expect(shapeAt(shapes, [20, 52])).toBe("path");
    expect(shapeAt(shapes, [20, 90])).toBe("zone");
    expect(shapeAt(shapes, [300, 300])).toBeNull();
    // A zone still being drawn, with two points, is not a target.
    expect(
      shapeAt(
        [
          {
            id: "z",
            kind: "zone",
            points: [
              [0, 0],
              [9, 9],
            ],
          },
        ],
        [5, 5],
      ),
    ).toBeNull();
  });

  it("finds the nearest corner within reach", () => {
    expect(vertexAt(square, [95, 4])).toBe(1);
    expect(vertexAt(square, [50, 50])).toBeNull();
  });
});

describe("the inside of a zone on a globe laid flat", () => {
  const inside = (rings: Position[][], p: Position) => rings.some((r) => pointInPolygon(p, r));
  const lons = (rings: Position[][]) => rings.flat().map((p) => p[0]);

  it("fills a plain zone as its outline, whichever way it was drawn", () => {
    const triangle: Position[] = [
      [10, 0],
      [20, 0],
      [20, 10],
    ];
    for (const points of [triangle, [...triangle].reverse()]) {
      const rings = zoneOnPlate(points, 0);
      expect(rings).toHaveLength(1);
      expect(inside(rings, [18, 3])).toBe(true);
      expect(inside(rings, [12, 8])).toBe(false);
      expect(inside(rings, [-100, 40])).toBe(false);
    }
  });

  it("carries a zone that contains the north pole up to the pole, across the whole width", () => {
    const cap: Position[] = [
      [0, 70],
      [120, 70],
      [-120, 70],
    ];
    for (const points of [cap, [...cap].reverse()]) {
      const rings = zoneOnPlate(points, 0);
      expect(rings).toHaveLength(1);
      expect(Math.min(...lons(rings))).toBeCloseTo(-180, 6);
      expect(Math.max(...lons(rings))).toBeCloseTo(180, 6);
      expect(Math.max(...rings[0]!.map((p) => p[1]))).toBeCloseTo(90, 6);
      for (const lon of [-179, -60, 0, 60, 179]) expect(inside(rings, [lon, 89])).toBe(true);
      // Between two corners the side follows the great circle, which runs nearer the pole.
      expect(inside(rings, [60, 72])).toBe(false);
      expect(inside(rings, [60, 82])).toBe(true);
      expect(inside(rings, [0, 0])).toBe(false);
      expect(inside(rings, [100, -80])).toBe(false);
    }
  });

  it("does the same at the south pole, about any centre", () => {
    const rings = zoneOnPlate(
      [
        [0, -60],
        [90, -60],
        [180, -60],
        [-90, -60],
      ],
      50,
    );
    expect(Math.min(...lons(rings))).toBeCloseTo(-130, 6);
    expect(Math.max(...lons(rings))).toBeCloseTo(230, 6);
    expect(inside(rings, [200, -85])).toBe(true);
    expect(inside(rings, [-100, -85])).toBe(true);
    expect(inside(rings, [50, 0])).toBe(false);
    expect(inside(rings, [50, 85])).toBe(false);
  });

  it("cuts a zone across the edge of the picture into pieces that join at the repeat", () => {
    const rings = zoneOnPlate(
      [
        [170, 0],
        [-170, 0],
        [-170, 10],
        [170, 10],
      ],
      0,
    );
    expect(rings).toHaveLength(2);
    expect(inside(rings, [175, 5])).toBe(true);
    expect(inside(rings, [-175, 5])).toBe(true);
    expect(inside(rings, [0, 5])).toBe(false);
    // Seen from the other side of the globe it is one piece.
    const whole = zoneOnPlate(
      [
        [170, 0],
        [-170, 0],
        [-170, 10],
        [170, 10],
      ],
      180,
    );
    expect(whole).toHaveLength(1);
    expect(inside(whole, [185, 5])).toBe(true);
  });

  it("has nothing to fill for fewer than three corners", () => {
    expect(
      zoneOnPlate(
        [
          [0, 0],
          [10, 10],
        ],
        0,
      ),
    ).toEqual([]);
  });
});
