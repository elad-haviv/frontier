/**
 * What biome zones do to Find paths, kept apart from the cost and water code, which only call
 * in here: which biome each cell lies in (the smallest zone that holds it), how much a biome
 * multiplies each way of travelling's speed on open ground, and what it does to water (a desert
 * takes it, a jungle gives it, a marsh ends a river). See docs/designs/stage-21-biome-zones.md.
 */
import type { BiomeSpeeds, RiverRule } from "@frontier/schema";
import type { Px } from "../findAreas/contour.ts";
import type { Mode } from "./cost.ts";
import type { Grid } from "./grid.ts";
import { travelTime } from "./travel.ts";

/** A biome zone as the engine is told of it: its ring in the picture's pixels, and what it does. */
export interface TerrainBiome {
  /** The zone's id. */
  id: string;
  /** The biome's id: zones of one biome are one row of the route's tally. */
  biome: string;
  /** The biome's name, as "Desert (sand)". */
  name: string;
  /** The zone's own name, if it has one, as "Tharn Desert". */
  label: string | null;
  ring: Px[];
  speed: BiomeSpeeds;
  rivers: RiverRule;
}

/** Which biome each cell is in. */
export interface BiomeCells {
  /** The index + 1 in `list` of the biome zone that holds each cell; 0 for none. */
  at: Uint16Array;
  list: TerrainBiome[];
}

function ringArea(ring: readonly Px[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  }
  return Math.abs(a) / 2;
}

/** Fills a ring's cells (those whose middle is inside it) with `value`, row by row. */
function fill(into: Uint16Array, g: Grid, ring: readonly Px[], value: number): void {
  if (ring.length < 3) return;
  const xs: number[] = [];
  for (let gy = 0; gy < g.h; gy++) {
    const py = (gy + 0.5) * g.cell - 0.5;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!;
      const [bx, by] = ring[i]!;
      if (ay > py !== by > py) xs.push(ax + ((py - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k]! + 0.5) / g.cell - 0.5));
      const to = Math.min(g.w - 1, Math.floor((xs[k + 1]! + 0.5) / g.cell - 0.5));
      for (let gx = from; gx <= to; gx++) into[gy * g.w + gx] = value;
    }
  }
}

/**
 * The biome of each cell. Larger zones are laid down first and smaller ones over them, so where
 * zones overlap the smallest that holds a cell wins: an oasis in a desert, a marsh in a forest.
 */
export function biomeCells(g: Grid, biomes: readonly TerrainBiome[]): BiomeCells | undefined {
  if (biomes.length === 0) return undefined;
  const list = [...biomes].sort((a, b) => ringArea(b.ring) - ringArea(a.ring));
  const at = new Uint16Array(g.w * g.h);
  list.forEach((b, k) => fill(at, g, b.ring, k + 1));
  return { at, list };
}

/**
 * What a cell's biome multiplies a way of travelling's open-ground speed by, or -1 when the
 * cell lies in no biome (the picture's forest and marsh then speak). 0 is "no way". A ship on
 * land goes on foot.
 */
export function biomeFactor(cells: BiomeCells | undefined, mode: Mode, cell: number): number {
  const k = cells?.at[cell] ?? 0;
  if (!k) return -1;
  return cells!.list[k - 1]!.speed[mode === "ship" ? "foot" : mode];
}

/** The biome zone of a cell, or null. */
export function biomeOf(cells: BiomeCells | undefined, cell: number): TerrainBiome | null {
  const k = cells?.at[cell] ?? 0;
  return k ? cells!.list[k - 1]! : null;
}

/** The water a cell of a dry biome gives, and of a wet one, against 1 elsewhere. */
export const DRY_RUNOFF = 0.2;
export const WET_RUNOFF = 2;
/** The water a river loses for each km it crosses of a dry biome, in cells' worth of runoff. */
export const DRY_LOSS_PER_KM = 4;
/** A river in a dry biome carrying less than this many cells' worth of water has dried out. */
export const DRIED = 3;

/** What biomes do to the water that gathers: what each cell gives, and what it takes away. */
export interface WaterWeights {
  /** The water each land cell gives, 1 on ordinary ground. */
  runoff: Float32Array;
  /** The water taken from what runs through each cell, in cells' worth; 0 on ordinary ground. */
  loss: Float32Array;
}

/** The weights of the water, or undefined when no biome changes it. */
export function waterWeights(
  cells: BiomeCells | undefined,
  kmPerCell: number,
): WaterWeights | undefined {
  if (!cells || !cells.list.some((b) => b.rivers === "dry" || b.rivers === "source")) {
    return undefined;
  }
  const n = cells.at.length;
  const runoff = new Float32Array(n).fill(1);
  const loss = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rule = biomeOf(cells, i)?.rivers;
    if (rule === "dry") {
      runoff[i] = DRY_RUNOFF;
      loss[i] = DRY_LOSS_PER_KM * kmPerCell;
    } else if (rule === "source") runoff[i] = WET_RUNOFF;
  }
  return { runoff, loss };
}

/**
 * Where a river's course stops in a biome, on its step from one cell to the next: on entering a
 * marsh (it spreads into it, an inland delta; a river that rises in the marsh runs on through
 * it), or in a dry biome once it carries too little to go on. Null: it runs on.
 */
export function biomeEnd(
  cells: BiomeCells | undefined,
  acc: Float32Array,
  from: number,
  to: number,
): "dry" | "marsh" | null {
  const b = biomeOf(cells, to);
  if (!b) return null;
  if (b.rivers === "marsh" && biomeOf(cells, from) !== b) return "marsh";
  if (b.rivers === "dry" && acc[to]! < DRIED) return "dry";
  return null;
}

/** A biome zone's name for the bar: its own ("the Tharn Desert"), else its biome's. */
export function biomePlace(b: TerrainBiome): string {
  return b.label ? `the ${b.label.replace(/^the\s+/i, "")}` : `the ${b.name.toLowerCase()}`;
}

/** The km of a route's cells in each biome, in the order first met. */
export function kmByBiome(
  cells: BiomeCells | undefined,
  route: readonly number[],
  stepKm: (a: number, b: number) => number,
): { biome: string; name: string; km: number; speed: BiomeSpeeds }[] {
  if (!cells) return [];
  const out = new Map<string, { biome: string; name: string; km: number; speed: BiomeSpeeds }>();
  for (let i = 1; i < route.length; i++) {
    const b = biomeOf(cells, route[i]!);
    if (!b) continue;
    const row = out.get(b.biome) ?? { biome: b.biome, name: b.name, km: 0, speed: b.speed };
    row.km += stepKm(route[i - 1]!, route[i]!);
    out.set(b.biome, row);
  }
  return [...out.values()];
}

/** What biome zones did to a journey, as the Route bar says it: "+6½ days from biomes". */
export function biomeDelta(hours: number): string {
  if (Math.abs(hours) < 0.5) return "biomes change little";
  return `${hours > 0 ? "+" : "−"}${travelTime(Math.abs(hours))} from biomes`;
}
