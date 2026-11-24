/**
 * The chronicle file: one version of a history, as lanes, spans, the author's statements about
 * how spans relate, his units, and the comparison he last laid out. Every number in it is a
 * working number, not lore.
 */
import { z } from "zod";
import { mergeItemLists, mergeValue, serialiseItemFile } from "./itemFile.js";

const ItemId = z.string().min(1).max(40);

/** The author's words with a lowest and a highest value, in years. The words are never read. */
export const Rough = z
  .object({ words: z.string(), low: z.number(), high: z.number() })
  .passthrough()
  .refine((r) => r.low <= r.high, "The lowest value is above the highest.");
export type Rough = z.infer<typeof Rough>;

/** A length also records whose clock it was counted on, and the unit it was typed in, if any. */
export const RoughLength = z
  .object({
    words: z.string(),
    low: z.number().min(0),
    high: z.number().min(0),
    clock: z.string(),
    unit: z.string().optional(),
    count: z.tuple([z.number(), z.number()]).optional(),
  })
  .passthrough()
  .refine((r) => r.low <= r.high, "The lowest value is above the highest.");
export type RoughLength = z.infer<typeof RoughLength>;

/** A beginning or an end: a rough number, "open" (older than shown, or still going on), or unknown. */
const End = z.union([Rough, z.literal("open")]).nullable();

export const ChronicleLane = z
  .object({ id: ItemId, name: z.string(), color: z.string(), clock: z.string() })
  .passthrough();
export type ChronicleLane = z.infer<typeof ChronicleLane>;

export const ChronicleUnit = z
  .object({ id: ItemId, name: z.string(), low: z.number().min(0), high: z.number().min(0) })
  .passthrough();
export type ChronicleUnit = z.infer<typeof ChronicleUnit>;

/** A tie: another span's start or end, plus a lowest and a highest number of years. */
export const SpanTie = z
  .object({
    span: ItemId,
    edge: z.enum(["start", "end"]),
    plus: z
      .object({ low: z.number(), high: z.number() })
      .refine((p) => p.low <= p.high, "The lowest value is above the highest."),
  })
  .passthrough();
export type SpanTie = z.infer<typeof SpanTie>;

export const ChronicleSpan = z
  .object({
    id: ItemId,
    lane: ItemId,
    name: z.string(),
    /** True for an event: a single moment, with a start and no length. */
    point: z.boolean(),
    start: End,
    end: End,
    length: RoughLength.nullable(),
    /** The id of the entry this span stands for, or null. */
    entry: z.string().nullable(),
    note: z.string(),
    /**
     * Ties (stage 17): the start or end follows a point of another span. `start` and `end` still
     * hold the worked-out numbers, so whatever does not know ties reads the same. Optional, so
     * older files are unchanged.
     */
    startFrom: SpanTie.nullish(),
    endFrom: SpanTie.nullish(),
  })
  .passthrough();
export type ChronicleSpan = z.infer<typeof ChronicleSpan>;

export const RELATION_KINDS = [
  "after",
  "before",
  "during",
  "starts_with",
  "ends_with",
  "overlaps",
  "longer_than",
  "shorter_than",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** A kind this version does not know is kept as written and shown as not checked. */
export const ChronicleRelation = z
  .object({ id: ItemId, a: ItemId, kind: z.string(), b: ItemId })
  .passthrough();
export type ChronicleRelation = z.infer<typeof ChronicleRelation>;

/** A real-world example used as a ruler. A shipped one is copied in when it is picked. */
export const ChronicleCase = z
  .object({
    id: ItemId,
    name: z.string(),
    low: z.number().min(0),
    high: z.number().min(0),
    /** What starts the clock and what stops it. */
    from: z.string(),
    to: z.string(),
    source: z.string(),
    caveat: z.string(),
    /** The id of the case in Frontier's own list this was copied from. */
    shipped: z.string().optional(),
  })
  .passthrough();
export type ChronicleCase = z.infer<typeof ChronicleCase>;

const unique = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;

export const ChronicleFile = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]{8}$/),
    title: z.string().min(1),
    /** At most one chronicle is the main one, which maps and AI will read later. */
    main: z.boolean(),
    /** The reference clock: whose years starts and ends are counted in. */
    clock: z.string(),
    /** The span whose start is year 0, or null while nothing is placed. */
    origin: z.string().nullable(),
    lanes: z.array(ChronicleLane).min(1),
    units: z.array(ChronicleUnit),
    spans: z.array(ChronicleSpan),
    relations: z.array(ChronicleRelation),
    compare: z.object({ spans: z.array(z.string()), cases: z.array(ChronicleCase) }).passthrough(),
  })
  .passthrough()
  .superRefine((c, ctx) => {
    for (const key of ["lanes", "units", "spans", "relations"] as const) {
      if (!unique(c[key])) ctx.addIssue({ code: "custom", message: `Two ${key} share an id.` });
    }
    const lanes = new Set(c.lanes.map((l) => l.id));
    if (c.spans.some((s) => !lanes.has(s.lane))) {
      ctx.addIssue({ code: "custom", message: "A span is in a lane that does not exist." });
    }
    // A relation to a missing span, a circle of relations, and a missing unit or origin are all
    // allowed: a merge can produce them, and the chronicle must still open.
  });
export type ChronicleFile = z.infer<typeof ChronicleFile>;

export const CHRONICLE_FOLDER = ".frontier/chronicles";
export const chroniclePath = (id: string): string => `${CHRONICLE_FOLDER}/${id}.json`;
/** The chronicle id a vault path belongs to, or null when it is not a chronicle file. */
export function chronicleIdOf(path: string): string | null {
  return /^\.frontier\/chronicles\/([a-z0-9]{8})\.json$/.exec(path)?.[1] ?? null;
}

const TOP = [
  "version",
  "id",
  "title",
  "main",
  "clock",
  "origin",
  "lanes",
  "units",
  "spans",
  "relations",
  "compare",
];
const ITEM_KEYS: Record<string, string[]> = {
  lanes: ["id", "name", "color", "clock"],
  units: ["id", "name", "low", "high"],
  spans: [
    "id",
    "lane",
    "name",
    "point",
    "start",
    "end",
    "length",
    "entry",
    "note",
    "startFrom",
    "endFrom",
  ],
  relations: ["id", "a", "kind", "b"],
};

/** The text a chronicle is stored as: one lane, unit, span and relation per line. */
export function serialiseChronicle(chronicle: ChronicleFile): string {
  return serialiseItemFile(chronicle as Record<string, unknown>, TOP, ITEM_KEYS);
}

export type ParsedChronicle =
  { ok: true; chronicle: ChronicleFile } | { ok: false; message: string };

/** Reads a chronicle's text. Says why when it is not a valid chronicle. */
export function parseChronicle(text: string): ParsedChronicle {
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
  const parsed = ChronicleFile.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    return {
      ok: false,
      message: `${issue?.message ?? "It does not have the form of a chronicle."}${where}`,
    };
  }
  return { ok: true, chronicle: parsed.data };
}

/** A new chronicle: one lane, nothing placed. */
export function emptyChronicle(id: string, title: string, laneId: string): ChronicleFile {
  return {
    version: 1,
    id,
    title,
    main: false,
    clock: "ezob",
    origin: null,
    lanes: [{ id: laneId, name: "Main", color: "#9a3b1f", clock: "ezob" }],
    units: [],
    spans: [],
    relations: [],
    compare: { spans: [], cases: [] },
  };
}

export interface ChronicleMerge {
  chronicle: ChronicleFile;
  /** Ids of the items, or names of the properties, that both sides changed differently. */
  clashes: string[];
}

/**
 * Merges two versions of a chronicle that started from the same one. What only one side changed
 * is taken from that side; where both changed the same thing, `mine` is kept and it is named in
 * `clashes`. The result may hold a circle of relations or a relation to a span that is gone:
 * those are shown to the author, not treated as a broken file.
 */
export function mergeChronicles(
  base: ChronicleFile,
  mine: ChronicleFile,
  theirs: ChronicleFile,
): ChronicleMerge {
  const clashes: string[] = [];
  const pick = <K extends "title" | "main" | "clock" | "origin" | "compare">(
    key: K,
  ): ChronicleFile[K] => {
    const merged = mergeValue(base[key], mine[key], theirs[key]);
    if (merged.clash) clashes.push(key);
    return merged.value;
  };
  const lanes = mergeItemLists(base.lanes, mine.lanes, theirs.lanes);
  const units = mergeItemLists(base.units, mine.units, theirs.units);
  const spans = mergeItemLists(base.spans, mine.spans, theirs.spans);
  const relations = mergeItemLists(base.relations, mine.relations, theirs.relations);
  clashes.push(...lanes.clashes, ...units.clashes, ...spans.clashes, ...relations.clashes);

  // A chronicle always has a lane, and no span may be left in one that is gone.
  const unordered = lanes.items.length > 0 ? lanes.items : mine.lanes;
  // The list merge keeps their order. When only this side reordered the lanes, its order wins.
  const order = (c: ChronicleFile) =>
    c.lanes.map((l) => l.id).filter((id) => base.lanes.some((l) => l.id === id));
  const same = (x: string[], y: string[]) => x.join("\n") === y.join("\n");
  const baseOrder = base.lanes.map((l) => l.id);
  const mineMoved =
    !same(
      order(mine),
      baseOrder.filter((id) => mine.lanes.some((l) => l.id === id)),
    ) &&
    same(
      order(theirs),
      baseOrder.filter((id) => theirs.lanes.some((l) => l.id === id)),
    );
  const rank = new Map(mine.lanes.map((l, i) => [l.id, i]));
  const kept = mineMoved
    ? [...unordered].sort((x, y) => (rank.get(x.id) ?? Infinity) - (rank.get(y.id) ?? Infinity))
    : unordered;
  const laneIds = new Set(kept.map((l) => l.id));
  const fallback = kept[0]!.id;
  const chronicle: ChronicleFile = {
    ...theirs,
    ...mine,
    title: pick("title"),
    main: pick("main"),
    clock: pick("clock"),
    origin: pick("origin"),
    compare: pick("compare"),
    lanes: kept,
    units: units.items,
    spans: spans.items.map((s) => (laneIds.has(s.lane) ? s : { ...s, lane: fallback })),
    relations: relations.items,
  };
  return { chronicle, clashes };
}
