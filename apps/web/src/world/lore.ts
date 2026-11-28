/**
 * The World Wizard's life and lore (stage 34, release 3): the places found on the world, what
 * the AI is told of the world and what it suggests, the entries made of what the author ticks,
 * and the World brief. Finding the places and writing the brief need no AI; names and prose for
 * the places, the sapient species and the life do.
 */
import { BIOME_KINDS, BIOMES } from "@frontier/schema";
import { cellDegrees, ensure, factsOf, H, LAT, METRES, N, W, type World } from "./model.ts";
import type { River } from "./rivers.ts";
import { homeOf, monthDays, STARS, type SystemSettings, yearDays } from "./system.ts";

export interface Place {
  /** What the AI's answer refers to it by. */
  key: string;
  cell: number;
  /** What it is: "The highest range". Its name until it is given one. */
  what: string;
  /** Its climate and height in a line. */
  facts: string;
}

const kindOf = (name: (typeof BIOME_KINDS)[number]) => BIOME_KINDS.indexOf(name);
const DESERTS = [kindOf("desert-sand"), kindOf("desert-rock")];
const WOODS = [kindOf("jungle"), kindOf("forest")];
const COLD = [kindOf("tundra"), kindOf("taiga")];
const ICE = kindOf("ice");

/** "41° north, 22° east". */
export function whereWords(cell: number): string {
  const [lat, lon] = cellDegrees(cell);
  const ns =
    Math.abs(lat) < 0.75
      ? "on the equator"
      : `${Math.round(Math.abs(lat))}° ${lat > 0 ? "north" : "south"}`;
  return `${ns}, ${Math.round(Math.abs(lon))}° ${lon >= 0 ? "east" : "west"}`;
}

const rainWords = (r: number) =>
  r < 0.1 ? "almost no rain" : r < 0.2 ? "little rain" : r < 0.4 ? "steady rain" : "heavy rain";

/** A place's climate and height in a line, for the AI and for the entry written without it. */
export function placeFacts(world: World, cell: number): string {
  const biome = BIOMES[BIOME_KINDS[world.biome[cell]!]!].name.toLowerCase();
  const high = Math.round((Math.max(0, world.elev[cell]!) * METRES) / 100) * 100;
  return `At ${whereWords(cell)}: ${biome}, about ${high.toLocaleString("en")} m up, ${Math.round(world.temp[cell]!)} °C through the year, ${rainWords(world.rain[cell]!)}.`;
}

/** How far apart two cells are, in degrees round the globe. */
function apart(a: number, b: number): number {
  const [la, lo] = cellDegrees(a);
  const [lb, lob] = cellDegrees(b);
  const r = Math.PI / 180;
  const cos =
    Math.sin(la * r) * Math.sin(lb * r) +
    Math.cos(la * r) * Math.cos(lb * r) * Math.cos((lo - lob) * r);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / r;
}

/**
 * The places worth an entry, found on the world: the highest ground, the driest basin, the
 * wettest forest, a sheltered well-watered coast, cold open country by the ice, and the mouth of
 * the greatest river. Fewer on a world that lacks them; none closer than eight degrees to another.
 */
export function findPlaces(world: World, rivers: readonly River[] = []): Place[] {
  ensure(world, "biome");
  const { elev, rain, temp, biome } = world;
  const best: Record<string, { cell: number; score: number }> = {};
  const offer = (key: string, cell: number, score: number) => {
    if (!best[key] || score > best[key].score) best[key] = { cell, score };
  };
  for (let i = 0; i < N; i++) {
    if (elev[i]! <= 0) continue;
    const b = biome[i]!;
    const x = i % W;
    const y = Math.floor(i / W);
    const deg = (Math.abs(LAT[y]!) * 180) / Math.PI;
    offer("peak", i, elev[i]!);
    if (DESERTS.includes(b)) offer("desert", i, 1 - rain[i]!);
    if (WOODS.includes(b)) offer("forest", i, rain[i]!);
    if (COLD.includes(b)) offer("cold", i, -temp[i]!);
    const shore =
      elev[y * W + ((x + 1) % W)]! <= 0 ||
      elev[y * W + ((x + W - 1) % W)]! <= 0 ||
      (y > 0 && elev[i - W]! <= 0) ||
      (y < H - 1 && elev[i + W]! <= 0);
    if (shore && b !== ICE && deg > 12 && deg < 55)
      offer("bay", i, rain[i]! + (temp[i]! > 8 ? 0.2 : 0));
  }
  const greatest = rivers[0];
  if (greatest) best["river"] = { cell: greatest.cells[greatest.cells.length - 1]!, score: 1 };
  const WHAT: [string, string][] = [
    ["peak", "The highest range"],
    ["river", "The mouth of the greatest river"],
    ["bay", "A sheltered, well-watered coast"],
    ["forest", "The wettest forest"],
    ["desert", "The driest basin"],
    ["cold", "Cold open country by the ice"],
  ];
  const places: Place[] = [];
  for (const [key, what] of WHAT) {
    const found = best[key];
    if (!found || places.some((p) => apart(p.cell, found.cell) < 8)) continue;
    places.push({ key, cell: found.cell, what, facts: placeFacts(world, found.cell) });
  }
  return places;
}

// ---- What is suggested, and kept --------------------------------------------------------------

export type LoreGroup = "place" | "species" | "life";
export const GROUP_NAMES: Record<LoreGroup, string> = {
  place: "Places",
  species: "Sapient species",
  life: "Life",
};
/** The folder each group's entries go to. */
export const GROUP_FOLDERS: Record<LoreGroup, string> = {
  place: "Places",
  species: "Peoples",
  life: "Life",
};

export interface LoreItem {
  id: string;
  group: LoreGroup;
  title: string;
  text: string;
  /** Where it is on the world: a place's own cell, or the place a species arose at. */
  cell?: number;
  /** Ticked: an entry is made of it. */
  on: boolean;
  /** Named and written by the AI; a place found by the wizard alone is not. */
  written?: boolean;
}

export const SPECIES_CHOICES = [
  [1, "One"],
  [3, "Two or three"],
  [4, "Many"],
] as const;
export const MAGIC = ["None", "Rare", "Everywhere"] as const;
export const AGES = ["Stone", "Iron", "Sail", "Engines", "Stars"] as const;

export interface LoreState {
  know: string;
  species: 1 | 3 | 4;
  magic: (typeof MAGIC)[number];
  age: (typeof AGES)[number];
  items: LoreItem[];
  /** The world the items were found on, as `stampOf` says it; another world makes them stale. */
  stamp: string;
}

export const NO_LORE: LoreState = {
  know: "",
  species: 3,
  magic: "Rare",
  age: "Iron",
  items: [],
  stamp: "",
};

/** A short mark of the world as built: the same until its land, heights, climate or biomes change. */
export function stampOf(world: World): string {
  ensure(world, "biome");
  let sum = 0;
  for (let i = 0; i < N; i += 7)
    sum = (sum * 31 + world.biome[i]! + Math.round(world.elev[i]! * 50)) | 0;
  return `${world.s.seed}:${world.my}:${sum}`;
}

/** The places as items, before the AI has named them: each named for what it is. */
export function placeItems(places: readonly Place[]): LoreItem[] {
  return places.map((p) => ({
    id: `place-${p.key}`,
    group: "place",
    title: p.what,
    text: p.facts,
    cell: p.cell,
    on: true,
  }));
}

export interface LoreAnswer {
  places: { key: string; name: string; text: string }[];
  species: { cradle: string | null; name: string; text: string }[];
  life: { name: string; text: string }[];
}

/**
 * The items after an answer: each place takes its name and prose (one the AI skipped keeps its
 * plain form), the species and the life are added. A tick taken off a place stays off.
 */
export function withAnswer(
  places: readonly Place[],
  before: readonly LoreItem[],
  answer: LoreAnswer,
): LoreItem[] {
  const wasOn = new Map(before.map((i) => [i.id, i.on]));
  const named = new Map(answer.places.map((p) => [p.key, p]));
  const items: LoreItem[] = placeItems(places).map((item) => {
    const got = named.get(item.id.slice(6));
    const base = { ...item, on: wasOn.get(item.id) ?? true };
    return got ? { ...base, title: got.name, text: got.text, written: true } : base;
  });
  answer.species.forEach((sp, n) => {
    const cradle = places.find((p) => p.key === sp.cradle);
    items.push({
      id: `species-${n}`,
      group: "species",
      title: sp.name,
      text: sp.text,
      ...(cradle ? { cell: cradle.cell } : {}),
      on: true,
      written: true,
    });
  });
  answer.life.forEach((l, n) =>
    items.push({
      id: `life-${n}`,
      group: "life",
      title: l.name,
      text: l.text,
      on: true,
      written: true,
    }),
  );
  return items;
}

/** The world in plain lines, for the AI and for the World brief. */
export function worldFacts(world: World, system: SystemSettings): string[] {
  const facts = factsOf(world);
  const s = world.s;
  const home = homeOf(system);
  const months = monthDays(system, s.day, s.size);
  const shares = facts.shares
    .map((share, n) => ({ share, name: BIOMES[BIOME_KINDS[n]!].name.toLowerCase(), n }))
    .filter((b) => b.share >= 0.01 && b.n > 1)
    .sort((a, b) => b.share - a.share)
    .slice(0, 6)
    .map((b) => `${b.name} ${Math.round(b.share * 100)}%`);
  return [
    `It circles a ${STARS[system.star].name.toLowerCase()} star${system.twin ? " with a small red companion" : ""}${home ? `, ${home.a.toFixed(2)} AU out` : ""}, with ${system.planets.length - 1} other planets.`,
    `A day is ${s.day} hours and a year is ${yearDays(system, s.day)} days. The sun rises in the ${s.spin > 0 ? "east" : "west"}.`,
    months.length === 0
      ? "It has no moon: no months and weak tides."
      : `It has ${months.length} ${months.length === 1 ? "moon" : "moons"}; the nearest goes round in ${months[0]} days.`,
    `The axis leans ${s.tilt}°: ${s.tilt < 8 ? "no seasons" : s.tilt < 30 ? "mild seasons" : "hard seasons"}.`,
    `It is ${s.size.toFixed(1)} times Earth's size, ${Math.round(40030 * s.size).toLocaleString("en")} km round.`,
    `${facts.land}% of the surface is land. The highest ground is about ${facts.peak.toLocaleString("en")} m.`,
    `Of the whole surface: ${shares.join(", ") || "almost all sea and ice"}.`,
    `Its plates have drifted for ${world.my} million years.`,
  ];
}

/** What is sent to the AI. */
export function loreRequest(
  name: string,
  world: World,
  system: SystemSettings,
  places: readonly Place[],
  lore: LoreState,
) {
  return {
    name,
    facts: worldFacts(world, system),
    places: places.map((p) => ({ key: p.key, what: p.what, facts: p.facts })),
    species: lore.species === 3 ? 3 : lore.species,
    magic: lore.magic,
    age: lore.age,
    know: lore.know.trim().slice(0, 2000),
    avoid: [] as string[],
  };
}

/** A title a file can be named by. */
export const cleanTitle = (title: string): string =>
  title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const TYPES: Record<LoreGroup, string> = { place: "place", species: "species", life: "life" };

/** The path and the text of the entry made of an item; null for one with no usable title. */
export function entryOf(item: LoreItem): { path: string; text: string } | null {
  const title = cleanTitle(item.title);
  if (title === "") return null;
  return {
    path: `${GROUP_FOLDERS[item.group]}/${title}.md`,
    text: `---\ntype: ${TYPES[item.group]}\n---\n# ${title}\n\n${item.text.trim()}\n`,
  };
}

/**
 * The World brief: the numbers and the choices the world was built from, and what the author
 * said he knows, as one entry. Written by the wizard, not by the AI.
 */
export function worldBrief(
  title: string,
  world: World,
  system: SystemSettings,
  lore: LoreState,
): string {
  const kept = lore.items.filter((i) => i.on && cleanTitle(i.title) !== "");
  const list = (group: LoreGroup) =>
    kept.filter((i) => i.group === group).map((i) => `- [[${cleanTitle(i.title)}]]`);
  const lines = [
    `# ${title}: world brief`,
    "",
    `What ${title} was built from in the World Wizard. Change it as the world changes: it is the short account of the world for anyone, or any AI, beginning to write in it.`,
    "",
    "## The world",
    "",
    ...worldFacts(world, system).map((f) => `- ${f}`),
    `- Built from seed ${world.s.seed}.`,
    "",
    "## The setting",
    "",
    `- Magic: ${lore.magic.toLowerCase()}.`,
    `- The present age: ${lore.age.toLowerCase()}.`,
  ];
  if (lore.know.trim() !== "") lines.push("", "## What is already known", "", lore.know.trim());
  for (const group of ["place", "species", "life"] as const) {
    const rows = list(group);
    if (rows.length) lines.push("", `## ${GROUP_NAMES[group]}`, "", ...rows);
  }
  lines.push("");
  return lines.join("\n");
}

/** A ring of points round a place on the globe, `radius` degrees out: a species' homeland. */
export function ringAround(cell: number, radius: number, points = 24): [number, number][] {
  const r = Math.PI / 180;
  const [lat, lon] = cellDegrees(cell);
  const d = radius * r;
  const ring: [number, number][] = [];
  for (let n = 0; n < points; n++) {
    const bearing = (2 * Math.PI * n) / points;
    const la = Math.asin(
      Math.sin(lat * r) * Math.cos(d) + Math.cos(lat * r) * Math.sin(d) * Math.cos(bearing),
    );
    const lo =
      lon * r +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat * r),
        Math.cos(d) - Math.sin(lat * r) * Math.sin(la),
      );
    const deg = ((((lo / r + 180) % 360) + 360) % 360) - 180;
    ring.push([
      Math.round(deg * 100) / 100,
      Math.round(Math.max(-89, Math.min(89, la / r)) * 100) / 100,
    ]);
  }
  return ring;
}
