import { describe, expect, it } from "vitest";
import {
  apart,
  type Body,
  distanceFor,
  drawnPosition,
  eccentricAnomaly,
  localRadius,
  localRadiusInverse,
  drawnRadius,
  drawnRadiusInverse,
  looseMoon,
  makeBody,
  meanAnomaly,
  nextClosest,
  orbitAt,
  period,
  totalMass,
  truePosition,
  yearLength,
  yearWords,
  daysWords,
} from "./orbits.ts";

const sun = makeBody("sun", "star", { mass: 1 });
const earth = makeBody("earth", "ocean", { parent: "sun", a: 1, home: true });
const mars = makeBody("mars", "rocky", { parent: "sun", a: 1.524 });
const moon = makeBody("moon", "moon", { parent: "earth", a: 384.4 });
const system: Body[] = [sun, earth, mars, moon];

describe("periods", () => {
  it("follow Kepler's third law around a Sun-like star", () => {
    expect(period(earth, system)).toBeCloseTo(365.25, 3);
    expect(period(mars, system)).toBeCloseTo(687, -1);
  });
  it("give a moon at the Moon's distance the Moon's month", () => {
    expect(period(moon, system)).toBeCloseTo(27.32, 2);
  });
  it("are shorter around a heavier star and longer around a lighter one", () => {
    expect(period(earth, [makeBody("sun", "star", { mass: 4 }), earth])).toBeCloseTo(365.25 / 2, 3);
    expect(period(earth, [makeBody("sun", "star", { mass: 0.25 }), earth])).toBeCloseTo(
      365.25 * 2,
      3,
    );
  });
  it("count both stars of a pair for a planet that circles them", () => {
    const pair = [sun, makeBody("b", "companion", { parent: null, mass: 1, a: 0.2 }), earth];
    expect(totalMass(pair)).toBe(2);
    expect(period(earth, pair)).toBeCloseTo(365.25 / Math.sqrt(2), 3);
  });
  it("go back to a distance from a period", () => {
    for (const b of [earth, mars, moon]) {
      expect(distanceFor(b, period(b, system), system)).toBeCloseTo(b.a, 6);
    }
  });
});

describe("a stretched orbit", () => {
  it("solves Kepler's equation", () => {
    for (const e of [0, 0.3, 0.9]) {
      for (const M of [0.1, 1, 2.5, 5]) {
        const E = eccentricAnomaly(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 8);
      }
    }
  });
  it("is nearest at day zero when the phase is zero, and farthest half a circuit later", () => {
    const comet = makeBody("c", "comet", { parent: "sun", a: 10, e: 0.9 });
    const all = [sun, comet];
    expect(orbitAt(comet, meanAnomaly(comet, 0, all)).r).toBeCloseTo(1, 6);
    expect(orbitAt(comet, meanAnomaly(comet, period(comet, all) / 2, all)).r).toBeCloseTo(19, 6);
  });
  it("is quick near the star: more of the circuit is spent far away", () => {
    const comet = makeBody("c", "comet", { parent: "sun", a: 10, e: 0.9 });
    const all = [sun, comet];
    const P = period(comet, all);
    const near = apart(comet, sun, P * 0.02, all);
    const far = apart(comet, sun, P * 0.5, all);
    expect(near).toBeLessThan(far / 5);
  });
  it("turns the other way when retrograde", () => {
    const back = { ...mars, retro: true };
    const a = truePosition(mars, 100, system);
    const b = truePosition(back, 100, [sun, back]);
    expect(b.y).toBeCloseTo(-a.y, 6);
  });
});

describe("where things are", () => {
  it("puts a moon near its planet and moves it with the planet", () => {
    const p0 = drawnPosition(earth, 0, system, "schematic");
    const m0 = drawnPosition(moon, 0, system, "schematic");
    expect(Math.hypot(m0.x - p0.x, m0.y - p0.y)).toBeCloseTo(localRadius(384.4), 4);
    const p1 = drawnPosition(earth, 90, system, "schematic");
    const m1 = drawnPosition(moon, 90, system, "schematic");
    expect(Math.hypot(m1.x - p1.x, m1.y - p1.y)).toBeCloseTo(localRadius(384.4), 4);
    expect(p1.x).not.toBeCloseTo(p0.x, 0);
  });
  it("keeps the centre of a pair still, the heavier star nearer it", () => {
    const b = makeBody("b", "companion", { parent: null, mass: 0.25, a: 0.5 });
    const pair = [sun, b];
    for (const day of [0, 7, 50]) {
      const p = drawnPosition(sun, day, pair, "true");
      const q = drawnPosition(b, day, pair, "true");
      // The centre of mass of the pair stays at the origin.
      expect((p.x * 1 + q.x * 0.25) / 1.25).toBeCloseTo(0, 6);
      expect(Math.hypot(p.x, p.y)).toBeLessThan(Math.hypot(q.x, q.y));
    }
  });
  it("is the same AU apart, however the system is drawn", () => {
    expect(apart(earth, mars, 0, system)).toBeCloseTo(0.524, 3);
    expect(apart(earth, moon, 0, system)).toBeCloseTo(0, 6);
  });
});

describe("scales", () => {
  it("go to pixels and back", () => {
    for (const s of ["schematic", "true"] as const) {
      expect(drawnRadiusInverse(drawnRadius(2.5, s), s)).toBeCloseTo(2.5, 8);
    }
    expect(localRadiusInverse(localRadius(500))).toBeCloseTo(500, 6);
  });
  it("squeeze far distances in the schematic view", () => {
    expect(drawnRadius(40, "schematic") / drawnRadius(1, "schematic")).toBeLessThan(7);
    expect(drawnRadius(40, "true") / drawnRadius(1, "true")).toBe(40);
  });
});

describe("what a writer asks", () => {
  it("finds when two worlds are next closest", () => {
    const n = nextClosest(earth, mars, 0, system)!;
    // Mars is at its closest to Earth when the two line up, about every 780 days.
    expect(n.days).toBeGreaterThan(0);
    expect(n.days).toBeLessThanOrEqual(780);
    expect(n.au).toBeCloseTo(0.524, 1);
  });
  it("has none for two on the same circuit", () => {
    expect(
      nextClosest(earth, { ...earth, id: "twin" }, 0, [...system, { ...earth, id: "twin" }]),
    ).toBeNull();
  });
  it("counts the year as the home world's circuit", () => {
    expect(yearLength(system)).toBeCloseTo(365.25, 3);
    expect(yearWords(0, system)).toBe("Year 0, day 1");
    expect(yearWords(365.25 * 3 + 30, system)).toBe("Year 3, day 31");
    expect(daysWords(40, system)).toBe("40 days");
    expect(daysWords(365.25 * 2, system)).toBe("2.00 years");
  });
  it("warns, softly, about a moon too far from a small planet", () => {
    expect(looseMoon(moon, system)).toBeNull();
    expect(looseMoon({ ...moon, a: 2_000_000 }, system)).toMatch(/struggle to hold/);
    expect(looseMoon(earth, system)).toBeNull();
  });
});
