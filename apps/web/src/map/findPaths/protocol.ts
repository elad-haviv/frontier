/**
 * What the map page asks of Find paths' engine, and what comes back. The engine runs in Find
 * areas' worker, on the same looked-at picture. Every point is in the pixels of the picture's
 * working copy (pixel (x, y) has its middle at (x, y)); the page turns them into map positions.
 */
import type { CountsAs } from "@frontier/schema";
import type { Px } from "../findAreas/contour.ts";
import type { BiomeSpeeds } from "@frontier/schema";
import type { TerrainBiome } from "./biomes.ts";
import type { Mode, Variant } from "./cost.ts";
import type { SuggestRequest } from "./suggest.ts";
import type { TraceKind } from "./trace.ts";

/** A feature of the map that counts as terrain, by its style: its line as drawn, in pixels. */
export interface TerrainFeature {
  id: string;
  counts: CountsAs;
  /** A path's line; a zone's ring (closed without its first point repeated). */
  line: Px[];
}

/** The map's height picture, for the worker to read, with the terrain's settings. */
export interface HeightSource {
  url: string;
  /** Where it lies on the map: as an image's extent. */
  extent: [number, number, number, number];
  /** Black is high. */
  invert: boolean;
  /** 0 to 4. */
  smoothing: number;
  /** Null: matched to the picture's coast. */
  seaLevel: number | null;
  /** The metres between the lowest grey and the highest, or null when heights are relative. */
  metres: number | null;
}

export interface OpenPaths {
  /** The picture, already opened for Find areas; null when the map has only heights. */
  url: string | null;
  /** The picture's extent on the map (the heights' own, when there is no picture). */
  extent: [number, number, number, number];
  heights: HeightSource | null;
}

export interface OpenedPaths {
  /** The working copy's size, in which every point is given. */
  w: number;
  h: number;
  /** The cell grid: its size, and pixels a side of a cell. */
  gw: number;
  gh: number;
  cell: number;
  hasPicture: boolean;
  hasHeights: boolean;
}

export interface TerrainRequest {
  /** Use the height picture; off, or when there is none: guess from the picture. */
  useHeights: boolean;
  /** Painted rivers pull water and block travellers; painted roads are quick. */
  follow: boolean;
  features: TerrainFeature[];
  /** The biome zones drawn now, each with what its biome does; left out: none. */
  biomes?: TerrainBiome[];
  /** Kilometres a pixel of the working copy; null when the map has no scale. */
  kmPerPx: number | null;
}

export interface TerrainInfo {
  /** Metres for a height of 1, when the heights say. */
  top: number | null;
  /** The terrain is guessed from the picture, not read from heights. */
  guessed: boolean;
  /** The sea level in use, 0 to 1, with heights. */
  seaLevel: number | null;
  /** Over a tenth of the land lay in hollows: rivers may wander. */
  rough: boolean;
  /** Any water at all: without it, "sea" never ends a river and a ship has nowhere to sail. */
  hasSea: boolean;
}

export interface RiverRequest {
  at: Px;
  from: "source" | "mouth";
  /** The first point stays exactly where it was clicked (not for a ghost taken). */
  exact: boolean;
  /** 0 (straight) to 8 (winding). */
  meander: number;
  /** How far, in pixels, the thinned line may stray from what was found. */
  eps: number;
  /** A tributary ends exactly on a river already on the map. */
  snap: boolean;
  /** How the river ends in a basin it reaches: "auto" for the rule's choice. */
  basin: BasinEnd | "auto";
}

/**
 * How a river that reaches a basin ends there: the lake fills and drains over its lowest rim
 * (the river carries on), the lake keeps the water (it ends at the shore), it spreads into a
 * marsh, it sinks underground, or it dries out.
 */
export type BasinEnd = "drains" | "keeps" | "marsh" | "sinks" | "dries";

export interface BasinFound {
  /** The basin filled to where it spills: the lake's (or the marsh's) outline, closed. */
  ring: Px[];
  /** Its area in km², when the map has a scale. */
  km2: number | null;
  /** How the river ends in it, as asked or as the rule chose. */
  end: BasinEnd;
  /** The rule's choice: a lake drains when the land draining into it is large beside it. */
  auto: "drains" | "keeps";
  /** A marsh's channels, fading out into it, each from where the river reaches it. */
  channels: Px[][];
}

export type RiverReply =
  | {
      ok: true;
      points: Px[];
      end: "sea" | "river" | "edge" | "basin" | "dry" | "marsh";
      /** The first basin large enough to be a lake that it reaches, and how it ends there. */
      basin: BasinFound | null;
      /** Where a biome ended it: "the Tharn Desert", "the wetland / marsh". */
      endIn: string | null;
      /** The id of the river it joins. */
      joined: string | null;
      /** The share of its course over filled hollows and flats, where the course is a guess. */
      flatShare: number;
      /** How far it falls, in metres, when the heights say. */
      fall: number | null;
    }
  | { ok: false; why: "sea" | "noLand" | "short" | "onRiver" };

export interface LikelyReply {
  /** Each likely river from its head down, for a ghost; its first point is the head. */
  rivers: Px[][];
}

export interface RouteRequest {
  stops: Px[];
  mode: Mode;
  variant: Variant;
  eps: number;
  /** The steepest grade the way may have, as a fraction. */
  steepest: number;
  /** Steps on stretches too steep for the limit, up to `STEPS_GRADE` and `stepsKm` long (on foot). */
  steps: boolean;
  /** A tunnel through high ground where there is no way over, at most this many km long; null: none. */
  tunnelKm: number | null;
  /** The route sets out from anywhere along this line (a road it branches from), not its first stop. */
  startOn: Px[] | null;
  /** It arrives anywhere along this line, not at its last stop. */
  endOn: Px[] | null;
}

/** A stretch of a route between two of its points (indices into `points`). */
export interface RouteStretch {
  kind: "tunnel" | "steps" | "climb";
  from: number;
  to: number;
  /** A climb's steepest grade, above 0 when it rises from `from` to `to`. */
  grade?: number;
}

/** A stretch of a route along a road already there: a made one (its id) or one painted (null). */
export interface RouteAlong {
  from: number;
  to: number;
  road: string | null;
}

/** The heights along a route, for its profile. */
export interface Profile {
  /** Distances along the line as drawn, in pixels, and the heights there (as given or guessed). */
  d: number[];
  h: number[];
  /** The grade from each sample to the next, as a fraction. */
  grade: number[];
  /** The total of every climb, in the heights' unit. */
  climb: number;
  /** The highest height along it. */
  high: number;
  /** The steepest grade along it. */
  steepest: number;
}

export interface Mark {
  at: Px;
  kind: "ford" | "bridge" | "sail" | "land";
}

export type RouteReply =
  | {
      ok: true;
      points: Px[];
      /** Null when the map has no scale to time it by. */
      hours: number | null;
      marks: Mark[];
      fords: number;
      bridges: number;
      /** The share of its length that is by sea. */
      seaShare: number;
      /** The same way as the fastest, for the owner's purposes. */
      same: boolean;
      stretches: RouteStretch[];
      along: RouteAlong[];
      profile: Profile;
      /** The hours the journey would take without the biome zones; null without biomes or hours. */
      withoutBiomes: number | null;
      /** The km of the route in each biome, in the order first met. */
      byBiome: { biome: string; name: string; km: number; speed: BiomeSpeeds }[];
    }
  /** No way: water is in the way, or the ground is too steep (its steepest step, and where). */
  | { ok: false; why: "water" }
  | { ok: false; why: "steep"; at: Px; grade: number };

export interface TraceRequest {
  at: Px;
  /** A second click on the same line: the stretch between the two. */
  end: Px | null;
  eps: number;
  /** The main line will be drawn curved: branches end on the curve. */
  curved: boolean;
  /** Look for side branches too (not while only pointing). */
  branches: boolean;
}

export type TraceReply =
  | { ok: true; points: Px[]; branches: Px[][]; loop: boolean; kind: TraceKind }
  | { ok: false; why: "none" | "short" | "other" };

export interface ReliefReply {
  w: number;
  h: number;
  /** One RGBA pixel a cell. */
  rgba: Uint8ClampedArray;
}

/** What the Terrain dialog measures a height picture against, on a small grid of cells. */
export interface TerrainLook {
  /** The preview grid. */
  gw: number;
  gh: number;
  /** The picture's water on it; null when the map has no picture. */
  water: Uint8Array | null;
  /** The heights Find paths guesses from the picture alone, on the same grid. */
  guess: Float32Array | null;
  /** The height picture's greys, 0 to 1, at a small size; null when none was asked for. */
  heights: { w: number; h: number; data: Float32Array } | null;
}

export type PathsRequest =
  /** The Terrain dialog: the picture's water and a height picture's greys, to measure and draw. */
  | { type: "paths.look"; url: string | null; heights: string | null }
  /** The map's relief: a height picture as light and shade, one pixel a cell. */
  | {
      type: "paths.shade";
      url: string;
      invert: boolean;
      smoothing: number;
      seaLevel: number | null;
    }
  | ({ type: "paths.open" } & OpenPaths)
  | ({ type: "paths.terrain" } & TerrainRequest)
  | ({ type: "paths.river" } & RiverRequest)
  | { type: "paths.likely"; above: number }
  | ({ type: "paths.route" } & RouteRequest)
  | ({ type: "paths.trace" } & TraceRequest)
  | { type: "paths.relief" }
  /** Suggest biomes: the climate of the terrain in use, as ghost zones. */
  | ({ type: "paths.suggest" } & SuggestRequest)
  /** Leaving the tool: the heights, the flow and the cost surfaces are let go. */
  | { type: "paths.close" };
