/**
 * Draws a map's features on a canvas above its images, and reports where each one landed on the
 * screen so that a tap can find it.
 */
import {
  densify,
  drawingProjection,
  type Point,
  type Position,
  type Shape,
  type Space,
  type View,
  zoneOnPlate,
} from "@frontier/geo";
import type { MapFeature, MapFile } from "@frontier/schema";
import { geoArea, geoOrthographic, geoPath } from "d3-geo";

export interface OverlayInput {
  map: MapFile;
  view: View;
  /** Ids of layers that are not shown. */
  hidden: Set<string>;
  selected: string | null;
  /** The corner of the selected path or zone that is picked, if any. */
  selectedVertex: number | null;
  /** The icon image for a feature, once it has loaded. */
  iconFor: (feature: MapFeature) => HTMLImageElement | null;
  titleOf: (feature: MapFeature) => string;
  /** A path or zone being drawn, or a line being measured. */
  sketch: { kind: "path" | "zone" | "measure"; points: Position[] } | null;
  /** Corner handles are shown while editing. */
  editing: boolean;
  /** How strongly each feature is drawn, and whether with dashes, when the map is seen in time. */
  presence?: ReadonlyMap<string, { opacity: number; dashed: boolean }>;
}

const INK = "#2a2420";
const PAPER = "#fbf7f0";

/** The screen lines of a run of positions: one per repeat of the picture, or per visible stretch. */
function lines(space: Space, view: View, points: Position[], close: boolean): Point[][] {
  const ring = close && points.length > 2 ? [...points, points[0]!] : points;
  const stepped = densify(space, ring);
  if (view.lines) return view.lines(stepped);
  if (view.state.kind === "globe") {
    const out: Point[][] = [];
    let run: Point[] = [];
    for (const p of stepped) {
      const s = view.project(p);
      if (s) run.push(s);
      else if (run.length) {
        out.push(run);
        run = [];
      }
    }
    if (run.length) out.push(run);
    return out;
  }
  const base = stepped.map((p) => view.projectClamped(p).point);
  return view.repeats().map((shift) => base.map(([x, y]): Point => [x + shift, y]));
}

function trace(ctx: CanvasRenderingContext2D, points: Point[]): void {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
}

/** A zone on the ball, filled by d3 so that it is cut cleanly at the edge of the disc. */
function fillOnGlobe(ctx: CanvasRenderingContext2D, view: View, points: Position[]): void {
  if (view.state.kind !== "globe") return;
  const projection = geoOrthographic()
    .rotate([-view.state.lon, -view.state.lat])
    .scale(view.state.k)
    .translate([view.width / 2, view.height / 2])
    .clipAngle(90);
  let ring = [...points, points[0]!];
  // d3 takes the inside of a ring to be on one side of its direction; a ring drawn the other way
  // would cover the rest of the globe.
  if (geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI) ring = ring.reverse();
  ctx.beginPath();
  geoPath(projection, ctx)({ type: "Polygon", coordinates: [ring] });
  ctx.fill();
}

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput): Shape[] {
  const { map, view } = input;
  const ratio = window.devicePixelRatio || 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (view.state.kind === "globe") {
    ctx.beginPath();
    ctx.arc(view.width / 2, view.height / 2, view.state.k, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(42, 36, 32, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (view.state.kind === "projected") {
    // The map's outline, as the ball has its rim.
    ctx.beginPath();
    geoPath(drawingProjection(view.state, view.width, view.height), ctx)({ type: "Sphere" });
    ctx.strokeStyle = "rgba(42, 36, 32, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const shapes: Shape[] = [];
  const colours = new Map(map.layers.map((l) => [l.id, l.color]));
  const order = new Map(map.layers.map((l, i) => [l.id, i]));
  const features = map.features
    .filter((f) => !input.hidden.has(f.layer))
    .sort((a, b) => (order.get(a.layer) ?? 0) - (order.get(b.layer) ?? 0));

  /** Sets the strength and the dashes for one feature; `plain` puts them back. */
  const look = (f: MapFeature): { opacity: number; dashed: boolean } => {
    const style = input.presence?.get(f.id) ?? { opacity: 1, dashed: false };
    ctx.globalAlpha = style.opacity;
    ctx.setLineDash(style.dashed ? [7, 5] : []);
    return style;
  };
  const plain = () => {
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  };

  // Zones first, then paths, then markers, so the small things stay reachable.
  for (const f of features) {
    if (f.kind !== "zone") continue;
    look(f);
    const colour = colours.get(f.layer) ?? INK;
    const picked = f.id === input.selected;
    ctx.fillStyle = colour + (picked ? "55" : "33");
    const drawn = lines(map.space, view, f.points, true);
    if (view.state.kind === "globe") fillOnGlobe(ctx, view, f.points);
    if (view.rings) {
      // In a projection the zone is filled as the pieces it is cut into, and tapped by them too.
      ctx.beginPath();
      for (const ring of view.rings(f.points)) {
        trace(ctx, ring);
        ctx.closePath();
        shapes.push({ id: f.id, kind: "zone", points: ring });
      }
      ctx.fill();
    }
    if (view.state.kind === "plate") {
      // On a globe laid flat the inside is not simply the closed outline: a zone may be cut by
      // the edge of the picture, or reach up to a pole across the whole width.
      const rings = zoneOnPlate(f.points, view.state.lon).map((ring) =>
        ring.map((p) => view.projectClamped(p).point),
      );
      for (const shift of view.repeats()) {
        ctx.beginPath();
        for (const ring of rings) {
          const moved = ring.map(([x, y]): Point => [x + shift, y]);
          trace(ctx, moved);
          ctx.closePath();
          shapes.push({ id: f.id, kind: "zone", points: moved });
        }
        ctx.fill();
      }
    }
    for (const line of drawn) {
      if (view.state.kind === "flat") {
        ctx.beginPath();
        trace(ctx, line);
        ctx.fill();
      }
      ctx.beginPath();
      trace(ctx, line);
      ctx.strokeStyle = colour;
      ctx.lineWidth = picked ? 3 : 1.5;
      ctx.stroke();
      if (view.state.kind !== "plate" && view.state.kind !== "projected") {
        shapes.push({ id: f.id, kind: "zone", points: line });
      }
    }
  }
  for (const f of features) {
    if (f.kind !== "path") continue;
    look(f);
    const colour = colours.get(f.layer) ?? INK;
    for (const line of lines(map.space, view, f.points, false)) {
      ctx.beginPath();
      trace(ctx, line);
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = f.id === input.selected ? 7 : 5;
      ctx.stroke();
      ctx.strokeStyle = colour;
      ctx.lineWidth = f.id === input.selected ? 4 : 2.5;
      ctx.stroke();
      shapes.push({ id: f.id, kind: "path", points: line });
    }
  }

  plain();

  // Markers in the order of the file, so a later one lies above an earlier one.
  const labels: { title: string; x: number; y: number; picked: boolean; opacity: number }[] = [];
  for (const f of features) {
    if (f.kind !== "marker") continue;
    const style = look(f);
    ctx.setLineDash([]);
    const colour = colours.get(f.layer) ?? INK;
    const spots: Point[] =
      view.state.kind === "globe"
        ? [view.project(f.at)].filter((p): p is Point => p !== null)
        : view.repeats().map((shift): Point => {
            const p = view.projectClamped(f.at).point;
            return [p[0] + shift, p[1]];
          });
    for (const [x, y] of spots) {
      if (x < -40 || x > view.width + 40 || y < -40 || y > view.height + 40) continue;
      const picked = f.id === input.selected;
      const icon = input.iconFor(f);
      let below = 9;
      if (icon) {
        const size = picked ? 34 : 28;
        ctx.drawImage(icon, x - size / 2, y - size / 2, size, size);
        below = size / 2 + 2;
      } else {
        ctx.beginPath();
        ctx.arc(x, y, picked ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (picked) {
        ctx.beginPath();
        ctx.arc(x, y, icon ? 21 : 12, 0, Math.PI * 2);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (style.dashed) {
        // Undated: a dashed ring, outside the ring that marks the selection.
        ctx.beginPath();
        ctx.arc(x, y, icon ? 25 : 16, 0, Math.PI * 2);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      shapes.push({ id: f.id, kind: "marker", at: [x, y] });
      const title = input.titleOf(f);
      if (title) labels.push({ title, x, y: y + below, picked, opacity: style.opacity });
    }
  }

  plain();

  // Labels above every marker, those of later features first, where there is room.
  const taken: [number, number, number, number][] = [];
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = labels.length - 1; i >= 0; i--) {
    const { title, x, y, picked, opacity } = labels[i]!;
    const half = ctx.measureText(title).width / 2 + 3;
    const box: [number, number, number, number] = [x - half, y, x + half, y + 16];
    const clash = taken.some(
      (t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1],
    );
    if (clash && !picked) continue;
    taken.push(box);
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 3;
    ctx.strokeText(title, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(title, x, y);
  }

  plain();

  // Corner handles of the selected path or zone.
  const chosen = features.find((f) => f.id === input.selected);
  if (input.editing && chosen && chosen.kind !== "marker") {
    chosen.points.forEach((p, i) => {
      const s = view.project(p);
      if (!s) return;
      for (const shift of view.repeats()) {
        ctx.beginPath();
        ctx.arc(s[0] + shift, s[1], i === input.selectedVertex ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = i === input.selectedVertex ? INK : PAPER;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }

  if (input.sketch && input.sketch.points.length > 0) {
    const { kind, points } = input.sketch;
    ctx.setLineDash(kind === "measure" ? [6, 5] : []);
    for (const line of lines(map.space, view, points, kind === "zone")) {
      ctx.beginPath();
      trace(ctx, line);
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const p of points) {
      const s = view.project(p);
      if (!s) continue;
      ctx.beginPath();
      ctx.arc(s[0], s[1], 4, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
  }
  return shapes;
}
