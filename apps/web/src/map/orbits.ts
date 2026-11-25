/**
 * The orbits of a system model. Every body is on a fixed two-body track around its parent, so any
 * day can be shown at once and nothing flies apart. A binary is two stars on tracks around their
 * shared centre. Distances are in AU for a body that circles a star, and in thousands of km for a
 * moon or station that circles a planet.
 */

export type BodyType =
  | "star"
  | "companion"
  | "rocky"
  | "ocean"
  | "gas"
  | "ice"
  | "dwarf"
  | "moon"
  | "station"
  | "belt"
  | "comet";

export interface Body {
  id: string;
  type: BodyType;
  /** The body this one circles; null for the stars. */
  parent: string | null;
  /** Distance (semi-major axis): AU, or thousand km around a planet. For a companion star, the AU apart. */
  a: number;
  /** How stretched the orbit is: 0 round, up to 0.95. */
  e: number;
  /** Where on the orbit it is at day 0, in radians. */
  phase: number;
  /** Which way the stretched orbit points, in radians. */
  peri: number;
  retro: boolean;
  /** Mass in solar masses, for stars. */
  mass: number;
  /** A belt's edges, in AU. */
  inner: number;
  outer: number;
  /** The home world: its circuit is the year. */
  home: boolean;
}

export const TAU = Math.PI * 2;

export interface Preset {
  label: string;
  note: string;
  colour: string;
  /** Drawn radius in pixels at the normal view: symbolic, never to scale. */
  radius: number;
  /** Earth masses; sets how far a moon may orbit and how fast. */
  earthMass: number;
  /** Circles a planet, on a local scale. */
  local: boolean;
}

export const PRESETS: Record<BodyType, Preset> = {
  star: {
    label: "Star",
    note: "The centre",
    colour: "#f2d28a",
    radius: 13,
    earthMass: 333000,
    local: false,
  },
  companion: {
    label: "Second star",
    note: "The two stars circle each other",
    colour: "#e8a15c",
    radius: 10,
    earthMass: 200000,
    local: false,
  },
  rocky: {
    label: "Rocky planet",
    note: "Small and solid",
    colour: "#b08a6a",
    radius: 4.5,
    earthMass: 1,
    local: false,
  },
  ocean: {
    label: "Ocean world",
    note: "A place to live",
    colour: "#6d9fcf",
    radius: 5,
    earthMass: 1,
    local: false,
  },
  gas: {
    label: "Gas giant",
    note: "Huge, with room for moons",
    colour: "#d9b38c",
    radius: 9,
    earthMass: 318,
    local: false,
  },
  ice: {
    label: "Ice giant",
    note: "Cold and far out",
    colour: "#9fcbd6",
    radius: 7,
    earthMass: 15,
    local: false,
  },
  dwarf: {
    label: "Dwarf planet",
    note: "A small far world",
    colour: "#bfb8ad",
    radius: 3,
    earthMass: 0.002,
    local: false,
  },
  moon: {
    label: "Moon",
    note: "Circles a planet",
    colour: "#c9c5bb",
    radius: 2.5,
    earthMass: 0.012,
    local: true,
  },
  station: {
    label: "Station",
    note: "Circles a planet",
    colour: "#fbf7f0",
    radius: 3,
    earthMass: 0,
    local: true,
  },
  belt: {
    label: "Belt",
    note: "A ring of rubble",
    colour: "#b3aa99",
    radius: 0,
    earthMass: 0,
    local: false,
  },
  comet: {
    label: "Comet",
    note: "A long stretched orbit",
    colour: "#dfe6ee",
    radius: 2.5,
    earthMass: 0,
    local: false,
  },
};

/** The kinds offered when adding, in the order the picker shows them. */
export const ADDABLE: BodyType[] = [
  "rocky",
  "ocean",
  "gas",
  "ice",
  "dwarf",
  "moon",
  "station",
  "belt",
  "comet",
  "companion",
];

export const isStar = (b: Body) => b.type === "star" || b.type === "companion";

export function makeBody(id: string, type: BodyType, over: Partial<Body> = {}): Body {
  return {
    id,
    type,
    parent: type === "star" ? null : "",
    a: 1,
    e: 0,
    phase: 0,
    peri: 0,
    retro: false,
    mass: 1,
    inner: 0,
    outer: 0,
    home: false,
    ...over,
  };
}

const byId = (bodies: Body[], id: string | null) => bodies.find((b) => b.id === id);

/** The star at the centre. */
export const primary = (bodies: Body[]): Body | undefined => bodies.find((b) => b.type === "star");
export const companion = (bodies: Body[]): Body | undefined =>
  bodies.find((b) => b.type === "companion");

/** Solar masses of everything the planets circle: one star, or the pair. */
export function totalMass(bodies: Body[]): number {
  return (primary(bodies)?.mass ?? 1) + (companion(bodies)?.mass ?? 0);
}

/** A body that circles a planet, not a star, and so is drawn on a local scale. */
export function isLocal(b: Body, bodies: Body[]): boolean {
  const parent = byId(bodies, b.parent);
  return !!parent && !isStar(parent);
}

/** Days for one circuit, by Kepler's third law. */
export function period(b: Body, bodies: Body[]): number {
  if (b.type === "belt")
    return 365.25 * Math.sqrt(((b.inner + b.outer) / 2) ** 3 / totalMass(bodies));
  if (isLocal(b, bodies)) {
    const planet = byId(bodies, b.parent)!;
    // The Moon's 384 thousand km takes 27.32 days around an Earth mass.
    return 27.32 * Math.sqrt((b.a / 384.4) ** 3 / Math.max(PRESETS[planet.type].earthMass, 1e-6));
  }
  return 365.25 * Math.sqrt(b.a ** 3 / totalMass(bodies));
}

/** The distance that gives a circuit of this many days: the other way round from `period`. */
export function distanceFor(b: Body, days: number, bodies: Body[]): number {
  if (isLocal(b, bodies)) {
    const planet = byId(bodies, b.parent)!;
    return 384.4 * Math.cbrt((days / 27.32) ** 2 * Math.max(PRESETS[planet.type].earthMass, 1e-6));
  }
  return Math.cbrt((days / 365.25) ** 2 * totalMass(bodies));
}

/** Where a body is on its orbit at a day, as the angle that grows with time (the mean anomaly). */
export function meanAnomaly(b: Body, day: number, bodies: Body[]): number {
  return (b.retro ? -1 : 1) * ((TAU * day) / period(b, bodies)) + b.phase;
}

/** Solves Kepler's equation, so a stretched orbit is quick at its near end. */
export function eccentricAnomaly(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Distance from the parent and direction, at a mean anomaly. The parent is at a focus. */
export function orbitAt(b: Body, M: number): { r: number; theta: number } {
  const E = eccentricAnomaly(M, b.e);
  const x = Math.cos(E) - b.e;
  const y = Math.sqrt(1 - b.e * b.e) * Math.sin(E);
  return { r: b.a * Math.hypot(x, y), theta: Math.atan2(y, x) + b.peri };
}

// ---- Drawing scale ------------------------------------------------------------------------------

export type Scale = "schematic" | "true";

/** Pixels from the centre for a distance in AU: square-root spaced, or true. */
export const drawnRadius = (au: number, scale: Scale): number =>
  scale === "schematic" ? 86 * Math.sqrt(au) : 30 * au;
export const drawnRadiusInverse = (px: number, scale: Scale): number =>
  scale === "schematic" ? (px / 86) ** 2 : px / 30;
/** Around a planet: thousand km to pixels, with its own exaggeration. */
export const localRadius = (thousandKm: number): number => 11 + 7 * Math.sqrt(thousandKm / 100);
export const localRadiusInverse = (px: number): number =>
  Math.max(60, ((Math.max(px, 12) - 11) / 7) ** 2 * 100);

export interface Point {
  x: number;
  y: number;
}

/** The two stars of a pair, each on a ring about the shared centre; the heavier one is nearer it. */
export function starPosition(b: Body, day: number, bodies: Body[], scale: Scale): Point {
  const c = companion(bodies);
  const p = primary(bodies);
  if (!c || !p) return { x: 0, y: 0 };
  const angle = (TAU * day) / period(c, bodies) + c.phase;
  const apart = drawnRadius(c.a, scale);
  const total = p.mass + c.mass;
  const share = b.type === "star" ? -c.mass / total : p.mass / total;
  return { x: apart * share * Math.cos(angle), y: apart * share * Math.sin(angle) };
}

/** Where a body is drawn, in pixels from the centre of the system, at a day. */
export function drawnPosition(b: Body, day: number, bodies: Body[], scale: Scale): Point {
  if (isStar(b)) return starPosition(b, day, bodies, scale);
  const parent = byId(bodies, b.parent);
  const local = isLocal(b, bodies);
  const origin = local && parent ? drawnPosition(parent, day, bodies, scale) : { x: 0, y: 0 };
  const o = orbitAt(b, meanAnomaly(b, day, bodies));
  const d = local ? localRadius(o.r) : drawnRadius(o.r, scale);
  return { x: origin.x + d * Math.cos(o.theta), y: origin.y + d * Math.sin(o.theta) };
}

/** Where a body really is, in AU from the centre; a moon is where its planet is. */
export function truePosition(b: Body, day: number, bodies: Body[]): Point {
  let body = b;
  if (isLocal(b, bodies)) body = byId(bodies, b.parent)!;
  if (isStar(body)) return { x: 0, y: 0 };
  const o = orbitAt(body, meanAnomaly(body, day, bodies));
  return { x: o.r * Math.cos(o.theta), y: o.r * Math.sin(o.theta) };
}

/** AU between two bodies at a day. */
export function apart(a: Body, b: Body, day: number, bodies: Body[]): number {
  const p = truePosition(a, day, bodies);
  const q = truePosition(b, day, bodies);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** When two bodies are next closest, searching one meeting ahead. Null for the same circuit. */
export function nextClosest(
  a: Body,
  b: Body,
  day: number,
  bodies: Body[],
): { days: number; au: number } | null {
  const pa = period(a, bodies);
  const pb = period(b, bodies);
  if (Math.abs(pa - pb) < 1e-6) return null;
  const meeting = Math.min(1 / Math.abs(1 / pa - 1 / pb), 20000);
  let best = Infinity;
  let at = 0;
  for (let i = 1; i <= 400; i++) {
    const d = apart(a, b, day + (meeting * i) / 400, bodies);
    if (d < best) {
      best = d;
      at = (meeting * i) / 400;
    }
  }
  return { days: at, au: best };
}

/** A soft note when a moon is further out than its planet could hold it, or null. Never blocks. */
export function looseMoon(b: Body, bodies: Body[]): string | null {
  if (!isLocal(b, bodies)) return null;
  const planet = byId(bodies, b.parent)!;
  const mass = PRESETS[planet.type].earthMass / 333000;
  const hillKm = planet.a * 149_600_000 * Math.cbrt(mass / (3 * totalMass(bodies)));
  return b.a * 1000 > hillKm / 3
    ? `This far out, ${"the planet"} would struggle to hold it. Fine for a story, but an astronomer would notice.`
    : null;
}

// ---- Time ---------------------------------------------------------------------------------------

/** The length of the year: one circuit of the home world, else of the first planet, else 365.25 days. */
export function yearLength(bodies: Body[]): number {
  const home =
    bodies.find((b) => b.home) ??
    bodies.find(
      (b) => !isStar(b) && b.type !== "belt" && b.type !== "comet" && !isLocal(b, bodies),
    );
  return home ? period(home, bodies) : 365.25;
}

/** "Year 12, day 30" for a day count. */
export function yearWords(day: number, bodies: Body[]): string {
  const year = yearLength(bodies);
  const y = Math.floor(day / year);
  return `Year ${y}, day ${Math.floor(day - y * year) + 1}`;
}

/** A span of days in words a writer uses: days, or years once it is longer than one and a half. */
export function daysWords(days: number, bodies: Body[]): string {
  const year = yearLength(bodies);
  if (days >= year * 1.5) {
    const n = days / year;
    return `${n.toFixed(n < 10 ? 2 : 1)} years`;
  }
  return `${Math.round(days)} days`;
}

/** The size of the whole system in pixels at the normal view, for fitting it on screen. */
export function systemRadius(bodies: Body[], scale: Scale): number {
  // Room for about three AU, so a lone star still shows where a first planet would go.
  let r = drawnRadius(3, scale);
  for (const b of bodies) {
    if (isLocal(b, bodies)) continue;
    if (b.type === "comet") continue;
    if (b.type === "companion") r = Math.max(r, drawnRadius(b.a, scale));
    else if (!isStar(b))
      r = Math.max(r, drawnRadius((b.type === "belt" ? b.outer : b.a) * (1 + b.e), scale));
  }
  return r;
}
