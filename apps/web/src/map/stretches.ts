/**
 * A path's stretches (Find paths' tunnels, steps and climbs) and how a river ends inland, kept
 * and drawn. A stretch is held by the coordinates of its two corners, so a corner put in
 * elsewhere (a join, a crossroads) leaves it alone; after a change `keepStretches` moves a
 * stretch's end with a corner that was dragged, and lets the stretch go when a corner was taken
 * away. Drawing is on the canvas the map's features are drawn on, over each path's own line.
 */
import type { Point, Position } from "@frontier/geo";
import type { MapFeature, MapFile, PathStretch } from "@frontier/schema";

type PathFeature = Extract<MapFeature, { kind: "path" }>;
const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** Where a stretch lies along a path: the indices of its two corners, the first first. */
export function stretchSpan(points: readonly Position[], s: PathStretch): [number, number] | null {
  const i = points.findIndex((p) => same(p, s.from));
  const j = points.findIndex((p) => same(p, s.to));
  if (i < 0 || j < 0 || i === j) return null;
  return i < j ? [i, j] : [j, i];
}

/**
 * After a change: a stretch whose corner was moved (the path has as many points as before, and
 * the corner's place changed) follows it; one whose corner is gone is let go.
 */
export function keepStretches(before: MapFile, after: MapFile): MapFile {
  let changed = false;
  const features = after.features.map((f) => {
    if (f.kind !== "path" || !f.stretches?.length) return f;
    const was = before.features.find((b) => b.id === f.id) as PathFeature | undefined;
    if (!was || was.points === f.points) return f;
    const moved = (p: Position): Position | null => {
      if (f.points.some((q) => same(q, p))) return p;
      if (was.points.length !== f.points.length) return null;
      const i = was.points.findIndex((q) => same(q, p));
      return i < 0 ? null : f.points[i]!;
    };
    const stretches: PathStretch[] = [];
    let touched = false;
    for (const s of f.stretches) {
      const from = moved(s.from);
      const to = moved(s.to);
      if (!from || !to) {
        touched = true;
        continue;
      }
      if (from !== s.from || to !== s.to) touched = true;
      stretches.push(from === s.from && to === s.to ? s : { ...s, from, to });
    }
    if (!touched) return f;
    changed = true;
    const rest: Record<string, unknown> = { ...f };
    delete rest.stretches;
    return (stretches.length ? { ...rest, stretches } : rest) as MapFeature;
  });
  return changed ? { ...after, features } : after;
}

// ---- Drawing --------------------------------------------------------------------------------

/** How long a run of screen points is. */
const lengthOf = (line: readonly Point[]) => {
  let s = 0;
  for (let i = 1; i < line.length; i++)
    s += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return s;
};

/** The point and direction at a distance along a run of screen points. */
export function along(line: readonly Point[], at: number): { p: Point; dx: number; dy: number } {
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > 0 && s + l >= at) {
      const f = (at - s) / l;
      return {
        p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
        dx: (b[0] - a[0]) / l,
        dy: (b[1] - a[1]) / l,
      };
    }
    s += l;
  }
  const b = line[line.length - 1]!;
  const a = line[line.length - 2] ?? b;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { p: b, dx: (b[0] - a[0]) / l, dy: (b[1] - a[1]) / l };
}

const trace = (ctx: CanvasRenderingContext2D, line: readonly Point[]) => {
  ctx.beginPath();
  line.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
};

export interface StretchLook {
  colour: string;
  width: number;
  /** The paper casing's width, which a tunnel's or a fading end's line is drawn over. */
  casing: number;
  paper: string;
  ink: string;
}

/** A tunnel: the path's line taken away and drawn again in dashes. */
export function drawTunnel(
  ctx: CanvasRenderingContext2D,
  line: readonly Point[],
  look: StretchLook,
) {
  trace(ctx, line);
  ctx.setLineDash([]);
  ctx.strokeStyle = look.paper;
  ctx.lineWidth = look.casing + 0.5;
  ctx.stroke();
  ctx.setLineDash([Math.max(3, look.width * 2.2), Math.max(3, look.width * 1.8)]);
  ctx.strokeStyle = look.colour;
  ctx.lineWidth = look.width;
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = "round";
}

/** Steps: short bars across the line, close together, like the treads of a stair. */
export function drawSteps(
  ctx: CanvasRenderingContext2D,
  line: readonly Point[],
  look: StretchLook,
) {
  const total = lengthOf(line);
  const half = Math.max(3, look.width * 1.6);
  ctx.setLineDash([]);
  ctx.strokeStyle = look.colour;
  ctx.lineWidth = Math.max(1, look.width * 0.6);
  ctx.beginPath();
  for (let s = 2; s < total - 1; s += 4) {
    const { p, dx, dy } = along(line, s);
    ctx.moveTo(p[0] - dy * half, p[1] + dx * half);
    ctx.lineTo(p[0] + dy * half, p[1] - dx * half);
  }
  ctx.stroke();
}

/**
 * Chevrons along a climb, pointing uphill: one (›) on a grade under 20%, two (››) above. `up` is
 * whether the line rises the way it runs.
 */
export function drawChevrons(
  ctx: CanvasRenderingContext2D,
  line: readonly Point[],
  grade: number,
  look: StretchLook,
) {
  const total = lengthOf(line);
  if (total < 10) return;
  const double = Math.abs(grade) >= 0.2;
  const size = 4;
  const gap = 26;
  const first = Math.min(total / 2, gap / 2);
  const sign = grade >= 0 ? 1 : -1;
  ctx.setLineDash([]);
  for (let s = first; s <= total - 4; s += gap) {
    const { p, dx, dy } = along(line, s);
    const ux = dx * sign;
    const uy = dy * sign;
    const marks = double ? [-2.5, 2.5] : [0];
    ctx.beginPath();
    for (const m of marks) {
      const cx = p[0] + ux * m;
      const cy = p[1] + uy * m;
      // A "›" pointing uphill: two strokes meeting at the tip.
      ctx.moveTo(cx - ux * size - uy * size, cy - uy * size + ux * size);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - ux * size + uy * size, cy - uy * size - ux * size);
    }
    ctx.strokeStyle = look.paper;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** The run of a screen line from a distance along it to its end. */
export function tailOf(line: readonly Point[], from: number): Point[] {
  const out: Point[] = [along(line, from).p];
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    s += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
    if (s > from) out.push(line[i]!);
  }
  return out;
}

/**
 * How a river ends inland, over the end of its last stored segment (at most half of it, and
 * at most 90 pixels on the screen): sinking underground, it tapers to nothing; drying out, it
 * thins and turns to dashes.
 */
export function drawEnd(
  ctx: CanvasRenderingContext2D,
  whole: readonly Point[],
  how: "sinks" | "dries",
  look: StretchLook,
) {
  if (whole.length < 2) return;
  const length = lengthOf(whole);
  const tail = Math.min(length / 2, 90);
  if (tail < 2) return;
  const line = tailOf(whole, length - tail);
  trace(ctx, line);
  ctx.setLineDash([]);
  ctx.strokeStyle = look.paper;
  ctx.lineWidth = look.casing + 0.5;
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.strokeStyle = look.colour;
  if (how === "dries") {
    trace(ctx, line);
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = Math.max(0.8, look.width * 0.55);
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    return;
  }
  // Tapering: in short pieces, each narrower than the one before.
  const pieces = Math.max(4, Math.round(tail / 4));
  for (let k = 0; k < pieces; k++) {
    const a = along(line, (tail * k) / pieces).p;
    const b = along(line, (tail * (k + 1)) / pieces).p;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineWidth = Math.max(0.4, look.width * (1 - k / pieces));
    ctx.stroke();
  }
}
