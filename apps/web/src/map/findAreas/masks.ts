/** Masks of chosen pixels: of areas, and of a zone's own outline for "Add to". */
import type { Mask, Px } from "./contour.ts";
import type { Areas } from "./segment.ts";

/**
 * A mask of the chosen areas, over their joint box. On a globe's picture that goes all the way
 * round, areas that reach both side edges are one stretch across the 180th meridian: the mask is
 * then turned so its cut falls in the widest run of empty columns, and its x runs past the
 * picture's width (a longitude past 180, brought back when the zone is written).
 */
export function areaMask(areas: Areas, ids: Iterable<number>, round: boolean): Mask {
  const { w } = areas;
  const list = [...ids].filter((a) => a >= 0 && a < areas.count);
  if (list.length === 0) return { ox: 0, oy: 0, w: 0, h: 0, data: new Uint8Array(0) };
  let x0 = w;
  let y0 = areas.h;
  let x1 = -1;
  let y1 = -1;
  for (const a of list) {
    x0 = Math.min(x0, areas.x0[a]!);
    y0 = Math.min(y0, areas.y0[a]!);
    x1 = Math.max(x1, areas.x1[a]!);
    y1 = Math.max(y1, areas.y1[a]!);
  }
  let ox = x0;
  let mw = x1 - x0 + 1;
  if (round && x0 === 0 && x1 === w - 1) {
    const used = new Uint8Array(w);
    for (const a of list) {
      for (let k = areas.offsets[a]!; k < areas.offsets[a + 1]!; k++)
        used[areas.pixels[k]! % w] = 1;
    }
    // The widest run of empty columns, going round.
    let best = -1;
    let bestLength = 0;
    for (let start = 0; start < w; start++) {
      if (used[start] || !used[(start - 1 + w) % w]) continue;
      let length = 0;
      while (length < w && !used[(start + length) % w]) length++;
      if (length > bestLength) {
        bestLength = length;
        best = start;
      }
    }
    if (best >= 0) {
      // The mask starts just after the empty run and goes once round.
      ox = (best + bestLength) % w;
      if (ox === 0) ox = w;
      mw = w - bestLength;
    }
  }
  const mh = y1 - y0 + 1;
  const data = new Uint8Array(mw * mh);
  for (const a of list) {
    for (let k = areas.offsets[a]!; k < areas.offsets[a + 1]!; k++) {
      const i = areas.pixels[k]!;
      let x = i % w;
      if (x < ox) x += w;
      const mx = x - ox;
      if (mx < 0 || mx >= mw) continue;
      data[(((i / w) | 0) - y0) * mw + mx] = 1;
    }
  }
  return { ox, oy: y0, w: mw, h: mh, data };
}

/**
 * The mask with a polygon (a zone's outline in the picture's pixels) added to it, by the
 * even-odd rule at each pixel's middle. The mask grows to hold it, but never past `limit`, a box
 * of pixels `[x0, y0, x1, y1]` (so a zone far beyond the picture cannot ask for a huge mask).
 */
export function withPolygon(
  mask: Mask,
  ring: readonly Px[],
  limit: [number, number, number, number],
): Mask {
  if (ring.length < 3) return mask;
  let [x0, y0, x1, y1] =
    mask.w > 0
      ? [mask.ox, mask.oy, mask.ox + mask.w - 1, mask.oy + mask.h - 1]
      : [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    x0 = Math.min(x0, Math.floor(x));
    y0 = Math.min(y0, Math.floor(y));
    x1 = Math.max(x1, Math.ceil(x));
    y1 = Math.max(y1, Math.ceil(y));
  }
  x0 = Math.max(x0, limit[0]);
  y0 = Math.max(y0, limit[1]);
  x1 = Math.min(x1, limit[2]);
  y1 = Math.min(y1, limit[3]);
  if (x1 < x0 || y1 < y0) return mask;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.data[y * mask.w + x]) continue;
      const mx = x + mask.ox - x0;
      const my = y + mask.oy - y0;
      if (mx >= 0 && my >= 0 && mx < w && my < h) data[my * w + mx] = 1;
    }
  }
  const crossings: number[] = [];
  for (let row = 0; row < h; row++) {
    const py = row + y0;
    crossings.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!;
      const [bx, by] = ring[i]!;
      if (ay > py !== by > py) crossings.push(ax + ((py - ay) * (bx - ax)) / (by - ay));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(x0, Math.ceil(crossings[k]!));
      const to = Math.min(x1, Math.floor(crossings[k + 1]!));
      for (let x = from; x <= to; x++) data[row * w + (x - x0)] = 1;
    }
  }
  return { ox: x0, oy: y0, w, h, data };
}
