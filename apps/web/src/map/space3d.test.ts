import { describe, expect, it } from "vitest";
import {
  fitCamera,
  heightText,
  makeCamera,
  nearest,
  numberText,
  pointOnPlane,
  project,
  routeLength,
  toSegment,
  travelDays,
} from "./space3d.ts";

const W = 800;
const H = 600;

describe("project and pointOnPlane", () => {
  it("puts the target at the centre of the screen", () => {
    const cam = { ...makeCamera(), target: { x: 3, y: -2, z: 1 } };
    const s = project(cam, { x: 3, y: -2, z: 1 }, W, H)!;
    expect(s.x).toBeCloseTo(W / 2);
    expect(s.y).toBeCloseTo(H / 2);
  });

  it("raises a place on screen as it goes up", () => {
    const cam = makeCamera();
    const low = project(cam, { x: 1, y: 1, z: 0 }, W, H)!;
    const high = project(cam, { x: 1, y: 1, z: 5 }, W, H)!;
    expect(high.y).toBeLessThan(low.y);
  });

  it("makes nearer places larger", () => {
    const cam = { ...makeCamera(), yaw: 0, pitch: 0.4 };
    const near = project(cam, { x: 0, y: -8, z: 0 }, W, H)!;
    const far = project(cam, { x: 0, y: 8, z: 0 }, W, H)!;
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("finds back the place a screen point came from, at any height and turn", () => {
    for (const [yaw, pitch, z] of [
      [0.55, 0.6, 0],
      [-1.2, 1.1, 4],
      [2.5, 0.3, -3],
      [0, Math.PI / 2, 0],
    ] as const) {
      const cam = { ...makeCamera(), yaw, pitch, zoom: 18, target: { x: 1, y: -1, z: 0 } };
      const p = { x: 4.2, y: -3.1, z };
      const s = project(cam, p, W, H)!;
      const back = pointOnPlane(cam, s.x, s.y, z, W, H)!;
      expect(back.x).toBeCloseTo(p.x, 3);
      expect(back.y).toBeCloseTo(p.y, 3);
      expect(back.z).toBe(z);
    }
  });

  it("finds nothing on the plane when a point looks at the sky", () => {
    const cam = { ...makeCamera(), pitch: 0.2 };
    expect(pointOnPlane(cam, W / 2, 0, 0, W, H)).toBeNull();
  });
});

describe("distances", () => {
  it("measures a route through three places", () => {
    expect(
      routeLength([
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
        { x: 3, y: 4, z: 12 },
      ]),
    ).toBe(17);
  });

  it("gives a travel time only when a speed is known, and at least a day", () => {
    expect(travelDays(10, undefined)).toBeNull();
    expect(travelDays(10, 2)).toBe(5);
    expect(travelDays(0.1, 2)).toBe(1);
  });
});

describe("words", () => {
  it("writes a height against the plane", () => {
    expect(heightText(0, "ly")).toBe("on the plane");
    expect(heightText(2.34, "ly")).toBe("2.3 ly above the plane");
    expect(heightText(-1.26, "ly")).toBe("1.3 ly below the plane");
  });
  it("never writes a minus zero", () => {
    expect(numberText(-0.04)).toBe("0.0");
    expect(numberText(-5.8)).toBe("−5.8");
  });
});

describe("fitCamera", () => {
  it("centres on the places", () => {
    const cam = fitCamera(
      makeCamera(),
      [
        { x: -10, y: 0, z: 0 },
        { x: 10, y: 4, z: 6 },
      ],
      W,
      H,
    );
    expect(cam.target).toEqual({ x: 0, y: 2, z: 3 });
  });
  it("copes with no places", () => {
    expect(fitCamera(makeCamera(), [], W, H).target).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("picking", () => {
  it("takes the nearest point inside the reach, the later on a tie", () => {
    const pts = [
      { id: "a", x: 10, y: 10 },
      { id: "b", x: 10, y: 10 },
      { id: "c", x: 100, y: 100 },
    ];
    expect(nearest(pts, 12, 10, 14)?.id).toBe("b");
    expect(nearest(pts, 60, 60, 14)).toBeNull();
  });
  it("measures to a segment, and past its ends", () => {
    expect(toSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(toSegment(13, 4, 0, 0, 10, 0)).toBe(5);
  });
});
