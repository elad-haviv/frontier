/**
 * Where a half-built world waits (stage 34): on this device, one for each project, so leaving the
 * wizard loses nothing. It is a working file of the wizard, not part of the library: nothing of
 * it reaches the project until the wizard makes the map. A database of its own, so the save
 * queue's database needs no new version for it. Where the browser has no IndexedDB (some private
 * windows) nothing is kept, and the wizard starts fresh.
 */
import { openDB } from "idb";
import {
  DEFAULT_SETTINGS,
  type Drift,
  N,
  newWorld,
  type Stage,
  STAGES,
  type World,
  type WorldSettings,
} from "./model.ts";
import type { LoreState } from "./lore.ts";
import type { SystemSettings } from "./system.ts";

const DB = "frontier-world";
const STORE = "worlds";

/** The parts of the world step, in order, then the last step. */
export const PARTS = [
  "system",
  "basics",
  "land",
  "plates",
  "heights",
  "climate",
  "biomes",
  "lore",
  "make",
] as const;
export type Part = (typeof PARTS)[number];

/** A world in progress, as kept. */
export interface KeptWorld {
  v: 1;
  title: string;
  part: Part;
  savedAt: string;
  /** The map made from it, once one was: the wizard is then no longer waiting to be finished. */
  made?: string;
  /** The star system; a world kept before there was one has the usual system. */
  system?: SystemSettings;
  /** The life and lore: the choices and what was suggested. */
  lore?: LoreState;
  settings: WorldSettings;
  drift: Drift[];
  my: number;
  ok: Record<Stage, boolean>;
  land: Uint8Array;
  plate: Uint8Array;
  crust: Uint8Array;
  painted: Uint8Array;
  h: Float32Array;
  carry: Float32Array;
}

/** What is kept of a world. Heights, climate and biomes are built again from it. */
export function keep(
  world: World,
  title: string,
  part: Part,
  more: { made?: string | undefined; system?: SystemSettings; lore?: LoreState } = {},
): KeptWorld {
  return {
    v: 1,
    title,
    part,
    ...(more.made ? { made: more.made } : {}),
    ...(more.system ? { system: more.system } : {}),
    ...(more.lore ? { lore: more.lore } : {}),
    savedAt: new Date().toISOString(),
    settings: { ...world.s },
    drift: world.drift.map((d) => ({ ...d })),
    my: world.my,
    ok: { ...world.ok, height: false, climate: false, biome: false },
    land: world.land.slice(),
    plate: world.plate.slice(),
    crust: world.crust.slice(),
    painted: world.painted.slice(),
    h: world.h.slice(),
    carry: world.carry.slice(),
  };
}

/** The world a kept one was; null when what was kept is not a world this build can read. */
export function restore(kept: KeptWorld): World | null {
  if (kept.v !== 1) return null;
  const sized = [kept.land, kept.plate, kept.crust, kept.painted, kept.h].every(
    (a) => a?.length === N,
  );
  if (!sized || kept.carry?.length !== kept.drift.length * 2) return null;
  const world = newWorld({ ...DEFAULT_SETTINGS, ...kept.settings });
  world.land.set(kept.land);
  world.plate.set(kept.plate);
  world.crust.set(kept.crust);
  world.painted.set(kept.painted);
  world.h.set(kept.h);
  world.carry = kept.carry.slice();
  world.drift = kept.drift.map((d) => ({ ...d }));
  world.my = kept.my;
  for (const stage of STAGES) world.ok[stage] = kept.ok[stage] === true;
  world.ok.height = world.ok.climate = world.ok.biome = false;
  return world;
}

const open = () =>
  openDB(DB, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });

/** The world in progress of a project, by the project's id; null when there is none. */
export async function loadWorld(project: string): Promise<KeptWorld | null> {
  try {
    const db = await open();
    const kept = (await db.get(STORE, project)) as KeptWorld | undefined;
    db.close();
    return kept ?? null;
  } catch {
    return null;
  }
}

export async function saveWorld(project: string, kept: KeptWorld): Promise<void> {
  try {
    const db = await open();
    await db.put(STORE, kept, project);
    db.close();
  } catch {
    // Nothing is kept on a device that cannot keep it; the wizard still works.
  }
}

export async function forgetWorld(project: string): Promise<void> {
  try {
    const db = await open();
    await db.delete(STORE, project);
    db.close();
  } catch {
    // As above.
  }
}

export const PART_NAMES: Record<Part, string> = {
  system: "Star system",
  basics: "Basics",
  land: "Land and sea",
  plates: "Plates",
  heights: "Heights",
  climate: "Climate",
  biomes: "Biomes",
  lore: "Life and lore",
  make: "Make it",
};
