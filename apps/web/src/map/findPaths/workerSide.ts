/**
 * Find paths in Find areas' worker: it shares the looked-at picture (its Lab colours, its ink and
 * its full-size bitmap) and adds what paths need: the picture's ground, the height picture read
 * onto the cell grid, and the engine that answers the page.
 */
import type { Px } from "../findAreas/contour.ts";
import type { Ink } from "../findAreas/ink.ts";
import type { LabPicture } from "../findAreas/lab.ts";
import { type FullPicture, refineRing } from "../findAreas/refine.ts";
import { prepared } from "../terrain/fit.ts";
import { Engine } from "./engine.ts";
import { flatGrid } from "./grid.ts";
import type {
  HeightSource,
  OpenedPaths,
  PathsRequest,
  ReliefReply,
  TerrainLook,
} from "./protocol.ts";
import {
  type HeightPicture,
  heightsFromRgba,
  LOWEST_SEA,
  reliefPicture,
  resampleHeights,
} from "./terrain.ts";

/** What Find areas' worker keeps of a picture, as far as paths need it. */
export interface SharedPicture {
  pic: LabPicture;
  ink: Ink;
  /** The engine made for this picture, kept with it. */
  paths?: Engine;
}

export interface WorkerDeps {
  /** The picture, looked at once and kept. */
  opened: (url: string) => Promise<SharedPicture>;
  /** The full-size picture, when it is larger than the working copy. */
  full: (shared: SharedPicture) => FullPicture | null;
}

/** A height picture is read at no more than this many pixels. */
const HEIGHT_PIXELS = 1_000_000;
const heightPictures = new Map<string, Promise<HeightPicture>>();

/** Reads a height picture: its greys, 0 to 1, at a working size. */
export async function readHeights(url: string): Promise<HeightPicture> {
  let found = heightPictures.get(url);
  if (!found) {
    found = (async () => {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error("The height map could not be read.");
      const bitmap = await createImageBitmap(await response.blob());
      const s = Math.max(1, Math.sqrt((bitmap.width * bitmap.height) / HEIGHT_PIXELS));
      const w = Math.max(1, Math.round(bitmap.width / s));
      const h = Math.max(1, Math.round(bitmap.height / s));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      return heightsFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
    })();
    heightPictures.set(url, found);
    found.catch(() => heightPictures.delete(url));
    while (heightPictures.size > 2) heightPictures.delete(heightPictures.keys().next().value!);
  }
  return found;
}

let current: Engine | null = null;

async function open(
  req: Extract<PathsRequest, { type: "paths.open" }>,
  deps: WorkerDeps,
): Promise<OpenedPaths> {
  const heights: HeightSource | null = req.heights;
  let source: HeightPicture | null = null;
  if (heights) {
    // A height picture that cannot be read is not the end of the tool: it guesses instead.
    source = await readHeights(heights.url).then(
      (h) => prepared(h, { invert: heights.invert, smoothing: heights.smoothing }),
      () => null,
    );
  }
  let engine: Engine;
  if (req.url) {
    const shared = await deps.opened(req.url);
    shared.paths ??= new Engine(shared.pic, shared.ink);
    engine = shared.paths;
    const full = deps.full(shared);
    // A traced line is finished on the full-size picture: each point to the middle of its ink.
    engine.refine = full
      ? (line: Px[]) => {
          const moved = refineRing(line, full, () => true);
          moved[0] = line[0]!;
          moved[moved.length - 1] = line[line.length - 1]!;
          return moved;
        }
      : null;
  } else if (source) {
    engine = new Engine(null, null, { w: source.w, h: source.h }, 500_000);
  } else {
    throw new Error("Find paths needs a map image or a height map.");
  }
  engine.setHeights(
    source && heights ? resampleHeights(source, heights.extent, engine.grid, req.extent) : null,
    { seaLevel: heights?.seaLevel ?? null, top: heights?.metres ?? null },
  );
  current = engine;
  return {
    w: engine.w,
    h: engine.h,
    gw: engine.grid.w,
    gh: engine.grid.h,
    cell: engine.grid.cell,
    hasPicture: engine.hasPicture,
    hasHeights: engine.hasHeights,
  };
}

/** A picture of heights shrunk to at most `most` pixels, by the mean of each block. */
function shrunk(src: HeightPicture, most: number): HeightPicture {
  const f = Math.max(1, Math.ceil(Math.sqrt((src.w * src.h) / most)));
  if (f === 1) return src;
  const w = Math.max(1, Math.floor(src.w / f));
  const h = Math.max(1, Math.floor(src.h / f));
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) s += src.data[(y * f + dy) * src.w + x * f + dx]!;
      data[y * w + x] = s / (f * f);
    }
  }
  return { w, h, data };
}

/** The Terrain dialog's look: at most this many cells, so every slider move is worked out at once. */
const PREVIEW_CELLS = 40_000;

async function look(
  req: Extract<PathsRequest, { type: "paths.look" }>,
  deps: WorkerDeps,
): Promise<{ value: TerrainLook; transfer: Transferable[] }> {
  const heights = req.heights ? shrunk(await readHeights(req.heights), 160_000) : null;
  let gw = heights?.w ?? 1;
  let gh = heights?.h ?? 1;
  let water: Uint8Array | null = null;
  let guess: Float32Array | null = null;
  if (req.url) {
    const shared = await deps.opened(req.url);
    shared.paths ??= new Engine(shared.pic, shared.ink);
    const ground = shared.paths.pictureGround!;
    const g = ground.grid;
    const f = Math.max(1, Math.ceil(Math.sqrt((g.w * g.h) / PREVIEW_CELLS)));
    gw = Math.max(1, Math.floor(g.w / f));
    gh = Math.max(1, Math.floor(g.h / f));
    water = new Uint8Array(gw * gh);
    guess = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = Math.min(g.h - 1, y * f + (f >> 1)) * g.w + Math.min(g.w - 1, x * f + (f >> 1));
        water[y * gw + x] = ground.water[i]!;
        guess[y * gw + x] = ground.guess[i]!;
      }
    }
  } else if (heights) {
    const small = shrunk(heights, PREVIEW_CELLS);
    gw = small.w;
    gh = small.h;
  }
  const copy = heights ? { w: heights.w, h: heights.h, data: heights.data.slice() } : null;
  const transfer: Transferable[] = [];
  if (water) transfer.push(water.buffer);
  if (guess) transfer.push(guess.buffer);
  if (copy) transfer.push(copy.data.buffer);
  return { value: { gw, gh, water, guess, heights: copy }, transfer };
}

async function shade(
  req: Extract<PathsRequest, { type: "paths.shade" }>,
): Promise<{ value: ReliefReply; transfer: Transferable[] }> {
  const src = prepared(shrunk(await readHeights(req.url), 250_000), {
    invert: req.invert,
    smoothing: req.smoothing,
  });
  const level = req.seaLevel ?? LOWEST_SEA;
  const sea = new Uint8Array(src.w * src.h);
  for (let i = 0; i < sea.length; i++) sea[i] = src.data[i]! < level ? 1 : 0;
  const rgba = reliefPicture(flatGrid(src.w, src.h), src.data, sea);
  return { value: { w: src.w, h: src.h, rgba }, transfer: [rgba.buffer] };
}

/** Answers one request of Find paths. */
export async function answerPaths(
  req: PathsRequest,
  deps: WorkerDeps,
): Promise<{ value: unknown; transfer?: Transferable[] }> {
  if (req.type === "paths.open") return { value: await open(req, deps) };
  if (req.type === "paths.look") return look(req, deps);
  if (req.type === "paths.shade") return shade(req);
  if (req.type === "paths.close") {
    current?.close();
    current = null;
    return { value: null };
  }
  const engine = current;
  if (!engine) throw new Error("Find paths has not looked at the map yet.");
  switch (req.type) {
    case "paths.terrain":
      return { value: engine.setTerrain(req) };
    case "paths.river":
      return { value: engine.river(req) };
    case "paths.likely":
      return { value: engine.likely(req.above) };
    case "paths.route":
      return { value: engine.route(req) };
    case "paths.trace":
      return { value: engine.trace(req) };
    case "paths.relief": {
      const relief = engine.relief();
      return { value: relief, transfer: [relief.rgba.buffer] };
    }
  }
}
