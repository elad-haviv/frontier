/**
 * The small grid tools that finding hints and building heights share: pieces of a mask, a
 * piece's outline, a ring filled onto a grid, distances in steps, and the cells near a line.
 * Every grid here is a plain `w` × `h` array whose cells are `cell` pixels of the picture's
 * working copy a side; pixel (x, y) has its middle at (x, y), as everywhere in the map tools.
 */
import type { Px } from "../findAreas/contour.ts";
import { simplifyRing, smoothRing } from "../findAreas/simplify.ts";

export interface Piece {
  /** The cells, in the order they were reached. */
  cells: number[];
  /** Whether it touches the grid's edge. */
  edge: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DX = [1, 0, -1, 0, 1, -1, -1, 1];
const DY = [0, 1, 0, -1, 1, 1, -1, -1];

/** The pieces of a mask: four-connected, or eight with `eight`. `label` holds each cell's piece. */
export function pieces(
  mask: ArrayLike<number>,
  w: number,
  h: number,
  eight = false,
): { label: Int32Array; list: Piece[] } {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const list: Piece[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]! >= 0) continue;
    const id = list.length;
    const p: Piece = { cells: [], edge: false, x0: w, y0: h, x1: -1, y1: -1 };
    let sp = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const i = stack[--sp]!;
      p.cells.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) p.edge = true;
      if (x < p.x0) p.x0 = x;
      if (x > p.x1) p.x1 = x;
      if (y < p.y0) p.y0 = y;
      if (y > p.y1) p.y1 = y;
      for (let d = 0; d < (eight ? 8 : 4); d++) {
        const xx = x + DX[d]!;
        const yy = y + DY[d]!;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = yy * w + xx;
        if (mask[v] && label[v]! < 0) {
          label[v] = id;
          stack[sp++] = v;
        }
      }
    }
    list.push(p);
  }
  return { label, list };
}

/** The outer boundary of a piece, as cell positions in order (Moore-neighbour tracing). */
function traceBoundary(label: Int32Array, id: number, w: number, h: number, start: number): Px[] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === id;
  // Clockwise from west.
  const ORDER: Px[] = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  let cx = start % w;
  let cy = (start / w) | 0;
  let bx = cx - 1;
  let by = cy;
  const sx = cx;
  const sy = cy;
  const out: Px[] = [[cx, cy]];
  for (let guard = 0; guard < w * h * 2; guard++) {
    let k0 = ORDER.findIndex(([dx, dy]) => cx + dx === bx && cy + dy === by);
    if (k0 < 0) k0 = 0;
    let found = false;
    for (let j = 1; j <= 8; j++) {
      const k = (k0 + j) % 8;
      const nx = cx + ORDER[k]![0];
      const ny = cy + ORDER[k]![1];
      if (inside(nx, ny)) {
        const back = ORDER[(k0 + j - 1) % 8]!;
        bx = cx + back[0];
        by = cy + back[1];
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found || (cx === sx && cy === sy)) break;
    out.push([cx, cy]);
  }
  return out;
}

/**
 * The outline of the largest piece of a mask on a grid of `cell`-pixel cells, smoothed and
 * thinned to `eps` pixels; null when the mask is empty or the piece too small to outline.
 */
export function outlineOf(
  mask: Uint8Array,
  w: number,
  h: number,
  cell: number,
  eps: number,
): Px[] | null {
  const { label, list } = pieces(mask, w, h, true);
  if (list.length === 0) return null;
  let big = 0;
  for (let k = 1; k < list.length; k++) {
    if (list[k]!.cells.length > list[big]!.cells.length) big = k;
  }
  const piece = list[big]!;
  if (piece.cells.length < 3) return null;
  let start = piece.cells[0]!;
  for (const c of piece.cells) if (c < start) start = c;
  let ring = traceBoundary(label, big, w, h, start).map(([x, y]): Px => [
    (x + 0.5) * cell - 0.5,
    (y + 0.5) * cell - 0.5,
  ]);
  if (ring.length < 3) return null;
  ring = smoothRing(smoothRing(ring));
  const thin = simplifyRing(ring, eps);
  return thin.length >= 3 ? thin : null;
}

/** Marks the cells whose middles lie inside a ring (even-odd) with `value`. */
export function fillRing(
  ring: readonly Px[],
  w: number,
  h: number,
  cell: number,
  out: Uint8Array = new Uint8Array(w * h),
  value = 1,
): Uint8Array {
  const n = ring.length;
  if (n < 3) return out;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of ring) {
    top = Math.min(top, p[1]);
    bottom = Math.max(bottom, p[1]);
  }
  const xs: number[] = [];
  const y0 = Math.max(0, Math.floor((top + 0.5) / cell));
  const y1 = Math.min(h - 1, Math.ceil((bottom + 0.5) / cell));
  for (let y = y0; y <= y1; y++) {
    const py = (y + 0.5) * cell - 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      if (a[1] <= py !== b[1] <= py) xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k]! + 0.5) / cell - 0.5));
      const to = Math.min(w - 1, Math.floor((xs[k + 1]! + 0.5) / cell - 0.5));
      for (let x = from; x <= to; x++) out[y * w + x] = value;
    }
  }
  return out;
}

/** Four-way steps from the marked cells to every cell, up to `most`. */
export function stepsFrom(
  seed: ArrayLike<number>,
  w: number,
  h: number,
  most: number,
): Float32Array {
  const n = w * h;
  const dist = new Float32Array(n).fill(most);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (seed[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const next = dist[i]! + 1;
    if (next >= most) continue;
    const x = i % w;
    if (x > 0 && dist[i - 1]! > next) {
      dist[i - 1] = next;
      queue[tail++] = i - 1;
    }
    if (x < w - 1 && dist[i + 1]! > next) {
      dist[i + 1] = next;
      queue[tail++] = i + 1;
    }
    if (i >= w && dist[i - w]! > next) {
      dist[i - w] = next;
      queue[tail++] = i - w;
    }
    if (i < n - w && dist[i + w]! > next) {
      dist[i + w] = next;
      queue[tail++] = i + w;
    }
  }
  return dist;
}

export interface NearCell {
  /** The cell. */
  i: number;
  /** Its distance from the line, in pixels. */
  d: number;
  /** How far along the line its nearest point is, 0 to 1. */
  t: number;
  /** Which side of the line it lies on: 1 left as drawn (on screen), -1 right. */
  side: number;
}

/** The cells of a grid within `reach` pixels of a line (a single point is a line too). */
export function cellsNear(
  line: readonly Px[],
  w: number,
  h: number,
  cell: number,
  reach: number,
): NearCell[] {
  const out: NearCell[] = [];
  if (line.length === 0) return out;
  const pts = line.length === 1 ? [line[0]!, line[0]!] : line;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  }
  const total = cum[cum.length - 1]! || 1;
  const cx0 = Math.max(0, Math.floor((x0 - reach + 0.5) / cell));
  const cx1 = Math.min(w - 1, Math.ceil((x1 + reach + 0.5) / cell));
  const cy0 = Math.max(0, Math.floor((y0 - reach + 0.5) / cell));
  const cy1 = Math.min(h - 1, Math.ceil((y1 + reach + 0.5) / cell));
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const px = (x + 0.5) * cell - 0.5;
      const py = (y + 0.5) * cell - 0.5;
      let best = Infinity;
      let bt = 0;
      let side = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0;
        const d = Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
        if (d < best) {
          best = d;
          bt = (cum[i - 1]! + t * Math.sqrt(l)) / total;
          side = Math.sign(dx * (py - a[1]) - dy * (px - a[0]));
        }
      }
      if (best <= reach) out.push({ i: y * w + x, d: best, t: bt, side });
    }
  }
  return out;
}

/** The cells a line passes through, in order, each once. */
export function cellsAlong(line: readonly Px[], w: number, h: number, cell: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const at = (p: Px) => {
    const x = Math.max(0, Math.min(w - 1, Math.floor((p[0] + 0.5) / cell)));
    const y = Math.max(0, Math.min(h - 1, Math.floor((p[1] + 0.5) / cell)));
    return y * w + x;
  };
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)]!;
    const b = line[i]!;
    const steps = Math.max(1, Math.ceil((Math.hypot(b[0] - a[0], b[1] - a[1]) / cell) * 2));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      const c = at([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

/** A field on one grid read onto another of the same picture, between the four nearest cells. */
export function resize(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  const kx = sw / dw;
  const ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * ky - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * kx - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const a = src[y0 * sw + x0]!;
      const b = src[y0 * sw + x1]!;
      const c = src[y1 * sw + x0]!;
      const d = src[y1 * sw + x1]!;
      out[y * dw + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

/** A mask on one grid read onto another of the same picture, by the nearest cell. */
export function resizeMask(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw))]!;
    }
  }
  return out;
}
