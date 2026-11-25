/**
 * Finding hints: what a painted map's picture says about height, read the way a person reads it.
 * Water joined to the map's edge is sea and its edge the coast; enclosed water is a lake; a blue
 * line is a river, flowing to the sea or a lake at one end (or into the river it joins, or towards
 * the end drawn wider); crowds of small dark marks wider than tall are mountain symbols, whose
 * spine is a ridge and whose largest symbols are peaks; short level greenish strokes are reeds,
 * a marsh; red-brown lines are roads, a weak hint of gentle ground. Forests are looked at and left
 * out: they grow on hills and plains alike. No DOM: it runs in the worker and under the tests.
 */
import type { Px } from "../findAreas/contour.ts";
import { boxMean } from "../findAreas/ink.ts";
import type { LabPicture } from "../findAreas/lab.ts";
import { inkMasks, type PictureGround } from "../findPaths/classes.ts";
import { lineLength, simplifyOpen, smoothOpen } from "../findPaths/lines.ts";
import type { TraceReply } from "../findPaths/protocol.ts";
import { outlineOf, pieces, stepsFrom } from "./masks.ts";
import type { Found, FoundHint } from "./types.ts";

export interface HintPicture {
  pic: LabPicture;
  ground: PictureGround;
  /** Follows the painted line nearest a point, as Find paths' Trace does (with its branches). */
  trace: (at: Px) => TraceReply;
  /** Kilometres a pixel of the working copy, for the sizes said in words; null without a scale. */
  kmPerPx?: number | null;
}

/** Found hints at or above this start in use; the others wait (decision 2). */
export const LIKELY = 0.7;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const COMPASS = [
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
];
/** The way from a line's first point to its last, as a compass word (north is up). */
export const compass = (line: readonly Px[]): string => {
  const a = line[0]!;
  const b = line[line.length - 1]!;
  return COMPASS[((Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 4)) % 8) + 8) % 8]!;
};

interface Symbol_ {
  x: number;
  y: number;
  w: number;
}

/** Looks at a picture once for everything it says about height. */
export function findHints(src: HintPicture): Found {
  const t0 = performance.now();
  const { pic, ground } = src;
  const { w, h } = pic;
  const g = ground.grid;
  const gw = g.w;
  const gh = g.h;
  const gn = gw * gh;
  const c = g.cell;
  /** Sizes are tuned on a picture 960 pixels across; a larger picture's land is drawn larger. */
  const S = Math.max(w, h) / 960;
  const hints: FoundHint[] = [];
  const notUsed: string[] = [];
  const cellOf = (p: Px) => {
    const x = Math.max(0, Math.min(gw - 1, Math.floor((p[0] + 0.5) / c)));
    const y = Math.max(0, Math.min(gh - 1, Math.floor((p[1] + 0.5) / c)));
    return y * gw + x;
  };
  const cellMiddle = (i: number): Px => [
    ((i % gw) + 0.5) * c - 0.5,
    (((i / gw) | 0) + 0.5) * c - 0.5,
  ];
  const area = (cells: number) => {
    const k = src.kmPerPx;
    return k ? `${Math.round(cells * c * c * k * k).toLocaleString("en")} km²` : null;
  };

  // ---- Water: joined to the map's edge it is sea; enclosed and larger than a pond, a lake.
  const water = pieces(ground.water, gw, gh);
  const sea = new Uint8Array(gn);
  const lake = new Uint8Array(gn);
  let seaCells = 0;
  for (const p of water.list) {
    if (!p.edge) continue;
    for (const i of p.cells) sea[i] = 1;
    seaCells += p.cells.length;
  }
  if (seaCells > 0) {
    hints.push({
      kind: "sea",
      conf: 0.97,
      why: `Blue-grey water joined to the map's edge (${Math.round((seaCells / gn) * 100)}% of the picture). The sea floor deepens away from the shore.`,
    });
    hints.push({
      kind: "coast",
      conf: 0.95,
      why: "Where the sea meets the land: held at sea level.",
    });
  }
  const leastLake = Math.max(400 * S * S, 0.0004 * w * h) / (c * c);
  for (const p of water.list) {
    // Larger than a pond, and not a wide stretch of a river's ink.
    if (p.edge || p.cells.length < leastLake) continue;
    const m = new Uint8Array(gn);
    for (const i of p.cells) m[i] = 1;
    // At least ten pixels across somewhere: deeper inside than a river's ink is wide.
    const inside = stepsFrom(
      m.map((v) => 1 - v),
      gw,
      gh,
      64,
    );
    let deepest = 0;
    for (const i of p.cells) deepest = Math.max(deepest, inside[i]!);
    if (deepest * c < 5) continue;
    for (const i of p.cells) lake[i] = 1;
    const ring = outlineOf(m, gw, gh, c, Math.max(1.2, c * 0.8));
    if (!ring) continue;
    const size = area(p.cells.length);
    hints.push({
      kind: "lake",
      points: ring,
      conf: 0.86,
      why: `Blue-grey water enclosed by land${size ? ` (${size})` : ""}: a lake fills a hollow, flat on top.`,
    });
  }

  // ---- Painted rivers, each followed end to end with its branches.
  const reach = Math.max(1, Math.round((10 * S) / c));
  const wetAt = (p: Px): "sea" | "lake" | null => {
    const i = cellOf(p);
    const x = i % gw;
    const y = (i / gw) | 0;
    let found: "sea" | "lake" | null = null;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const v = yy * gw + xx;
        if (sea[v]) return "sea";
        if (lake[v]) found = "lake";
      }
    }
    return found;
  };
  const { dark } = inkMasks(pic);
  let meanA = 0;
  let meanB = 0;
  {
    const stride = Math.max(1, Math.floor((w * h) / 40_000));
    let k = 0;
    for (let i = 0; i < w * h; i += stride) {
      meanA += pic.A[i]!;
      meanB += pic.B[i]!;
      k++;
    }
    meanA /= k;
    meanB /= k;
  }
  /** How much blue ink there is round a point: a river is drawn wider downstream. */
  const inkWidth = (p: Px) => {
    let k = 0;
    const r = Math.max(3, Math.round(5 * S));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(p[0] + dx);
        const y = Math.round(p[1] + dy);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (dark[i] && pic.B[i]! < meanB - 6) k++;
      }
    }
    return k;
  };
  const covered = new Uint8Array(gn);
  const coverR = Math.max(1, Math.ceil((6 * S) / c));
  const cover = (line: readonly Px[]) => {
    for (let k = 0; k < line.length; k++) {
      const a = line[Math.max(0, k - 1)]!;
      const b = line[k]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / c));
      for (let s = 0; s <= steps; s++) {
        const i = cellOf([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
        const x = i % gw;
        const y = (i / gw) | 0;
        for (let dy = -coverR; dy <= coverR; dy++) {
          for (let dx = -coverR; dx <= coverR; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) covered[yy * gw + xx] = 1;
          }
        }
      }
    }
  };
  const coverCell = (i: number) => {
    const x = i % gw;
    const y = (i / gw) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) covered[yy * gw + xx] = 1;
      }
    }
  };
  /** Whether most of a line lies where a line already found does: the same line found again. */
  const foundBefore = (line: readonly Px[]) => {
    let on = 0;
    for (const p of line) if (covered[cellOf(p)]) on++;
    return on > line.length * 0.5;
  };
  /** An uncovered cell of a mask with the most uncovered cells of it round it; -1 when none. */
  const seedIn = (mask: Uint8Array) => {
    let seed = -1;
    let best = 0;
    for (let i = 0; i < gn; i++) {
      if (!mask[i] || covered[i] || ground.water[i]) continue;
      let k = 0;
      const x = i % gw;
      const y = (i / gw) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const v = yy * gw + xx;
          if (mask[v] && !covered[v]) k++;
        }
      }
      if (k > best) {
        best = k;
        seed = i;
      }
      if (k >= 7) break;
    }
    return best >= 4 ? seed : -1;
  };
  const shortest = 30 * S;
  for (let guard = 0; guard < 30; guard++) {
    const seed = seedIn(ground.river);
    if (seed < 0) break;
    const r = src.trace(cellMiddle(seed));
    if (!r.ok || r.kind !== "river" || r.loop) {
      coverCell(seed);
      if (r.ok) cover(r.points);
      continue;
    }
    const again = foundBefore(r.points);
    cover(r.points);
    for (const b of r.branches) cover(b);
    if (again || lineLength(r.points) < shortest) continue;
    let main = r.points.slice();
    const e0 = wetAt(main[0]!);
    const e1 = wetAt(main[main.length - 1]!);
    let why: string;
    let conf: number;
    if ((e1 && !e0) || (e1 === "sea" && e0 !== "sea")) {
      why = `Blue line that reaches the ${e1} at its ${compass(main)} end: it flows that way.`;
      conf = 0.92;
    } else if (e0) {
      main.reverse();
      why = `Blue line that reaches the ${e0} at its ${compass(main)} end: it flows that way.`;
      conf = 0.92;
    } else {
      const a = inkWidth(main[Math.floor(main.length * 0.1)]!);
      const b = inkWidth(main[Math.floor(main.length * 0.9)]!);
      if (a > b) main.reverse();
      why = `Drawn wider at its ${compass(main)} end: probably flows that way.`;
      conf = 0.62;
    }
    main = simplifyOpen(main, 1.2 * Math.max(1, S));
    hints.push({ kind: "river", points: main, conf, why });
    for (const branch of r.branches) {
      let line = branch.slice();
      if (lineLength(line) < shortest) continue;
      // A branch ends on the river it joins, which is where it flows; unless it rises by water.
      if (wetAt(line[0]!) && !wetAt(line[line.length - 1]!)) line = line.reverse();
      hints.push({
        kind: "river",
        points: simplifyOpen(line, 1.2 * Math.max(1, S)),
        conf: 0.84,
        why: "Joins a larger river: flows into it, so it lies above it.",
      });
    }
  }

  // ---- Painted roads: a weak hint that the ground is gentle.
  for (let guard = 0; guard < 12; guard++) {
    const seed = seedIn(ground.road);
    if (seed < 0) break;
    const r = src.trace(cellMiddle(seed));
    if (!r.ok || r.kind !== "road") {
      coverCell(seed);
      if (r.ok) cover(r.points);
      continue;
    }
    const again = foundBefore(r.points);
    cover(r.points);
    if (again || lineLength(r.points) < shortest * 2) continue;
    hints.push({
      kind: "road",
      points: simplifyOpen(r.points, 1.5 * Math.max(1, S)),
      conf: 0.35,
      why: "A road: roads keep to gentle ground and cross ranges at passes. A weak hint.",
    });
  }

  // ---- Mountain symbols: small dark marks wider than tall, not blue, red or green.
  const n = w * h;
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!dark[i]) continue;
    const a = pic.A[i]!;
    const b = pic.B[i]!;
    if (b < meanB - 8 || a > meanA + 14 || a < meanA - 6) continue;
    cand[i] = 1;
  }
  const marks = pieces(cand, w, h, true);
  const symbols: Symbol_[] = [];
  for (const p of marks.list) {
    const sw = p.x1 - p.x0 + 1;
    const sh = p.y1 - p.y0 + 1;
    const count = p.cells.length;
    if (count < 10 || sh < 5 || sh > 40 * Math.max(1, S) || sw < 8) continue;
    if (sw / sh < 1.05 || count > sw * sh * 0.7) continue;
    if (ground.water[cellOf([(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2])]) continue;
    // Green as a whole (reeds, trees), its edges blended with the ground: not a mountain.
    let a = 0;
    for (const i of p.cells) a += pic.A[i]!;
    if (a / count < meanA - 4) continue;
    // A chain of symbols drawn touching: cut into pieces about as wide as tall-and-a-half.
    const k = sw > 3 * sh ? Math.round(sw / (1.6 * sh)) : 1;
    if (k > 8) continue;
    for (let j = 0; j < k; j++) {
      symbols.push({ x: p.x0 + ((j + 0.5) * sw) / k, y: (p.y0 + p.y1) / 2, w: sw / k });
    }
  }
  const allWidths = symbols.map((s) => s.w).sort((a, b) => a - b);
  const medAll = allWidths[allWidths.length >> 1] ?? 15;
  /** A symbol's width against the picture's usual one, as a height 0 to 1. */
  const sizeToH = (sw: number) => 0.32 + 0.62 * clamp01((sw / medAll - 0.6) / 0.87);
  const symG = new Float32Array(gn);
  for (const s of symbols) symG[cellOf([s.x, s.y])] = symG[cellOf([s.x, s.y])]! + 1;
  const density = boxMean(
    boxMean(symG, gw, gh, Math.max(1, Math.round((32 * S) / c))),
    gw,
    gh,
    Math.max(1, Math.round((24 * S) / c)),
  );
  let densest = 0;
  for (let i = 0; i < gn; i++) if (density[i]! > densest) densest = density[i]!;
  const high = new Uint8Array(gn);
  for (let i = 0; i < gn; i++) high[i] = density[i]! > densest * 0.2 && !ground.water[i] ? 1 : 0;
  const ranges = pieces(high, gw, gh, true);
  const leastRange = (1200 * S * S) / (c * c);
  const ranked = ranges.list
    .filter((p) => p.cells.length >= leastRange)
    .sort((a, b) => b.cells.length - a.cells.length);
  for (const p of ranked) {
    const m = new Uint8Array(gn);
    for (const i of p.cells) m[i] = 1;
    const mine = symbols.filter((s) => m[cellOf([s.x, s.y])]);
    if (mine.length < 8) continue;
    const ws = mine.map((s) => s.w).sort((a, b) => a - b);
    const med = ws[ws.length >> 1]!;
    const ring = outlineOf(m, gw, gh, c, 4 * Math.max(1, S));
    if (!ring) continue;
    hints.push({
      kind: "highland",
      points: ring,
      h: sizeToH(ws[Math.floor(ws.length * 0.15)]!) * 0.8,
      h2: sizeToH(ws[Math.floor(ws.length * 0.9)]!),
      conf: Math.min(0.9, 0.55 + mine.length / 200),
      why: `${mine.length} mountain symbols drawn close together: high ground.`,
    });
    // The spine: the symbols' main direction, then the size-weighted middle of each stretch.
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const s of mine) {
      const wt = s.w * s.w;
      sx += s.x * wt;
      sy += s.y * wt;
      sw += wt;
    }
    sx /= sw;
    sy /= sw;
    let cxx = 0;
    let cxy = 0;
    let cyy = 0;
    for (const s of mine) {
      const wt = s.w * s.w;
      const dx = s.x - sx;
      const dy = s.y - sy;
      cxx += wt * dx * dx;
      cxy += wt * dx * dy;
      cyy += wt * dy * dy;
    }
    const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const along = mine.map((s) => (s.x - sx) * ux + (s.y - sy) * uy);
    const lo = Math.min(...along);
    const hi = Math.max(...along);
    // Only a chain longer than it is wide has a spine.
    const across = Math.sqrt(Math.max(0, (cxx + cyy) / sw - (hi - lo) ** 2 / 12));
    const bins = Math.max(3, Math.min(8, Math.round((hi - lo) / (70 * S))));
    const spine: { p: Px; w: number }[] = [];
    for (let b = 0; b < bins; b++) {
      let ax = 0;
      let ay = 0;
      let aw = 0;
      let sumW = 0;
      let count = 0;
      mine.forEach((s, k) => {
        const t = (along[k]! - lo) / (hi - lo + 1e-6);
        if (Math.floor(t * bins) !== b) return;
        const wt = s.w ** 3;
        ax += s.x * wt;
        ay += s.y * wt;
        aw += wt;
        sumW += s.w;
        count++;
      });
      if (aw) spine.push({ p: [ax / aw, ay / aw], w: sumW / count });
    }
    if (spine.length >= 2 && hi - lo > 1.5 * across) {
      const ridgeW = spine.reduce((a, s) => a + s.w, 0) / spine.length;
      const line = smoothOpen(
        spine.map((s) => s.p),
        1,
      );
      hints.push({
        kind: "ridge",
        points: line,
        h: sizeToH(ridgeW + medAll * 0.13),
        conf: 0.76,
        why: `The spine of a chain of ${mine.length} mountain symbols, through where they are drawn largest.`,
      });
    }
    // Peaks: the largest symbols, well apart (artists draw higher peaks bigger).
    const big = mine.slice().sort((a, b) => b.w - a.w);
    const apart = 95 * S;
    const peaks: Symbol_[] = [];
    for (const s of big) {
      if (peaks.length >= 3 || s.w < ws[Math.floor(ws.length * 0.8)]!) break;
      if (peaks.some((q) => Math.hypot(q.x - s.x, q.y - s.y) < apart)) continue;
      peaks.push(s);
    }
    for (const s of peaks) {
      const near = mine.filter((q) => Math.hypot(q.x - s.x, q.y - s.y) < 40 * S);
      const mw = near.reduce((a, q) => a + q.w, 0) / near.length;
      hints.push({
        kind: "peak",
        at: [s.x, s.y],
        h: sizeToH(mw + medAll * 0.2),
        conf: Math.min(0.88, 0.5 + (0.06 * ((s.w - med) * 15)) / medAll + 0.03 * near.length),
        why: `Mountain symbols drawn largest here (${Math.round(s.w)} px wide, against ${Math.round(med)} px elsewhere): likely a summit.`,
      });
    }
  }

  // ---- Reed marks: short level greenish strokes with tufts; marsh lies very low and flat.
  {
    const reeds = new Float32Array(gn);
    let found = 0;
    const shortRun = Math.max(5, Math.round(6 * S));
    const longRun = Math.max(12, Math.round(14 * S));
    for (let y = 2; y < h - 3; y++) {
      let run = 0;
      for (let x = 0; x <= w; x++) {
        const i = y * w + x;
        const on =
          x < w &&
          dark[i] === 1 &&
          pic.A[i]! < meanA - 4 &&
          pic.B[i]! < meanB + 4 &&
          pic.B[i]! > meanB - 30;
        if (on) {
          run++;
          continue;
        }
        if (run >= shortRun && run <= longRun) {
          // A level stroke, not the top of a filled shape: little ink just below it.
          let below = 0;
          for (let k = x - run; k < x; k++) below += dark[(y + 2) * w + k] ? 1 : 0;
          if (below < 3 && !ground.water[cellOf([x - run / 2, y])]) {
            const ci = cellOf([x - run / 2, y]);
            reeds[ci] = reeds[ci]! + 1;
            found++;
          }
        }
        run = 0;
      }
    }
    if (found > 6) {
      const d = boxMean(
        boxMean(reeds, gw, gh, Math.max(1, Math.round((16 * S) / c))),
        gw,
        gh,
        Math.max(1, Math.round((12 * S) / c)),
      );
      let most = 0;
      for (let i = 0; i < gn; i++) if (d[i]! > most) most = d[i]!;
      const m = new Uint8Array(gn);
      for (let i = 0; i < gn; i++) m[i] = d[i]! > most * 0.25 && !ground.water[i] ? 1 : 0;
      const ring = outlineOf(m, gw, gh, c, 3 * Math.max(1, S));
      if (ring) {
        hints.push({
          kind: "marsh",
          points: ring,
          h: 0.01,
          conf: 0.72,
          why: `${found} reed marks (short level strokes with tufts): marsh lies very low and flat.`,
        });
      }
    }
  }

  // ---- What says nothing about height.
  {
    const forests = pieces(ground.forest, gw, gh).list.filter(
      (p) => p.cells.length * c * c > 800 * S * S,
    ).length;
    if (forests > 0) {
      notUsed.push(
        `${forests} forest${forests > 1 ? "s" : ""} (green, with tree marks). Forests grow on hills and plains alike: they say nothing about height, so they are not used.`,
      );
    }
  }
  return { hints, notUsed, ms: performance.now() - t0 };
}
