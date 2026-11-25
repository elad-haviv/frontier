/**
 * Terrain hints as the worker sees them: in the pixels of the picture's working copy, like every
 * point the map tools pass about. The page turns them into map positions and back (protocol.ts).
 * See docs/designs/stage-21-infer-height-map.md.
 */
import type { TerrainHintKind } from "@frontier/schema";
import type { Px } from "../findAreas/contour.ts";

export interface PxHint {
  id: string;
  kind: TerrainHintKind;
  at?: Px;
  points?: Px[];
  h?: number;
  h2?: number;
  strength?: number;
  flip?: boolean;
}

/** A hint the picture suggests, before it has an id. */
export interface FoundHint extends Omit<PxHint, "id"> {
  /** How sure the finding is, 0 to 1. */
  conf: number;
  /** Why, in one sentence, shown when it is selected. */
  why: string;
}

export interface Found {
  hints: FoundHint[];
  /** What was looked at and is not used, in words: "Forests say nothing about height". */
  notUsed: string[];
  /** How long it took, in milliseconds. */
  ms: number;
}

export interface BuildSettings {
  /** Which natural detail: the same hints give another variation with another seed. */
  seed: number;
  /** 0 to 1. */
  rough: number;
  sharp: number;
  erosion: number;
  /** 1 draft, 2 normal, 3 fine. */
  detail: 1 | 2 | 3;
  /** Every river is cut a valley that only runs downhill to its mouth. */
  carve: boolean;
  /** Lakes stay hollows with flat water. */
  lakes: boolean;
}

export const DEFAULT_SETTINGS: BuildSettings = {
  seed: 1,
  rough: 0.5,
  sharp: 0.55,
  erosion: 0.45,
  detail: 2,
  carve: true,
  lakes: true,
};

export interface BuildChecks {
  /** Rivers whose water, put at the source, runs down along them to the sea or a lake. */
  drain: number;
  rivers: number;
  /** The ids of the rivers that do not. */
  badRivers: string[];
  /** The built coast against the painted one, 0 to 1; null without sea. */
  coast: number | null;
  peaks: number;
  peaksAsked: number;
  lakes: number;
  lakesHeld: number;
  ms: number;
}

export interface Built {
  /** The working grid. */
  w: number;
  h: number;
  /** Pixels of the working copy a side of a cell. */
  cell: number;
  /** Heights: below 0 is sea, the highest land about 1. */
  heights: Float32Array;
  sea: Uint8Array;
  checks: BuildChecks;
}
