/**
 * A small painted island for the tests of finding hints and building heights: a sea all round,
 * a lake, a river from the hills to the sea with a tributary, a chain of mountain symbols drawn
 * larger in its middle, a marsh of reed marks and a road. Everything is where `ISLAND` says, so a
 * test can check what was found against what was painted.
 */
import type { Px } from "../findAreas/contour.ts";
import { Painter, rgb } from "../findPaths/paint.ts";

export const W = 480;
export const H = 320;

const inIsland = (x: number, y: number) => ((x - 240) / 200) ** 2 + ((y - 160) / 130) ** 2 < 1;

export const ISLAND = {
  /** The main river, from its source to its mouth on the west coast. */
  river: [
    [300, 150],
    [240, 170],
    [160, 165],
    [44, 170],
  ] as Px[],
  /** A tributary from the north joining it. */
  tributary: [
    [200, 80],
    [205, 166],
  ] as Px[],
  lake: { at: [330, 230] as Px, rx: 24, ry: 14 },
  /** The mountain chain: symbols along this line, largest at its middle. */
  chain: [
    [300, 60],
    [400, 130],
  ] as Px[],
  /** The largest symbol. */
  summit: [350, 95] as Px,
  marsh: { at: [110, 220] as Px, rx: 34, ry: 18 },
  road: [
    [150, 60],
    [150, 270],
  ] as Px[],
};

/** The island as painted. */
export function island(): Painter {
  const p = new Painter(W, H, rgb("#aac5c4"));
  p.where(inIsland, rgb("#ded2a2"));
  const { lake, marsh } = ISLAND;
  p.where(
    (x, y) => ((x - lake.at[0]) / lake.rx) ** 2 + ((y - lake.at[1]) / lake.ry) ** 2 < 1,
    rgb("#93b3bd"),
  );
  // The coast.
  const ring: [number, number][] = [];
  for (let k = 0; k <= 120; k++) {
    const a = (k / 120) * Math.PI * 2;
    ring.push([240 + 200 * Math.cos(a), 160 + 130 * Math.sin(a)]);
  }
  p.line(ring, 2, rgb("#3c2f21"));
  // The road first, so the river crosses it.
  p.line(ISLAND.road as [number, number][], 2.2, rgb("#8a3520"), [8, 4]);
  // The river, drawn wider downstream; the tributary thin.
  const r = ISLAND.river as [number, number][];
  p.line(r.slice(0, 2), 2, rgb("#4a7391"));
  p.line(r.slice(1, 3), 3, rgb("#4a7391"));
  p.line(r.slice(2), 4, rgb("#4a7391"));
  p.line(ISLAND.tributary as [number, number][], 2, rgb("#4a7391"));
  // Mountain symbols: inverted Vs along the chain, in two rows, larger towards the summit.
  const [a, b] = ISLAND.chain as [Px, Px];
  for (let k = 0; k <= 6; k++) {
    for (const off of [-1, 1]) {
      const t = (k + (off > 0 ? 0.5 : 0)) / 6.5;
      const x = a[0] + (b[0] - a[0]) * t + off * 10;
      const y = a[1] + (b[1] - a[1]) * t - off * 13;
      const size = 9 + 9 * (1 - Math.abs(t - 0.5) * 2);
      p.line(
        [
          [x - size / 2, y + size * 0.35],
          [x, y - size * 0.35],
          [x + size / 2, y + size * 0.35],
        ],
        1.6,
        rgb("#4a3a2a"),
      );
    }
  }
  // Reed marks: a level stroke with three tufts, scattered over the marsh.
  for (let y = marsh.at[1] - marsh.ry; y < marsh.at[1] + marsh.ry; y += 9) {
    for (let x = marsh.at[0] - marsh.rx; x < marsh.at[0] + marsh.rx; x += 14) {
      const jx = x + (((y / 9) | 0) % 2) * 7;
      if (((jx - marsh.at[0]) / marsh.rx) ** 2 + ((y - marsh.at[1]) / marsh.ry) ** 2 > 1) continue;
      p.line(
        [
          [jx - 4.5, y],
          [jx + 4.5, y],
        ],
        1.1,
        rgb("#4b6a58"),
      );
      for (const dx of [-2.2, 0, 2.2]) {
        p.line(
          [
            [jx + dx, y - 0.6],
            [jx + dx * 1.3, y - (dx ? 3 : 4.2)],
          ],
          1,
          rgb("#4b6a58"),
        );
      }
    }
  }
  return p;
}
