/**
 * The map file: its form, the exact text it is written as, and how two versions of one map are
 * merged. A map is a standalone object that refers to entries by their ids.
 */
import { z } from "zod";
import { mergeItemLists, sameValue as same, serialiseItemFile } from "./itemFile.js";

/** 8 random characters, as for an entry. Shorter ids from hand-written files are accepted. */
const ItemId = z.string().min(1).max(40);
const Pair = z.tuple([z.number(), z.number()]);
const Extent = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const MapSpace = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("sphere"),
      /** Null until the lore gives the globe a size. */
      radius: z.number().positive().nullable(),
      unit: z.string(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("flat"),
      width: z.number().positive(),
      height: z.number().positive(),
      /** Real units per position unit; null until given. */
      scale: z.number().positive().nullable(),
      unit: z.string(),
    })
    .passthrough(),
]);
export type MapSpace = z.infer<typeof MapSpace>;

export const MapImage = z
  .object({
    id: ItemId,
    name: z.string(),
    /** The image's path in the vault. */
    path: z.string(),
    /** `[west, south, east, north]` on a sphere, `[left, top, right, bottom]` on a flat map. */
    extent: Extent,
    /** Whether the map opens with this image shown. */
    visible: z.boolean(),
  })
  .passthrough();
export type MapImage = z.infer<typeof MapImage>;

export const MapLayer = z
  .object({ id: ItemId, name: z.string(), visible: z.boolean(), color: z.string() })
  .passthrough();
export type MapLayer = z.infer<typeof MapLayer>;

const featureBase = {
  id: ItemId,
  layer: ItemId,
  /** The id of the entry this feature stands for, or null. */
  entry: z.string().nullable(),
  /** Shown instead of the entry's title. */
  label: z.string().nullable(),
  /** The id of a more detailed map of this place, or null. */
  child: z.string().nullable(),
};

export const MapFeature = z.discriminatedUnion("kind", [
  z
    .object({
      ...featureBase,
      kind: z.literal("marker"),
      at: Pair,
      icon: z.object({ set: z.string(), name: z.string() }).nullable(),
    })
    .passthrough(),
  z.object({ ...featureBase, kind: z.literal("path"), points: z.array(Pair).min(2) }).passthrough(),
  z.object({ ...featureBase, kind: z.literal("zone"), points: z.array(Pair).min(3) }).passthrough(),
]);
export type MapFeature = z.infer<typeof MapFeature>;

const unique = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;

export const MapFile = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]{8}$/),
    title: z.string().min(1),
    space: MapSpace,
    images: z.array(MapImage),
    markerSets: z.array(z.string()),
    layers: z.array(MapLayer).min(1),
    features: z.array(MapFeature),
  })
  .passthrough()
  .superRefine((map, ctx) => {
    for (const key of ["images", "layers", "features"] as const) {
      if (!unique(map[key])) ctx.addIssue({ code: "custom", message: `Two ${key} share an id.` });
    }
    const layers = new Set(map.layers.map((l) => l.id));
    for (const f of map.features) {
      if (!layers.has(f.layer)) {
        ctx.addIssue({ code: "custom", message: `A feature is in a layer that does not exist.` });
        break;
      }
    }
  });
export type MapFile = z.infer<typeof MapFile>;

export const MAP_FOLDER = ".frontier/maps";
export const mapPath = (id: string): string => `${MAP_FOLDER}/${id}.json`;
/** The map id a vault path belongs to, or null when it is not a map file. */
export function mapIdOf(path: string): string | null {
  return /^\.frontier\/maps\/([a-z0-9]{8})\.json$/.exec(path)?.[1] ?? null;
}

// ---- The text form ---------------------------------------------------------------------------

const TOP = ["version", "id", "title", "space", "images", "markerSets", "layers", "features"];
const ITEM_KEYS: Record<string, string[]> = {
  images: ["id", "name", "path", "extent", "visible"],
  layers: ["id", "name", "visible", "color"],
  features: ["id", "kind", "layer", "at", "points", "entry", "label", "icon", "child"],
};

/**
 * The text a map is stored as. Each image, layer and feature is on one line, so a difference
 * reads item by item, and the same map always gives the same bytes.
 */
export function serialiseMap(map: MapFile): string {
  return serialiseItemFile(map as Record<string, unknown>, TOP, ITEM_KEYS);
}

export type ParsedMap = { ok: true; map: MapFile } | { ok: false; message: string };

/** Reads a map's text. Says why when it is not a valid map. */
export function parseMap(text: string): ParsedMap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "It is not valid JSON." };
  }
  const version = (raw as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version !== 1) {
    return { ok: false, message: `It has version ${version}; this Frontier reads version 1.` };
  }
  const parsed = MapFile.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    return {
      ok: false,
      message: `${issue?.message ?? "It does not have the form of a map."}${where}`,
    };
  }
  return { ok: true, map: parsed.data };
}

// ---- Merging ---------------------------------------------------------------------------------

export interface MapMerge {
  map: MapFile;
  /** Ids of the items, or names of the properties, that both sides changed differently. */
  clashes: string[];
}

/**
 * Merges two versions of a map that started from the same one. What only one side changed is
 * taken from that side. Where both changed the same thing differently, `mine` is kept and the
 * thing is named in `clashes`; the caller decides whether that is acceptable.
 */
export function mergeMaps(base: MapFile, mine: MapFile, theirs: MapFile): MapMerge {
  const clashes: string[] = [];
  const pick = <K extends "title" | "space" | "markerSets">(key: K): MapFile[K] => {
    if (same(mine[key], theirs[key]) || same(base[key], theirs[key])) return mine[key];
    if (same(base[key], mine[key])) return theirs[key];
    clashes.push(key);
    return mine[key];
  };
  const images = mergeItemLists(base.images, mine.images, theirs.images);
  const layers = mergeItemLists(base.layers, mine.layers, theirs.layers);
  const features = mergeItemLists(base.features, mine.features, theirs.features);
  clashes.push(...images.clashes, ...layers.clashes, ...features.clashes);

  // A feature must not be left in a layer that the other side removed.
  const layerIds = new Set(layers.items.map((l) => l.id));
  const fallback = layers.items[0]?.id ?? mine.layers[0]!.id;
  const kept = layers.items.length > 0 ? layers.items : mine.layers;
  const map: MapFile = {
    ...theirs,
    ...mine,
    title: pick("title"),
    space: pick("space"),
    markerSets: pick("markerSets"),
    images: images.items,
    layers: kept,
    features: features.items.map((f) => (layerIds.has(f.layer) ? f : { ...f, layer: fallback })),
  };
  return { map, clashes };
}
