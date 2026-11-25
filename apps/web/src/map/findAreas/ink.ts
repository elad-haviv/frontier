/**
 * The ink of a painted map: thin dark lines (borders, coasts, rivers), which areas stop at, and
 * small marks (letters, mountains, trees, a compass), which areas can flow under.
 */
import type { LabPicture } from "./lab.ts";

/** The mean of `src` over a square of side 2r+1 around each pixel, in linear time. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const W1 = w + 1;
  const I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]!;
      I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * W1 + x1]! - I[y0 * W1 + x1]! - I[y1 * W1 + x0]! + I[y0 * W1 + x0]!;
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * A mask grown (dilation) or shrunk (erosion) by a square of side 2r+1, as two passes of a
 * running count, so its cost does not grow with r.
 */
export function morph(m: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pre = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    pre[0] = 0;
    for (let x = 0; x < w; x++) pre[x + 1] = pre[x]! + m[y * w + x]!;
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r);
      const b = Math.min(w, x + r + 1);
      const c = pre[b]! - pre[a]!;
      tmp[y * w + x] = grow ? (c > 0 ? 1 : 0) : c === b - a ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    pre[0] = 0;
    for (let y = 0; y < h; y++) pre[y + 1] = pre[y]! + tmp[y * w + x]!;
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r);
      const b = Math.min(h, y + r + 1);
      const c = pre[b]! - pre[a]!;
      out[y * w + x] = grow ? (c > 0 ? 1 : 0) : c === b - a ? 1 : 0;
    }
  }
  return out;
}

export interface Ink {
  /** Pixels of long thin lines, dashes joined: walls when "Stop at lines" is on. */
  line: Uint8Array;
  /** Pixels of other dark marks: looked past when "Ignore text & marks" is on. */
  mark: Uint8Array;
}

/** How long a piece of ink must be, corner to corner of its box, to count as a line. */
export const lineLength = (w: number, h: number): number =>
  Math.max(40, Math.round(Math.max(w, h) * 0.094));

/** The widest gap in a line of ink that is bridged, in pixels. */
const GAP = 8;

/** Labels the pieces of a mask (8-connected) in `comp`, -1 off the mask; returns how many. */
function label(mask: Uint8Array, w: number, h: number, comp: Int32Array): number {
  const stack = new Int32Array(w * h);
  comp.fill(-1);
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || comp[s]! >= 0) continue;
    let sp = 0;
    stack[sp++] = s;
    comp[s] = count;
    while (sp) {
      const i = stack[--sp]!;
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (mask[j] && comp[j]! < 0) {
            comp[j] = count;
            stack[sp++] = j;
          }
        }
      }
    }
    count++;
  }
  return count;
}

/**
 * Joins pieces of ink that lie within `gap` pixels of each other, by a straight stroke from each
 * edge pixel of one to the nearest pixel of another. Closing with a square (grow, then shrink)
 * joins the dashes of a line that runs along the grid, but not of a thin slanted one: there the
 * shrinking square never fits and the gaps open again. This joins them whichever way they run.
 */
export function bridgeGaps(mask: Uint8Array, w: number, h: number, gap: number): void {
  const comp = new Int32Array(w * h);
  if (label(mask, w, h, comp) < 2) return;
  // Blocks of the picture that hold one piece only (its number), none (-1) or several (-2), so
  // the pixels with no other piece near are passed over at once.
  const bw = Math.ceil(w / gap);
  const bh = Math.ceil(h / gap);
  const block = new Int32Array(bw * bh).fill(-1);
  for (let i = 0; i < w * h; i++) {
    const c = comp[i]!;
    if (c < 0) continue;
    const b = ((((i / w) | 0) / gap) | 0) * bw + (((i % w) / gap) | 0);
    if (block[b] === -1) block[b] = c;
    else if (block[b] !== c) block[b] = -2;
  }
  const strokes: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = comp[i]!;
      if (c < 0) continue;
      // Only the edge of a piece reaches out.
      const inside =
        x > 0 &&
        x < w - 1 &&
        y > 0 &&
        y < h - 1 &&
        comp[i - 1] === c &&
        comp[i + 1] === c &&
        comp[i - w] === c &&
        comp[i + w] === c;
      if (inside) continue;
      const bx = (x / gap) | 0;
      const by = (y / gap) | 0;
      let other = false;
      for (let dy = -1; dy <= 1 && !other; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = bx + dx;
          const yy = by + dy;
          if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
          const v = block[yy * bw + xx]!;
          if (v !== -1 && v !== c) {
            other = true;
            break;
          }
        }
      }
      if (!other) continue;
      let best = -1;
      let bd = gap * gap + 1;
      for (let dy = -gap; dy <= gap; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -gap; dx <= gap; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const d = dx * dx + dy * dy;
          const j = yy * w + xx;
          if (d < bd && comp[j]! >= 0 && comp[j] !== c) {
            bd = d;
            best = j;
          }
        }
      }
      if (best >= 0) strokes.push([i, best]);
    }
  }
  for (const [from, to] of strokes) {
    const x0 = from % w;
    const y0 = (from / w) | 0;
    const x1 = to % w;
    const y1 = (to / w) | 0;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / steps);
      const y = Math.round(y0 + ((y1 - y0) * k) / steps);
      mask[y * w + x] = 1;
      // A second pixel beside it: a stroke one pixel wide lets a four-way step slip through.
      if (x + 1 < w) mask[y * w + x + 1] = 1;
    }
  }
}

/**
 * Finds the ink. A pixel is ink when it is clearly darker than the mean of its 13×13
 * neighbourhood (a black top-hat): lines and letters are, a forest painted dark is not, since
 * there the neighbourhood is dark too. Gaps of up to about 8 px are closed (dashed borders), and
 * each joined piece is a line when it is long and thin, else a mark.
 */
export function findInk(pic: LabPicture): Ink {
  const { w, h, L } = pic;
  const n = w * h;
  const mean = boxMean(L, w, h, 6);
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) dark[i] = L[i]! < mean[i]! - 9 ? 1 : 0;
  const closed = morph(morph(dark, w, h, 4, true), w, h, 4, false);
  bridgeGaps(closed, w, h, GAP);
  // Each piece of the closed ink (8-connected), sorted into lines and marks.
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const isLine: boolean[] = [];
  const longest = lineLength(w, h);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (!closed[s] || comp[s]! >= 0) continue;
    let sp = 0;
    let area = 0;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    stack[sp++] = s;
    comp[s] = count;
    while (sp) {
      const i = stack[--sp]!;
      const x = i % w;
      const y = (i / w) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (closed[j] && comp[j]! < 0) {
            comp[j] = count;
            stack[sp++] = j;
          }
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // Long, and thin: sparse in its box (a winding border network), or a narrow box (a straight
    // stretch of line). A word is long too, but dense in a box as tall as its letters.
    const long = Math.hypot(bw, bh) >= longest;
    isLine[count++] = long && (area / (bw * bh) < 0.3 || Math.min(bw, bh) <= 8);
  }
  const line = new Uint8Array(n);
  const mark = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (closed[i] && isLine[comp[i]!]) line[i] = 1;
    else if (dark[i]) mark[i] = 1;
  }
  return { line, mark };
}
