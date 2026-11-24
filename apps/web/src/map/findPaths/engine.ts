/**
 * Find paths' engine: one looked-at picture (and perhaps a height field), the terrain in use made
 * of them and of the map's own features, and the three things asked of it: a river's course, a
 * route, a traced line. No DOM here, so it runs in the worker and under the unit tests alike.
 */
import { outline, type Space } from "@frontier/geo";
import type { Px } from "../findAreas/contour.ts";
import type { Ink } from "../findAreas/ink.ts";
import type { LabPicture } from "../findAreas/lab.ts";
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
import { type Course, courseFrom, type Flow, flow, likelyRivers, upstream } from "./hydro.ts";
import {
  lineLength,
  meander,
  nearestOn,
  resample,
  simplifyOpen,
  smoothOpen,
} from "./lines.ts";
import type {
  LikelyReply,
  Mark,
  ReliefReply,
  RiverReply,
  RiverRequest,
  RouteReply,
  RouteRequest,
  TerrainFeature,
  TerrainInfo,
  TerrainRequest,
  TraceReply,
  TraceRequest,
} from "./protocol.ts";
import { type Found, marksAlong, routeThrough, sameWay, type Terrain } from "./route.ts";
import { matchSeaLevel, reliefPicture } from "./terrain.ts";
import { Tracer } from "./trace.ts";

/** A river shorter than this many cells is not one. */
const SHORTEST_RIVER = 5;
/** How far, in cells, a click in the sea looks for the coast a river comes out at. */
const MOUTH_REACH = 8;

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
    const mountains = empty();
    for (const f of req.features) {
      if (f.counts === "river") {
        rivers.push(f);
        drawLine(riverOn, grid, f.line, rivers.length);
        drawLine(river, grid, f.line, 1);
      } else if (f.counts === "road") drawLine(road, grid, f.line, 1);
      else if (f.counts === "water") fillRing(sea, grid, f.line, 1);
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
    const burned = Float32Array.from(heights);
    const level = Float32Array.from(heights);
    const floor = seaLevel ?? Math.min(0, lo);
    for (let i = 0; i < n; i++) {
      if (sea[i]) level[i] = floor;
      else if (river[i]) burned[i] = burned[i]! - 0.04 * range;
    }
    const f = flow(grid, burned, sea);

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
    this.t = {
      guessed: !useHeights,
      seaLevel,
      heights,
      sea,
      ground: { sea, forest, marsh, upland, road, river, riverWide },
      riverOn: riverBy,
      riverNear,
      rivers,
      flow: f,
      terrain: { grid, heights: level, kmPerCell: kmPerCell ?? 1, rise },
      kmPerPx: req.kmPerPx,
      top,
      surfaces: new Map(),
      fastest: new Map(),
    };
    return {
      guessed: !useHeights,
      seaLevel,
      rough: useHeights && f.raisedShare > 0.1,
      hasSea: anySea,
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
      course = courseFrom(t.flow, t.sea, start, req.snap ? t.riverOn : null);
      cells = course.cells;
    }
    if (cells.length < SHORTEST_RIVER) {
      return { ok: false, why: course.end === "river" ? "onRiver" : "short" };
    }
    const pts = this.line(cells);
    if (req.from === "source" && req.exact) pts[0] = [req.at[0], req.at[1]];
    const target = course.joined > 0 ? t.rivers[course.joined - 1]! : null;
    const last = pts.length - 1;
    if (target) pts[last] = nearestOn(pts[last]!, target.line).at;
    // Smoothed, stepped evenly, wound (more on flat ground), then thinned. The winding is worked
    // out in half cells, so it is the same size on the map whatever the picture's size.
    const unit = grid.cell / 2;
    const stepped = resample(smoothOpen(pts, 3), grid.cell).map((p): Px => [p[0] / unit, p[1] / unit]);
    const flatness = (p: Px) => {
      const c = pxCell(grid, [p[0] * unit, p[1] * unit]);
      const x = c % grid.w;
      const y = (c / grid.w) | 0;
      const e = t.heights;
      const gx = x > 0 && x < grid.w - 1 ? e[c + 1]! - e[c - 1]! : 0;
      const gy = y > 0 && y < grid.h - 1 ? e[c + grid.w]! - e[c - grid.w]! : 0;
      return 1 / (1 + (Math.hypot(gx, gy) * t.terrain.rise * 9) ** 2);
    };
    const wound = meander(stepped, req.meander, flatness).map((p): Px => [p[0] * unit, p[1] * unit]);
    wound[0] = pts[0]!;
    wound[wound.length - 1] = pts[last]!;
    const points = simplifyOpen(wound, req.eps);
    let onFlat = 0;
    for (const c of cells) if (t.flow.raised[c]) onFlat++;
    const fall =
      t.top !== null
        ? Math.max(0, t.heights[cells[0]!]! - Math.max(t.seaLevel ?? 0, t.heights[cells[cells.length - 1]!]!)) * t.top
        : null;
    return {
      ok: true,
      points,
      end: course.end,
      joined: target?.id ?? null,
      flatShare: onFlat / cells.length,
      fall,
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

  route(req: RouteRequest): RouteReply {
    const t = this.inUse();
    const { grid } = this;
    if (req.stops.length < 2) return { ok: false };
    const stops = req.stops.map((p) => pxCell(grid, p));
    const legs = routeThrough(t.terrain, this.surface(req.mode, req.variant), stops);
    if (!legs) return { ok: false };
    const cells: number[] = [];
    let hours = 0;
    let points: Px[] = [];
    let rawLength = 0;
    legs.forEach((leg, k) => {
      hours += leg.hours;
      cells.push(...(k ? leg.cells.slice(1) : leg.cells));
      // Through each stop exactly; the stretch between is smoothed and thinned.
      const part = this.line(leg.cells);
      rawLength += lineLength(part);
      part[0] = req.stops[k]!;
      part[part.length - 1] = req.stops[k + 1]!;
      const thin = part.length > 2 ? simplifyOpen(smoothOpen(part, 3), req.eps) : part;
      points = points.concat(k ? thin.slice(1) : thin);
    });
    if (cells.length < 2 || points.length < 2) return { ok: false };
    const found: Found = { cells, hours };
    const key = `${req.mode}|${stops.join(",")}`;
    if (req.variant === "fast") t.fastest.set(key, found);
    const fastest = t.fastest.get(key);
    const { marks, fords, bridges, seaCells } = marksAlong(t.ground, cells);
    // The staircase of cells is a little longer than the line as drawn: the time follows the line.
    const drawn = lineLength(points);
    const timed = rawLength > 0 ? hours * Math.min(1, drawn / rawLength) : hours;
    return {
      ok: true,
      points,
      hours: t.kmPerPx === null ? null : timed,
      marks: marks.map((m): Mark => ({ at: cellPx(grid, m.cell), kind: m.kind })),
      fords,
      bridges,
      seaShare: seaCells / cells.length,
      same: req.variant !== "fast" && !!fastest && sameWay(found, fastest),
    };
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
