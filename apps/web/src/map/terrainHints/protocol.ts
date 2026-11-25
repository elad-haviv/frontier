/**
 * What the Terrain dialog asks of Find areas' worker about terrain hints, and what comes back.
 * Points are in the pixels of the picture's working copy, as for Find paths.
 */
import type { BuildChecks, BuildSettings, FoundHint, PxHint } from "./types.ts";

export interface HintsFound {
  /** The working copy's size, which every point is given in. */
  w: number;
  h: number;
  hints: FoundHint[];
  notUsed: string[];
  ms: number;
}

export interface HintsBuilt {
  /** The working copy's size. */
  pw: number;
  ph: number;
  /** The working grid. */
  w: number;
  h: number;
  heights: Float32Array;
  sea: Uint8Array;
  /** The picture's water on the same grid, for the preview's coast. */
  water: Uint8Array;
  checks: BuildChecks;
}

export interface HintsImage {
  /** A 16-bit grey PNG, white is high. */
  png: Uint8Array;
  w: number;
  h: number;
  /** The grey of sea level, 0 to 1. */
  seaLevel: number;
  /** The heights of black and white, in the builder's units (the highest hint is about 1). */
  low: number;
  high: number;
}

export type HintsRequest =
  /** Looks at the picture for hints. */
  | { type: "hints.find"; url: string; kmPerPx: number | null }
  /** Builds heights from the hints in use. */
  | { type: "hints.build"; url: string; hints: PxHint[]; settings: BuildSettings }
  /** Builds them and makes the image to save, `width` pixels wide. */
  | {
      type: "hints.image";
      url: string;
      hints: PxHint[];
      settings: BuildSettings;
      width: number;
    };
