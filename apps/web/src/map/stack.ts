/**
 * The layered view (stage 20c): a globe and the globes set to lie under it, drawn as plates, one
 * under the other. A plate is the whole globe laid flat (longitude across, latitude up), so a line
 * straight down through the stack meets the same spot on every layer, which is how layers lie.
 */
import type { MapFeature, MapFile } from "@frontier/schema";
import type { OtherMap } from "./layersBeneath.ts";
import type { Point3 } from "./space3d.ts";

/** Half the width and height of a plate, in the units the camera works in. */
export const PLATE_W = 11;
export const PLATE_H = 5.5;

export type Spot = [number, number];

/** A plate's place for a longitude and latitude, on the plate of layer `index`. */
export function plateOf(at: Spot, index: number, spread: number): Point3 {
  return { x: (at[0] / 180) * PLATE_W, y: (at[1] / 90) * PLATE_H, z: -index * spread };
}

/** The longitude and latitude of a place on a plate, or null when it is off the plate. */
export function spotOf(x: number, y: number): Spot | null {
  if (Math.abs(x) > PLATE_W || Math.abs(y) > PLATE_H) return null;
  return [Math.round((x / PLATE_W) * 180 * 10) / 10, Math.round((y / PLATE_H) * 90 * 10) / 10];
}

/**
 * The globes that stack with this one, top to bottom: the one at the top of the chain it lies in,
 * then those under it, level by level. A map with nothing above or below gives only itself.
 */
export function stackOf(id: string, maps: OtherMap[]): string[] {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const seen = new Set<string>();
  let top = id;
  while (!seen.has(top)) {
    seen.add(top);
    const above = byId.get(top)?.under;
    if (!above || !byId.get(above) || byId.get(above)!.space.kind !== "sphere") break;
    top = above;
  }
  const order = [top];
  const placed = new Set(order);
  for (let level = 0; level < order.length; level++) {
    for (const m of maps) {
      if (m.under === order[level] && m.space.kind === "sphere" && !placed.has(m.id)) {
        placed.add(m.id);
        order.push(m.id);
      }
    }
  }
  return order;
}

export type Passage = { map: string; feature: string };

/** A place of any layer: where it is and what it is called, for lists and lines between layers. */
export interface Place {
  map: string;
  /** The layer's index in the stack. */
  layer: number;
  feature: MapFeature & { kind: "marker" };
}

export function placesOf(maps: Record<string, MapFile>, order: string[]): Place[] {
  const out: Place[] = [];
  order.forEach((id, layer) => {
    for (const f of maps[id]?.features ?? [])
      if (f.kind === "marker") out.push({ map: id, layer, feature: f });
  });
  return out;
}

/** The passages a marker holds, which lead from it to places on other layers. */
export const passagesOf = (f: MapFeature): Passage[] =>
  f.kind === "marker" && Array.isArray(f.passages) ? (f.passages as Passage[]) : [];

/** Every passage between two places, from the marker that holds it. */
export interface Link {
  from: Place;
  to: Place;
}
export function linksOf(places: Place[]): Link[] {
  const at = new Map(places.map((p) => [`${p.map}/${p.feature.id}`, p]));
  const out: Link[] = [];
  for (const p of places) {
    for (const g of passagesOf(p.feature)) {
      const to = at.get(`${g.map}/${g.feature}`);
      if (to) out.push({ from: p, to });
    }
  }
  return out;
}

/** The passages that touch a place, from either end, as the places they lead to. */
export function leadsFrom(place: Place, links: Link[]): Place[] {
  return links.flatMap((l) =>
    l.from === place || (l.from.map === place.map && l.from.feature.id === place.feature.id)
      ? [l.to]
      : l.to.map === place.map && l.to.feature.id === place.feature.id
        ? [l.from]
        : [],
  );
}

/** The place on another layer nearest straight above or below, within a few degrees. */
export function neighbour(place: Place, places: Place[], by: -1 | 1, within = 6): Place | null {
  const layer = place.layer + by;
  let best: Place | null = null;
  let bd = within;
  for (const p of places) {
    if (p.layer !== layer) continue;
    const d = Math.hypot(
      p.feature.at[0] - place.feature.at[0],
      p.feature.at[1] - place.feature.at[1],
    );
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Joins two places by a passage, held by the one on the upper layer. Two on one layer join none. */
export function addPassage(
  maps: Record<string, MapFile>,
  a: Place,
  b: Place,
): { map: string; next: MapFile } | null {
  if (a.map === b.map) return null;
  const [upper, lower] = a.layer < b.layer ? [a, b] : [b, a];
  const file = maps[upper.map];
  if (!file) return null;
  const held = passagesOf(upper.feature);
  if (held.some((g) => g.map === lower.map && g.feature === lower.feature.id)) return null;
  const passages = [...held, { map: lower.map, feature: lower.feature.id }];
  return {
    map: upper.map,
    next: {
      ...file,
      features: file.features.map((f) =>
        f.id === upper.feature.id ? ({ ...f, passages } as MapFeature) : f,
      ),
    },
  };
}

/** Takes the passage between two places away, wherever it is held. Returns the maps that changed. */
export function removePassage(
  maps: Record<string, MapFile>,
  a: Place,
  b: Place,
): Record<string, MapFile> {
  const changed: Record<string, MapFile> = {};
  for (const [holder, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const file = changed[holder.map] ?? maps[holder.map];
    if (!file) continue;
    const held = passagesOf(holder.feature);
    const kept = held.filter((g) => !(g.map === other.map && g.feature === other.feature.id));
    if (kept.length === held.length) continue;
    changed[holder.map] = {
      ...file,
      features: file.features.map((f) => {
        if (f.id !== holder.feature.id) return f;
        const next = { ...f } as Record<string, unknown>;
        if (kept.length) next.passages = kept;
        else delete next.passages;
        return next as MapFeature;
      }),
    };
  }
  return changed;
}

/**
 * A marker removed from a layer, and every passage that led to it from the other layers. Returns
 * each map that changed.
 */
export function removePlace(maps: Record<string, MapFile>, place: Place): Record<string, MapFile> {
  const changed: Record<string, MapFile> = {};
  for (const [id, file] of Object.entries(maps)) {
    let touched = false;
    const features = file.features.flatMap((f): MapFeature[] => {
      if (id === place.map && f.id === place.feature.id) {
        touched = true;
        return [];
      }
      const held = passagesOf(f);
      if (held.some((g) => g.map === place.map && g.feature === place.feature.id)) {
        touched = true;
        const kept = held.filter((g) => !(g.map === place.map && g.feature === place.feature.id));
        const next = { ...f } as Record<string, unknown>;
        if (kept.length) next.passages = kept;
        else delete next.passages;
        return [next as MapFeature];
      }
      return [f];
    });
    if (touched) changed[id] = { ...file, features };
  }
  return changed;
}
