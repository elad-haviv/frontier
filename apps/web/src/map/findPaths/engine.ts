/**
 * Find paths' engine: one looked-at picture (and perhaps a height field), the terrain in use made
 * of them and of the map's own features, and the three things asked of it: a river's course, a
 * route, a traced line. No DOM here, so it runs in the worker and under the unit tests alike.
 */
import { outline, type Space } from "@frontier/geo";
import type { Px } from "../findAreas/contour.ts";
import type { Ink } from "../findAreas/ink.ts";
import type { LabPicture } from "../findAreas/lab.ts";
import { biomeCells, biomeEnd, biomeOf, biomePlace, kmByBiome, waterWeights } from "./biomes.ts";
import { lookAtGround, type PictureGround } from "./classes.ts";
import { type Ground, type Mode, type Surface, surfaceFor, type Variant } from "./cost.ts";
import {
  cellPx,
  drawLine,
  fillRing,
  flatGrid,
  type Grid,
  gridFor,
  pxCell,
  thicken,
} from "./grid.ts";
import { traceMask } from "../findAreas/contour.ts";
import { simplifyRing, smoothRing } from "../findAreas/simplify.ts";
import {
  type Basin,
  basinOn,
  type Course,
  courseFrom,
  type Flow,
  flow,
  likelyRivers,
  upstream,
} from "./hydro.ts";
import {
  lineLength,
  meander,
  nearestOn,
  resample,
  simplifyOpen,
  simplifyWithin,
  smoothBranch,
  smoothOpen,
  smoothWithin,
} from "./lines.ts";
import type {
  BasinEnd,
  BasinFound,
  LikelyReply,
  Mark,
  ReliefReply,
  RiverReply,
  RiverRequest,
  RouteReply,
  RouteRequest,
  RouteAlong,
  RouteStretch,
  Profile,
  TerrainFeature,
  TerrainInfo,
  TerrainRequest,
  TraceReply,
  TraceRequest,
} from "./protocol.ts";
import {
  CLIFF,
  type Found,
  type Limits,
  marksAlong,
  type Place,
  routeThrough,
  sameWay,
  STEPS,
  stepCells,
  steepestStep,
  type Terrain,
  TUNNEL,
} from "./route.ts";
import { matchSeaLevel, reliefPicture } from "./terrain.ts";
import { Tracer } from "./trace.ts";

/** A river shorter than this many cells is not one. */
const SHORTEST_RIVER = 5;
/** How far, in cells, a click in the sea looks for the coast a river comes out at. */
const MOUTH_REACH = 8;

/** Steps: as steep as this at most (80%), for about this many km in a row, this many times slower. */
export const STEPS_GRADE = 0.8;
export const STEPS_KM = 0.3;
const STEPS_SLOWER = 3;
/** What a km of tunnel costs the search, in hours: far more than any way over the top. */
const TUNNEL_COST = 20;
/** And how quick it is to go through once it is there: as on a road. */
const TUNNEL_SPEED = 4;
/** A stretch steeper than this is a climb, drawn with chevrons: › to 20%, ›› above. */
export const CLIMB = 0.12;
/** A lake drains over its rim when the land draining into it is this many times its own size. */
export const DRAINS_AT = 20;
/** A run along a road shorter than this many cells is a crossing, not a way along it. */
const ALONG_LEAST = 8;

/** The terrain in use: what the heights, the picture and the map's features come to. */
interface InUse {
  guessed: boolean;
  seaLevel: number | null;
  /** The heights as given or guessed. */
  heights: Float32Array;
  sea: Uint8Array;
  ground: Ground;
  /** The number (index + 1 in `rivers`) of the made river on or right beside each cell; 0 for none. */
  riverOn: Int32Array;
  /** The same, a few cells wider: where a likely river is not offered. */
  riverNear: Int32Array;
  rivers: TerrainFeature[];
  /** The road (index + 1 in `roads`, -1 for one painted in the picture) on or beside each cell. */
  roadOn: Int32Array;
  roads: TerrainFeature[];
  /** The land's lowest height and its range, for the sizes of hollows. */
  lo: number;
  range: number;
  flow: Flow;
  /** What routes are searched on: the sea is flat at its level. */
  terrain: Terrain;
  /** Null when the map has no scale: lengths are in pixels and there are no hours. */
  kmPerPx: number | null;
  /** Metres for a height of 1, when the heights say. */
  top: number | null;
  surfaces: Map<string, Surface>;
  fastest: Map<string, Found>;
}

export class Engine {
  readonly grid: Grid;
  /** The size of the working copy every point is given in. */
  readonly w: number;
  readonly h: number;
  private ground: PictureGround | null = null;
  private tracer: Tracer | null = null;
  private heights: Float32Array | null = null;
  private heightInfo: { seaLevel: number | null; top: number | null } = {
    seaLevel: null,
    top: null,
  };
  private t: InUse | null = null;
  /** Moves a traced line onto the ink of the full-size picture, where there is a larger one. */
  refine: ((line: Px[]) => Px[]) | null = null;

  /**
   * With a picture: its ground and ink are looked at. Without one (a map with only heights), the
   * grid is `size`, one cell a pixel.
   */
  constructor(
    pic: LabPicture | null,
    ink: Ink | null,
    size: { w: number; h: number } = { w: 1, h: 1 },
    most?: number,
  ) {
    if (pic && ink) {
      const { looked, ground } = lookAtGround(pic, ink, most);
      this.ground = ground;
      this.grid = ground.grid;
      this.w = pic.w;
      this.h = pic.h;
      this.tracer = new Tracer({ ...pic, ink: looked.ink, ref: looked.ref });
    } else {
      this.grid = most ? gridFor(size.w, size.h, most) : flatGrid(size.w, size.h, 1);
      this.w = size.w;
      this.h = size.h;
    }
  }

  get hasPicture(): boolean {
    return this.ground !== null;
  }
  get hasHeights(): boolean {
    return this.heights !== null;
  }
  /** What the picture alone says of the ground; for the tests. */
  get pictureGround(): PictureGround | null {
    return this.ground;
  }

  /** Gives the engine its height field: one height (0 to 1) a cell of `grid`. */
  setHeights(
    heights: Float32Array | null,
    info: { seaLevel: number | null; top: number | null } = { seaLevel: null, top: null },
  ): void {
    this.heights = heights;
    this.heightInfo = info;
    this.t = null;
  }

  /** Lets go of what was worked out, on leaving the tool. */
  close(): void {
    this.t = null;
  }

  // ---- The terrain in use ---------------------------------------------------------------------

  setTerrain(req: TerrainRequest): TerrainInfo {
    const { grid, ground: pic } = this;
    const n = grid.w * grid.h;
    const useHeights = req.useHeights && this.heights !== null;
    const empty = () => new Uint8Array(n);
    let heights: Float32Array;
    let sea: Uint8Array;
    let seaLevel: number | null = null;
    if (useHeights) {
      heights = this.heights!;
      seaLevel = this.heightInfo.seaLevel ?? matchSeaLevel(heights, pic ? pic.water : null);
      sea = empty();
      for (let i = 0; i < n; i++) sea[i] = heights[i]! < seaLevel ? 1 : 0;
    } else if (pic) {
      heights = pic.guess;
      sea = Uint8Array.from(pic.water);
    } else {
      heights = new Float32Array(n);
      sea = empty();
    }

    // The map's own features, by what their styles count as. They outrank the picture's guess.
    const forest = pic ? Uint8Array.from(pic.forest) : empty();
    const marsh = empty();
    const upland = new Float32Array(n);
    // With heights the slopes say where the mountains are; a guess needs the painted high ground.
    if (!useHeights && pic) upland.set(pic.upland);
    const river = req.follow && pic ? Uint8Array.from(pic.river) : empty();
    const road = req.follow && pic ? Uint8Array.from(pic.road) : empty();
    const riverOn = new Int32Array(n);
    const rivers: TerrainFeature[] = [];
    const roadMade = new Int32Array(n);
    const roads: TerrainFeature[] = [];
    const mountains = empty();
    for (const f of req.features) {
      if (f.counts === "river") {
        rivers.push(f);
        drawLine(riverOn, grid, f.line, rivers.length);
        drawLine(river, grid, f.line, 1);
      } else if (f.counts === "road") {
        roads.push(f);
        drawLine(roadMade, grid, f.line, roads.length);
        drawLine(road, grid, f.line, 1);
      } else if (f.counts === "water") fillRing(sea, grid, f.line, 1);
      else if (f.counts === "forest") fillRing(forest, grid, f.line, 1);
      else if (f.counts === "marsh") fillRing(marsh, grid, f.line, 1);
      else fillRing(mountains, grid, f.line, 1);
    }
    for (let i = 0; i < n; i++) {
      if (mountains[i]) upland[i] = 1;
      if (sea[i]) river[i] = 0;
    }
    const riverWide = thicken(river, grid);
    for (let i = 0; i < n; i++) if (sea[i]) riverWide[i] = 0;
    // A made river is met a cell early: water running beside it has reached it. Likely rivers
    // keep a little further off, so no ghost runs along a river that is already there.
    const beside = (ids: Int32Array) => {
      const out = Int32Array.from(ids);
      for (let i = 0; i < n; i++) {
        if (!ids[i]) continue;
        const x = i % grid.w;
        const y = (i / grid.w) | 0;
        if (x > 0 && !out[i - 1]) out[i - 1] = ids[i]!;
        if (x < grid.w - 1 && !out[i + 1]) out[i + 1] = ids[i]!;
        if (y > 0 && !out[i - grid.w]) out[i - grid.w] = ids[i]!;
        if (y < grid.h - 1 && !out[i + grid.w]) out[i + grid.w] = ids[i]!;
      }
      return out;
    };
    const riverBy = beside(riverOn);
    const riverNear = beside(beside(riverBy));
    // Which road a cell is on, for a route along one: a made road by its number, a painted one -1.
    const roadOn = beside(roadMade);
    if (req.follow && pic)
      for (let i = 0; i < n; i++) if (pic.road[i] && !roadOn[i]) roadOn[i] = -1;

    // Water is drawn into rivers already there (stream burning): a new river that reaches one
    // follows it, and a painted river that the heights disagree with still wins.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (sea[i]) continue;
      lo = Math.min(lo, heights[i]!);
      hi = Math.max(hi, heights[i]!);
    }
    const range = hi > lo ? hi - lo : 1;
    // Biome zones: their speeds, and what they do to the water (a desert takes it, a jungle gives).
    const biomes = biomeCells(grid, req.biomes ?? []);
    const burned = Float32Array.from(heights);
    const level = Float32Array.from(heights);
    const floor = seaLevel ?? Math.min(0, lo);
    for (let i = 0; i < n; i++) {
      if (sea[i]) level[i] = floor;
      else if (river[i]) burned[i] = burned[i]! - 0.04 * range;
    }
    const f = flow(
      grid,
      burned,
      sea,
      waterWeights(biomes, req.kmPerPx === null ? 1 : req.kmPerPx * grid.cell),
    );

    const top = useHeights ? this.heightInfo.top : null;
    const kmPerCell = req.kmPerPx === null ? null : req.kmPerPx * grid.cell;
    // With a scale and real heights, a slope is a true one. With heights that are only relative,
    // the steepest ground on the map is taken to be a mountain pass (about a 30% slope) and the
    // rest is scaled from it. A guess is gentler still: its whole range rises over a tenth of the
    // map's width, so the plain it guesses between the sea and the hills is all but level.
    let rise: number;
    if (top !== null && kmPerCell !== null) rise = top / (kmPerCell * 1000);
    else if (!useHeights) rise = 0.03 * Math.max(grid.w, grid.h);
    else {
      const steep: number[] = [];
      const stride = Math.max(1, Math.floor(n / 40_000));
      for (let i = grid.w + 1; i < n - grid.w - 1; i += stride) {
        if (sea[i] || sea[i + 1] || sea[i + grid.w]) continue;
        steep.push(Math.hypot(heights[i + 1]! - heights[i]!, heights[i + grid.w]! - heights[i]!));
      }
      steep.sort((x, y) => x - y);
      const pass = steep[Math.floor(steep.length * 0.99)] ?? 0;
      rise = pass > 0 ? 0.3 / pass : 0;
    }
    let anySea = false;
    for (let i = 0; i < n && !anySea; i++) anySea = sea[i] === 1;
    // Cliffs: crowded ink in the picture, and in the heights a drop all but straight down.
    const cliff = pic ? Uint8Array.from(pic.cliff) : empty();
    if (useHeights && rise > 0) {
      for (let i = 0; i < n; i++) {
        const x = i % grid.w;
        const y = (i / grid.w) | 0;
        const across = x < grid.w - 1 ? Math.abs(heights[i + 1]! - heights[i]!) : 0;
        const down = y < grid.h - 1 ? Math.abs(heights[i + grid.w]! - heights[i]!) : 0;
        if (Math.max(across, down) * rise > CLIFF) cliff[i] = 1;
      }
    }
    for (let i = 0; i < n; i++) if (sea[i] || road[i]) cliff[i] = 0;
    this.t = {
      guessed: !useHeights,
      seaLevel,
      heights,
      sea,
      ground: {
        sea,
        forest,
        marsh,
        upland,
        road,
        river,
        riverWide,
        cliff,
        ...(biomes ? { biomes } : {}),
      },
      riverOn: riverBy,
      riverNear,
      rivers,
      roadOn,
      roads,
      lo: Number.isFinite(lo) ? lo : 0,
      range,
      flow: f,
      terrain: { grid, heights: level, kmPerCell: kmPerCell ?? 1, rise },
      kmPerPx: req.kmPerPx,
      top,
      surfaces: new Map(),
      fastest: new Map(),
    };
    return {
      top,
      guessed: !useHeights,
      seaLevel,
      rough: useHeights && f.raisedShare > 0.1,
      hasSea: anySea,
    };
  }

  /**
   * The height field in use, as Suggest biomes reads it: whatever the terrain is (a height map,
   * the guess from the picture, or a height map inferred from it), the same as every tool's.
   */
  terrainNow(): {
    grid: Grid;
    heights: Float32Array;
    sea: Uint8Array;
    acc: Float32Array;
    kmPerCell: number | null;
    top: number | null;
    seaLevel: number | null;
    guessed: boolean;
  } {
    const t = this.inUse();
    return {
      grid: this.grid,
      heights: t.heights,
      sea: t.sea,
      acc: t.flow.acc,
      kmPerCell: t.kmPerPx === null ? null : t.kmPerPx * this.grid.cell,
      top: t.top,
      seaLevel: t.seaLevel,
      guessed: t.guessed,
    };
  }

  private inUse(): InUse {
    if (!this.t) throw new Error("The terrain has not been worked out yet.");
    return this.t;
  }

  private line(cells: readonly number[]): Px[] {
    return cells.map((c) => cellPx(this.grid, c));
  }

  // ---- Rivers ------------------------------------------------------------------------------------

  river(req: RiverRequest): RiverReply {
    const t = this.inUse();
    const { grid } = this;
    let start = pxCell(grid, req.at);
    let cells: number[];
    let course: Course;
    if (req.from === "mouth") {
      if (t.sea[start]) {
        // The coast nearest the click that carries the most water.
        const x = start % grid.w;
        const y = (start / grid.w) | 0;
        let best = -1;
        let most = 0;
        for (let dy = -MOUTH_REACH; dy <= MOUTH_REACH; dy++) {
          for (let dx = -MOUTH_REACH; dx <= MOUTH_REACH; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= grid.w || yy >= grid.h) continue;
            const v = yy * grid.w + xx;
            if (!t.sea[v] && t.flow.acc[v]! > most) {
              most = t.flow.acc[v]!;
              best = v;
            }
          }
        }
        if (best < 0) return { ok: false, why: "noLand" };
        start = best;
      }
      const up = upstream(grid, t.flow, start, SHORTEST_RIVER).reverse();
      course = courseFrom(t.flow, t.sea, start, null);
      cells = up.concat(course.cells.slice(1));
    } else {
      if (t.sea[start]) return { ok: false, why: "sea" };
      const biomes = t.ground.biomes;
      course = courseFrom(
        t.flow,
        t.sea,
        start,
        req.snap ? t.riverOn : null,
        biomes ? (a, b) => biomeEnd(biomes, t.flow.acc, a, b) : undefined,
      );
      cells = course.cells;
    }
    if (cells.length < SHORTEST_RIVER) {
      return { ok: false, why: course.end === "river" ? "onRiver" : "short" };
    }
    // A basin on the way that is large enough to be a lake: the river ends there as asked.
    let end: "sea" | "river" | "edge" | "basin" | "dry" | "marsh" = course.end;
    let basin: BasinFound | null = null;
    let joins = course.joined;
    if (req.from === "source") {
      const found = basinOn(
        grid,
        t.flow,
        t.heights,
        t.sea,
        cells,
        Math.max(25, Math.round(grid.w * grid.h * 0.0004)),
        t.range * 0.01,
      );
      if (found && found.inlet >= SHORTEST_RIVER - 1) {
        const made = this.basinEnd(found, cells, req);
        basin = made.basin;
        if (made.cells !== cells) {
          cells = made.cells;
          end = "basin";
          joins = 0;
        }
      }
    }
    const pts = this.line(cells);
    if (req.from === "source" && req.exact) pts[0] = [req.at[0], req.at[1]];
    const target = joins > 0 ? t.rivers[joins - 1]! : null;
    const last = pts.length - 1;
    if (target) pts[last] = nearestOn(pts[last]!, target.line).at;
    // Smoothed, stepped evenly, wound (more on flat ground), then thinned. The winding is worked
    // out in half cells, so it is the same size on the map whatever the picture's size.
    const unit = grid.cell / 2;
    const stepped = resample(smoothOpen(pts, 3), grid.cell).map((p): Px => [
      p[0] / unit,
      p[1] / unit,
    ]);
    const flatness = (p: Px) => {
      const c = pxCell(grid, [p[0] * unit, p[1] * unit]);
      const x = c % grid.w;
      const y = (c / grid.w) | 0;
      const e = t.heights;
      const gx = x > 0 && x < grid.w - 1 ? e[c + 1]! - e[c - 1]! : 0;
      const gy = y > 0 && y < grid.h - 1 ? e[c + grid.w]! - e[c - grid.w]! : 0;
      return 1 / (1 + (Math.hypot(gx, gy) * t.terrain.rise * 9) ** 2);
    };
    const wound = meander(stepped, req.meander, flatness).map((p): Px => [
      p[0] * unit,
      p[1] * unit,
    ]);
    wound[0] = pts[0]!;
    wound[wound.length - 1] = pts[last]!;
    const points = simplifyOpen(wound, req.eps);
    let onFlat = 0;
    for (const c of cells) if (t.flow.raised[c]) onFlat++;
    const fall =
      t.top !== null
        ? Math.max(
            0,
            t.heights[cells[0]!]! - Math.max(t.seaLevel ?? 0, t.heights[cells[cells.length - 1]!]!),
          ) * t.top
        : null;
    // A desert or a marsh zone ended it (unless a basin before that did).
    const endBiome =
      end === "dry" || end === "marsh" ? biomeOf(t.ground.biomes, cells[cells.length - 1]!) : null;
    return {
      ok: true,
      points,
      end,
      basin,
      endIn: endBiome ? biomePlace(endBiome) : null,
      joined: target?.id ?? null,
      flatShare: onFlat / cells.length,
      fall,
    };
  }

  /**
   * How a river ends in a basin, as asked or by the rule: the lake drains when the land that
   * drains into it is at least `DRAINS_AT` times the lake's own size (there is water enough to
   * fill it to its rim), and keeps the water otherwise. Gives the river's cells as they end there
   * (the same cells when it carries on), and the basin's outline and channels.
   */
  private basinEnd(
    b: Basin,
    course: number[],
    req: RiverRequest,
  ): { cells: number[]; basin: BasinFound } {
    const t = this.inUse();
    const { grid } = this;
    const inside = new Set(b.cells);
    const out = course[Math.min(course.length - 1, b.outlet)]!;
    const catchment = t.flow.acc[out]! - b.cells.length;
    const auto = catchment >= DRAINS_AT * b.cells.length ? "drains" : "keeps";
    const endAs: BasinEnd = req.basin === "auto" ? auto : req.basin;
    const shore = course.slice(0, b.inlet + 1);
    // Down from the shore to the hollow's lowest place, a cell at a time.
    const inward = (share: number) => {
      const from = cellPx(grid, course[b.inlet]!);
      const to = cellPx(grid, b.deepest);
      const steps = Math.max(
        1,
        Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / grid.cell),
      );
      const extra: number[] = [];
      for (let k = 1; k <= Math.round(steps * share); k++) {
        const c = pxCell(grid, [
          from[0] + ((to[0] - from[0]) * k) / steps,
          from[1] + ((to[1] - from[1]) * k) / steps,
        ]);
        if (c !== extra[extra.length - 1] && inside.has(c)) extra.push(c);
      }
      return shore.concat(extra);
    };
    const cells =
      endAs === "drains"
        ? course
        : endAs === "sinks"
          ? inward(1)
          : endAs === "dries"
            ? inward(0.5)
            : shore;
    // The basin filled to its spill: its outline, as a lake's or a marsh's.
    const mask = new Uint8Array(grid.w * grid.h);
    for (const c of b.cells) mask[c] = 1;
    const rings = traceMask({ ox: 0, oy: 0, w: grid.w, h: grid.h, data: mask }, 4).filter(
      (r) => r.role === "outer",
    );
    const ring = rings.reduce<(typeof rings)[number] | null>(
      (m, r) => (!m || r.area > m.area ? r : m),
      null,
    );
    const px = (ring?.points ?? []).map((p): Px => [
      (p[0] + 0.5) * grid.cell - 0.5,
      (p[1] + 0.5) * grid.cell - 0.5,
    ]);
    const outline = simplifyRing(smoothRing(smoothRing(px)), Math.max(req.eps, grid.cell * 0.7));
    const channels: Px[][] = [];
    if (endAs === "marsh") {
      // A few channels fanning out from where the river reaches the marsh, fading into it.
      const from = cellPx(grid, course[b.inlet]!);
      const to = cellPx(grid, b.deepest);
      const vx = to[0] - from[0];
      const vy = to[1] - from[1];
      const l = Math.hypot(vx, vy);
      if (l > grid.cell * 3) {
        for (const turn of [0, 0.45, -0.45]) {
          const c = Math.cos(turn);
          const sn = Math.sin(turn);
          const reach = turn ? 0.75 : 0.9;
          let end: Px = [
            from[0] + (vx * c - vy * sn) * reach,
            from[1] + (vx * sn + vy * c) * reach,
          ];
          for (let k = 0; k < 4 && !inside.has(pxCell(grid, end)); k++) {
            end = [from[0] + (end[0] - from[0]) * 0.7, from[1] + (end[1] - from[1]) * 0.7];
          }
          const bend = (turn >= 0 ? 1 : -1) * 0.12 * l;
          const mid: Px = [
            (from[0] + end[0]) / 2 - (vy / l) * bend,
            (from[1] + end[1]) / 2 + (vx / l) * bend,
          ];
          const line = resample(smoothOpen([from, mid, end], 2), grid.cell);
          channels.push(simplifyOpen(line.length > 2 ? meander(line, 1.5) : line, req.eps));
        }
      }
    }
    const kmPerCell = t.kmPerPx === null ? null : t.kmPerPx * grid.cell;
    return {
      cells,
      basin: {
        ring: outline,
        km2: kmPerCell === null ? null : b.cells.length * kmPerCell * kmPerCell,
        end: endAs,
        auto,
        channels,
      },
    };
  }

  likely(above: number): LikelyReply {
    const t = this.inUse();
    const made = t.rivers.length > 0 ? t.riverNear : null;
    return {
      rivers: likelyRivers(t.flow, t.sea, Math.max(2, above), made).map((cells) =>
        simplifyOpen(smoothOpen(this.line(cells), 3), Math.max(0.6, this.grid.cell * 0.6)),
      ),
    };
  }

  // ---- Routes ------------------------------------------------------------------------------------

  private surface(mode: Mode, variant: Variant): Surface {
    const t = this.inUse();
    const key = `${mode}|${variant}`;
    let s = t.surfaces.get(key);
    if (!s) {
      s = surfaceFor(t.ground, mode, variant);
      t.surfaces.set(key, s);
    }
    return s;
  }

  /** The limits a route is searched within: its mode's steepest grade, steps and tunnels. */
  private limits(req: RouteRequest): Limits {
    const t = this.inUse();
    const kmPerCell = t.terrain.kmPerCell;
    // Without a scale a km means nothing: a tunnel may be a fortieth of the map, steps a 400th.
    const span = Math.max(this.grid.w, this.grid.h);
    const cells = (km: number, share: number) =>
      t.kmPerPx === null ? span * share : km / kmPerCell;
    return {
      grade: req.steepest,
      steps:
        req.steps && req.mode === "foot"
          ? { grade: STEPS_GRADE, cells: cells(STEPS_KM, 0.0025), factor: STEPS_SLOWER }
          : null,
      tunnel:
        req.tunnelKm !== null && req.tunnelKm > 0
          ? {
              cells: Math.max(2, cells(req.tunnelKm, req.tunnelKm / 200)),
              hoursPerCell: kmPerCell * TUNNEL_COST,
              travelPerCell: kmPerCell / TUNNEL_SPEED,
            }
          : null,
    };
  }

  /** The cells a line passes through (a road a route branches from). */
  private cellsOf(line: readonly Px[]): number[] {
    const mask = new Uint8Array(this.grid.w * this.grid.h);
    drawLine(mask, this.grid, line, 1);
    const out: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
    return out;
  }

  /** The height at a point of the working copy, between the four cells round it. */
  private heightAt(p: Px): number {
    const { grid } = this;
    const h = this.inUse().terrain.heights;
    const fx = Math.max(0, Math.min(grid.w - 1, (p[0] + 0.5) / grid.cell - 0.5));
    const fy = Math.max(0, Math.min(grid.h - 1, (p[1] + 0.5) / grid.cell - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(grid.w - 1, x0 + 1);
    const y1 = Math.min(grid.h - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x: number, y: number) => h[y * grid.w + x]!;
    return (
      (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) +
      (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
    );
  }

  /**
   * The steepest grade along a straight piece, as a fraction, measured a cell at a time: above 0
   * when that steepest part rises from `a` towards `b`.
   */
  gradeAlong(a: Px, b: Px): number {
    const { cell } = this.grid;
    const rise = this.inUse().terrain.rise;
    const cells = Math.hypot(b[0] - a[0], b[1] - a[1]) / cell;
    if (cells < 1e-9) return 0;
    const steps = Math.max(1, Math.round(cells));
    let best = 0;
    let before = this.heightAt(a);
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      const here = this.heightAt([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      const g = ((here - before) * rise) / (cells / steps);
      if (Math.abs(g) > Math.abs(best)) best = g;
      before = here;
    }
    return best;
  }

  route(req: RouteRequest): RouteReply {
    const t = this.inUse();
    const { grid } = this;
    if (req.stops.length < 2) return { ok: false, why: "water" };
    const last = req.stops.length - 1;
    const places: Place[] = req.stops.map((p, i) => {
      const line = i === 0 ? req.startOn : i === last ? req.endOn : null;
      const cells = line ? this.cellsOf(line) : [];
      return cells.length ? cells : pxCell(grid, p);
    });
    const surface = this.surface(req.mode, req.variant);
    const limits = this.limits(req);
    const legs = routeThrough(t.terrain, surface, places, limits);
    if (!legs) {
      // Why not: the same search with any slope short of a cliff. When that finds a way, the
      // ground is too steep, and its steepest step is where; when not, water is in the way.
      const loose = routeThrough(t.terrain, surface, places, {
        grade: CLIFF,
        steps: null,
        tunnel: null,
      });
      if (!loose) return { ok: false, why: "water" };
      const steepest = steepestStep(
        t.terrain,
        loose.flatMap((l) => l.cells),
      );
      return { ok: false, why: "steep", at: cellPx(grid, steepest.cell), grade: steepest.grade };
    }

    const ok = (a: Px, b: Px) =>
      limits.grade === Infinity || Math.abs(this.gradeAlong(a, b)) <= limits.grade * 1.05;
    const span = Math.max(this.w, this.h);
    const lead = Math.max(2 * grid.cell, span * 0.012);
    const cells: number[] = [];
    const how: number[] = [];
    let hours = 0;
    let points: Px[] = [];
    let rawLength = 0;
    const stretches: RouteStretch[] = [];
    const along: RouteAlong[] = [];
    legs.forEach((leg, k) => {
      hours += leg.hours;
      cells.push(...(k ? leg.cells.slice(1) : leg.cells));
      how.push(...(k ? leg.how.slice(1) : leg.how));
      rawLength += lineLength(this.line(leg.cells));
      const pieces = this.pieces(leg);
      pieces.forEach((piece, j) => {
        let part = this.line(leg.cells.slice(piece.from, piece.to + 1));
        const first = k === 0 && j === 0;
        const final = k === legs.length - 1 && j === pieces.length - 1;
        // Through each stop exactly; a road branched from, at the nearest place on it.
        if (j === 0) {
          part[0] = k === 0 && req.startOn ? nearestOn(part[0]!, req.startOn).at : req.stops[k]!;
        }
        if (j === pieces.length - 1) {
          const end = part.length - 1;
          part[end] =
            k === legs.length - 1 && req.endOn
              ? nearestOn(part[end]!, req.endOn).at
              : req.stops[k + 1]!;
        }
        if (piece.kind === "tunnel") part = [part[0]!, part[part.length - 1]!];
        else if (piece.kind !== "steps" && part.length > 2) {
          part = simplifyWithin(smoothWithin(part, 3, ok), req.eps, ok);
        }
        if (piece.kind === "plain") {
          // A branch leaves the road it branches from smoothly, and joins one so.
          if (first && req.startOn) part = smoothBranch(part, req.startOn, lead);
          if (final && req.endOn)
            part = smoothBranch([...part].reverse(), req.endOn, lead).reverse();
        }
        const from = points.length ? points.length - 1 : 0;
        points = points.concat(points.length ? part.slice(1) : part);
        const to = points.length - 1;
        if (piece.kind === "tunnel" || piece.kind === "steps") {
          stretches.push({ kind: piece.kind, from, to });
        } else if (piece.kind !== "plain") {
          const road = piece.road > 0 ? t.roads[piece.road - 1]!.id : null;
          along.push({ from, to, road });
        }
      });
    });
    if (cells.length < 2 || points.length < 2) return { ok: false, why: "water" };
    const climbed = this.withClimbs(points, stretches, along);
    points = climbed.points;
    const found = { cells, hours };
    const key = JSON.stringify([req.mode, req.stops, req.startOn, req.endOn, limits]);
    if (req.variant === "fast") t.fastest.set(key, found as Found);
    const fastest = t.fastest.get(key);
    const { marks, fords, bridges, seaCells } = marksAlong(t.ground, cells);
    // The staircase of cells is a little longer than the line as drawn: the time follows the line.
    const drawn = lineLength(points);
    const timed = rawLength > 0 ? hours * Math.min(1, drawn / rawLength) : hours;
    const biomes = this.withoutBiomes(req, places, limits, cells, timed / Math.max(hours, 1e-9));
    return {
      ok: true,
      points,
      hours: t.kmPerPx === null ? null : timed,
      marks: marks.map((m): Mark => ({ at: cellPx(grid, m.cell), kind: m.kind })),
      fords,
      bridges,
      seaShare: seaCells / cells.length,
      same: req.variant !== "fast" && !!fastest && sameWay(found, fastest),
      stretches: climbed.stretches,
      along: climbed.along,
      profile: this.profile(points, climbed.stretches),
      ...biomes,
    };
  }

  /**
   * With biome zones on the map: how long the same journey would take without them (the way
   * found again, over the ground as it would be), and the km of the route in each biome.
   */
  private withoutBiomes(
    req: RouteRequest,
    places: Place[],
    limits: Limits,
    cells: number[],
    drawnShare: number,
  ): Pick<Extract<RouteReply, { ok: true }>, "withoutBiomes" | "byBiome"> {
    const t = this.inUse();
    const biomes = t.ground.biomes;
    if (!biomes || t.kmPerPx === null) return { withoutBiomes: null, byBiome: [] };
    const key = `${req.mode}|${req.variant}|plain`;
    let plain = t.surfaces.get(key);
    if (!plain) {
      const ground = { ...t.ground };
      delete ground.biomes;
      plain = surfaceFor(ground, req.mode, req.variant);
      t.surfaces.set(key, plain);
    }
    const legs = routeThrough(t.terrain, plain, places, limits);
    const byBiome = kmByBiome(
      biomes,
      cells,
      // A step may be a knight's move, or a tunnel's jump through the high ground.
      (a, b) => stepCells(this.grid.w, a, b) * t.terrain.kmPerCell,
    );
    return {
      withoutBiomes: legs ? legs.reduce((h, l) => h + l.hours, 0) * drawnShare : null,
      byBiome,
    };
  }

  /**
   * A leg cut where it changes from one kind of going to another: plain ground, a tunnel, steps,
   * or a run along a road (made or painted). Each piece is made into points by itself, so where
   * one ends is a point of the path: a tunnel's mouths, the ends of a run along a road.
   */
  pieces(leg: Pick<Found, "cells" | "how">): {
    kind: "plain" | "tunnel" | "steps" | "road";
    road: number;
    from: number;
    to: number;
  }[] {
    const t = this.inUse();
    const { cells, how } = leg;
    const n = cells.length;
    // The road under each cell, with crossings and short gaps evened out.
    const lab = cells.map((c) => t.roadOn[c]!);
    const least = Math.max(ALONG_LEAST, Math.round(n * 0.03));
    const runs = (fn: (start: number, end: number, value: number) => void) => {
      for (let i = 0; i < n;) {
        let j = i;
        while (j + 1 < n && lab[j + 1] === lab[i]) j++;
        fn(i, j, lab[i]!);
        i = j + 1;
      }
    };
    runs((a, b, v) => {
      if (v !== 0 && b - a + 1 < least) for (let i = a; i <= b; i++) lab[i] = 0;
    });
    runs((a, b, v) => {
      if (v === 0 && a > 0 && b < n - 1 && b - a + 1 < 3 && lab[a - 1] === lab[b + 1]) {
        for (let i = a; i <= b; i++) lab[i] = lab[a - 1]!;
      }
    });
    const kindOf = (i: number): { kind: "plain" | "tunnel" | "steps" | "road"; road: number } =>
      how[i] === TUNNEL
        ? { kind: "tunnel", road: 0 }
        : how[i] === STEPS
          ? { kind: "steps", road: 0 }
          : lab[i - 1] !== 0 && lab[i] === lab[i - 1]
            ? { kind: "road", road: lab[i]! }
            : { kind: "plain", road: 0 };
    const out: {
      kind: "plain" | "tunnel" | "steps" | "road";
      road: number;
      from: number;
      to: number;
    }[] = [];
    for (let i = 1; i < n; i++) {
      const k = kindOf(i);
      const last = out[out.length - 1];
      if (last && last.kind === k.kind && last.road === k.road && k.kind !== "tunnel") last.to = i;
      else out.push({ ...k, from: i - 1, to: i });
    }
    if (out.length === 0) out.push({ kind: "plain", road: 0, from: 0, to: n - 1 });
    return out;
  }

  /**
   * The climbs of a line: where it runs steeper than `CLIMB` the same way up (outside tunnels),
   * measured a cell at a time. Where a climb starts or ends between two of the line's points, a
   * point is put in there (on the straight piece, so the line keeps its course), and the other
   * stretches' indices move with it.
   */
  withClimbs(
    points: readonly Px[],
    stretches: readonly RouteStretch[],
    along: readonly RouteAlong[],
  ): { points: Px[]; stretches: RouteStretch[]; along: RouteAlong[] } {
    const { cell } = this.grid;
    const rise = this.inUse().terrain.rise;
    const tunnel = (j: number) =>
      stretches.some((s) => s.kind === "tunnel" && j >= s.from && j < s.to);
    // Samples a cell apart along the line; each a corner (its index) or a place between two.
    const samples: { p: Px; corner: number }[] = [{ p: points[0]!, corner: 0 }];
    const grades: number[] = [];
    for (let j = 0; j + 1 < points.length; j++) {
      const a = points[j]!;
      const b = points[j + 1]!;
      const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / cell));
      let before = this.heightAt(a);
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        const p: Px = k === steps ? b : [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        const here = this.heightAt(p);
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) / steps / cell;
        grades.push(tunnel(j) || l <= 0 ? 0 : ((here - before) * rise) / l);
        samples.push({ p, corner: k === steps ? j + 1 : -1 });
        before = here;
      }
    }
    // Each piece between samples: up (1), down (-1) or neither; a lone steep cell is no climb.
    const way = grades.map((g) => (g >= CLIMB ? 1 : g <= -CLIMB ? -1 : 0));
    for (let i = 0; i < way.length; i++) {
      if (way[i] && way[i - 1] !== way[i] && way[i + 1] !== way[i]) way[i] = 0;
    }
    const cut = new Uint8Array(samples.length);
    for (let i = 1; i < way.length; i++) if (way[i] !== way[i - 1]) cut[i] = 1;
    const out: Px[] = [];
    const index = new Int32Array(samples.length).fill(-1);
    const moved = new Int32Array(points.length);
    samples.forEach((s, i) => {
      if (s.corner < 0 && !cut[i]) return;
      index[i] = out.length;
      if (s.corner >= 0) moved[s.corner] = out.length;
      out.push(s.p);
    });
    const climbs: RouteStretch[] = [];
    for (let i = 0; i < way.length;) {
      let j = i;
      let steepest = grades[i]!;
      while (j + 1 < way.length && way[j + 1] === way[i]) {
        j++;
        if (Math.abs(grades[j]!) > Math.abs(steepest)) steepest = grades[j]!;
      }
      if (way[i]) {
        climbs.push({ kind: "climb", from: index[i]!, to: index[j + 1]!, grade: steepest });
      }
      i = j + 1;
    }
    const shift = <T extends { from: number; to: number }>(x: T): T => ({
      ...x,
      from: moved[x.from]!,
      to: moved[x.to]!,
    });
    return {
      points: out,
      stretches: [...stretches.map(shift), ...climbs].sort((a, b) => a.from - b.from),
      along: along.map(shift),
    };
  }

  /** The heights along a line, for its profile; a tunnel runs straight from mouth to mouth. */
  profile(points: readonly Px[], stretches: readonly RouteStretch[]): Profile {
    const total = lineLength(points);
    const step = Math.max(this.grid.cell * 0.5, total / 160);
    const d: number[] = [];
    const h: number[] = [];
    let s = 0;
    for (let j = 0; j + 1 < points.length; j++) {
      const a = points[j]!;
      const b = points[j + 1]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tunnel = stretches.some((x) => x.kind === "tunnel" && j >= x.from && j < x.to);
      const ha = this.heightAt(a);
      const hb = this.heightAt(b);
      const count = Math.max(1, Math.ceil(l / step));
      for (let k = j === 0 ? 0 : 1; k <= count; k++) {
        const f = k / count;
        d.push(s + l * f);
        h.push(
          tunnel
            ? ha + (hb - ha) * f
            : this.heightAt([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]),
        );
      }
      s += l;
    }
    const rise = this.inUse().terrain.rise;
    const grade: number[] = [];
    let climb = 0;
    let steepest = 0;
    for (let i = 0; i + 1 < d.length; i++) {
      const cells = (d[i + 1]! - d[i]!) / this.grid.cell;
      const g = cells > 0 ? ((h[i + 1]! - h[i]!) * rise) / cells : 0;
      grade.push(g);
      climb += Math.max(0, h[i + 1]! - h[i]!);
    }
    for (let j = 0; j + 1 < points.length; j++) {
      if (stretches.some((x) => x.kind === "tunnel" && j >= x.from && j < x.to)) continue;
      steepest = Math.max(steepest, Math.abs(this.gradeAlong(points[j]!, points[j + 1]!)));
    }
    return { d, h, grade, climb, high: h.length ? Math.max(...h) : 0, steepest };
  }

  // ---- Trace -------------------------------------------------------------------------------------

  trace(req: TraceRequest): TraceReply {
    if (!this.tracer) return { ok: false, why: "none" };
    const traced = this.tracer.trace(req.at, req.end, req.branches);
    if (!traced.ok) return traced;
    let main = this.refine ? this.refine(traced.points) : traced.points;
    if (traced.loop) main[main.length - 1] = [main[0]![0], main[0]![1]];
    // A river is written from its source: the end by the water comes last.
    if (traced.kind === "river" && !req.end && !traced.loop && this.ground) {
      const wet = (p: Px) => {
        const g = this.grid;
        const c = pxCell(g, p);
        const x = c % g.w;
        const y = (c / g.w) | 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
            if (this.ground!.water[yy * g.w + xx]) return true;
          }
        }
        return false;
      };
      if (wet(main[0]!) && !wet(main[main.length - 1]!)) main = [...main].reverse();
    }
    const points = simplifyOpen(main, req.eps);
    // The main line as it will be drawn, which a branch must end on exactly.
    const space = { kind: "flat", width: this.w, height: this.h, scale: null, unit: "" } as Space;
    const drawn = req.curved
      ? (outline(space, points, { curve: true, closed: false }).line as Px[])
      : points;
    const branches = traced.branches.map((b) => {
      const line = simplifyOpen(this.refine ? this.refine(b) : b, req.eps);
      const on = nearestOn(line[line.length - 1]!, drawn);
      if (on.d < 10) line[line.length - 1] = on.at;
      return line;
    });
    return { ok: true, points, branches, loop: traced.loop, kind: traced.kind };
  }

  // ---- Show relief -------------------------------------------------------------------------------

  relief(): ReliefReply {
    const t = this.inUse();
    return {
      w: this.grid.w,
      h: this.grid.h,
      rgba: reliefPicture(this.grid, t.heights, t.sea),
    };
  }
}
