/**
 * Draws a map's features on a canvas above its images, and reports where each one landed on the
 * screen so that a tap can find it.
 */
import {
  drawingProjection,
  hasInside,
  outline,
  type Point,
  type Position,
  type Shape,
  type Space,
  type View,
  zoneOnPlate,
  zonePolygon,
} from "@frontier/geo";
import {
  isLined,
  LABEL_LOOK,
  layerTree,
  lockedWithin,
  type MapFeature,
  type MapFile,
  type MapLabel,
  type MapStyle,
} from "@frontier/schema";
import { geoContains, geoOrthographic, geoPath } from "d3-geo";
import type { PointerKind } from "./gesture.ts";
import { autoAnchor, boxOf, clearOfMarkers, nameFits } from "./groupLabel.ts";
import { outlineOf, PLUS_SIZE, plusHandles } from "./handles.ts";
import {
  casingOf,
  dashOf,
  fillAlpha,
  paintOf,
  type Paint,
  selectionOf,
  undatedOf,
} from "./mapStyles.ts";

export interface OverlayInput {
  map: MapFile;
  view: View;
  /**
   * Ids of what is not shown: layers (a hidden layer's sublayers must be in it too, as
   * `hiddenWithin` gives) and single features.
   */
  hidden: ReadonlySet<string>;
  selected: string | null;
  /** The corner of the selected path or zone that is picked, if any. */
  selectedVertex: number | null;
  /** The icon image for a feature, once it has loaded. */
  iconFor: (feature: MapFeature) => HTMLImageElement | null;
  titleOf: (feature: MapFeature) => string;
  /** A path or zone being drawn, curved or not, or a line being measured. */
  sketch: { kind: "path" | "zone" | "measure"; points: Position[]; curve?: boolean } | null;
  /** Corner handles are shown while editing. */
  editing: boolean;
  /**
   * The "+" handles of the selected path or zone are shown, sized for the pointer that last
   * pressed the map; null hides them (another tool than Select).
   */
  pluses?: PointerKind | null;
  /** How strongly each feature is drawn, and whether with dashes, when the map is seen in time. */
  presence?: ReadonlyMap<string, { opacity: number; dashed: boolean }>;
  /** The library's path and zone styles; a feature without one is drawn in its layer's look. */
  styles?: readonly MapStyle[];
  /** Features drawn as picked besides the selected one: a selected group's, or several picked. */
  picked?: ReadonlySet<string>;
  /** The dashed box around the selected group and its tag; faint while inside it. */
  groupBox?: { members: ReadonlySet<string>; tag: string; faint: boolean } | null;
  /** The names of groups written on the map, once for each group. */
  groupNames?: readonly GroupName[];
  /** Features and group names that cannot be picked on the map: those of locked groups. */
  unpickable?: ReadonlySet<string>;
}

/** A group's name as the overlay writes it. */
export interface GroupName {
  id: string;
  words: string;
  size: number;
  colour: string;
  rotate: number;
  spacing: number;
  /** Where it was put by hand, or null to place it by itself. */
  at: Position | null;
  members: ReadonlySet<string>;
  opacity: number;
  /** Selected: its box is drawn, as a selected label's, and it can be dragged. */
  ring: boolean;
}

/**
 * Where a feature landed on the screen; a marker also says how far it reaches from its middle,
 * and a path or zone how wide its line is, which sizes its hover halo.
 */
export type DrawnShape = Shape & { radius?: number; width?: number };

const INK = "#2a2420";
const PAPER = "#fbf7f0";

/** The width of a path's line, and of a zone's edge, in pixels, without a style. */
export const PATH_WIDTH = 2.5;
export const ZONE_EDGE = 1.5;

/** How far a marker reaches from its middle: its icon, or its dot with the paper edge. */
export const markerRadius = (icon: boolean) => (icon ? 14 : 7);

/**
 * The colour that marks the selection and the hover, from `--map-select` in styles.css, read
 * once per draw so that it follows the theme.
 */
export function selectColour(): string {
  if (typeof document === "undefined") return "#c2410c";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--map-select");
  return value.trim() || "#c2410c";
}

/** The two rings around a selected or hovered marker: paper, and the accent outside it. */
export function markerRing(
  ctx: CanvasRenderingContext2D,
  [x, y]: Point,
  radius: number,
  colour: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/**
 * The screen lines of an outline, as `outline` gives it: one per repeat of the picture, or per
 * visible stretch.
 */
export function screenLines(view: View, stepped: Position[]): Point[][] {
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

/** The screen lines of a run of control points, curved or not, open or closed. */
export function lines(
  space: Space,
  view: View,
  points: Position[],
  close: boolean,
  curve = false,
): Point[][] {
  return screenLines(view, outline(space, points, { curve, closed: close }).line);
}

/**
 * A zone on the ball, filled by d3 so that it is cut cleanly at the edge of the disc. `ring` is
 * the zone's closed outline.
 */
function fillOnGlobe(ctx: CanvasRenderingContext2D, view: View, ring: Position[]): void {
  if (view.state.kind !== "globe" || !hasInside(ring)) return;
  const projection = geoOrthographic()
    .rotate([-view.state.lon, -view.state.lat])
    .scale(view.state.k)
    .translate([view.width / 2, view.height / 2])
    .clipAngle(90);
  ctx.beginPath();
  geoPath(projection, ctx)(zonePolygon(ring));
  ctx.fill();
}

/**
 * On the ball, a press is inside a zone when it is inside what is filled: the press taken back to
 * the globe, tested against the same polygon the fill uses.
 */
function insideOnGlobe(view: View, ring: Position[]): (p: Point) => boolean {
  const polygon = hasInside(ring) ? zonePolygon(ring) : null;
  return ([x, y]) => {
    const at = polygon ? view.unproject(x, y) : null;
    return at !== null && geoContains(polygon!, at);
  };
}

/** A "+" handle: a paper disc with a plus in ink. */
function plus(ctx: CanvasRenderingContext2D, [x, y]: Point): void {
  const r = PLUS_SIZE / 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r / 2, y);
  ctx.lineTo(x + r / 2, y);
  ctx.moveTo(x, y - r / 2);
  ctx.lineTo(x, y + r / 2);
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Strokes the line traced on `ctx` in a look: its colour, width and dashes, butt-capped when
 * dashed. The solid round look is put back after.
 */
function stroke(
  ctx: CanvasRenderingContext2D,
  colour: string,
  paint: Pick<Paint, "width" | "dash" | "cap">,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = paint.width;
  ctx.setLineDash(paint.dash);
  ctx.lineCap = paint.cap;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = "round";
}

/**
 * An undated line: over the line in its own look, a narrower dotted stroke in the paper colour,
 * so that it looks perforated. Dotted is none of the styles' patterns, so it is never taken for one.
 */
function perforate(ctx: CanvasRenderingContext2D, width: number): void {
  const dots = undatedOf(width);
  stroke(ctx, PAPER, { width: dots.width, dash: dots.dash, cap: "butt" });
}

/**
 * A sample of a style, for the Styles tab and the legend: a curved line for a path, a filled
 * patch for a zone, drawn with the overlay's own strokes. A style without a colour is drawn in
 * `fallback`, which stands for "its layer's colour".
 */
export function drawSample(
  ctx: CanvasRenderingContext2D,
  style: Pick<MapStyle, "for" | "color" | "width" | "dash" | "fill">,
  width: number,
  height: number,
  fallback = "#7d746b",
): void {
  const ratio = window.devicePixelRatio || 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const colour = style.color ?? fallback;
  const dash = dashOf(style.dash, style.width);
  const look = { width: style.width, dash, cap: dash.length > 0 ? "butt" : "round" } as const;
  const pad = Math.max(4, style.width + 3);
  ctx.beginPath();
  if (style.for === "path") {
    const [left, right] = [pad, width - pad];
    ctx.moveTo(left, height * 0.65);
    ctx.bezierCurveTo(
      width * 0.35,
      height * 0.05,
      width * 0.65,
      height * 0.95,
      right,
      height * 0.35,
    );
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = casingOf(style.width);
    ctx.stroke();
  } else {
    ctx.rect(pad, pad, width - pad * 2, height - pad * 2);
    ctx.fillStyle = colour + fillAlpha(style.fill ?? 0.2, false);
    ctx.fill();
  }
  stroke(ctx, colour, look);
}

/** Where a place is drawn on the screen: once on a globe, once per repeat of a flat picture. */
function spotsOf(view: View, at: Position): Point[] {
  return view.state.kind === "globe"
    ? [view.project(at)].filter((p): p is Point => p !== null)
    : view.repeats().map((shift): Point => {
        const p = view.projectClamped(at).point;
        return [p[0] + shift, p[1]];
      });
}

/** The font a label is written in, at its size. */
export const labelFont = (size: number) => `600 ${size}px Georgia, "Times New Roman", serif`;

/**
 * Writes a label centred on a point of the screen, turned and spaced as it says, with a paper
 * halo so it reads over any picture; with `ring`, a box in that colour marks it as selected.
 * Gives the four corners of the box around its words.
 */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: MapLabel,
  [x, y]: Point,
  ring: string | null,
): Point[] {
  const size = label.size ?? LABEL_LOOK.size;
  ctx.font = labelFont(size);
  const letters = [...label.label];
  const gap = (label.spacing ?? LABEL_LOOK.spacing) * size;
  const widths = letters.map((l) => ctx.measureText(l).width);
  const width = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, letters.length - 1);
  const half = { w: width / 2 + 4, h: size * 0.65 };
  const turn = ((label.rotate ?? LABEL_LOOK.rotate) * Math.PI) / 180;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  if (ring) {
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(-half.w, -half.h, half.w * 2, half.h * 2);
    ctx.setLineDash([]);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(3, size / 6);
  ctx.fillStyle = label.color ?? LABEL_LOOK.color;
  // Letter by letter, so the spacing is the same in every browser.
  let left = -width / 2;
  letters.forEach((letter, i) => {
    ctx.strokeText(letter, left, 0);
    ctx.fillText(letter, left, 0);
    left += widths[i]! + gap;
  });
  ctx.restore();
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  return (
    [
      [-half.w, -half.h],
      [half.w, -half.h],
      [half.w, half.h],
      [-half.w, half.h],
    ] as Point[]
  ).map(([px, py]): Point => [x + px * c - py * s, y + px * s + py * c]);
}

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput): DrawnShape[] {
  const { map, view } = input;
  const isPicked = (id: string) => id === input.selected || input.picked?.has(id) === true;
  const accent =
    input.selected || (input.picked?.size ?? 0) > 0 || input.groupBox ? selectColour() : "";
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

  const shapes: DrawnShape[] = [];
  const colours = new Map(map.layers.map((l) => [l.id, l.color]));
  // Layers are drawn in the order of their tree: a layer, then its sublayers over it.
  const order = new Map(layerTree(map.layers).map((n, i) => [n.layer.id, i]));
  const features = map.features
    .filter((f) => !input.hidden.has(f.layer) && !input.hidden.has(f.id))
    .sort((a, b) => (order.get(a.layer) ?? 0) - (order.get(b.layer) ?? 0));

  /** Sets the strength for one feature, and says whether it is undated; `plain` puts it back. */
  const look = (f: MapFeature): { opacity: number; dashed: boolean } => {
    const style = input.presence?.get(f.id) ?? { opacity: 1, dashed: false };
    ctx.globalAlpha = style.opacity;
    return style;
  };
  const styles = input.styles ?? [];
  const plain = () => {
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  };

  // Zones first, then paths, then markers, so the small things stay reachable.
  for (const f of features) {
    if (f.kind !== "zone") continue;
    const undated = look(f).dashed;
    const paint = paintOf(f, colours.get(f.layer), styles);
    const colour = paint.colour;
    const picked = isPicked(f.id);
    ctx.fillStyle = colour + fillAlpha(paint.fill, picked);
    // The closed outline: what is drawn, filled and tapped.
    const ring = outlineOf(map.space, f).line;
    const drawn = screenLines(view, ring);
    if (view.state.kind === "globe") fillOnGlobe(ctx, view, ring);
    if (view.rings && hasInside(ring)) {
      // In a projection the zone is filled as the pieces it is cut into, and tapped by them too.
      ctx.beginPath();
      for (const piece of view.rings(ring)) {
        trace(ctx, piece);
        ctx.closePath();
        shapes.push({ id: f.id, kind: "zone", points: piece, width: paint.width });
      }
      ctx.fill();
    }
    if (view.state.kind === "plate") {
      // On a globe laid flat the inside is not simply the closed outline: a zone may be cut by
      // the edge of the picture, or reach up to a pole across the whole width.
      const rings = zoneOnPlate(ring, view.state.lon).map((piece) =>
        piece.map((p) => view.projectClamped(p).point),
      );
      for (const shift of view.repeats()) {
        ctx.beginPath();
        for (const ring of rings) {
          const moved = ring.map(([x, y]): Point => [x + shift, y]);
          trace(ctx, moved);
          ctx.closePath();
          shapes.push({ id: f.id, kind: "zone", points: moved, width: paint.width });
        }
        ctx.fill();
      }
    }
    const inside = view.state.kind === "globe" ? insideOnGlobe(view, ring) : undefined;
    for (const line of drawn) {
      if (view.state.kind === "flat" && hasInside(ring)) {
        ctx.beginPath();
        trace(ctx, line);
        ctx.fill();
      }
      ctx.beginPath();
      trace(ctx, line);
      if (picked) {
        // The selection: an accent outline under the zone's own edge.
        ctx.strokeStyle = accent;
        ctx.lineWidth = selectionOf("zone", paint.width);
        ctx.stroke();
      }
      stroke(ctx, colour, paint);
      if (undated) perforate(ctx, paint.width);
      if (view.state.kind !== "plate" && view.state.kind !== "projected") {
        shapes.push({
          id: f.id,
          kind: "zone",
          points: line,
          width: paint.width,
          ...(inside ? { inside } : {}),
        });
      }
    }
  }
  for (const f of features) {
    if (f.kind !== "path") continue;
    const undated = look(f).dashed;
    const paint = paintOf(f, colours.get(f.layer), styles);
    for (const line of screenLines(view, outlineOf(map.space, f).line)) {
      ctx.beginPath();
      trace(ctx, line);
      if (isPicked(f.id)) {
        // The selection: an accent casing under the paper casing and the line.
        ctx.strokeStyle = accent;
        ctx.lineWidth = selectionOf("path", paint.width);
        ctx.stroke();
      }
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = casingOf(paint.width);
      ctx.stroke();
      stroke(ctx, paint.colour, paint);
      if (undated) perforate(ctx, paint.width);
      shapes.push({ id: f.id, kind: "path", points: line, width: paint.width });
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
    for (const [x, y] of spotsOf(view, f.at)) {
      if (x < -40 || x > view.width + 40 || y < -40 || y > view.height + 40) continue;
      const picked = isPicked(f.id);
      const icon = input.iconFor(f);
      const radius = markerRadius(icon !== null);
      let below = 9;
      if (icon) {
        const size = 28;
        ctx.drawImage(icon, x - size / 2, y - size / 2, size, size);
        below = size / 2 + 2;
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (picked) {
        markerRing(ctx, [x, y], radius, accent);
        below = radius + 9;
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
      shapes.push({ id: f.id, kind: "marker", at: [x, y], radius });
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

  // Labels written on the map, above everything else, in the order of the file.
  for (const f of features) {
    if (f.kind !== "label") continue;
    // Seen in time, a label fades as a marker does.
    look(f);
    for (const at of spotsOf(view, f.at)) {
      // Tapped and hovered by the box around its words, as a zone is by its outline.
      const box = drawLabel(ctx, f, at, isPicked(f.id) ? accent : null);
      shapes.push({ id: f.id, kind: "zone", points: box, width: 1 });
    }
  }

  plain();

  // Each group's name, once for the group, over its pieces as they are drawn now.
  const kindOf = new Map(features.map((f) => [f.id, f.kind]));
  const markerSpots = shapes.flatMap((s) => (s.kind === "marker" ? [s.at] : []));
  for (const g of input.groupNames ?? []) {
    const mine = shapes.filter((s) => g.members.has(s.id));
    const points = mine.flatMap((s) => (s.kind === "marker" ? [s.at] : s.points));
    const box = boxOf(points);
    if (!box) continue;
    const look = { size: g.size, spacing: g.spacing };
    const width = labelWidth(ctx, g.words, look);
    // Zoomed far out, a small group drops its name rather than cover the map in words.
    if (!nameFits(box[2] - box[0], width)) continue;
    const half = { w: width / 2 + 4, h: g.size * 0.65 };
    let at: Point | null = g.at ? (spotsOf(view, g.at)[0] ?? null) : null;
    if (!at) {
      const auto = autoAnchor(
        mine.flatMap((s) => (s.kind === "zone" && kindOf.get(s.id) === "zone" ? [s.points] : [])),
        mine.flatMap((s): Point[] =>
          s.kind === "marker" ? [s.at] : kindOf.get(s.id) === "zone" ? [] : s.points,
        ),
      );
      if (!auto) continue;
      const above: Point = auto.above ? [auto.at[0], box[1] - half.h - 6] : auto.at;
      at = clearOfMarkers(above, half, markerSpots);
    }
    ctx.globalAlpha = g.opacity;
    const corners = drawLabel(
      ctx,
      {
        id: g.id,
        kind: "label",
        layer: "",
        at: [0, 0],
        entry: null,
        child: null,
        label: g.words,
        size: g.size,
        color: g.colour,
        rotate: g.rotate,
        spacing: g.spacing,
      },
      at,
      g.ring ? accent : null,
    );
    shapes.push({ id: g.id, kind: "zone", points: corners, width: 1 });
  }

  plain();

  // The selected group: a dashed box around all its pieces, with a tag that names it.
  if (input.groupBox) {
    const { members, tag, faint } = input.groupBox;
    const box = boxOf(
      shapes
        .filter((s) => members.has(s.id))
        .flatMap((s) => (s.kind === "marker" ? [s.at] : s.points)),
    );
    if (box) {
      const [x0, y0, x1, y1] = [box[0] - 10, box[1] - 10, box[2] + 10, box[3] + 10];
      ctx.globalAlpha = faint ? 0.45 : 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(tag).width + 12;
      ctx.fillStyle = accent;
      ctx.fillRect(x0, y0 - 18, w, 17);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(tag, x0 + 6, y0 - 9.5);
    }
  }

  plain();

  // Corner handles of the selected path or zone, and its "+" handles between them; none for a
  // feature in a locked layer, which cannot be changed on the map.
  const locked = lockedWithin(map.layers);
  const chosen = features.find((f) => f.id === input.selected && !locked.has(f.layer));
  if (input.editing && chosen && isLined(chosen) && input.pluses) {
    for (const h of plusHandles(map.space, view, chosen, input.pluses)) {
      for (const shift of view.repeats()) plus(ctx, [h.screen[0] + shift, h.screen[1]]);
    }
  }
  if (input.editing && chosen && isLined(chosen)) {
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
    const curve = kind !== "measure" && input.sketch.curve === true;
    for (const line of lines(map.space, view, points, kind === "zone", curve)) {
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
  // A feature in a locked layer or group is drawn but cannot be found by a tap: what lies under
  // it can.
  const unpickable = input.unpickable;
  if (locked.size === 0 && !unpickable?.size) return shapes;
  const layerOf = new Map(features.map((f) => [f.id, f.layer]));
  return shapes.filter((s) => !locked.has(layerOf.get(s.id) ?? "") && !unpickable?.has(s.id));
}

/** How wide words are written in a label's font, size and spacing. */
export function labelWidth(
  ctx: CanvasRenderingContext2D,
  words: string,
  look: { size: number; spacing: number },
): number {
  ctx.font = labelFont(look.size);
  const letters = [...words];
  const gap = look.spacing * look.size;
  return (
    letters.reduce((sum, l) => sum + ctx.measureText(l).width, 0) +
    gap * Math.max(0, letters.length - 1)
  );
}
