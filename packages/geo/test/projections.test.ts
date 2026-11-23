import { geoRotation } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  clipRing,
  cutRun,
  focusOn,
  makeView,
  type Position,
  type Projected,
  PROJECTIONS,
  projectedAt,
  projectedMesh,
  switchView,
  zoomAt,
  panBy,
  centreOn,
  cellFor,
  isProjectionId,
  outline,
  type View,
} from "../src/index.js";

/** The rings that fill a zone through these control points, from its closed outline. */
const ringsOf = (view: View, points: Position[]) =>
  view.rings!(
    outline({ kind: "sphere", radius: null, unit: "" }, points, { curve: false, closed: true })
      .line,
  );

const W = 900;
const H = 600;
const at = (projection: Projected["projection"], extra: Partial<Projected> = {}): Projected => ({
  kind: "projected",
  projection,
  rotate: [0, 0, 0],
  k: 140,
  x: 0,
  y: 0,
  ...extra,
});

describe("each projection", () => {
  for (const { id } of PROJECTIONS) {
    it(`${id}: reads back the place it drew, turned and tilted`, () => {
      const view = makeView(at(id, { rotate: [30, -20, 10] }), W, H);
      let checked = 0;
      for (let lon = -170; lon <= 170; lon += 20) {
        for (let lat = -70; lat <= 70; lat += 20) {
          // Mercator is cut at 85 degrees: a place beyond that, after the turn, is drawn on the edge.
          if (Math.abs(geoRotation([30, -20, 10])([lon, lat])[1]) > 85) continue;
          const s = view.project([lon, lat])!;
          const back = view.unproject(s[0], s[1]);
          if (!back) continue; // On the very edge the round trip may refuse; that is allowed.
          checked += 1;
          const dlon = Math.abs(((back[0] - lon + 540) % 360) - 180);
          expect(dlon).toBeLessThan(0.05);
          expect(Math.abs(back[1] - lat)).toBeLessThan(0.05);
        }
      }
      expect(checked).toBeGreaterThan(100);
    });

    it(`${id}: finds nothing far outside the map`, () => {
      const view = makeView(at(id), W, H);
      expect(view.unproject(W / 2, -5000)).toBeNull();
      expect(view.unproject(-5000, H / 2)).toBeNull();
    });
  }

  it("knows its projections", () => {
    expect(isProjectionId("robinson")).toBe(true);
    expect(isProjectionId("cylinder")).toBe(false);
  });

  it("finds nothing in the gap between the two hemispheres", () => {
    const view = makeView(at("hemispheres"), W, H);
    // Above the point where the two discs touch.
    const touch = view.project([0, 0])!;
    expect(view.unproject(touch[0], touch[1] - 120)).toBeNull();
  });
});

describe("cutting at the map's edges", () => {
  it("cuts a line across the edge into two pieces that reach it", () => {
    const pieces = cutRun(
      [
        [170, 0],
        [178, 2],
        [-178, 4],
        [-170, 6],
      ],
      [],
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.at(-1)![0]).toBeCloseTo(180, 4);
    expect(pieces[1]![0]![0]).toBeCloseTo(-180, 4);
    expect(pieces[0]!.at(-1)![1]).toBeCloseTo(3);
  });

  it("cuts at the hemispheres' meridian too", () => {
    const pieces = cutRun(
      [
        [-10, 0],
        [10, 10],
      ],
      [0],
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.at(-1)![1]).toBeCloseTo(5);
  });

  it("keeps a line that crosses nothing whole", () => {
    expect(
      cutRun(
        [
          [0, 0],
          [10, 10],
          [20, 0],
        ],
        [],
      ),
    ).toHaveLength(1);
  });

  it("clips a ring to either side of a meridian", () => {
    const square: Position[] = [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ];
    const west = clipRing(square, 0, "west");
    const east = clipRing(square, 0, "east");
    expect(Math.max(...west.map((p) => p[0]))).toBeLessThanOrEqual(0);
    expect(Math.min(...east.map((p) => p[0]))).toBeGreaterThanOrEqual(0);
    expect(west).toHaveLength(4);
  });

  it("draws a line across the edge as pieces, none of them spanning the map", () => {
    const view = makeView(at("robinson"), W, H);
    const lines = view.lines!([
      [160, 10],
      [175, 10],
      [-175, 10],
      [-160, 10],
    ]);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const xs = line.map((p) => p[0]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(W / 4);
    }
  });

  it("fills a zone across the edge as pieces on both sides, and one around a pole", () => {
    const view = makeView(at("mollweide"), W, H);
    const across = ringsOf(view, [
      [170, -10],
      [-170, -10],
      [-170, 10],
      [170, 10],
    ]);
    expect(across).toHaveLength(2);
    const polar = ringsOf(view, [
      [0, 70],
      [120, 70],
      [-120, 70],
    ]);
    expect(polar.length).toBeGreaterThan(0);
    // It reaches up to the pole: the top of the drawing.
    const top = view.project([0, 90])![1];
    expect(Math.min(...polar.flat().map((p) => p[1]))).toBeCloseTo(top, 0);
  });

  it("cuts a zone between the two hemispheres", () => {
    const view = makeView(at("hemispheres"), W, H);
    const rings = ringsOf(view, [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ]);
    expect(rings).toHaveLength(2);
  });
});

describe("the image grid", () => {
  const whole: [number, number, number, number] = [-180, -90, 180, 90];

  it("divides 180 at every size", () => {
    for (const w of [3, 2, 1.7, 0.3, 0.001]) expect(180 % cellFor(w)).toBe(0);
  });

  for (const { id } of PROJECTIONS) {
    it(`${id}: no triangle stretches across the map, and corners read back their places`, () => {
      const state = at(id, { rotate: [40, 15, 0], k: 140 });
      const mesh = projectedMesh(state, W, H, whole);
      expect(mesh.positions.length).toBeGreaterThan(1000);
      const view = makeView(state, W, H);
      const span = 2 * Math.PI * 140;
      for (let t = 0; t < mesh.positions.length; t += 6) {
        const xs = [mesh.positions[t]!, mesh.positions[t + 2]!, mesh.positions[t + 4]!];
        // A cell across the map would span about half of it; near a pole cells shear a little.
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(span / 5);
      }
      // A sample of corners: the image place of a corner is the place the view reads there.
      let checked = 0;
      for (let i = 0; i < mesh.positions.length / 2; i += 97) {
        const x = mesh.positions[i * 2]!;
        const y = mesh.positions[i * 2 + 1]!;
        const place = view.unproject(x, y);
        if (!place || Math.abs(place[1]) > 80) continue;
        const u = mesh.uvs[i * 2]!;
        const v = mesh.uvs[i * 2 + 1]!;
        const lon = -180 + 360 * (((u % 1) + 1) % 1);
        const lat = 90 - 180 * v;
        expect(Math.abs(((lon - place[0] + 540) % 360) - 180)).toBeLessThan(0.1);
        expect(Math.abs(lat - place[1])).toBeLessThan(0.1);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(20);
    });
  }

  it("leaves out what is off the screen when zoomed in, and still covers the screen", () => {
    const near = at("robinson", { k: 20000 });
    const mesh = projectedMesh(near, W, H, whole);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.positions.length / 12).toBeLessThan(4000);
    const xs = Array.from(mesh.positions.filter((_, i) => i % 2 === 0));
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(W);
  });

  it("leaves out cells with nothing of a part image", () => {
    const part = projectedMesh(at("equirectangular"), W, H, [0, 0, 30, 30]);
    const all = projectedMesh(at("equirectangular"), W, H, whole);
    expect(part.positions.length).toBeLessThan(all.positions.length / 20);
  });
});

describe("moving a projected view", () => {
  it("turns the globe when dragged sideways and moves it when dragged up", () => {
    const s = at("robinson");
    const moved = panBy(s, 140, 30) as Projected;
    expect(moved.rotate[0]).toBeCloseTo(180 / Math.PI);
    expect(moved.y).toBe(30);
    const wrapped = panBy({ ...s, rotate: [170, 0, 0] }, 140 * 0.5, 0) as Projected;
    expect(wrapped.rotate[0]).toBeLessThan(0);
  });

  it("zooms about the pointer, keeping the place under it", () => {
    const s = at("winkel3", { rotate: [10, 20, 5] });
    const before = makeView(s, W, H).unproject(600, 200)!;
    const z = zoomAt(s, W, H, 600, 200, 2);
    const after = makeView(z, W, H).project(before)!;
    expect(after[0]).toBeCloseTo(600, 1);
    expect(after[1]).toBeCloseTo(200, 1);
  });

  it("centres on a place", () => {
    const s = centreOn(at("mollweide", { rotate: [30, 0, 0] }), [100, 30]);
    const p = makeView(s, W, H).project([100, 30])!;
    expect(p[0]).toBeCloseTo(W / 2);
    expect(p[1]).toBeCloseTo(H / 2);
  });

  it("keeps the middle of the screen when switching between views", () => {
    const plate = { kind: "plate" as const, lon: 40, lat: 25, k: 3 };
    const robinson = switchView(plate, "robinson", W, H) as Projected;
    expect(robinson.rotate[1]).toBe(0);
    const middle = makeView(robinson, W, H).unproject(W / 2, H / 2)!;
    expect(middle[0]).toBeCloseTo(40);
    expect(middle[1]).toBeCloseTo(25);
    const fahey = switchView(robinson, "fahey", W, H);
    const again = makeView(fahey, W, H).unproject(W / 2, H / 2)!;
    expect(again[0]).toBeCloseTo(40);
    expect(again[1]).toBeCloseTo(25, 1);
    const back = switchView(fahey, "globe", W, H);
    expect(back).toMatchObject({ kind: "globe" });
    expect((back as { lon: number }).lon).toBeCloseTo(40);
    expect(switchView(back, "plate", W, H)).toMatchObject({ kind: "plate" });
  });

  it("opens a projection at a place without tilting it", () => {
    const s = projectedAt("mercator", [-60, 50], 200);
    expect(s.rotate).toEqual([60, 0, 0]);
    const p = makeView(s, W, H).project([-60, 50])!;
    expect(p[1]).toBeCloseTo(H / 2);
  });

  it("focuses on a box: its middle comes to the middle, and it fills the screen", () => {
    const s = at("naturalEarth");
    const view = makeView(s, W, H);
    const a = view.project([20, 40])!;
    const b = view.project([40, 20])!;
    const focused = focusOn(s, W, H, [a[0], a[1], b[0], b[1]]) as Projected;
    expect(focused.k).toBeGreaterThan(s.k * 3);
    expect(focused.rotate[2]).toBe(0);
    const middle = makeView(focused, W, H).unproject(W / 2, H / 2)!;
    // The centroid of the box as drawn, which is near the middle of its corners' places.
    expect(Math.abs(middle[0] - 30)).toBeLessThan(1.5);
    expect(Math.abs(middle[1] - 30)).toBeLessThan(1.5);
    expect(focusOn(s, W, H, [-9000, -9000, -8000, -8000])).toBe(s);
  });
});
