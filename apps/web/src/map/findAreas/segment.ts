/**
 * Cuts the whole picture into areas up front, so that pointing at the map is one lookup (the area
 * at this pixel) and a whole area can be lit at once. A graph-based region merge in the manner of
 * Felzenszwalb–Huttenlocher, kept simple; see docs/designs/stage-19-find-areas.md, "The technique".
 */
import type { Ink } from "./ink.ts";
import type { LabPicture } from "./lab.ts";

export interface AreaOptions {
  /** How close two colours must be (ΔE) to count as one area. */
  tolerance: number;
  /** Long thin dark lines are walls that an area does not cross. */
  stopAtLines: boolean;
  /** Letters and small marks are looked past: the area flows under them. */
  ignoreMarks: boolean;
}

export const DEFAULT_OPTIONS: AreaOptions = { tolerance: 12, stopAtLines: true, ignoreMarks: true };

/** The label of a piece of ink shown as its own area while marks are not ignored. */
export const INK = -2;

export interface Areas {
  w: number;
  h: number;
  /** The area of each pixel: 0 and up, or `INK`. */
  labels: Int32Array;
  count: number;
  /** Each area's pixel count and box. */
  size: Int32Array;
  x0: Int32Array;
  y0: Int32Array;
  x1: Int32Array;
  y1: Int32Array;
  /** Each area's pixels, packed: those of area `a` are `pixels[offsets[a]..offsets[a + 1]]`. */
  offsets: Int32Array;
  pixels: Int32Array;
}

/** The smallest area kept; anything smaller is a crumb given to its neighbours. */
export const crumbSize = (w: number, h: number): number =>
  Math.max(16, Math.round((w * h) / 15000));

/**
 * The areas of a picture. `wrap` joins the left and right edges, for a globe's picture that goes
 * all the way round, so that an area across the 180th meridian is one area.
 */
export function findAreas(pic: LabPicture, ink: Ink, options: AreaOptions, wrap = false): Areas {
  const { w, h, L, A, B } = pic;
  const n = w * h;
  const { tolerance: tol, stopAtLines, ignoreMarks } = options;
  // 1. Walls, and marks set aside.
  const ex = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    ex[i] = (stopAtLines && ink.line[i]) || (ignoreMarks && ink.mark[i]) ? 1 : 0;
  }
  // 2. Colours smoothed over 5×5, leaving the walls out, so a border does not bleed into a country.
  const W1 = w + 1;
  const R2 = 2;
  const I0 = new Float64Array(W1 * (h + 1));
  const IL = new Float64Array(W1 * (h + 1));
  const IA = new Float64Array(W1 * (h + 1));
  const IB = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let c = 0;
    let l = 0;
    let a = 0;
    let b = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ex[i]) {
        c++;
        l += L[i]!;
        a += A[i]!;
        b += B[i]!;
      }
      const k = (y + 1) * W1 + x + 1;
      const u = y * W1 + x + 1;
      I0[k] = I0[u]! + c;
      IL[k] = IL[u]! + l;
      IA[k] = IA[u]! + a;
      IB[k] = IB[u]! + b;
    }
  }
  const bl = new Float32Array(n);
  const ba = new Float32Array(n);
  const bb = new Float32Array(n);
  const box = (I: Float64Array, y0: number, y1: number, x0: number, x1: number) =>
    I[y1 + x1]! - I[y0 + x1]! - I[y1 + x0]! + I[y0 + x0]!;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R2) * W1;
    const y1 = Math.min(h, y + R2 + 1) * W1;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R2);
      const x1 = Math.min(w, x + R2 + 1);
      const i = y * w + x;
      const c = box(I0, y0, y1, x0, x1);
      if (c > 0) {
        bl[i] = box(IL, y0, y1, x0, x1) / c;
        ba[i] = box(IA, y0, y1, x0, x1) / c;
        bb[i] = box(IB, y0, y1, x0, x1) / c;
      } else {
        bl[i] = L[i]!;
        ba[i] = A[i]!;
        bb[i] = B[i]!;
      }
    }
  }
  // 3. Neighbouring pixels, sorted by how different they are (a bucket sort), then joined
  // smallest first, when the pixels are alike and the two areas' average colours are too.
  const tolEdge = Math.max(1.5, tol * 0.45);
  const Q = 4;
  const NB = Math.ceil(tolEdge * Q) + 1;
  const qq = new Int16Array(2 * n).fill(-1);
  const cnt = new Int32Array(NB + 1);
  const right = (i: number) => {
    const x = i % w;
    return x < w - 1 ? i + 1 : wrap ? i - (w - 1) : -1;
  };
  const weigh = (i: number, j: number) =>
    Math.hypot(bl[i]! - bl[j]!, ba[i]! - ba[j]!, bb[i]! - bb[j]!);
  for (let i = 0; i < n; i++) {
    if (ex[i]) continue;
    const r = right(i);
    if (r >= 0 && !ex[r]) {
      const d = weigh(i, r);
      if (d < tolEdge) {
        const q = (d * Q) | 0;
        qq[2 * i] = q;
        cnt[q + 1]!++;
      }
    }
    const down = i + w;
    if (down < n && !ex[down]) {
      const d = weigh(i, down);
      if (d < tolEdge) {
        const q = (d * Q) | 0;
        qq[2 * i + 1] = q;
        cnt[q + 1]!++;
      }
    }
  }
  for (let q = 0; q < NB; q++) cnt[q + 1]! += cnt[q]!;
  const ne = cnt[NB]!;
  const edges = new Int32Array(ne);
  for (let e = 0; e < 2 * n; e++) if (qq[e]! >= 0) edges[cnt[qq[e]!]!++] = e;
  const parent = new Int32Array(n);
  const sz = new Int32Array(n);
  const sL = new Float64Array(n);
  const sA = new Float64Array(n);
  const sB = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
    sz[i] = 1;
    sL[i] = bl[i]!;
    sA[i] = ba[i]!;
    sB[i] = bb[i]!;
  }
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const tol2 = tol * tol;
  for (let k = 0; k < ne; k++) {
    const e = edges[k]!;
    const i = e >> 1;
    const j = e & 1 ? i + w : right(i);
    let a = find(i);
    let b = find(j);
    if (a === b) continue;
    const dl = sL[a]! / sz[a]! - sL[b]! / sz[b]!;
    const da = sA[a]! / sz[a]! - sA[b]! / sz[b]!;
    const db = sB[a]! / sz[a]! - sB[b]! / sz[b]!;
    if (dl * dl + da * da + db * db > tol2) continue;
    if (sz[a]! < sz[b]!) [a, b] = [b, a];
    parent[b] = a;
    sz[a]! += sz[b]!;
    sL[a]! += sL[b]!;
    sA[a]! += sA[b]!;
    sB[a]! += sB[b]!;
  }
  // 4. Name the areas. Crumbs, and pieces mostly of marks while marks are not ignored, are dealt
  // with below.
  const labels = new Int32Array(n);
  const root = new Int32Array(n);
  const marks = new Int32Array(n);
  const id = new Int32Array(n).fill(-9);
  for (let i = 0; i < n; i++) {
    if (ex[i]) continue;
    root[i] = find(i);
    marks[root[i]!]! += ink.mark[i]!;
  }
  const smallest = crumbSize(w, h);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (ex[i]) {
      labels[i] = -1;
      continue;
    }
    const r = root[i]!;
    if (id[r] === -9) {
      id[r] = !ignoreMarks && marks[r]! * 2 > sz[r]! ? INK : sz[r]! < smallest ? -1 : count++;
    }
    labels[i] = id[r]!;
  }
  // A sliver (on average under 3 px across, such as the blur's band where two colours meet
  // with no line between them) is a crumb too.
  if (count > 0) {
    const bx0 = new Int32Array(count).fill(w);
    const by0 = new Int32Array(count).fill(h);
    const bx1 = new Int32Array(count).fill(-1);
    const by1 = new Int32Array(count).fill(-1);
    const pixelsOf = new Int32Array(count);
    for (let i = 0; i < n; i++) {
      const l = labels[i]!;
      if (l < 0) continue;
      const x = i % w;
      const y = (i / w) | 0;
      pixelsOf[l]!++;
      if (x < bx0[l]!) bx0[l] = x;
      if (x > bx1[l]!) bx1[l] = x;
      if (y < by0[l]!) by0[l] = y;
      if (y > by1[l]!) by1[l] = y;
    }
    const remap = new Int32Array(count);
    let kept = 0;
    for (let l = 0; l < count; l++) {
      const long = Math.max(bx1[l]! - bx0[l]! + 1, by1[l]! - by0[l]! + 1);
      remap[l] = pixelsOf[l]! / long < 3 ? -1 : kept++;
    }
    if (kept > 0 && kept < count) {
      for (let i = 0; i < n; i++) if (labels[i]! >= 0) labels[i] = remap[labels[i]!]!;
      count = kept;
    }
  }
  // 5. Walls, looked-past marks and crumbs go to the nearest area (a breadth-first flood from all
  // areas at once), so two neighbours meet in the middle of the line between them.
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) if (labels[i]! >= 0) queue[tail++] = i;
  const take = (j: number, l: number) => {
    if (labels[j] === -1) {
      labels[j] = l;
      queue[tail++] = j;
    }
  };
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    const l = labels[i]!;
    if (x > 0) take(i - 1, l);
    else if (wrap) take(i + w - 1, l);
    if (x < w - 1) take(i + 1, l);
    else if (wrap) take(i - (w - 1), l);
    if (i >= w) take(i - w, l);
    if (i + w < n) take(i + w, l);
  }
  // A picture with no area at all (every pixel ink) is one area.
  if (count === 0) {
    for (let i = 0; i < n; i++) if (labels[i] === -1) labels[i] = 0;
    count = 1;
  }
  // 6. Each area's pixels, box and size.
  const size = new Int32Array(count);
  const x0 = new Int32Array(count).fill(w);
  const y0 = new Int32Array(count).fill(h);
  const x1 = new Int32Array(count).fill(-1);
  const y1 = new Int32Array(count).fill(-1);
  for (let i = 0; i < n; i++) {
    const l = labels[i]!;
    if (l < 0) continue;
    size[l]!++;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0[l]!) x0[l] = x;
    if (x > x1[l]!) x1[l] = x;
    if (y < y0[l]!) y0[l] = y;
    if (y > y1[l]!) y1[l] = y;
  }
  const offsets = new Int32Array(count + 1);
  for (let l = 0; l < count; l++) offsets[l + 1] = offsets[l]! + size[l]!;
  const fill = offsets.slice(0, count);
  const pixels = new Int32Array(offsets[count]!);
  for (let i = 0; i < n; i++) {
    const l = labels[i]!;
    if (l >= 0) pixels[fill[l]!++] = i;
  }
  return { w, h, labels, count, size, x0, y0, x1, y1, offsets, pixels };
}
