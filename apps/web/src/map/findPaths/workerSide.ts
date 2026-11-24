/**
 * Find paths in Find areas' worker: it shares the looked-at picture (its Lab colours, its ink and
 * its full-size bitmap) and adds what paths need: the picture's ground, the height picture read
 * onto the cell grid, and the engine that answers the page.
 */
import type { Px } from "../findAreas/contour.ts";
import { boxMean, type Ink } from "../findAreas/ink.ts";
import type { LabPicture } from "../findAreas/lab.ts";
import { type FullPicture, refineRing } from "../findAreas/refine.ts";
import { Engine } from "./engine.ts";
import type { HeightSource, OpenedPaths, PathsRequest } from "./protocol.ts";
import { type HeightPicture, heightsFromRgba, resampleHeights } from "./terrain.ts";

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

/**
 * The height picture as the terrain's settings read it: turned over when black is high, and
 * smoothed (two box passes a step), which changes how it is read and never the picture.
 */
export function prepared(src: HeightPicture, invert: boolean, smoothing: number): HeightPicture {
  let data = src.data;
  if (invert) data = data.map((v) => 1 - v);
  if (smoothing > 0) {
    const r = Math.max(1, Math.round((smoothing * Math.max(src.w, src.h)) / 500));
    data = boxMean(boxMean(data, src.w, src.h, r), src.w, src.h, r);
  }
  return { w: src.w, h: src.h, data };
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
      (h) => prepared(h, heights.invert, heights.smoothing),
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

/** Answers one request of Find paths. */
export async function answerPaths(
  req: PathsRequest,
  deps: WorkerDeps,
): Promise<{ value: unknown; transfer?: Transferable[] }> {
  if (req.type === "paths.open") return { value: await open(req, deps) };
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
