import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, ensure, newWorld, N, W } from "./model.ts";
import { drainageOf, lakeMask, lakesOf, riverLines, riversOf } from "./rivers.ts";
import { lakeRings } from "./zones.ts";
import {
  calendarEntry,
  DEFAULT_SYSTEM,
  homeOf,
  liquidBand,
  monthDays,
  rollSystem,
  sunWarmth,
  tidy,
  verdictOf,
  withHome,
  yearDays,
} from "./system.ts";

describe("the star system", () => {
  it("gives an Earth-like system Earth's year, month and warmth", () => {
    const earth = { ...DEFAULT_SYSTEM, planets: [{ kind: "rocky" as const, a: 1, home: true }] };
    expect(yearDays(earth, 24)).toBe(365);
    expect(monthDays(earth, 24, 1)).toEqual([27]);
    expect(sunWarmth(earth)).toBe(0);
    expect(verdictOf(earth)).toBe("inside");
    // A shorter day makes more of them in a year.
    expect(yearDays(earth, 12)).toBe(731);
  });

  it("says when the world is too near or too far, and warms or cools it by its place", () => {
    const at = (a: number) => ({
      ...DEFAULT_SYSTEM,
      planets: [{ kind: "rocky" as const, a, home: true }],
    });
    expect(verdictOf(at(0.6))).toBe("hot");
    expect(verdictOf(at(2))).toBe("cold");
    expect(sunWarmth(at(0.96))).toBeGreaterThan(0);
    expect(sunWarmth(at(1.35))).toBeLessThan(-10);
    // With the rule ignored nothing is said and nothing is added.
    const ignored = { ...at(3), life: false };
    expect(verdictOf(ignored)).toBe("off");
    expect(sunWarmth(ignored)).toBe(0);
  });

  it("puts the band nearer a dim star and further from a bright one", () => {
    const [dimNear] = liquidBand({ ...DEFAULT_SYSTEM, star: "M" });
    const [brightNear] = liquidBand({ ...DEFAULT_SYSTEM, star: "F" });
    expect(dimNear).toBeLessThan(0.3);
    expect(brightNear).toBeGreaterThan(1.4);
  });

  it("keeps exactly one world, a rocky one, with the planets in order", () => {
    const messy = tidy({
      ...DEFAULT_SYSTEM,
      planets: [
        { kind: "gas", a: 5, home: true },
        { kind: "rocky", a: 2, home: true },
        { kind: "rocky", a: 0.5, home: true },
      ],
    });
    expect(messy.planets.map((p) => p.a)).toEqual([0.5, 2, 5]);
    expect(messy.planets.filter((p) => p.home)).toHaveLength(1);
    expect(homeOf(messy)?.kind).toBe("rocky");
    // A gas giant cannot be made the world.
    expect(withHome(messy, 2)).toBe(messy);
    expect(homeOf(withHome(messy, 1))?.a).toBe(2);
  });

  it("rolls a system whose world is inside the band, the same for the same seed", () => {
    for (const seed of [1, 7, 42, 999]) {
      const sys = rollSystem(seed);
      expect(verdictOf(sys)).toBe("inside");
      expect(sys.planets.length).toBeGreaterThanOrEqual(3);
      expect(rollSystem(seed)).toEqual(sys);
    }
  });

  it("writes the calendar entry from the numbers", () => {
    const text = calendarEntry(
      "Salt Coast",
      { ...DEFAULT_SYSTEM, moons: 2 },
      { day: 30, tilt: 40, size: 1, spin: -1 },
    );
    expect(text).toContain("# The sky and the calendar of Salt Coast");
    expect(text).toContain("A day is 30 hours long. The sun rises in the west.");
    expect(text).toMatch(/A year is \d+ days\./);
    expect(text).toContain("The second moon goes round once in");
    expect(text).toContain("hard seasons");
    expect(
      calendarEntry("X", { ...DEFAULT_SYSTEM, moons: 0 }, { day: 24, tilt: 0, size: 1, spin: 1 }),
    ).toContain("There is no moon");
  });
});

describe("rivers", () => {
  const world = newWorld({ ...DEFAULT_SETTINGS, seed: 2024 });
  ensure(world, "climate");

  it("drains every cell of land to the sea, downhill through filled hollows", () => {
    const { to } = drainageOf(world);
    for (let i = 0; i < N; i += 37) {
      if (world.elev[i]! <= 0) continue;
      let at = i;
      let steps = 0;
      while (world.elev[at]! > 0 && steps++ < N) at = to[at]!;
      expect(at).toBeGreaterThanOrEqual(0);
      expect(world.elev[at]!).toBeLessThanOrEqual(0);
    }
  });

  it("finds rivers that run on land to the sea or into a larger river, the largest first", () => {
    const rivers = riversOf(world);
    expect(rivers.length).toBeGreaterThan(3);
    expect(rivers.map((r) => r.flow)).toEqual([...rivers.map((r) => r.flow)].sort((a, b) => b - a));
    const used = new Set(rivers.flatMap((r) => r.cells));
    const { to } = drainageOf(world);
    for (const r of rivers) {
      expect(r.cells.length).toBeGreaterThanOrEqual(4);
      expect(r.cells.every((c) => world.elev[c]! > 0)).toBe(true);
      const end = r.cells[r.cells.length - 1]!;
      const next = to[end]!;
      // It ends at the shore, or on a cell of another river.
      expect(world.elev[next]! <= 0 || used.has(end)).toBe(true);
    }
  });

  it("makes fewer rivers on a drier world", () => {
    const dry = newWorld({ ...DEFAULT_SETTINGS, seed: 2024, wet: 0.4 });
    ensure(dry, "climate");
    const wet = riversOf(world, 6, 1000).length;
    expect(riversOf(dry, 6, 1000).length).toBeLessThan(wet);
  });

  it("finds lakes in hollows that water reaches, on land, and none on a world too dry to fill them", () => {
    const lakes = lakesOf(world);
    expect(lakes.length).toBeGreaterThan(0);
    expect(lakes.map((l) => l.cells.length)).toEqual(
      [...lakes.map((l) => l.cells.length)].sort((a, b) => b - a),
    );
    const { level } = drainageOf(world);
    for (const lake of lakes) {
      expect(lake.cells.length).toBeGreaterThanOrEqual(3);
      // Every cell is land that lies under the water's level.
      for (const c of lake.cells) {
        expect(world.elev[c]!).toBeGreaterThan(0);
        expect(level[c]!).toBeGreaterThan(world.elev[c]!);
      }
    }
    const mask = lakeMask(lakes);
    expect(mask.reduce((n, v) => n + v, 0)).toBe(lakes.reduce((n, l) => n + l.cells.length, 0));
    expect(lakeRings(mask).length).toBeGreaterThan(0);
    for (const ring of lakeRings(mask)) expect(ring.length).toBeGreaterThanOrEqual(3);
    // Asked for more water than any hollow gets: no lake.
    expect(lakesOf(world, 1e9)).toEqual([]);
    expect(lakeRings(new Uint8Array(mask.length))).toEqual([]);
  });

  it("cuts a course where it crosses the edge of the picture", () => {
    const y = 90;
    const lines = riverLines({ cells: [y * W + W - 2, y * W + W - 1, y * W, y * W + 1], flow: 1 });
    expect(lines).toHaveLength(2);
    expect(lines[0]![1]![0]).toBeGreaterThan(179);
    expect(lines[1]![0]![0]).toBeLessThan(-179);
  });
});
