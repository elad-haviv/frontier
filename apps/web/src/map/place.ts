/**
 * Placing features with AI: where the proposals go on the map, and what a feature may look like,
 * as the model is offered it. The proposals themselves come from the server; nothing is kept
 * until the author places one.
 */
import type { Point, Position, View } from "@frontier/geo";
import {
  isLined,
  type MapFeature,
  type MapFile,
  type MapStyle,
  orderFeature,
} from "@frontier/schema";
import type { GeneratedFeature } from "../api.ts";
import { stylesFor } from "./mapStyles.ts";
import type { MarkerSets } from "./useMapFile.ts";
import { iconLabel, newItemId } from "./viewUrl.ts";

/** A proposal shown on the map until it is placed or discarded. */
export interface Ghost extends GeneratedFeature {
  key: string;
  at: Position;
}

/** How far apart, in pixels of the screen, proposals around a spot are put. */
const RING = 44;

/** Whether a point of the screen is inside a ring of points, by counting crossings. */
function inside([x, y]: Point, ring: Point[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/**
 * Where `count` proposals go. Around a spot (one or two points tapped): the first on it, the rest
 * in a ring about it. In an area (three points or more): spread inside it, apart from each other,
 * the same way each time for the same area.
 */
export function placeSpots(view: View, marked: Position[], count: number): Position[] {
  const screen = marked.map((p) => view.project(p)).filter((p): p is Point => p !== null);
  if (screen.length === 0) return [];
  const back = (pts: Point[]) =>
    pts.map((p) => view.unproject(p[0], p[1])).filter((p): p is Position => p !== null);
  if (screen.length < 3) {
    const [cx, cy] = screen[0]!;
    const ring = Array.from({ length: count - 1 }, (_, i): Point => {
      const turn = (i / Math.max(1, count - 1)) * Math.PI * 2 - Math.PI / 2;
      return [cx + RING * Math.cos(turn), cy + RING * Math.sin(turn)];
    });
    return [marked[0]!, ...back(ring)];
  }
  const xs = screen.map((p) => p[0]);
  const ys = screen.map((p) => p[1]);
  const [left, top, right, bottom] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  const middle: Point = [
    xs.reduce((a, b) => a + b) / xs.length,
    ys.reduce((a, b) => a + b) / ys.length,
  ];
  // A steady sequence spread over the box (the golden ratio's), tried in turn.
  const chosen: Point[] = [];
  const apart = Math.max(16, Math.min(right - left, bottom - top) / (count + 1));
  for (let i = 1; i < 400 && chosen.length < count; i++) {
    const p: Point = [
      left + (right - left) * ((i * 0.618034) % 1),
      top + (bottom - top) * ((i * 0.754878) % 1),
    ];
    if (!inside(p, screen)) continue;
    if (chosen.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < apart)) continue;
    chosen.push(p);
  }
  while (chosen.length < count) chosen.push(inside(middle, screen) ? middle : screen[0]!);
  return back(chosen);
}

/** The middle of a feature's shape, as the place it is asked about. */
export function middleOf(feature: MapFeature): Position {
  if (!isLined(feature)) return feature.at;
  const n = feature.points.length;
  const [x, y] = feature.points.reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
  return [x / n, y / n];
}

/** The looks a feature may take, offered to the model: the styles of its kind, or marker icons. */
export function choicesFor(
  kind: MapFeature["kind"],
  map: MapFile,
  styles: readonly MapStyle[],
  sets: MarkerSets,
): { id: string; name: string }[] {
  if (kind === "path" || kind === "zone") {
    return stylesFor([...styles], kind).map((s) => ({ id: s.id, name: s.name }));
  }
  if (kind !== "marker") return [];
  return sets
    .filter((s) => map.markerSets.includes(s.name))
    .flatMap((s) => s.icons.map((i) => ({ id: `${s.name}/${i.name}`, name: iconLabel(i.name) })))
    .slice(0, 200);
}

/** What a choice of look is called, for the preview. */
export function choiceName(
  choice: string | null,
  choices: readonly { id: string; name: string }[],
): string | null {
  return choice ? (choices.find((c) => c.id === choice)?.name ?? null) : null;
}

/** The feature with a proposal's name, and its look when one was chosen. */
export function withProposal(feature: MapFeature, proposal: GeneratedFeature): MapFeature {
  const next = { ...feature, label: proposal.name } as MapFeature & Record<string, unknown>;
  if (proposal.choice && isLined(feature)) next.style = proposal.choice;
  if (proposal.choice && feature.kind === "marker") {
    const cut = proposal.choice.lastIndexOf("/");
    if (cut > 0) {
      next.icon = { set: proposal.choice.slice(0, cut), name: proposal.choice.slice(cut + 1) };
    }
  }
  return orderFeature(next as MapFeature);
}

/** A new marker for a proposal placed on the map. */
export function ghostMarker(ghost: Ghost, layer: string): MapFeature {
  return withProposal(
    {
      id: newItemId(),
      kind: "marker",
      layer,
      at: ghost.at,
      entry: null,
      label: null,
      icon: null,
      child: null,
    },
    ghost,
  );
}
