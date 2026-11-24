/**
 * The Layers tab as rows: each layer, its features and its sublayers, with what a drag over a
 * row would do, and the changes to the map that adding, moving and deleting make.
 */
import {
  type LayerNode,
  layerTree,
  layersWithin,
  type MapFeature,
  type MapFile,
  type MapLayer,
  moveLayer,
  orderFeature,
  orderLayer,
} from "@frontier/schema";

/** How many features of one layer are listed before "Show all". */
export const FEATURE_LIMIT = 200;

export type Row =
  | { type: "layer"; key: string; node: LayerNode; depth: number; count: number; open: boolean }
  | { type: "feature"; key: string; feature: MapFeature; depth: number }
  | { type: "more"; key: string; layer: string; depth: number; rest: number };

export const layerKey = (id: string) => `l:${id}`;
export const featureKey = (id: string) => `f:${id}`;

/** Each layer's features, in the order of the map. */
export function featuresByLayer(map: MapFile): Map<string, MapFeature[]> {
  const out = new Map<string, MapFeature[]>();
  for (const f of map.features) out.set(f.layer, [...(out.get(f.layer) ?? []), f]);
  return out;
}

/**
 * The rows shown: each layer, then while it is open its features and its sublayers, in the
 * order they are drawn, so that a lower row is drawn over a higher one.
 */
export function layerRows(
  map: MapFile,
  { collapsed, showAll }: { collapsed: ReadonlySet<string>; showAll: ReadonlySet<string> },
): Row[] {
  const byLayer = featuresByLayer(map);
  const rows: Row[] = [];
  let closedAt: number | null = null;
  for (const node of layerTree(map.layers)) {
    if (closedAt !== null && node.depth > closedAt) continue;
    closedAt = null;
    const own = byLayer.get(node.layer.id) ?? [];
    const open = !collapsed.has(node.layer.id);
    const key = layerKey(node.layer.id);
    rows.push({ type: "layer", key, node, depth: node.depth, count: own.length, open });
    if (!open) {
      closedAt = node.depth;
      continue;
    }
    const listed = showAll.has(node.layer.id) ? own : own.slice(0, FEATURE_LIMIT);
    for (const feature of listed) {
      rows.push({ type: "feature", key: featureKey(feature.id), feature, depth: node.depth + 1 });
    }
    if (listed.length < own.length) {
      const rest = own.length - listed.length;
      rows.push({
        type: "more",
        key: `m:${node.layer.id}`,
        layer: node.layer.id,
        depth: node.depth + 1,
        rest,
      });
    }
  }
  return rows;
}

/** The ids of a layer and of the layers it is inside, up to the top level. */
export function layerAndAbove(layers: readonly MapLayer[], id: string): string[] {
  const out: string[] = [];
  const parentOf = new Map(layers.map((l) => [l.id, l.parent ?? null]));
  let at: string | null = id;
  while (at !== null && parentOf.has(at) && !out.includes(at)) {
    out.push(at);
    at = parentOf.get(at) ?? null;
  }
  return out;
}

/** A name for a new layer that no other layer has: "New layer", "New layer 2", … */
export function freshName(layers: readonly MapLayer[], base = "New layer"): string {
  const names = new Set(layers.map((l) => l.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The colours new layers take in turn. */
const COLOURS = ["#2f5d8a", "#9a3b1f", "#3f7d3a", "#8a5a9e", "#b7791f", "#2c7a7b", "#a23b6b"];

/** The map with a new layer at the end of the top level, or of a layer's sublayers. */
export function addLayer(
  map: MapFile,
  id: string,
  parent: string | null,
): { map: MapFile; layer: MapLayer } {
  const layer: MapLayer = orderLayer({
    id,
    name: freshName(map.layers),
    visible: true,
    color: COLOURS[map.layers.length % COLOURS.length]!,
    parent,
  });
  return { map: { ...map, layers: moveLayer([...map.layers, layer], id, parent) }, layer };
}

/** The map with one layer changed. */
export function setLayer(map: MapFile, id: string, change: Partial<MapLayer>): MapFile {
  return {
    ...map,
    layers: map.layers.map((l) => (l.id === id ? orderLayer({ ...l, ...change }) : l)),
  };
}

/**
 * The map without a layer. Its sublayers take its place, inside the layer it was inside; its
 * features move to the layer `to` names, or are deleted with it when `to` is null.
 */
export function removeLayer(map: MapFile, id: string, to: string | null): MapFile {
  const gone = map.layers.find((l) => l.id === id);
  if (!gone || map.layers.length < 2) return map;
  const parent = gone.parent ?? null;
  let layers = map.layers;
  for (const child of map.layers.filter((l) => l.parent === id)) {
    layers = moveLayer(layers, child.id, parent, id);
  }
  layers = layers.filter((l) => l.id !== id);
  const features =
    to === null
      ? map.features.filter((f) => f.layer !== id)
      : map.features.map((f) => (f.layer === id ? orderFeature({ ...f, layer: to }) : f));
  return { ...map, layers, features };
}

/** The layer a deleted layer's features go to unless the author chooses another. */
export function heirOf(layers: readonly MapLayer[], id: string): string | null {
  const gone = layers.find((l) => l.id === id);
  if (gone?.parent != null) return gone.parent;
  // Else the layer listed just above it, or else the first other one. Its own sublayers stay,
  // so they may take its features too.
  const tree = layerTree(layers).map((n) => n.layer.id);
  const at = tree.indexOf(id);
  return tree[at - 1] ?? tree.find((x) => x !== id) ?? null;
}

/**
 * The map with these features moved into a layer: before or after one feature, or at the end of
 * the map's list when `beside` is not given. Features keep their own order among themselves.
 */
export function moveFeatures(
  map: MapFile,
  ids: readonly string[],
  layer: string,
  beside?: { id: string; after: boolean },
): MapFile {
  // Without a place to go, those already in the layer stay where they are.
  const moving = new Set(
    beside ? ids : ids.filter((id) => map.features.some((f) => f.id === id && f.layer !== layer)),
  );
  if (!map.layers.some((l) => l.id === layer) || moving.size === 0) return map;
  const moved = map.features
    .filter((f) => moving.has(f.id))
    .map((f) => (f.layer === layer ? f : orderFeature({ ...f, layer })));
  if (moved.length === 0) return map;
  const rest = map.features.filter((f) => !moving.has(f.id));
  let at = rest.length;
  if (beside && !moving.has(beside.id)) {
    const i = rest.findIndex((f) => f.id === beside.id);
    if (i >= 0) at = beside.after ? i + 1 : i;
  } else if (!beside) {
    // At the end of the layer's own features, so they are listed last in it.
    const last = rest.findLastIndex((f) => f.layer === layer);
    if (last >= 0) at = last + 1;
  }
  const features = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  return features.every((f, i) => f === map.features[i]) ? map : { ...map, features };
}

/** What is dragged in the Layers tab: a layer with what is inside it, or features. */
export type Dragged = { kind: "layer"; id: string } | { kind: "features"; ids: string[] };

/** Where over a row the pointer is: its top, middle or bottom. */
export type Zone = "before" | "into" | "after";

/** What a drop does; null when it cannot be made there. */
export type Drop =
  | { kind: "layer"; id: string; parent: string | null; before: string | null; show: Zone }
  | {
      kind: "features";
      ids: string[];
      layer: string;
      beside?: { id: string; after: boolean };
      show: Zone;
    };

/**
 * The drop that the dragged thing would make over this row. A layer dropped on the middle of a
 * layer goes inside it, at the end; on its top, before it; on its bottom, after it, or inside it
 * at the end when the row is open and something is listed under it. Over a feature, a layer goes
 * into that feature's layer. Features go into the layer of the row, beside the feature they are
 * dropped on.
 */
export function dropFor(map: MapFile, dragged: Dragged, row: Row, y: number): Drop | null {
  const zone: Zone = y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
  const layerOfRow =
    row.type === "layer"
      ? row.node.layer.id
      : row.type === "feature"
        ? row.feature.layer
        : row.layer;
  if (dragged.kind === "features") {
    if (row.type === "feature") {
      if (dragged.ids.includes(row.feature.id)) return null;
      const after = zone === "after" || (zone === "into" && y >= 0.5);
      return {
        kind: "features",
        ids: dragged.ids,
        layer: layerOfRow,
        beside: { id: row.feature.id, after },
        show: after ? "after" : "before",
      };
    }
    return { kind: "features", ids: dragged.ids, layer: layerOfRow, show: "into" };
  }
  const id = dragged.id;
  const into = (parent: string): Drop | null =>
    parent === id || layersWithin(map.layers, id).has(parent)
      ? null
      : { kind: "layer", id, parent, before: null, show: "into" };
  if (row.type !== "layer") return into(layerOfRow);
  const target = row.node.layer;
  if (target.id === id) return null;
  const parent = target.parent ?? null;
  if (
    zone === "into" ||
    (zone === "after" && row.open && (row.count > 0 || row.node.children > 0))
  ) {
    return into(target.id);
  }
  if (parent !== null && (parent === id || layersWithin(map.layers, id).has(parent))) return null;
  if (zone === "before") return { kind: "layer", id, parent, before: target.id, show: "before" };
  // After: before the next sibling, or at the end of the siblings.
  const siblings = layerTree(map.layers).filter((n) => (n.layer.parent ?? null) === parent);
  const at = siblings.findIndex((n) => n.layer.id === target.id);
  const next = siblings.slice(at + 1).find((n) => n.layer.id !== id);
  return { kind: "layer", id, parent, before: next?.layer.id ?? null, show: "after" };
}

/** The map with a drop made. */
export function applyDrop(map: MapFile, drop: Drop): MapFile {
  if (drop.kind === "layer") {
    const layers = moveLayer(map.layers, drop.id, drop.parent, drop.before);
    return layers === map.layers ? map : { ...map, layers };
  }
  return moveFeatures(map, drop.ids, drop.layer, drop.beside);
}

/** The words for a kind of feature, for one the map page does not know too. */
export function kindName(kind: string): string {
  return kind ? kind[0]!.toUpperCase() + kind.slice(1) : "Feature";
}
