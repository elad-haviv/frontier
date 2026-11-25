/**
 * Terrain hints in Find areas' worker: they share the looked-at picture and Find paths' engine
 * made for it (its ground and its Trace), so nothing is decoded or looked at twice.
 */
import { Engine } from "../findPaths/engine.ts";
import type { WorkerDeps } from "../findPaths/workerSide.ts";
import { type BuildPlace, buildHeights, fullSize } from "./build.ts";
import { findHints } from "./find.ts";
import { greyPng } from "./png.ts";
import type { HintsBuilt, HintsFound, HintsImage, HintsRequest } from "./protocol.ts";

async function placeOf(url: string, deps: Pick<WorkerDeps, "opened">) {
  const shared = await deps.opened(url);
  shared.paths ??= new Engine(shared.pic, shared.ink);
  const engine = shared.paths;
  const ground = engine.pictureGround!;
  const place: BuildPlace = {
    w: shared.pic.w,
    h: shared.pic.h,
    water: ground.water,
    ww: ground.grid.w,
    wh: ground.grid.h,
  };
  return { shared, engine, ground, place };
}

/** Answers one request about terrain hints. */
export async function answerHints(
  req: HintsRequest,
  deps: Pick<WorkerDeps, "opened">,
): Promise<{ value: unknown; transfer?: Transferable[] }> {
  const { shared, engine, ground, place } = await placeOf(req.url, deps);
  if (req.type === "hints.find") {
    const found = findHints({
      pic: shared.pic,
      ground,
      trace: (at) => engine.trace({ at, end: null, eps: 1, curved: false, branches: true }),
      kmPerPx: req.kmPerPx,
    });
    const value: HintsFound = { w: shared.pic.w, h: shared.pic.h, ...found };
    return { value };
  }
  const built = buildHeights(place, req.hints, req.settings);
  if (req.type === "hints.build") {
    const water = new Uint8Array(built.w * built.h);
    // The picture's water on the built grid, nearest cell.
    for (let y = 0; y < built.h; y++) {
      const sy = Math.min(place.wh - 1, Math.floor(((y + 0.5) * place.wh) / built.h));
      for (let x = 0; x < built.w; x++) {
        const sx = Math.min(place.ww - 1, Math.floor(((x + 0.5) * place.ww) / built.w));
        water[y * built.w + x] = place.water![sy * place.ww + sx]!;
      }
    }
    const value: HintsBuilt = {
      pw: place.w,
      ph: place.h,
      w: built.w,
      h: built.h,
      heights: built.heights,
      sea: built.sea,
      water,
      checks: built.checks,
    };
    return { value, transfer: [built.heights.buffer, built.sea.buffer, water.buffer] };
  }
  const w = Math.max(16, Math.round(req.width));
  const h = Math.max(16, Math.round((w * place.h) / place.w));
  const image = fullSize(built, w, h, req.settings);
  const png = await greyPng(image.grey, w, h);
  const value: HintsImage = {
    png,
    w,
    h,
    seaLevel: image.seaLevel,
    low: image.low,
    high: image.high,
  };
  return { value, transfer: [png.buffer] };
}
