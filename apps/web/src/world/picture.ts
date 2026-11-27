/**
 * The World Wizard's pictures (stage 34): each stage of the world as colours on its grid, for the
 * wizard's own view, and the finished world painted large, with the height picture that goes with
 * it, for the map the wizard makes. Pure: pixels in, pixels out.
 */
import { classify, fits, H, ICE, isWater, layered, N, UNPAINTED, W, type World } from "./model.ts";

/** What the wizard's view shows. */
export type Layer = "natural" | "mask" | "plates" | "height" | "grey" | "temp" | "rain" | "biome";

type Rgb = readonly [number, number, number];
const hex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** How each biome is painted, by index into `BIOME_KINDS`. */
export const BIOME_PAINT: readonly string[] = [
  "#2c5878",
  "#5a90ab",
  "#eef3f5",
  "#b7bdab",
  "#4c705c",
  "#5d8a48",
  "#2d6838",
  "#a7bd69",
  "#c8b765",
  "#b6a578",
  "#e2ce93",
  "#c19f7b",
  "#6d9881",
  "#98928a",
  "#6a5954",
];
const BIOME_RGB = BIOME_PAINT.map(hex);

/** The colour of each plate in the plates view. */
export const PLATE_PAINT: readonly string[] = [
  "#c0564b",
  "#4b86c0",
  "#57a36b",
  "#c79a3d",
  "#8a62b8",
  "#3fa7a3",
  "#c46f9b",
  "#7d8a3a",
  "#b8763a",
  "#5f6fb5",
  "#9aa0a8",
  "#a8574f",
  "#3f8f5f",
  "#b59ad0",
];
const PLATE_RGB = PLATE_PAINT.map(hex);

const SEA_RAMP: Rgb[] = [
  [12, 30, 58],
  [28, 66, 104],
  [78, 132, 166],
];
const LAND_RAMP: Rgb[] = [
  [92, 136, 84],
  [160, 170, 104],
  [176, 146, 100],
  [134, 108, 88],
  [238, 238, 236],
];
export const TEMP_RAMP: Rgb[] = [
  [230, 240, 250],
  [120, 170, 215],
  [120, 190, 140],
  [235, 215, 110],
  [215, 110, 60],
  [150, 40, 40],
];
export const RAIN_RAMP: Rgb[] = [
  [226, 204, 150],
  [190, 200, 140],
  [90, 170, 150],
  [40, 110, 150],
  [24, 60, 120],
];

const blend = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
function ramp(stops: readonly Rgb[], t: number): Rgb {
  const at = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(at));
  return blend(stops[k]!, stops[k + 1]!, at - k);
}
/** A ramp as a CSS gradient, for a view's key. */
export const rampCss = (stops: readonly Rgb[]): string =>
  `linear-gradient(to right, ${stops.map((c) => `rgb(${c.join(",")})`).join(", ")})`;

const heightColour = (e: number): Rgb =>
  e <= 0 ? ramp(SEA_RAMP, 1 + e / 0.6) : ramp(LAND_RAMP, e / 0.75);

/** Paints a layer of the world onto its grid: `out` is RGBA, `W` by `H`. */
export function paintLayer(world: World, layer: Layer, out: Uint8ClampedArray): void {
  const { land, plate, crust, h, elev, temp, rain, biome } = world;
  for (let i = 0; i < N; i++) {
    let c: Rgb;
    if (layer === "mask") c = land[i] ? [244, 242, 236] : [14, 14, 16];
    else if (layer === "natural") c = land[i] ? [150, 160, 110] : [36, 76, 112];
    else if (layer === "plates") {
      const x = i % W;
      const y = Math.floor(i / W);
      const edge =
        plate[y * W + ((x + 1) % W)] !== plate[i] || (y < H - 1 && plate[i + W] !== plate[i]);
      const tone = PLATE_RGB[plate[i]! % PLATE_RGB.length]!;
      c = edge
        ? [16, 14, 12]
        : crust[i]
          ? blend(tone, [250, 246, 235], 0.25 + Math.max(0, Math.min(1, h[i]!)) * 0.5)
          : blend(tone, [10, 14, 24], 0.62);
    } else if (layer === "grey") {
      const g = (elev[i]! + 1) * 127.5;
      c = [g, g, g];
    } else if (layer === "height") {
      c = heightColour(elev[i]!);
      if (elev[i]! > 0) {
        const west = Math.floor(i / W) * W + (((i % W) + W - 1) % W);
        // Against the sea the land is not lit as a cliff.
        const shade = Math.max(-45, Math.min(45, (elev[i]! - Math.max(0, elev[west]!)) * 900));
        c = [c[0] + shade, c[1] + shade, c[2] + shade];
      }
    } else if (layer === "temp") c = ramp(TEMP_RAMP, (temp[i]! + 30) / 65);
    else if (layer === "rain") c = elev[i]! <= 0 ? [30, 48, 72] : ramp(RAIN_RAMP, rain[i]! / 0.7);
    else c = BIOME_RGB[biome[i]!]!;
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  }
}

/** The lowest height the height picture holds; deeper sea floor is drawn as this. */
export const HEIGHT_LOW = -0.6;
/** The grey, 0 to 1, of the sea level in the height picture. */
export const HEIGHT_SEA = -HEIGHT_LOW / (1 - HEIGHT_LOW);

export interface Painted {
  w: number;
  h: number;
  /** The map's picture, RGBA. */
  picture: Uint8ClampedArray;
  /** The height picture, RGBA greys: white is high, `HEIGHT_SEA` is the sea level. */
  heights: Uint8ClampedArray;
}

/**
 * The finished world, painted at `w` by `h` (two to one, the whole globe). Heights, warmth and
 * rain are read between the grid's cells and given finer detail, so coasts are not stair-stepped;
 * the biome of each pixel is worked out again from them, and a biome painted by hand is kept where
 * it fits. The land is shaded by its slope, lit from the north-west.
 */
export function paintWorld(world: World, w: number, h: number): Painted {
  const { elev, temp, rain, painted, s } = world;
  const e = new Float32Array(w * h);
  const picture = new Uint8ClampedArray(w * h * 4);
  const heights = new Uint8ClampedArray(w * h * 4);
  const kinds = new Uint8Array(w * h);
  for (let py = 0; py < h; py++) {
    const gy = ((py + 0.5) / h) * H - 0.5;
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(gy)));
    const y1 = Math.min(H - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, gy - y0));
    const lat = (0.5 - (py + 0.5) / h) * Math.PI;
    const cos = Math.cos(lat);
    const sin = Math.sin(lat);
    for (let px = 0; px < w; px++) {
      const gx = ((px + 0.5) / w) * W - 0.5;
      const xf = Math.floor(gx);
      const fx = gx - xf;
      const x0 = (xf + W) % W;
      const x1 = (x0 + 1) % W;
      const a = y0 * W + x0;
      const b = y0 * W + x1;
      const c = y1 * W + x0;
      const d = y1 * W + x1;
      const at = (f: Float32Array) =>
        (f[a]! * (1 - fx) + f[b]! * fx) * (1 - fy) + (f[c]! * (1 - fx) + f[d]! * fx) * fy;
      const lon = ((px + 0.5) / w - 0.5) * 2 * Math.PI;
      const fine =
        (layered(cos * Math.sin(lon), sin, cos * Math.cos(lon), s.seed + 7, 28, 3) - 0.44) *
        0.07 *
        s.rough;
      const here = Math.max(-1, Math.min(1, at(elev) + fine));
      const i = py * w + px;
      e[i] = here;
      const byHand = painted[(fy < 0.5 ? y0 : y1) * W + (fx < 0.5 ? x0 : x1)]!;
      kinds[i] =
        byHand !== UNPAINTED && fits(byHand, here)
          ? byHand
          : classify(here, at(temp) - Math.max(0, fine) * 42, at(rain));
    }
  }
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const here = e[i]!;
      const kind = kinds[i]!;
      let c: Rgb;
      if (kind === ICE) c = here > 0 ? [240, 243, 245] : [226, 234, 240];
      else if (isWater(kind)) c = heightColour(here);
      else c = blend(BIOME_RGB[kind]!, heightColour(here), 0.22);
      if (here > 0) {
        const west = e[py * w + ((px + w - 1) % w)]!;
        const north = e[Math.max(0, py - 1) * w + px]!;
        const shade = Math.max(-60, Math.min(60, (here * 2 - west - north) * 2600));
        c = [c[0] + shade, c[1] + shade, c[2] + shade];
      }
      picture[i * 4] = c[0];
      picture[i * 4 + 1] = c[1];
      picture[i * 4 + 2] = c[2];
      picture[i * 4 + 3] = 255;
      const grey = ((Math.max(HEIGHT_LOW, here) - HEIGHT_LOW) / (1 - HEIGHT_LOW)) * 255;
      // The sea level is one grey: land is never drawn at or under it, nor the sea over it.
      const sea = Math.round(HEIGHT_SEA * 255);
      const g = here > 0 ? Math.max(sea + 1, Math.round(grey)) : Math.min(sea, Math.round(grey));
      heights[i * 4] = heights[i * 4 + 1] = heights[i * 4 + 2] = g;
      heights[i * 4 + 3] = 255;
    }
  }
  return { w, h, picture, heights };
}
