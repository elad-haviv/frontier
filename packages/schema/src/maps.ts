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
      /** A diagram, such as the cosmology: positions mean nothing physical, so nothing is measured. */
      schematic: z.boolean().optional(),
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

/**
 * Another shape of a feature, in force from the start of a span of the chronicle the map is seen
 * through. A marker's holds `at`; a path's or a zone's holds `points`.
 */
export const LaterShape = z
  .object({
    id: ItemId,
    from: ItemId,
    at: Pair.optional(),
    points: z.array(Pair).optional(),
  })
  .passthrough();
export type LaterShape = z.infer<typeof LaterShape>;

const featureBase = {
  id: ItemId,
  layer: ItemId,
  /** The id of the entry this feature stands for, or null. */
  entry: z.string().nullable(),
  /** Shown instead of the entry's title. */
  label: z.string().nullable(),
  /** The id of a more detailed map of this place, or null. */
  child: z.string().nullable(),
  /** The id of the chronicle span that says when this exists. It wins over the entry's span. */
  span: ItemId.nullish(),
  /** Later shapes, each in force from the start of a span. */
  shapes: z.array(LaterShape).optional(),
  /** On a flat map: turns about another marker, once every `period` years, as time moves. */
  orbit: z.object({ around: ItemId, period: z.number().positive() }).passthrough().nullish(),
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
    /** The id of the map this one lies under, sharing its longitude and latitude. */
    under: z
      .string()
      .regex(/^[a-z0-9]{8}$/)
      .nullish(),
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

const TOP = [
  "version",
  "id",
  "title",
  "space",
  "under",
  "images",
  "markerSets",
  "layers",
  "features",
];
const ITEM_KEYS: Record<string, string[]> = {
  images: ["id", "name", "path", "extent", "visible"],
  layers: ["id", "name", "visible", "color"],
  features: [
    "id",
    "kind",
    "layer",
    "at",
    "points",
    "entry",
    "label",
    "icon",
    "child",
    "span",
    "shapes",
    "orbit",
  ],
};

const SHAPE_KEYS = ["id", "from", "at", "points"];

function inOrder<T extends object>(item: T, keys: string[]): T {
  const from = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (from[key] !== undefined) out[key] = from[key];
  for (const key of Object.keys(from))
    if (!(key in out) && from[key] !== undefined) out[key] = from[key];
  return out as T;
}

/**
 * A feature with its keys, and those of its later shapes, in the order the file is written in.
 * A null span and an empty list of later shapes are left out: both mean "none". The same
 * feature then gives the same bytes, and compares as equal, however it was put together.
 */
export function orderFeature(feature: MapFeature): MapFeature {
  const { span, shapes, orbit, ...rest } = feature as MapFeature & Record<string, unknown>;
  return inOrder(
    {
      ...rest,
      ...(span != null ? { span } : {}),
      ...(orbit != null ? { orbit } : {}),
      ...(Array.isArray(shapes) && shapes.length > 0
        ? { shapes: shapes.map((h) => inOrder(h as LaterShape, SHAPE_KEYS)) }
        : {}),
    } as MapFeature,
    ITEM_KEYS.features!,
  );
}

const ordered = (map: MapFile): MapFile => {
  // "Lies under nothing" is written by leaving the key out.
  const { under, ...rest } = map;
  return {
    ...rest,
    ...(under != null ? { under } : {}),
    features: map.features.map(orderFeature),
  } as MapFile;
};

/**
 * The text a map is stored as. Each image, layer and feature is on one line, so a difference
 * reads item by item, and the same map always gives the same bytes.
 */
export function serialiseMap(map: MapFile): string {
  return serialiseItemFile(ordered(map) as Record<string, unknown>, TOP, ITEM_KEYS);
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
export function mergeMaps(base0: MapFile, mine0: MapFile, theirs0: MapFile): MapMerge {
  // The same feature must compare as equal whatever order its keys were set in.
  const [base, mine, theirs] = [ordered(base0), ordered(mine0), ordered(theirs0)];
  const clashes: string[] = [];
  const pick = <K extends "title" | "space" | "markerSets" | "under">(key: K): MapFile[K] => {
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
    ...(mine.under != null || theirs.under != null || base.under != null
      ? { under: pick("under") }
      : {}),
    space: pick("space"),
    markerSets: pick("markerSets"),
    images: images.items,
    layers: kept,
    features: features.items.map((f) => (layerIds.has(f.layer) ? f : { ...f, layer: fallback })),
  };
  return { map, clashes };
}

// ---- Changes the map page makes -----------------------------------------------------------------

/** The extent of an image that covers the whole of a map's space. */
export function wholeExtent(space: MapSpace): MapImage["extent"] {
  return space.kind === "sphere" ? [-180, -90, 180, 90] : [0, 0, space.width, space.height];
}

/**
 * Why an extent cannot be used for an image in this space, or null when it can. An extent must
 * have a width and a height; on a sphere it must also lie on the globe, west of east, and may
 * not run across the 180th meridian.
 */
export function extentProblem(space: MapSpace, extent: readonly number[]): string | null {
  if (extent.length !== 4 || !extent.every((n) => Number.isFinite(n))) {
    return "Each of the four needs a number.";
  }
  const [x0, y0, x1, y1] = extent as [number, number, number, number];
  if (space.kind === "sphere") {
    if (x0 < -180 || x1 > 180) return "West and east must be between -180 and 180.";
    if (y0 < -90 || y1 > 90) return "South and north must be between -90 and 90.";
    if (x0 >= x1) return "West must be less than east.";
    if (y0 >= y1) return "South must be less than north.";
    return null;
  }
  if (x0 >= x1) return "Left must be less than right.";
  if (y0 >= y1) return "Top must be less than bottom.";
  return null;
}

/**
 * The features with one of them moved a step forward (`by` 1, drawn later and so above) or back
 * (`by` -1). Layers are drawn in their own order, and within a layer zones lie under paths and
 * paths under markers, so the only features one can pass are those of its own kind in its own
 * layer: the feature changes places with the nearest of those. The same list is returned when
 * there is none to pass.
 */
export function reorderFeature(features: MapFeature[], id: string, by: 1 | -1): MapFeature[] {
  const at = features.findIndex((f) => f.id === id);
  const feature = features[at];
  if (!feature) return features;
  for (let i = at + by; i >= 0 && i < features.length; i += by) {
    const other = features[i]!;
    if (other.kind !== feature.kind || other.layer !== feature.layer) continue;
    const next = [...features];
    next[at] = other;
    next[i] = feature;
    return next;
  }
  return features;
}
