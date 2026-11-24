/** The messages between the map page and the Find areas worker. */
import type { Position } from "@frontier/geo";
import type { ImageFrame } from "./frame.ts";
import type { FoundPiece } from "./outline.ts";
import type { AreaOptions } from "./segment.ts";

export type Request =
  /** Looks at a picture once: decodes it, makes the working copy, finds its ink. */
  | { type: "open"; url: string; round: boolean }
  /** Cuts the picture into areas with these options. */
  | { type: "areas"; url: string; options: AreaOptions }
  /** The outline of one area, to light it under the pointer. */
  | { type: "area"; url: string; area: number; frame: ImageFrame }
  /** The outline of the chosen areas, snapped, as a zone would be made of it. */
  | {
      type: "outline";
      url: string;
      areas: number[];
      frame: ImageFrame;
      eps: number;
      targets: Position[][];
      /** Add to: the zone whose outline the areas are added to. */
      addTo: Position[] | null;
    };

export interface Opened {
  /** The working copy's size: the clicks are kept in its pixels. */
  w: number;
  h: number;
  /** Full-size pixels per pixel of the working copy. */
  scale: number;
}

export interface FoundAreas {
  w: number;
  h: number;
  count: number;
  /** The area of each pixel of the working copy, or `INK` (-2). */
  labels: Int32Array;
}

export interface AreaRings {
  rings: { points: Position[]; role: "outer" | "hole" }[];
}

export interface Outlined {
  pieces: FoundPiece[];
}

export type Reply = { id: number } & ({ ok: true; value: unknown } | { ok: false; error: string });
