/**
 * The World Wizard's star system (stage 34, release 2): the star, what circles it, which planet
 * is the world, and its moons. From it come the length of the year, how warm the world starts
 * out, and the months. The numbers are rules of thumb: the light of a star by its kind, the band
 * where water stays liquid from that light, and Kepler's third law for years and months.
 */
import { random } from "./model.ts";

export type StarKind = "M" | "K" | "G" | "F";
export const STARS: Record<
  StarKind,
  { name: string; mass: number; light: number; colour: string }
> = {
  M: { name: "Red dwarf", mass: 0.4, light: 0.04, colour: "#ff9d6b" },
  K: { name: "Orange", mass: 0.75, light: 0.3, colour: "#ffc98a" },
  G: { name: "Yellow", mass: 1, light: 1, colour: "#fff0c2" },
  F: { name: "White", mass: 1.3, light: 2.6, colour: "#eef2ff" },
};
export const STAR_KINDS = Object.keys(STARS) as StarKind[];

export type PlanetKind = "rocky" | "gas" | "ice";
export const PLANETS: Record<PlanetKind, { name: string; radius: number; colour: string }> = {
  rocky: { name: "Rocky", radius: 4, colour: "#b08968" },
  gas: { name: "Gas giant", radius: 9, colour: "#d8b47a" },
  ice: { name: "Ice giant", radius: 7, colour: "#8fc1d6" },
};
export const PLANET_KINDS = Object.keys(PLANETS) as PlanetKind[];

export interface Planet {
  kind: PlanetKind;
  /** Its distance from the star, in AU. */
  a: number;
  /** The world the wizard builds. One planet is, and it is rocky. */
  home?: boolean;
}

export interface SystemSettings {
  star: StarKind;
  /** A second, smaller star close beside the first. */
  twin: boolean;
  planets: Planet[];
  /** The moons of the world, 0 to 3. */
  moons: number;
  /** Keep the world able to hold life: warn when it leaves the band, and warm it by its place. */
  life: boolean;
}

export const DEFAULT_SYSTEM: SystemSettings = {
  star: "G",
  twin: false,
  planets: [
    { kind: "rocky", a: 0.42 },
    { kind: "rocky", a: 1.02, home: true },
    { kind: "rocky", a: 1.7 },
    { kind: "gas", a: 5.4 },
    { kind: "ice", a: 18 },
  ],
  moons: 1,
  life: true,
};

/** The nearest and the farthest a planet can be, in AU. */
export const NEAREST = 0.05;
export const FARTHEST = 40;
/** How far each moon is from the world, in thousands of km. */
export const MOON_DISTANCES = [384, 640, 980] as const;
/** The second star's mass, in the Sun's, and how far it is from the first, in AU. */
export const TWIN = { mass: 0.4, apart: 0.12 };

/** The light the world gets from its star or stars, in the Sun's. */
export const lightOf = (sys: SystemSettings): number =>
  STARS[sys.star].light * (sys.twin ? 1.15 : 1);
/** The mass at the middle of the system, in the Sun's. */
export const massOf = (sys: SystemSettings): number =>
  STARS[sys.star].mass + (sys.twin ? TWIN.mass : 0);

/** The band where water stays liquid on a world like this one: its near and far edge, in AU. */
export function liquidBand(sys: SystemSettings): [number, number] {
  const root = Math.sqrt(lightOf(sys));
  return [0.95 * root, 1.4 * root];
}

/** The world: the planet marked so, else the first rocky one, else the first of any kind. */
export function homeOf(sys: SystemSettings): Planet | null {
  return (
    sys.planets.find((p) => p.home) ??
    sys.planets.find((p) => p.kind === "rocky") ??
    sys.planets[0] ??
    null
  );
}

export type Verdict = "inside" | "hot" | "cold" | "off" | "none";

/** Where the world lies by the band; "off" when the rule is ignored, "none" with no planet. */
export function verdictOf(sys: SystemSettings): Verdict {
  const home = homeOf(sys);
  if (!home) return "none";
  if (!sys.life) return "off";
  const [near, far] = liquidBand(sys);
  return home.a < near ? "hot" : home.a > far ? "cold" : "inside";
}

/**
 * How many degrees warmer (or, below zero, colder) than Earth the world starts out, from where it
 * lies by the band: Earth's own place in the Sun's band gives 0. Nothing when the rule is ignored.
 */
export function sunWarmth(sys: SystemSettings): number {
  const home = homeOf(sys);
  if (!home || !sys.life) return 0;
  const [near, far] = liquidBand(sys);
  const place = (home.a - near) / (far - near);
  // Earth sits at 1 AU in a band of 0.95 to 1.4.
  const earth = (1 - 0.95) / (1.4 - 0.95);
  return Math.round(Math.max(-45, Math.min(45, (earth - place) * 34)));
}

/** The year, in days of `dayHours` hours each. */
export function yearDays(sys: SystemSettings, dayHours: number): number {
  const home = homeOf(sys);
  if (!home) return 0;
  const earthDays = 365.25 * Math.sqrt(home.a ** 3 / massOf(sys));
  return Math.max(1, Math.round((earthDays * 24) / dayHours));
}

/**
 * How long each moon takes to go round, in the world's own days, nearest first. A world of the
 * same stuff as Earth weighs its size cubed.
 */
export function monthDays(sys: SystemSettings, dayHours: number, size: number): number[] {
  const mass = size ** 3;
  return MOON_DISTANCES.slice(0, Math.max(0, Math.min(3, sys.moons))).map((d) =>
    Math.max(1, Math.round((27.32 * Math.sqrt((d / 384) ** 3 / mass) * 24) / dayHours)),
  );
}

/** Makes one planet the world, if it may be: only a rocky planet can. */
export function withHome(sys: SystemSettings, index: number): SystemSettings {
  if (sys.planets[index]?.kind !== "rocky") return sys;
  return {
    ...sys,
    planets: sys.planets.map((p, n) => ({
      kind: p.kind,
      a: p.a,
      ...(n === index ? { home: true } : {}),
    })),
  };
}

/** The system with its planets in order from the star, and exactly one world when one can be. */
export function tidy(sys: SystemSettings): SystemSettings {
  const planets = [...sys.planets]
    .map((p) => ({ ...p, a: Math.max(NEAREST, Math.min(FARTHEST, p.a)) }))
    .sort((p, q) => p.a - q.a);
  let found = false;
  const marked = planets.map((p): Planet => {
    const home = !found && p.home === true && p.kind === "rocky";
    if (home) found = true;
    return { kind: p.kind, a: p.a, ...(home ? { home: true } : {}) };
  });
  if (!found) {
    const first = marked.find((p) => p.kind === "rocky");
    if (first) first.home = true;
  }
  return { ...sys, planets: marked, moons: Math.max(0, Math.min(3, Math.round(sys.moons))) };
}

/** A whole system rolled from a seed: the world is put inside the band. */
export function rollSystem(seed: number): SystemSettings {
  const r = random(seed);
  const star = STAR_KINDS[Math.floor(r() * STAR_KINDS.length)]!;
  const base: SystemSettings = {
    star,
    twin: r() < 0.25,
    planets: [],
    moons: Math.floor(r() * 4),
    life: true,
  };
  const [near, far] = liquidBand(base);
  // Toward the warm side of the band, where Earth is: the middle of it is a frozen world.
  const home = near + (far - near) * (0.03 + r() * 0.27);
  const planets: Planet[] = [{ kind: "rocky", a: home, home: true }];
  // Inward: one or two small worlds. Outward: more rock, then giants.
  let a = home;
  for (let n = Math.floor(r() * 3); n > 0; n--) {
    a /= 1.6 + r() * 0.8;
    if (a > NEAREST) planets.push({ kind: "rocky", a });
  }
  a = home;
  for (let n = 2 + Math.floor(r() * 3); n > 0; n--) {
    a *= 1.6 + r() * 1.2;
    if (a > FARTHEST) break;
    planets.push({ kind: a < far * 2.5 ? "rocky" : r() < 0.6 ? "gas" : "ice", a });
  }
  return tidy({ ...base, planets });
}

/** "1 moon", "2 moons", "no moon". */
const moonsWords = (n: number) => (n === 0 ? "no moon" : n === 1 ? "one moon" : `${n} moons`);

const SEASONS = (tilt: number) =>
  tilt < 8
    ? "The axis hardly leans, so there are no seasons to speak of: a place is as warm in one part of the year as in another."
    : tilt < 30
      ? `The axis leans ${tilt}°, which gives mild seasons: four of them, each a quarter of the year.`
      : `The axis leans ${tilt}°, which gives hard seasons: long bright summers and dark winters far from the equator.`;

/**
 * The entry the wizard writes about the sky and the calendar: what the star system and the
 * world's spin make of the year, the months and the seasons. Plain facts for the author to name
 * and change; nothing in it is invented beyond the numbers.
 */
export function calendarEntry(
  title: string,
  sys: SystemSettings,
  world: { day: number; tilt: number; size: number; spin: 1 | -1 },
): string {
  const year = yearDays(sys, world.day);
  const months = monthDays(sys, world.day, world.size);
  const star = STARS[sys.star].name.toLowerCase();
  const home = homeOf(sys);
  const lines = [
    `# The sky and the calendar of ${title}`,
    "",
    `${title} circles ${sys.twin ? `a ${star} star with a small red companion` : `a ${star} star`}${home ? `, ${home.a.toFixed(2)} AU out` : ""}. It has ${moonsWords(sys.moons)}, and ${sys.planets.length - 1 === 1 ? "one other planet shares" : `${Math.max(0, sys.planets.length - 1)} other planets share`} its sky.`,
    "",
    "## The day and the year",
    "",
    `- A day is ${world.day} hours long. The sun rises in the ${world.spin > 0 ? "east" : "west"}.`,
    `- A year is ${year.toLocaleString("en")} days.`,
    "",
    "## Months",
    "",
  ];
  if (months.length === 0) {
    lines.push("There is no moon, so nothing in the sky marks a month, and the tides are weak.");
  } else {
    const first = months[0]!;
    const whole = Math.floor(year / first);
    lines.push(
      `The ${months.length > 1 ? "nearest moon" : "moon"} goes round once in ${first} days: a month. A year holds ${whole} such ${whole === 1 ? "month" : "months"}${year - whole * first > 0 ? ` and ${year - whole * first} days over` : ""}.`,
    );
    months
      .slice(1)
      .forEach((m, n) =>
        lines.push(`The ${n === 0 ? "second" : "third"} moon goes round once in ${m} days.`),
      );
  }
  lines.push("", "## Seasons", "", SEASONS(world.tilt), "");
  return lines.join("\n");
}
