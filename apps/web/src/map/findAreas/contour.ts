/**
 * From a mask of chosen pixels to closed outlines: marching squares, with each ring's role (the
 * outside of a piece, or a hole in one) read from its direction. Then the rings are grouped into
 * pieces, each with its holes.
 *
 * What a zone does with pieces and holes is decided elsewhere (findAreas/zones.ts): this only
 * says what the outlines are.
 */

/** A point in the picture's pixels: pixel (x, y) has its middle at (x, y). */
export type Px = [number, number];

/**
 * A mask over part of a picture, or beyond it: pixel (x, y) of the mask is pixel
 * (x + ox, y + oy) of the picture. Outside the mask is outside.
 */
export interface Mask {
  ox: number;
  oy: number;
  w: number;
  h: number;
  data: Uint8Array;
}

export interface Ring {
  points: Px[];
  role: "outer" | "hole";
  /** The area it encloses, in square pixels. */
  area: number;
}

/** A piece of the chosen land: its outside, and the holes in it. */
export interface Piece {
  outer: Px[];
  holes: Px[][];
  area: number;
}

/** Twice the signed area by the shoelace sum: above zero for an outside ring here. */
export function signedArea(p: readonly Px[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    s += p[j]![0] * p[i]![1] - p[i]![0] * p[j]![1];
  }
  return s / 2;
}

/** Whether a point is inside a ring, by the even-odd rule. */
export function inRing(pt: Px, p: readonly Px[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * The outlines of a mask. Each edge between an inside and an outside pixel is cut at its middle;
 * the cuts of each 2×2 cell are joined with the inside always on the right (on the screen, y
 * down), so every corner has one way on and the rings come out closed and directed: an outside
 * ring runs clockwise on the screen, a hole the other way. Two inside pixels that touch only at a
 * corner are kept apart. Rings enclosing less than `smallest` square pixels are dropped.
 */
export function traceMask(mask: Mask, smallest = 30): Ring[] {
  const { w, h, data, ox, oy } = mask;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]!);
  // Corners: the middles of horizontal edges, (x + 0.5, y), then of vertical ones, (x, y + 0.5).
  const HW = w + 1;
  const HN = (h + 2) * HW;
  const VW = w + 2;
  const hor = (x: number, y: number) => (y + 1) * HW + (x + 1);
  const ver = (x: number, y: number) => HN + (y + 1) * VW + (x + 1);
  const total = HN + (h + 1) * VW;
  const next = new Int32Array(total).fill(-1);
  const starts: number[] = [];
  const link = (from: number, to: number) => {
    next[from] = to;
    starts.push(from);
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const k = at(x, y) * 8 + at(x + 1, y) * 4 + at(x + 1, y + 1) * 2 + at(x, y + 1);
      if (k === 0 || k === 15) continue;
      const T = hor(x, y);
      const B = hor(x, y + 1);
      const L = ver(x, y);
      const R = ver(x + 1, y);
      switch (k) {
        case 8:
          link(T, L);
          break;
        case 7:
          link(L, T);
          break;
        case 4:
          link(R, T);
          break;
        case 11:
          link(T, R);
          break;
        case 2:
          link(B, R);
          break;
        case 13:
          link(R, B);
          break;
        case 1:
          link(L, B);
          break;
        case 14:
          link(B, L);
          break;
        case 12:
          link(R, L);
          break;
        case 3:
          link(L, R);
          break;
        case 6:
          link(B, T);
          break;
        case 9:
          link(T, B);
          break;
        case 10:
          link(T, L);
          link(B, R);
          break;
        case 5:
          link(R, T);
          link(L, B);
          break;
      }
    }
  }
  const place = (v: number): Px => {
    if (v < HN) {
      const y = Math.floor(v / HW) - 1;
      const x = (v % HW) - 1;
      return [x + 0.5 + ox, y + oy];
    }
    const u = v - HN;
    const y = Math.floor(u / VW) - 1;
    const x = (u % VW) - 1;
    return [x + ox, y + 0.5 + oy];
  };
  const rings: Ring[] = [];
  for (const start of starts) {
    if (next[start]! < 0) continue;
    const points: Px[] = [];
    let v = start;
    while (v >= 0 && next[v]! >= 0) {
      points.push(place(v));
      const to = next[v]!;
      next[v] = -2;
      v = to;
    }
    if (points.length < 4) continue;
    const signed = signedArea(points);
    if (Math.abs(signed) < smallest) continue;
    rings.push({ points, role: signed > 0 ? "outer" : "hole", area: Math.abs(signed) });
  }
  return rings;
}

/**
 * The rings as pieces: each outside ring with the holes that lie in it (in the smallest outside
 * ring around them), largest piece first. A hole with no ring around it is dropped.
 */
export function groupRings(rings: readonly Ring[]): Piece[] {
  const outers = rings
    .filter((r) => r.role === "outer")
    .sort((a, b) => a.area - b.area)
    .map((r) => ({ ring: r, holes: [] as Px[][] }));
  for (const hole of rings) {
    if (hole.role !== "hole") continue;
    const around = outers.find(
      (o) => o.ring.area > hole.area && inRing(hole.points[0]!, o.ring.points),
    );
    around?.holes.push(hole.points);
  }
  return outers
    .map((o) => ({ outer: o.ring.points, holes: o.holes, area: o.ring.area }))
    .sort((a, b) => b.area - a.area);
}
