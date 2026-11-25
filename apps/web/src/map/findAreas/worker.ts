/**
 * The Find areas worker: looks at a map's picture off the page's thread, so the page never
 * stutters. Each picture is looked at once and kept for the session (the last few), with its
 * areas for the options last asked for.
 */
import { findInk, type Ink } from "./ink.ts";
import { type LabPicture, toLab } from "./lab.ts";
import { areaMask, withPolygon } from "./masks.ts";
import { outlineMask } from "./outline.ts";
import type { AreaRings, FoundAreas, Opened, Outlined, Reply, Request } from "./protocol.ts";
import type { FullPicture } from "./refine.ts";
import { type AreaOptions, type Areas, findAreas } from "./segment.ts";
import { goesRound, shiftNear } from "./frame.ts";
import { zonePx } from "./outline.ts";
import type { Engine } from "../findPaths/engine.ts";
import type { PathsRequest } from "../findPaths/protocol.ts";
import { answerPaths } from "../findPaths/workerSide.ts";
import type { HintsRequest } from "../terrainHints/protocol.ts";
import { answerHints } from "../terrainHints/workerSide.ts";

interface Scope {
  onmessage:
    ((e: MessageEvent<{ id: number } & (Request | PathsRequest | HintsRequest)>) => void) | null;
  postMessage(message: Reply, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

/** The working copy is at most this many pixels. */
const WORKING_PIXELS = 2_000_000;
/** How many pictures are kept. */
const KEPT = 3;
const TILE = 512;

interface Looked {
  pic: LabPicture;
  ink: Ink;
  round: boolean;
  scale: number;
  /** The full-size picture, when the working copy is smaller. */
  bitmap: ImageBitmap | null;
  areas: Areas | null;
  optionsKey: string;
  /** Find paths' engine for this picture, made when that tool first asks. */
  paths?: Engine;
}

const pictures = new Map<string, Promise<Looked>>();

async function look(url: string, round: boolean): Promise<Looked> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("The map's picture could not be read.");
  const bitmap = await createImageBitmap(await response.blob());
  const s = Math.max(1, Math.sqrt((bitmap.width * bitmap.height) / WORKING_PIXELS));
  const w = Math.max(1, Math.round(bitmap.width / s));
  const h = Math.max(1, Math.round(bitmap.height / s));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  const pic = toLab(ctx.getImageData(0, 0, w, h).data, w, h);
  const scale = bitmap.width / w;
  const keep = scale >= 1.2;
  if (!keep) bitmap.close();
  return {
    pic,
    ink: findInk(pic),
    round,
    scale,
    bitmap: keep ? bitmap : null,
    areas: null,
    optionsKey: "",
  };
}

function opened(url: string, round: boolean): Promise<Looked> {
  let found = pictures.get(url);
  if (found) {
    // Kept most recent last.
    pictures.delete(url);
    pictures.set(url, found);
    return found;
  }
  found = look(url, round);
  pictures.set(url, found);
  found.catch(() => pictures.delete(url));
  while (pictures.size > KEPT) {
    const oldest = pictures.keys().next().value!;
    void pictures.get(oldest)?.then((l) => l.bitmap?.close());
    pictures.delete(oldest);
  }
  return found;
}

async function known(url: string): Promise<Looked> {
  const found = pictures.get(url);
  if (!found) throw new Error("The picture has not been looked at.");
  return found;
}

function areasFor(looked: Looked, options: AreaOptions): Areas {
  const key = JSON.stringify(options);
  if (!looked.areas || looked.optionsKey !== key) {
    looked.areas = findAreas(looked.pic, looked.ink, options, looked.round);
    looked.optionsKey = key;
  }
  return looked.areas;
}

/** The full-size picture, read in tiles as the outline needs them. */
function fullPicture(looked: Looked): FullPicture | null {
  const bitmap = looked.bitmap;
  if (!bitmap) return null;
  const tiles = new Map<number, { data: Uint8ClampedArray; w: number }>();
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const across = Math.ceil(bitmap.width / TILE);
  return {
    scale: looked.scale,
    sample(x, y) {
      let fx = x;
      if (looked.round) fx = ((fx % bitmap.width) + bitmap.width) % bitmap.width;
      fx = Math.max(0, Math.min(bitmap.width - 1, fx));
      const fy = Math.max(0, Math.min(bitmap.height - 1, y));
      const tx = Math.floor(fx / TILE);
      const ty = Math.floor(fy / TILE);
      const key = ty * across + tx;
      let tile = tiles.get(key);
      if (!tile) {
        const tw = Math.min(TILE, bitmap.width - tx * TILE);
        const th = Math.min(TILE, bitmap.height - ty * TILE);
        ctx.clearRect(0, 0, TILE, TILE);
        ctx.drawImage(bitmap, tx * TILE, ty * TILE, tw, th, 0, 0, tw, th);
        tile = { data: ctx.getImageData(0, 0, tw, th).data, w: tw };
        // A handful of tiles at most, so an iPhone's memory is never pressed.
        if (tiles.size > 48) tiles.clear();
        tiles.set(key, tile);
      }
      const i = ((fy - ty * TILE) * tile.w + (fx - tx * TILE)) * 4;
      return [tile.data[i]!, tile.data[i + 1]!, tile.data[i + 2]!];
    },
  };
}

async function answer(req: Request): Promise<{ value: unknown; transfer?: Transferable[] }> {
  if (req.type === "open") {
    const looked = await opened(req.url, req.round);
    const value: Opened = { w: looked.pic.w, h: looked.pic.h, scale: looked.scale };
    return { value };
  }
  const looked = await known(req.url);
  if (req.type === "areas") {
    const areas = areasFor(looked, req.options);
    const labels = areas.labels.slice();
    const value: FoundAreas = { w: areas.w, h: areas.h, count: areas.count, labels };
    return { value, transfer: [labels.buffer] };
  }
  const areas = looked.areas;
  if (!areas) throw new Error("The areas have not been found yet.");
  const round = goesRound(req.frame);
  if (req.type === "area") {
    const pieces = outlineMask(areaMask(areas, [req.area], round), {
      frame: req.frame,
      eps: 1,
      smallest: 4,
    });
    const value: AreaRings = {
      rings: pieces.flatMap((p) => [
        { points: p.outer, role: "outer" as const },
        ...p.holes.map((points) => ({ points, role: "hole" as const })),
      ]),
    };
    return { value };
  }
  let mask = areaMask(areas, req.areas, round);
  if (req.addTo && req.addTo.length >= 3) {
    const centre = mask.w > 0 ? mask.ox + mask.w / 2 : areas.w / 2;
    const ring = shiftNear(req.frame, zonePx(req.frame, req.addTo), centre);
    const { w, h } = areas;
    mask = withPolygon(mask, ring, [-w, -h, 2 * w, 2 * h]);
  }
  const { line } = looked.ink;
  const { w, h } = areas;
  const pieces = outlineMask(mask, {
    frame: req.frame,
    eps: req.eps,
    // Add to snaps to the zone's own outline too, so the part of it that stays keeps its corners.
    targets: req.addTo ? [...req.targets, req.addTo] : req.targets,
    full: fullPicture(looked),
    onLine: ([x, y]) => {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const px = (((Math.floor(x) + dx) % w) + w) % w;
        const py = Math.floor(y) + dy;
        if (py >= 0 && py < h && line[py * w + px]) return true;
      }
      return false;
    },
  });
  const value: Outlined = { pieces };
  return { value };
}

scope.onmessage = (e) => {
  const { id, ...req } = e.data;
  const answered = req.type.startsWith("paths.")
    ? answerPaths(req as PathsRequest, {
        opened: (url) => opened(url, false),
        full: (shared) => fullPicture(shared as Looked),
      })
    : req.type.startsWith("hints.")
      ? answerHints(req as HintsRequest, { opened: (url) => opened(url, false) })
      : answer(req as Request);
  answered.then(
    ({ value, transfer }) => scope.postMessage({ id, ok: true, value }, transfer ?? []),
    (err: unknown) =>
      scope.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : "The picture could not be looked at.",
      }),
  );
};
