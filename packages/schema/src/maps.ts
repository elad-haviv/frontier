/**
 * The map file: its form, the exact text it is written as, and how two versions of one map are
 * merged. A map is a standalone object that refers to entries by their ids.
 */
import { z } from "zod";
import { CLIMATE_KEYS, MapClimate } from "./biomes.js";
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
  /**
   * Open space (stage 20): places have three coordinates, in `unit`, and no image is needed.
   * `speed` is how far ships go in a day, which gives routes a travel time.
   */
  z
    .object({
      kind: z.literal("stars"),
      unit: z.string(),
      speed: z.number().positive().optional(),
    })
    .passthrough(),
  /**
   * A star and what circles it (stage 20b). Its bodies are markers with a `body`; distances are
   * in AU, and a moon's in thousands of km. It needs no image.
   */
  z.object({ kind: z.literal("system"), unit: z.string() }).passthrough(),
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

/**
 * The map's terrain: a height picture the tools read (Find paths, relief), never drawn as one of
 * the map's pictures. It lies on the map through its own extent, so it need not be the size of the
 * map's picture. Set in the Terrain dialog (docs/designs/stage-20-terrain-dialog.md).
 */
export const MapTerrain = z
  .object({
    /** The height picture's path in the vault. */
    image: z
      .string()
      .min(1)
      .max(400)
      .refine(
        (p) => !p.startsWith("/") && !p.split("/").includes(".."),
        "Not a path in the vault.",
      ),
    /** Where it lies, as an image's extent; left out: over the whole map. */
    extent: Extent.optional(),
    /** Black is high; left out: white is high. */
    invert: z.literal(true).optional(),
    /** The grey, 0 to 1 after inverting, below which it is sea; left out: matched to the picture. */
    seaLevel: z.number().min(0).max(1).optional(),
    /** The heights of the lowest and the highest grey; left out: heights are only relative. */
    range: z
      .tuple([z.number(), z.number()])
      .refine(([low, high]) => low < high, "The lowest height comes first.")
      .optional(),
    /** The unit of the range: "m", "ft" or the map's own. */
    rangeUnit: z.string().max(20).optional(),
    /** How much the picture is smoothed as it is read, 0 (none) to 4; left out: 0. */
    smoothing: z.number().int().min(0).max(4).optional(),
    /** A guess kept as a height picture, which stays marked as one. */
    guessed: z.literal(true).optional(),
    /**
     * Built by Frontier from the map's terrain hints (docs/designs/stage-21-infer-height-map.md):
     * the settings it was built with, and a hash of the hints in use then, so a change to the
     * hints since shows as "Hints changed since it was built".
     */
    generated: z
      .object({
        from: z.literal("hints"),
        seed: z.number().int(),
        rough: z.number().min(0).max(1),
        sharp: z.number().min(0).max(1),
        erosion: z.number().min(0).max(1),
        /** 1 draft, 2 normal, 3 fine. */
        detail: z.number().int().min(1).max(3),
        carve: z.boolean(),
        lakes: z.boolean(),
        hints: z.string().max(40),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type MapTerrain = z.infer<typeof MapTerrain>;

export const TERRAIN_HINT_KINDS = [
  "sea",
  "coast",
  "lake",
  "river",
  "ridge",
  "peak",
  "hollow",
  "valley",
  "cliff",
  "highland",
  "lowland",
  "plain",
  "marsh",
  "road",
] as const;
export type TerrainHintKind = (typeof TERRAIN_HINT_KINDS)[number];

/**
 * What the picture (or the owner) says about height at a place, which a height map is built from:
 * a peak, a ridge, a river and which way it runs, a marsh. Kept as their own list on the map and
 * merged hint by hint. Sea and coast hold no shape: they are the picture's water each time. A hint
 * tied to a feature (`by: "feature:<id>"`) takes its shape from that feature.
 */
export const MapTerrainHint = z
  .object({
    id: ItemId,
    kind: z.enum(TERRAIN_HINT_KINDS),
    /** A point: a peak or a hollow. */
    at: Pair.optional(),
    /** A line (a river runs from its source to its mouth) or a zone's ring. */
    points: z.array(Pair).optional(),
    /** The height, 0 to 1 of the highest point; a highland's lowest. */
    h: z.number().min(-1).max(2).optional(),
    /** A highland's highest. */
    h2: z.number().min(-1).max(2).optional(),
    /** How firmly it holds, 0 to 1. */
    strength: z.number().min(0).max(1).optional(),
    /** A cliff high on its right as drawn; a river or a valley that runs the other way. */
    flip: z.literal(true).optional(),
    state: z.enum(["accepted", "waiting", "rejected"]),
    /** "found", "you", or "feature:<id>". */
    by: z.string().min(1).max(60),
    /** How sure the finding was, 0 to 1; only for found hints. */
    conf: z.number().min(0).max(1).optional(),
  })
  .passthrough();
export type MapTerrainHint = z.infer<typeof MapTerrainHint>;

export const MapLayer = z
  .object({
    id: ItemId,
    name: z.string(),
    /** Whether the map opens with this layer shown. A hidden layer hides its sublayers too. */
    visible: z.boolean(),
    color: z.string(),
    /** The layer this one is a sublayer of; none (left out of the file) at the top level. */
    parent: ItemId.nullish(),
    /** Its features, and those of its sublayers, cannot be picked on the map; left out: no. */
    locked: z.boolean().optional(),
    /** On a star map: whether this layer's markers are drawn as light dots or as pins. */
    look: z.enum(["dot", "pin"]).optional(),
  })
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
  /** The group it is one piece of, in its own layer; none (left out of the file) when in none. */
  group: ItemId.nullish(),
};

/**
 * A path or zone drawn as a smooth curve through its points; without it, straight from point to
 * point. It belongs to the feature: all of its shapes are curved or straight together.
 */
const curve = z.literal("smooth").optional();

/** A stretch of a path between two of its corners: see `stretches` on a path. */
export const PathStretch = z
  .object({
    kind: z.enum(["tunnel", "steps", "climb"]),
    from: Pair,
    to: Pair,
    grade: z.number().min(-10).max(10).optional(),
  })
  .passthrough();
export type PathStretch = z.infer<typeof PathStretch>;

/**
 * The id of a path or zone style in the map styles file. A style that is not there, or is for the
 * other kind, counts as none, and the id is kept so that the look comes back with the style.
 */
const style = z
  .string()
  .regex(/^[a-z0-9]{8}$/)
  .optional();

/**
 * A body of a system model. `a` is the distance in AU, or thousands of km around a planet; for a
 * second star, the AU between the two. `parent` is the id of the body it circles; a star has none.
 * `phase`, `peri` are angles in radians: where it is on day 0, and which way a stretched orbit
 * points. `mass` is in solar masses, for stars.
 */
export const SystemBody = z
  .object({
    type: z.enum([
      "star",
      "companion",
      "rocky",
      "ocean",
      "gas",
      "ice",
      "dwarf",
      "moon",
      "station",
      "belt",
      "comet",
    ]),
    parent: ItemId.optional(),
    a: z.number().min(0),
    e: z.number().min(0).max(0.95).optional(),
    phase: z.number().optional(),
    peri: z.number().optional(),
    retro: z.boolean().optional(),
    mass: z.number().positive().optional(),
    inner: z.number().min(0).optional(),
    outer: z.number().min(0).optional(),
    home: z.boolean().optional(),
  })
  .passthrough();
export type SystemBody = z.infer<typeof SystemBody>;

export const MapFeature = z.discriminatedUnion("kind", [
  z
    .object({
      ...featureBase,
      kind: z.literal("marker"),
      at: Pair,
      icon: z.object({ set: z.string(), name: z.string() }).nullable(),
      /** On a star map: the height above (or, below zero, under) the plane. */
      z: z.number().optional(),
      /** On a star map: how this marker is drawn, when not as its layer is. */
      look: z.enum(["dot", "pin"]).optional(),
      /** On a star map: the colour of its dot. */
      tone: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      /** On a star map: 1 small (named on hover), 2 normal, 3 large (always named). */
      size: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      /** In a system model: this marker is a body on an orbit. */
      body: SystemBody.optional(),
      /**
       * On a globe that has globes under it (stage 20c): passages from this place down to places
       * on other layers. The upper place holds them; the lower is named by its map and feature.
       */
      passages: z
        .array(
          z
            .object({
              map: z.string().regex(/^[a-z0-9]{8}$/),
              feature: ItemId,
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
  /**
   * On a star map: a route that runs through markers, in order. Its length comes from their
   * places, so it is not stored.
   */
  z
    .object({
      ...featureBase,
      kind: z.literal("route"),
      stops: z.array(ItemId).min(2),
      lane: z.enum(["jump", "trade", "patrol"]).optional(),
    })
    .passthrough(),
  z
    .object({
      ...featureBase,
      kind: z.literal("path"),
      points: z.array(Pair).min(2),
      curve,
      style,
      /**
       * A join: this path's first (`startOn`) or last (`endOn`) point lies on another path, whose id
       * this is, at a corner the two share. The app keeps the end on that corner as either path
       * is changed. A join to a path that is gone is dropped on reading and on merging.
       */
      startOn: ItemId.nullish(),
      endOn: ItemId.nullish(),
      /**
       * Stretches of the path that are something other than its plain line, each between two of
       * its corners, given by their coordinates (so a corner put in elsewhere leaves it alone): a
       * tunnel (drawn dashed), steps, or a climb (`grade`, the steepest grade along it as a
       * fraction, above 0 when it rises from `from` to `to`; drawn as chevrons pointing uphill).
       * A stretch whose corners are gone is not drawn. Made by Find paths.
       */
      stretches: z.array(PathStretch).max(500).optional(),
      /** How a river ends inland: it sinks underground (tapers) or dries out (thins, dashed). */
      endAs: z.enum(["sinks", "dries"]).optional(),
      /** The chevrons on its climbs are hidden; left out: shown. */
      steepShown: z.literal(false).optional(),
    })
    .passthrough(),
  z
    .object({
      ...featureBase,
      kind: z.literal("zone"),
      points: z.array(Pair).min(3),
      curve,
      style,
      /**
       * What the ground of the zone is, whatever its style: a built-in biome's key ("taiga") or
       * the id of one of the owner's biomes. One that is not there counts as none and is kept.
       */
      biome: z
        .string()
        .regex(/^[a-z0-9-]{2,24}$/, "Not a biome.")
        .optional(),
      /** The biome's pattern is not drawn over this zone; left out: it is. */
      pattern: z.literal(false).optional(),
    })
    .passthrough(),
  /**
   * Words written on the map, such as the name of a sea. `label` holds the words, so a label
   * always has a name. Its size is in pixels on the screen; it is upright unless turned.
   */
  z
    .object({
      ...featureBase,
      kind: z.literal("label"),
      at: Pair,
      label: z.string().min(1).max(200),
      size: z.number().min(6).max(160).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      /** Degrees, clockwise on the screen. */
      rotate: z.number().min(-360).max(360).optional(),
      /** The room between letters, in ems. */
      spacing: z.number().min(-0.2).max(2).optional(),
    })
    .passthrough(),
]);
/** A path or a zone: a feature drawn through points. */
export type LinedFeature = Extract<MapFeature, { kind: "path" | "zone" }>;
/** A marker or a label: a feature at one place. */
export type PlacedFeature = Extract<MapFeature, { kind: "marker" | "label" }>;
export type MapLabel = Extract<MapFeature, { kind: "label" }>;
export const isLined = (f: MapFeature): f is LinedFeature => f.kind === "path" || f.kind === "zone";
/** The look a label has when nothing else is set. */
export const LABEL_LOOK = { size: 16, color: "#2a2420", rotate: 0, spacing: 0 } as const;
export type MapFeature = z.infer<typeof MapFeature>;

/**
 * A named set of features of one layer that stand for one place, such as the islands of a realm.
 * Which features are in it is written on each feature (`group`), so that two devices adding
 * different pieces merge without a clash. Its name is written on the map once for all of them.
 */
export const MapGroup = z
  .object({
    id: ItemId,
    /** The layer it is in; its members are features of this layer. */
    layer: ItemId,
    /** The name; shown instead of the entry's title. */
    label: z.string().nullable(),
    entry: z.string().nullable(),
    /** The id of a more detailed map of this place. */
    child: z.string().nullable().optional(),
    span: ItemId.nullish(),
    /** The name on the map: left out, written; false, not written. */
    write: z.literal(false).optional(),
    /** Where the name is written; left out, placed by itself. */
    at: Pair.optional(),
    // The name's look, as a label's; left out, the defaults. Colour left out: from the zones.
    size: z.number().min(6).max(160).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    rotate: z.number().min(-360).max(360).optional(),
    spacing: z.number().min(-0.2).max(2).optional(),
    /** Its members cannot be picked on the map; left out: no. */
    locked: z.boolean().optional(),
  })
  .passthrough();
export type MapGroup = z.infer<typeof MapGroup>;
/** The look a group's name has when nothing else is set: written larger, and spaced. */
export const GROUP_LOOK = { size: 18, rotate: 0, spacing: 0.25 } as const;

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
    /** Features drawn as one place; left out when there are none. */
    groups: z.array(MapGroup).optional(),
    /** The height picture the tools read; left out when the map has none. */
    terrain: MapTerrain.nullish(),
    /** What says how high the land is, to build a height map from; left out when there are none. */
    terrainHints: z.array(MapTerrainHint).optional(),
    /** Suggest biomes' world settings, once something it suggested was accepted. */
    climate: MapClimate.nullish(),
  })
  .passthrough()
  .superRefine((map, ctx) => {
    if (map.terrain?.extent) {
      const problem = extentProblem(map.space, map.terrain.extent);
      if (problem) ctx.addIssue({ code: "custom", message: `The terrain's place: ${problem}` });
    }
    for (const key of ["images", "layers", "features"] as const) {
      if (!unique(map[key])) ctx.addIssue({ code: "custom", message: `Two ${key} share an id.` });
    }
    // A group's members and layer are put right on reading (`repairGroups`), not refused.
    if (map.groups && !unique(map.groups)) {
      ctx.addIssue({ code: "custom", message: "Two groups share an id." });
    }
    if (map.terrainHints && !unique(map.terrainHints)) {
      ctx.addIssue({ code: "custom", message: "Two terrain hints share an id." });
    }
    const layers = new Set(map.layers.map((l) => l.id));
    const problem = layerProblem(map.layers);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
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
  "groups",
  // Added later, so they go last: a file without them keeps its bytes.
  "terrain",
  "terrainHints",
  "climate",
];
const ITEM_KEYS: Record<string, string[]> = {
  images: ["id", "name", "path", "extent", "visible"],
  // Fields added later go at the end, so that older files read and write the same.
  layers: ["id", "name", "visible", "color", "parent", "locked"],
  features: [
    "id",
    "kind",
    "layer",
    "at",
    "points",
    "curve",
    "entry",
    "label",
    "icon",
    "style",
    "size",
    "color",
    "rotate",
    "spacing",
    "child",
    "span",
    "shapes",
    "orbit",
    "group",
    "startOn",
    "endOn",
    "stretches",
    "endAs",
    "steepShown",
    "biome",
    "pattern",
  ],
  groups: [
    "id",
    "layer",
    "label",
    "entry",
    "child",
    "span",
    "write",
    "at",
    "size",
    "color",
    "rotate",
    "spacing",
    "locked",
  ],
  terrainHints: [
    "id",
    "kind",
    "at",
    "points",
    "h",
    "h2",
    "strength",
    "flip",
    "state",
    "by",
    "conf",
  ],
};

const SHAPE_KEYS = ["id", "from", "at", "points"];
const TERRAIN_KEYS = [
  "image",
  "extent",
  "invert",
  "seaLevel",
  "range",
  "rangeUnit",
  "smoothing",
  "guessed",
  "generated",
];

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
  const { span, shapes, orbit, group, startOn, endOn, ...rest } = feature as MapFeature &
    Record<string, unknown>;
  return inOrder(
    {
      ...rest,
      ...(span != null ? { span } : {}),
      ...(orbit != null ? { orbit } : {}),
      ...(group != null ? { group } : {}),
      ...(startOn != null ? { startOn } : {}),
      ...(endOn != null ? { endOn } : {}),
      ...(Array.isArray(shapes) && shapes.length > 0
        ? { shapes: shapes.map((h) => inOrder(h as LaterShape, SHAPE_KEYS)) }
        : {}),
    } as MapFeature,
    ITEM_KEYS.features!,
  );
}

/**
 * A layer with its keys in the order the file is written in. "At the top level" and "not locked"
 * are written by leaving the key out, so a file from before sublayers keeps its bytes, and the
 * same layer compares as equal however it was put together.
 */
export function orderLayer<T extends MapLayer>(layer: T): T {
  const { parent, locked, ...rest } = layer;
  return inOrder(
    {
      ...rest,
      ...(parent != null ? { parent } : {}),
      ...(locked === true ? { locked } : {}),
    } as T,
    ITEM_KEYS.layers!,
  );
}

/**
 * A group with its keys in the order the file is written in. What is "none" or the default (no
 * map of the place, no span, the name written, not locked) is written by leaving the key out.
 */
export function orderGroup<T extends MapGroup>(group: T): T {
  const { child, span, write, locked, ...rest } = group;
  return inOrder(
    {
      ...rest,
      ...(child != null ? { child } : {}),
      ...(span != null ? { span } : {}),
      ...(write === false ? { write } : {}),
      ...(locked === true ? { locked } : {}),
    } as T,
    ITEM_KEYS.groups!,
  );
}

const ordered = (map: MapFile): MapFile => {
  // "Lies under nothing", "no groups", "no terrain", "no hints" and "no climate" are written by
  // leaving the key out.
  const { under, groups, terrain, terrainHints, climate, ...rest } = map;
  return {
    ...rest,
    ...(under != null ? { under } : {}),
    layers: map.layers.map(orderLayer),
    features: map.features.map(orderFeature),
    ...(groups && groups.length > 0 ? { groups: groups.map(orderGroup) } : {}),
    ...(terrain != null ? { terrain: inOrder(terrain, TERRAIN_KEYS) } : {}),
    ...(terrainHints && terrainHints.length > 0
      ? { terrainHints: terrainHints.map((h) => inOrder(h, ITEM_KEYS.terrainHints!)) }
      : {}),
    ...(climate != null ? { climate: inOrder(climate, CLIMATE_KEYS) } : {}),
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
  return { ok: true, map: repairHints(repairJoins(repairGroups(parsed.data))) };
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
  const pick = <K extends "title" | "space" | "markerSets" | "under" | "terrain" | "climate">(
    key: K,
  ): MapFile[K] => {
    if (same(mine[key], theirs[key]) || same(base[key], theirs[key])) return mine[key];
    if (same(base[key], mine[key])) return theirs[key];
    clashes.push(key);
    return mine[key];
  };
  const images = mergeItemLists(base.images, mine.images, theirs.images);
  const layers = mergeItemLists(base.layers, mine.layers, theirs.layers);
  // The order of the layers is the order they are drawn in: a reorder made on one side only is
  // kept. Then a sublayer whose layer the other side removed goes to the top level, and a loop
  // made by each side putting a layer inside the other is broken.
  layers.items = repairLayers(keepReorder(base.layers, mine.layers, theirs.layers, layers.items));
  const features = mergeItemLists(base.features, mine.features, theirs.features);
  const groups = mergeItemLists(base.groups ?? [], mine.groups ?? [], theirs.groups ?? []);
  // Hint by hint: two devices reviewing different hints both keep their work.
  const hints = mergeItemLists(
    base.terrainHints ?? [],
    mine.terrainHints ?? [],
    theirs.terrainHints ?? [],
  );
  clashes.push(
    ...images.clashes,
    ...layers.clashes,
    ...features.clashes,
    ...groups.clashes,
    ...hints.clashes,
  );

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
    // The terrain is one item: set, changed or taken away on one side, it is that side's.
    ...(mine.terrain != null || theirs.terrain != null || base.terrain != null
      ? { terrain: pick("terrain") }
      : {}),
    // So is the climate.
    ...(mine.climate != null || theirs.climate != null || base.climate != null
      ? { climate: pick("climate") }
      : {}),
    images: images.items,
    layers: kept,
    features: features.items.map((f) => (layerIds.has(f.layer) ? f : { ...f, layer: fallback })),
    groups: groups.items.map((g) => (layerIds.has(g.layer) ? g : { ...g, layer: fallback })),
    terrainHints: hints.items,
  };
  // A member whose group the other side removed, or moved to another layer, is no longer in it.
  return { map: ordered(repairHints(repairJoins(repairGroups(map)))), clashes };
}

// ---- Terrain hints -----------------------------------------------------------------------------

/**
 * The map with its terrain hints made sound: a hint tied to a feature that is not there is
 * dropped. The same map comes back when nothing was wrong.
 */
export function repairHints(map: MapFile): MapFile {
  const hints = map.terrainHints;
  if (!hints || hints.length === 0) return map;
  const ids = new Set(map.features.map((f) => f.id));
  const kept = hints.filter((h) => !h.by.startsWith("feature:") || ids.has(h.by.slice(8)));
  return kept.length === hints.length ? map : withTerrainHints(map, kept);
}

/** The map with this list of terrain hints; the key is left out when there are none. */
export function withTerrainHints(map: MapFile, hints: MapTerrainHint[]): MapFile {
  const next: MapFile = { ...map };
  delete next.terrainHints;
  return hints.length > 0 ? { ...next, terrainHints: hints } : next;
}

// ---- Joins -------------------------------------------------------------------------------------

/**
 * The map with its joins made sound: a path's join to a feature that is not there, is not a path,
 * or is the path itself, is dropped. The same map comes back when nothing was wrong.
 */
export function repairJoins(map: MapFile): MapFile {
  const paths = new Set(map.features.filter((f) => f.kind === "path").map((f) => f.id));
  let changed = false;
  const features = map.features.map((f) => {
    if (f.kind !== "path") return f;
    const bad = (on: string | null | undefined) => on != null && (!paths.has(on) || on === f.id);
    if (!bad(f.startOn) && !bad(f.endOn)) return f;
    changed = true;
    return orderFeature({
      ...f,
      startOn: bad(f.startOn) ? null : f.startOn,
      endOn: bad(f.endOn) ? null : f.endOn,
    });
  });
  return changed ? { ...map, features } : map;
}

// ---- Groups ------------------------------------------------------------------------------------

/**
 * The map with its groups made sound, without refusing anything: a group in a layer that is not
 * there goes to the first layer; a feature's group that is not there, or is in another layer, is
 * cleared; a group with no members left is dropped. The same map comes back when nothing was wrong.
 */
export function repairGroups(map: MapFile): MapFile {
  const before = map.groups ?? [];
  const layerIds = new Set(map.layers.map((l) => l.id));
  const fallback = map.layers[0]?.id;
  let groups = before.map((g) =>
    layerIds.has(g.layer) || !fallback ? g : orderGroup({ ...g, layer: fallback }),
  );
  const layerOf = new Map(groups.map((g) => [g.id, g.layer]));
  let changed = groups.some((g, i) => g !== before[i]);
  const features = map.features.map((f) => {
    if (f.group == null || layerOf.get(f.group) === f.layer) return f;
    changed = true;
    return orderFeature({ ...f, group: null });
  });
  const used = new Set(features.map((f) => f.group).filter((g) => g != null));
  if (groups.some((g) => !used.has(g.id))) {
    changed = true;
    groups = groups.filter((g) => used.has(g.id));
  }
  if (!changed) return map;
  return withGroups({ ...map, features }, groups);
}

/** The map with this list of groups; the key is left out when there are none. */
export function withGroups(map: MapFile, groups: MapGroup[]): MapFile {
  const next: MapFile = { ...map };
  delete next.groups;
  return groups.length > 0 ? { ...next, groups } : next;
}

/** The ids of `list` that are also in `among`, in the order of `list`. */
const sharedOrder = (list: readonly { id: string }[], among: Set<string>) =>
  list.filter((i) => among.has(i.id)).map((i) => i.id);

/**
 * The merged list in my order when only I reordered what all three versions have; otherwise as
 * merged, which follows their order. What only they added comes after, as in the merge.
 */
function keepReorder<T extends { id: string }>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  merged: T[],
): T[] {
  const inMine = new Set(mine.map((i) => i.id));
  const inTheirs = new Set(theirs.map((i) => i.id));
  const inAll = new Set(
    base.filter((b) => inMine.has(b.id) && inTheirs.has(b.id)).map((b) => b.id),
  );
  const b = sharedOrder(base, inAll).join();
  if (sharedOrder(mine, inAll).join() === b || sharedOrder(theirs, inAll).join() !== b) {
    return merged;
  }
  const byId = new Map(merged.map((i) => [i.id, i]));
  const out: T[] = [];
  const placed = new Set<string>();
  for (const { id } of [...mine, ...merged]) {
    const item = byId.get(id);
    if (item && !placed.has(id)) {
      placed.add(id);
      out.push(item);
    }
  }
  return out;
}

// ---- Layers and sublayers --------------------------------------------------------------------

/**
 * Why a map's layers cannot be saved, or null: each sublayer's layer must be there, and no layer
 * may be inside itself, however deep.
 */
export function layerProblem(layers: readonly MapLayer[]): string | null {
  const ids = new Set(layers.map((l) => l.id));
  if (layers.some((l) => l.parent != null && !ids.has(l.parent))) {
    return "A sublayer is in a layer that does not exist.";
  }
  if (layerLoops(layers).length > 0) return "A layer is inside itself.";
  return null;
}

/** Each loop of layers inside one another, as the ids in it. */
function layerLoops(layers: readonly MapLayer[]): string[][] {
  const parentOf = new Map(layers.map((l) => [l.id, l.parent ?? null]));
  const done = new Set<string>();
  const loops: string[][] = [];
  for (const start of layers) {
    const path: string[] = [];
    let at: string | null = start.id;
    while (at !== null && parentOf.has(at) && !done.has(at)) {
      const seen = path.indexOf(at);
      if (seen >= 0) {
        loops.push(path.slice(seen));
        break;
      }
      path.push(at);
      at = parentOf.get(at) ?? null;
    }
    for (const id of path) done.add(id);
  }
  return loops;
}

/**
 * The layers made sound: a sublayer of a layer that is not there goes to the top level, and
 * each loop is broken at the layer in it with the smallest id, which goes to the top level, so
 * that every device breaks it the same way. The same list comes back when nothing was wrong.
 */
export function repairLayers<T extends MapLayer>(layers: T[]): T[] {
  const ids = new Set(layers.map((l) => l.id));
  const top = (l: T) => orderLayer({ ...l, parent: null });
  let out = layers.map((l) => (l.parent != null && !ids.has(l.parent) ? top(l) : l));
  for (const loop of layerLoops(out)) {
    const first = [...loop].sort()[0];
    out = out.map((l) => (l.id === first ? top(l) : l));
  }
  return out.every((l, i) => l === layers[i]) ? layers : out;
}

/** One layer in the tree: how deep it is (0 at the top level) and how many sublayers it has. */
export interface LayerNode {
  layer: MapLayer;
  depth: number;
  children: number;
}

/** Each layer's sublayers, in the order of the list; the top level under null. */
function sublayers<T extends MapLayer>(layers: T[], repair = true): Map<string | null, T[]> {
  const kids = new Map<string | null, T[]>();
  for (const l of repair ? repairLayers(layers) : layers) {
    const p = l.parent ?? null;
    kids.set(p, [...(kids.get(p) ?? []), l]);
  }
  return kids;
}

/** The tree flattened: each layer, then its sublayers, depth first. */
function flatten<T extends MapLayer>(kids: Map<string | null, T[]>): { layer: T; depth: number }[] {
  const out: { layer: T; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of kids.get(parent) ?? []) {
      out.push({ layer: l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * The layers as a tree, flattened: each layer followed by its sublayers, siblings in the order
 * of the list. This is the order they are drawn in: a layer's features, then its sublayers'
 * over them, then the next layer's. A loop or a missing layer is read as the top level.
 */
export function layerTree(layers: readonly MapLayer[]): LayerNode[] {
  const kids = sublayers([...layers]);
  return flatten(kids).map(({ layer, depth }) => ({
    layer,
    depth,
    children: kids.get(layer.id)?.length ?? 0,
  }));
}

/** The ids of a layer's sublayers, theirs, and so on down; not the layer itself. */
export function layersWithin(layers: readonly MapLayer[], id: string): Set<string> {
  const out = new Set<string>();
  const tree = layerTree(layers);
  const at = tree.findIndex((n) => n.layer.id === id);
  for (let i = at + 1; at >= 0 && i < tree.length && tree[i]!.depth > tree[at]!.depth; i++) {
    out.add(tree[i]!.layer.id);
  }
  return out;
}

/** The ids in the tree under each layer for which `on` holds, with those layers. */
function withinWhere(layers: readonly MapLayer[], on: (l: MapLayer) => boolean): Set<string> {
  const out = new Set<string>();
  let under: number | null = null;
  for (const node of layerTree(layers)) {
    if (under !== null && node.depth <= under) under = null;
    if (under === null && on(node.layer)) under = node.depth;
    if (under !== null) out.add(node.layer.id);
  }
  return out;
}

/**
 * What is hidden, with the sublayers of each hidden layer added: a hidden layer hides all that is
 * inside it. Other ids in `hidden`, such as single features, are kept.
 */
export function hiddenWithin(
  layers: readonly MapLayer[],
  hidden: ReadonlySet<string>,
): Set<string> {
  return new Set([...hidden, ...withinWhere(layers, (l) => hidden.has(l.id))]);
}

/** The ids of the layers that are locked, by themselves or by a layer they are inside. */
export function lockedWithin(layers: readonly MapLayer[]): Set<string> {
  return withinWhere(layers, (l) => l.locked === true);
}

/**
 * The layers with one moved, with its sublayers, into `parent` (null: the top level), before its
 * sibling `before` (null: after the last). The list comes back in tree order. The same list comes
 * back when the move cannot be made: into itself or one of its own sublayers.
 */
export function moveLayer<T extends MapLayer>(
  layers: T[],
  id: string,
  parent: string | null,
  before: string | null = null,
): T[] {
  const moving = layers.find((l) => l.id === id);
  if (!moving || before === id) return layers;
  if (parent !== null && (parent === id || !layers.some((l) => l.id === parent))) return layers;
  if (parent !== null && layersWithin(layers, id).has(parent)) return layers;
  // Its sublayers stay with it: they still name it as their layer.
  const kids = sublayers(
    repairLayers(layers).filter((l) => l.id !== id),
    false,
  );
  const siblings = kids.get(parent) ?? [];
  const at = before === null ? -1 : siblings.findIndex((l) => l.id === before);
  const moved = orderLayer({ ...moving, parent });
  kids.set(
    parent,
    at < 0 ? [...siblings, moved] : [...siblings.slice(0, at), moved, ...siblings.slice(at)],
  );
  const next = flatten(kids).map((n) => n.layer);
  return next.length === layers.length && next.every((l, i) => sameLayer(l, layers[i]))
    ? layers
    : next;
}

const sameLayer = (a: MapLayer, b: MapLayer | undefined) =>
  b !== undefined && same(orderLayer(a), orderLayer(b));

/**
 * The layers with one moved a step up (-1) or down (1) among its siblings. The same list comes
 * back when it is already first or last.
 */
export function stepLayer<T extends MapLayer>(layers: T[], id: string, by: 1 | -1): T[] {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return layers;
  const parent = layer.parent ?? null;
  const siblings = (sublayers(layers).get(parent) ?? []).map((l) => l.id);
  const to = siblings.indexOf(id) + by;
  if (to < 0 || to >= siblings.length) return layers;
  // Down: before the sibling after the next one; up: before the one before.
  return moveLayer(layers, id, parent, by === 1 ? (siblings[to + 1] ?? null) : siblings[to]!);
}

// ---- Changes the map page makes -----------------------------------------------------------------

/** The extent of an image that covers the whole of a map's space. */
export function wholeExtent(space: MapSpace): MapImage["extent"] {
  if (space.kind === "stars" || space.kind === "system") return [0, 0, 1, 1];
  return space.kind === "sphere" ? [-180, -90, 180, 90] : [0, 0, space.width, space.height];
}

/** A space with a picture to lie over: a globe or a flat map. A star map or system has no such space. */
export type PlanarSpace = Exclude<MapSpace, { kind: "stars" | "system" }>;

/** The space of a map drawn by the globe and flat map page; the star map has its own page. */
export function planarSpace(space: MapSpace): PlanarSpace {
  if (space.kind === "stars" || space.kind === "system") {
    throw new Error("A star map or system model has no flat or globe space.");
  }
  return space;
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

/**
 * What the list of maps shows of a map without opening it (stage 23): its first image, or, for a
 * star map or a system model, the few numbers a small drawing needs. Positions are 0 to 1.
 */
export type MapPreview =
  | { kind: "image"; path: string }
  | {
      kind: "stars";
      /** Where each star is on the plane seen from above, and its colour. */
      dots: { x: number; y: number; c: string }[];
      /** Routes, as pairs of indexes into `dots`. */
      lines: [number, number][];
    }
  | {
      kind: "system";
      /** The star's colour. */
      star: string;
      /** Each planet's orbit as a share of the widest (0 to 1), where it is (radians) and its colour. */
      rings: { r: number; a: number; c: string }[];
    };
