/**
 * The cell grid that terrain, water flow and routes are worked out on: coarser than the picture
 * (about half a megapixel of cells), since none of them needs a pixel's precision. What the grid
 * code asks of the map's shape is only which cells are neighbours and how long a step between two
 * of them is, so a globe's plate (wrapping columns, narrower cells towards the poles) can be
 * added as another `Grid` without touching the flood or the search.
 */
import type { Px } from "../findAreas/contour.ts";

export interface Grid {
  w: number;
  h: number;
  /** Pixels of the picture's working copy along one side of a cell. */
  cell: number;
  /**
   * Writes the neighbours of a cell into `out` and returns how many there are (at most eight).
   */
  neighbours(cell: number, out: Int32Array): number;
  /** How long the step between two neighbouring cells is, in cells. */
  stepLength(a: number, b: number): number;
}

/** A flat map's grid: eight neighbours, a diagonal step √2 long, nothing past the edges. */
export function flatGrid(w: number, h: number, cell = 1): Grid {
  return {
    w,
    h,
    cell,
    neighbours(c, out) {
      const x = c % w;
      const y = (c / w) | 0;
      let n = 0;
      const left = x > 0;
      const right = x < w - 1;
      if (y > 0) {
        if (left) out[n++] = c - w - 1;
        out[n++] = c - w;
        if (right) out[n++] = c - w + 1;
      }
      if (left) out[n++] = c - 1;
      if (right) out[n++] = c + 1;
      if (y < h - 1) {
        if (left) out[n++] = c + w - 1;
        out[n++] = c + w;
        if (right) out[n++] = c + w + 1;
      }
      return n;
    },
    stepLength(a, b) {
      const d = Math.abs(a - b);
      return d === 1 || d === w ? 1 : Math.SQRT2;
    },
  };
}

/** How many pixels a side a cell has, so the grid has at most `most` cells. */
export function cellSize(w: number, h: number, most = 500_000): number {
  return Math.max(1, Math.ceil(Math.sqrt((w * h) / most)));
}

/** The grid of a picture's working copy of `w` × `h` pixels. */
export function gridFor(w: number, h: number, most?: number): Grid {
  const cell = cellSize(w, h, most);
  return flatGrid(Math.max(1, Math.ceil(w / cell)), Math.max(1, Math.ceil(h / cell)), cell);
}

/** The middle of a cell, as a point of the picture's working copy. */
export function cellPx(g: Grid, c: number): Px {
  return [((c % g.w) + 0.5) * g.cell - 0.5, (((c / g.w) | 0) + 0.5) * g.cell - 0.5];
}

/** The cell a point of the working copy is in, held to the grid. */
export function pxCell(g: Grid, [x, y]: Px): number {
  const cx = Math.max(0, Math.min(g.w - 1, Math.floor((x + 0.5) / g.cell)));
  const cy = Math.max(0, Math.min(g.h - 1, Math.floor((y + 0.5) / g.cell)));
  return cy * g.w + cx;
}

/**
 * A mask of pixels shrunk to the grid. `least` is how many of a cell's pixels must be set: 1 keeps
 * a thin line (any-pixel pooling), half of them takes the majority.
 */
export function pool(mask: Uint8Array, w: number, h: number, g: Grid, least: number): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  const c = g.cell;
  if (c === 1) {
    out.set(mask.subarray(0, out.length));
    return out;
  }
  for (let gy = 0; gy < g.h; gy++) {
    for (let gx = 0; gx < g.w; gx++) {
      let n = 0;
      for (let y = gy * c; y < Math.min(h, gy * c + c); y++) {
        for (let x = gx * c; x < Math.min(w, gx * c + c); x++) n += mask[y * w + x]!;
      }
      out[gy * g.w + gx] = n >= least ? 1 : 0;
    }
  }
  return out;
}

/** The mean of a field of pixels over each cell. */
export function poolMean(src: Float32Array, w: number, h: number, g: Grid): Float32Array {
  const out = new Float32Array(g.w * g.h);
  const c = g.cell;
  for (let gy = 0; gy < g.h; gy++) {
    for (let gx = 0; gx < g.w; gx++) {
      let s = 0;
      let n = 0;
      for (let y = gy * c; y < Math.min(h, gy * c + c); y++) {
        for (let x = gx * c; x < Math.min(w, gx * c + c); x++) {
          s += src[y * w + x]!;
          n++;
        }
      }
      out[gy * g.w + gx] = n ? s / n : 0;
    }
  }
  return out;
}

/**
 * A line of cells made closed to four-way steps: each cell with the four beside it. A river one
 * cell wide lets a diagonal step slip between two of its cells; thickened, it is a wall.
 */
export function thicken(mask: Uint8Array, g: Grid): Uint8Array {
  const out = new Uint8Array(mask.length);
  const { w, h } = g;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    out[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) out[i - 1] = 1;
    if (x < w - 1) out[i + 1] = 1;
    if (y > 0) out[i - w] = 1;
    if (y < h - 1) out[i + w] = 1;
  }
  return out;
}

/** Marks every cell a line (in working-copy pixels) passes through, with `value`. */
export function drawLine(
  into: Uint8Array | Int32Array,
  g: Grid,
  line: readonly Px[],
  value: number,
): void {
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)]!;
    const b = line[i]!;
    const steps = Math.max(1, Math.ceil((Math.hypot(b[0] - a[0], b[1] - a[1]) / g.cell) * 2));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (x < -0.5 || y < -0.5 || x >= g.w * g.cell - 0.5 || y >= g.h * g.cell - 0.5) continue;
      into[pxCell(g, [x, y])] = value;
    }
  }
}

/** Marks every cell whose middle is inside a closed ring (even-odd), with `value`. */
export function fillRing(into: Uint8Array, g: Grid, ring: readonly Px[], value: number): void {
  if (ring.length < 3) return;
  const crossings: number[] = [];
  for (let gy = 0; gy < g.h; gy++) {
    const py = (gy + 0.5) * g.cell - 0.5;
    crossings.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!;
      const [bx, by] = ring[i]!;
      if (ay > py !== by > py) crossings.push(ax + ((py - ay) * (bx - ax)) / (by - ay));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k]! + 0.5) / g.cell - 0.5));
      const to = Math.min(g.w - 1, Math.floor((crossings[k + 1]! + 0.5) / g.cell - 0.5));
      for (let gx = from; gx <= to; gx++) into[gy * g.w + gx] = value;
    }
  }
}
