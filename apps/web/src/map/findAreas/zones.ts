/**
 * What Make zone and Add to make of the found pieces. For now (release 19a) a zone is one ring:
 * each piece becomes its own zone and a hole is filled. How a zone could hold several pieces and
 * holes (or a group of features) is still to be decided; that decision changes this file only,
 * not the tracing, which already says which ring is a piece and which a hole.
 */
import type { Position } from "@frontier/geo";
import { type MapFeature, type MapFile, orderFeature } from "@frontier/schema";
import { type Resolved, writeShape } from "../time.ts";
import { newItemId } from "../viewUrl.ts";
import type { FoundPiece } from "./outline.ts";

/** The rings to make zones of: one per piece, its holes filled. */
export function zoneRings(pieces: readonly FoundPiece[]): Position[][] {
  return pieces.map((p) => p.outer).filter((r) => r.length >= 3);
}

/** How many holes the pieces have, which Make zone fills. */
export const holeCount = (pieces: readonly FoundPiece[]): number =>
  pieces.reduce((s, p) => s + p.holes.length, 0);

/** The name of the n-th zone made from one, counting from 1: "Skerra", "Skerra 2", … */
export const numbered = (label: string | null, n: number): string | null =>
  label === null || label === "" ? null : n === 1 ? label : `${label} ${n}`;

function newZone(
  layer: string,
  points: Position[],
  look: { style?: string | undefined; curve?: string | undefined; label?: string | null },
): MapFeature {
  return orderFeature({
    id: newItemId(),
    kind: "zone",
    layer,
    points,
    ...(look.curve ? { curve: look.curve } : {}),
    ...(look.style ? { style: look.style } : {}),
    entry: null,
    label: look.label ?? null,
    child: null,
  } as MapFeature);
}

/**
 * Make zone: a new zone for each piece, in `layer` with `style` (none: the layer's look),
 * largest first. Null when there is no piece to make.
 */
export function makeZones(
  map: MapFile,
  layer: string,
  style: string | null,
  pieces: readonly FoundPiece[],
): { map: MapFile; ids: string[] } | null {
  const rings = zoneRings(pieces);
  if (rings.length === 0) return null;
  const made = rings.map((points) => newZone(layer, points, style ? { style } : {}));
  return { map: { ...map, features: [...map.features, ...made] }, ids: made.map((f) => f.id) };
}

/**
 * Add to: the selected zone's shape on screen becomes the largest piece of the union (the found
 * outline already holds the zone's own outline); any other piece is a new zone beside it in the
 * same layer and look, named after it ("Skerra 2", …). Null when the zone is gone or nothing came.
 */
export function addToZone(
  map: MapFile,
  drawn: Resolved,
  pieces: readonly FoundPiece[],
): { map: MapFile; ids: string[] } | null {
  const feature = map.features.find((f) => f.id === drawn.feature.id);
  const rings = zoneRings(pieces);
  if (!feature || feature.kind !== "zone" || rings.length === 0) return null;
  const [first, ...rest] = rings;
  const kept = writeShape(feature, drawn.shape, { points: first! });
  const look = feature as { style?: string; curve?: string };
  const others = rest.map((points, i) =>
    newZone(feature.layer, points, {
      style: look.style,
      curve: look.curve,
      label: numbered(feature.label, i + 2),
    }),
  );
  return {
    map: {
      ...map,
      features: [...map.features.map((f) => (f.id === feature.id ? kept : f)), ...others],
    },
    ids: [feature.id, ...others.map((f) => f.id)],
  };
}
