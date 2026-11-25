/**
 * The map styles file, `.frontier/map-styles.json`: the looks of paths and zones, kept once for
 * the whole library (a river, a road, a border; a realm, a forest). A path or zone names at most
 * one by its id; its colour, width, dash and fill then come from the style, else from its layer
 * and the plain look. A library item file like the folder file, merged style by style by id.
 */
import { z } from "zod";
import {
  type LibraryFileKind,
  mergeLibraryFile,
  type ParsedLibraryFile,
  parseLibraryFile,
  serialiseLibraryFile,
} from "./libraryFiles.js";

export const MAP_STYLES_FILE = ".frontier/map-styles.json";

/** The dash patterns, in units of the line's width, so a wide line keeps the same rhythm. */
export const DASHES = {
  solid: [],
  dashed: [4, 3],
  long: [7, 3],
  "dash-dot": [5, 2, 1, 2],
} as const satisfies Record<string, readonly number[]>;
export type Dash = keyof typeof DASHES;
export const DASH_NAMES = Object.keys(DASHES) as Dash[];

/** The id of a style: eight letters and digits, as map items have. */
export const StyleId = z.string().regex(/^[a-z0-9]{8}$/, "A style id is eight letters and digits.");

/**
 * What a style's features are to the tools that read the map as terrain (Find paths): a zone of
 * water, forest, marsh or mountains; a path that is a river (in a traveller's way) or a road
 * (quicker). `nothing` says so outright, where a usual style would otherwise count.
 */
export const COUNTS_AS = ["water", "forest", "marsh", "mountains", "river", "road"] as const;
export type CountsAs = (typeof COUNTS_AS)[number];
/** The kinds of ground a zone can count as, and the lines a path can. */
export const COUNTS_FOR: Record<"path" | "zone", readonly CountsAs[]> = {
  path: ["river", "road"],
  zone: ["water", "forest", "marsh", "mountains"],
};

export const MapStyle = z
  .object({
    id: StyleId,
    name: z.string().trim().min(1).max(60),
    for: z.enum(["path", "zone"]),
    /** Null: the colour of the feature's layer. */
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/, "A colour is # and six digits.")
      .nullable(),
    /** In pixels. */
    width: z.number().min(0.5).max(12).multipleOf(0.5),
    dash: z.enum(DASH_NAMES as [Dash, ...Dash[]]),
    /** How strongly a zone is filled with its colour; zones only. */
    fill: z.number().min(0).max(0.8).optional(),
    /** What its features count as to Find paths; left out: as the usual style of its id, else nothing. */
    counts: z.enum([...COUNTS_AS, "nothing"]).optional(),
  })
  .passthrough()
  .refine((s) => s.for === "zone" || s.fill === undefined, "Only a zone style has a fill")
  .refine(
    (s) =>
      s.counts === undefined ||
      s.counts === "nothing" ||
      COUNTS_FOR[s.for].includes(s.counts as CountsAs),
    "A path counts as a river or a road; a zone as water, forest, marsh or mountains",
  );
export type MapStyle = z.infer<typeof MapStyle>;

/** At most this many styles, so a broken file cannot grow without end. */
export const MAX_MAP_STYLES = 200;

export const MapStylesFile = z
  .object({ version: z.literal(1), styles: z.array(MapStyle).max(MAX_MAP_STYLES) })
  .passthrough()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const style of file.styles) {
      if (seen.has(style.id)) {
        ctx.addIssue({ code: "custom", message: `Two styles share the id "${style.id}".` });
        return;
      }
      seen.add(style.id);
    }
  });
export type MapStylesFile = z.infer<typeof MapStylesFile>;

/** The map styles file's entry in the table of library files. */
export const MAP_STYLES: LibraryFileKind<MapStylesFile> = {
  name: "map-styles",
  path: MAP_STYLES_FILE,
  label: "Map styles",
  noun: "styles",
  schema: MapStylesFile,
  list: "styles",
  topKeys: ["version", "styles"],
  itemKeys: ["id", "name", "for", "color", "width", "dash", "fill", "counts"],
  key: (item) => (item as MapStyle).id,
  conflict: "map_styles_changed_on_both",
  empty: () => ({ version: 1, styles: [] }),
};

/** The look a path or zone has without a style. */
export const PLAIN_LOOK = {
  path: { width: 2.5, dash: "solid", fill: undefined },
  zone: { width: 1.5, dash: "solid", fill: 0.2 },
} as const;

/** "Add the usual styles": a start the author can then change. */
export const STARTER_STYLES: MapStyle[] = [
  {
    id: "strriver",
    name: "River",
    for: "path",
    color: "#2f6f9f",
    width: 3,
    dash: "solid",
    counts: "river",
  },
  {
    id: "strroad1",
    name: "Road",
    for: "path",
    color: "#7a5230",
    width: 2,
    dash: "long",
    counts: "road",
  },
  { id: "strborde", name: "Border", for: "path", color: null, width: 2, dash: "dash-dot" },
  { id: "strrealm", name: "Realm", for: "zone", color: null, width: 1.5, dash: "solid", fill: 0.2 },
  {
    id: "strfores",
    name: "Forest",
    for: "zone",
    color: "#3f6b2a",
    width: 1,
    dash: "solid",
    fill: 0.3,
    counts: "forest",
  },
  {
    id: "strwater",
    name: "Water",
    for: "zone",
    color: "#2f6f9f",
    width: 1,
    dash: "solid",
    fill: 0.35,
    counts: "water",
  },
  {
    id: "strmarsh",
    name: "Marsh",
    for: "zone",
    color: "#5f7a4a",
    width: 1,
    dash: "dashed",
    fill: 0.25,
    counts: "marsh",
  },
  {
    id: "strmount",
    name: "Mountains",
    for: "zone",
    color: "#4a5560",
    width: 1,
    dash: "solid",
    fill: 0.25,
    counts: "mountains",
  },
];

/**
 * What a style's features count as, or null for nothing. A usual style added before the field
 * existed (it is known by its id) counts as it does now, until the author says otherwise.
 */
export function countsAs(style: MapStyle | null | undefined): CountsAs | null {
  if (!style) return null;
  if (style.counts === "nothing") return null;
  const own = style.counts ?? STARTER_STYLES.find((s) => s.id === style.id)?.counts;
  return own && own !== "nothing" && COUNTS_FOR[style.for].includes(own) ? own : null;
}

/** Reads the map styles file's text. */
export const parseMapStyles = (text: string): ParsedLibraryFile<MapStylesFile> =>
  parseLibraryFile(MAP_STYLES, text);

/** The map styles file's text: one line per style. */
export const serialiseMapStyles = (file: MapStylesFile): string =>
  serialiseLibraryFile(MAP_STYLES, file);

/** Merges two versions of the map styles file style by style, by id. */
export const mergeMapStyles = (
  base: MapStylesFile,
  mine: MapStylesFile,
  theirs: MapStylesFile,
): { file: MapStylesFile; clashes: string[] } => mergeLibraryFile(MAP_STYLES, base, mine, theirs);

/**
 * Whether `name` would be a second style of that name for paths or for zones; `except` is the
 * style being renamed. Names are compared as the author reads them, letter case aside.
 */
export function styleNameTaken(
  styles: MapStyle[],
  name: string,
  kind: MapStyle["for"],
  except?: string,
): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  return styles.some(
    (s) => s.for === kind && s.id !== except && s.name.trim().toLocaleLowerCase() === wanted,
  );
}
