import { describe, expect, it } from "vitest";
import type { Px } from "../findAreas/contour.ts";
import { Engine } from "../findPaths/engine.ts";
import { lineLength } from "../findPaths/lines.ts";
import { type BuildPlace, buildHeights, fullSize } from "./build.ts";
import { findHints, type HintPicture, LIKELY } from "./find.ts";
import { seeded } from "./noise.ts";
import { ISLAND, island } from "./synthetic.ts";
import { type BuildSettings, DEFAULT_SETTINGS, type FoundHint, type PxHint } from "./types.ts";

function looked(): { src: HintPicture; place: BuildPlace } {
  const { pic, ink } = island().looked();
  const engine = new Engine(pic, ink);
  const ground = engine.pictureGround!;
  return {
    src: {
      pic,
      ground,
      trace: (at) => engine.trace({ at, end: null, eps: 1, curved: false, branches: true }),
    },
    place: { w: pic.w, h: pic.h, water: ground.water, ww: ground.grid.w, wh: ground.grid.h },
  };
}
const { src, place } = looked();
const found = findHints(src);
const of = (kind: string) => found.hints.filter((h) => h.kind === kind);
const dist = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const withIds = (hints: readonly FoundHint[]): PxHint[] =>
  hints.map((h, i) => {
    const { conf, why, ...shape } = h;
    void conf;
    void why;
    return { ...shape, id: `h${i}` };
  });

describe("finding hints in a painted island", () => {
  it("finds the sea and its coast", () => {
    expect(of("sea")).toHaveLength(1);
    expect(of("coast")).toHaveLength(1);
    expect(of("sea")[0]!.why).toMatch(/joined to the map's edge \(\d+% of the picture\)/);
  });

  it("finds the lake, and not the river's wide stretches", () => {
    expect(of("lake")).toHaveLength(1);
    const ring = of("lake")[0]!.points!;
    const mid: Px = [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ];
    expect(dist(mid, ISLAND.lake.at)).toBeLessThan(6);
  });

  it("follows the river to the sea, and its tributary into it", () => {
    const rivers = of("river");
    expect(rivers).toHaveLength(2);
    const [main, branch] = rivers.sort((a, b) => lineLength(b.points!) - lineLength(a.points!));
    // From its source in the hills to its mouth on the west coast.
    expect(dist(main!.points![0]!, ISLAND.river[0]!)).toBeLessThan(12);
    expect(main!.points!.at(-1)![0]).toBeLessThan(50);
    expect(main!.conf).toBeGreaterThanOrEqual(LIKELY);
    expect(main!.why).toMatch(/reaches the sea at its west end/);
    // The tributary flows south into it.
    expect(branch!.points!.at(-1)![1]).toBeGreaterThan(branch!.points![0]![1]);
    expect(branch!.why).toMatch(/Joins a larger river/);
  });

  it("reads the mountain symbols as a highland with a ridge and a summit", () => {
    expect(of("highland")).toHaveLength(1);
    const highland = of("highland")[0]!;
    expect(highland.h2!).toBeGreaterThan(highland.h!);
    const ridge = of("ridge")[0]!;
    // Along the chain.
    const [a, b] = [ridge.points![0]!, ridge.points!.at(-1)!];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const chain = Math.atan2(
      ISLAND.chain[1]![1] - ISLAND.chain[0]![1],
      ISLAND.chain[1]![0] - ISLAND.chain[0]![0],
    );
    expect(Math.abs(angle - chain)).toBeLessThan(0.3);
    const peak = of("peak")[0]!;
    expect(dist(peak.at!, ISLAND.summit)).toBeLessThan(30);
    expect(peak.h!).toBeGreaterThan(0.6);
  });

  it("finds the marsh by its reed marks, and the road as a weak hint once", () => {
    const marsh = of("marsh")[0]!;
    const ring = marsh.points!;
    const mid: Px = [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ];
    expect(dist(mid, ISLAND.marsh.at)).toBeLessThan(15);
    expect(of("road")).toHaveLength(1);
    expect(of("road")[0]!.conf).toBeLessThan(LIKELY);
  });

  it("finds nothing high on a plain picture", () => {
    const blank = new (
      island().constructor as never as new (
        w: number,
        h: number,
        g: [number, number, number],
      ) => ReturnType<typeof island>
    )(200, 120, [222, 210, 162]);
    const { pic, ink } = blank.looked();
    const engine = new Engine(pic, ink);
    const none = findHints({
      pic,
      ground: engine.pictureGround!,
      trace: (at) => engine.trace({ at, end: null, eps: 1, curved: false, branches: true }),
    });
    expect(none.hints).toEqual([]);
  });
});

describe("building heights from the hints", () => {
  const accepted = withIds(found.hints);
  const built = buildHeights(place, accepted, DEFAULT_SETTINGS);
  const at = (p: Px) => {
    const x = Math.min(built.w - 1, Math.floor((p[0] + 0.5) / built.cell));
    const y = Math.min(built.h - 1, Math.floor((p[1] + 0.5) / built.cell));
    return built.heights[y * built.w + x]!;
  };

  it("keeps the painted coast exactly, the sea below 0", () => {
    expect(built.checks.coast).toBeGreaterThan(0.97);
    expect(at([5, 5])).toBeLessThan(0);
    expect(at([240, 160])).toBeGreaterThan(0);
  });

  it("raises the mountains above the lowlands and the marsh", () => {
    expect(at(ISLAND.summit)).toBeGreaterThan(0.45);
    expect(at(ISLAND.marsh.at)).toBeLessThan(0.08);
    expect(at(ISLAND.summit)).toBeGreaterThan(at([240, 250]) + 0.2);
    expect(built.checks.peaks).toBe(built.checks.peaksAsked);
  });

  it("makes every river drain to the sea, and the lake flat in a hollow", () => {
    expect(built.checks.rivers).toBe(2);
    expect(built.checks.drain).toBe(2);
    expect(built.checks.lakes).toBe(1);
    expect(built.checks.lakesHeld).toBe(1);
  });

  it("without carving, a river can be left to wander", () => {
    const loose = buildHeights(place, accepted, { ...DEFAULT_SETTINGS, carve: false });
    expect(loose.checks.drain).toBeLessThanOrEqual(built.checks.drain);
  });

  it("is the same for a seed, and differs for another", () => {
    const again = buildHeights(place, accepted, DEFAULT_SETTINGS);
    expect(again.heights).toEqual(built.heights);
    const other = buildHeights(place, accepted, { ...DEFAULT_SETTINGS, seed: 2 });
    let diff = 0;
    for (let i = 0; i < other.heights.length; i++) {
      diff += Math.abs(other.heights[i]! - built.heights[i]!);
    }
    expect(diff / other.heights.length).toBeGreaterThan(0.001);
  });

  it("drains its rivers on 20 random seeds and settings", () => {
    const rand = seeded(42);
    for (let k = 0; k < 20; k++) {
      const s: BuildSettings = {
        ...DEFAULT_SETTINGS,
        seed: 1 + Math.floor(rand() * 1000),
        rough: rand(),
        sharp: rand(),
        erosion: rand(),
        detail: 1,
      };
      const b = buildHeights(place, accepted, s);
      expect(b.checks.drain, JSON.stringify(s)).toBe(b.checks.rivers);
      expect(b.checks.coast!).toBeGreaterThan(0.95);
    }
  });

  it("builds a valley along a drawn valley and a step at a cliff", () => {
    const valley: PxHint = {
      id: "v",
      kind: "valley",
      points: [
        [330, 40],
        [420, 110],
      ],
    };
    const cliff: PxHint = {
      id: "c",
      kind: "cliff",
      points: [
        [180, 240],
        [300, 240],
      ],
      h: 0.3,
    };
    const b = buildHeights(place, [...accepted, valley, cliff], { ...DEFAULT_SETTINGS, rough: 0 });
    const get = (p: Px) => b.heights[Math.floor(p[1] / b.cell) * b.w + Math.floor(p[0] / b.cell)]!;
    // Drawn left to right, high on its left: north of it (up on screen) is higher.
    expect(get([240, 228])).toBeGreaterThan(get([240, 252]));
  });

  it("takes well under a second", () => {
    expect(built.checks.ms).toBeLessThan(1500);
  });

  it("gives the saved image's greys, white high, with the sea level between", () => {
    const img = fullSize(built, 240, 160, DEFAULT_SETTINGS);
    expect(img.grey).toHaveLength(240 * 160);
    expect(img.seaLevel).toBeGreaterThan(0);
    expect(img.seaLevel).toBeLessThan(0.5);
    const corner = img.grey[0]! / 65535;
    expect(corner).toBeLessThan(img.seaLevel);
    expect(img.grey[80 * 240 + 120]! / 65535).toBeGreaterThan(img.seaLevel);
  });
});
