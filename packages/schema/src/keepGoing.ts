/**
 * Stage 25, keep going: the work queue on Home, "From here" at the foot of an entry, Link it,
 * random entry, pins, the AI's "What's missing here?" and the question of the day, and the
 * next steps after Publish. Every shape here is an API answer or request; see
 * docs/designs/stage-25-keep-going.md section 6.
 */
import { z } from "zod";
import {
  type LibraryFileKind,
  mergeLibraryFile,
  type ParsedLibraryFile,
  parseLibraryFile,
  serialiseLibraryFile,
} from "./libraryFiles.js";
import { NeedsLoveRule, NeedsLoveRules } from "./keepGoingSettings.js";
import { VaultPath } from "./state.js";

export * from "./keepGoingSettings.js";

// ---- Stubs ----------------------------------------------------------------------------------

/** An entry with fewer words of body text than this is a stub. */
export const STUB_WORDS = 80;
/** The "No picture" rule applies only to entries with at least this many words. */
export const PICTURE_WORDS = 150;
/** Whether an entry with this many words of body text is a stub. */
export const isStub = (words: number): boolean => words < STUB_WORDS;

// ---- The work queue -----------------------------------------------------------------------

/** A reason an entry is on the list, with the words shown on its row. */
export const NeedsLoveReason = z.object({ rule: NeedsLoveRule, text: z.string() });
export type NeedsLoveReason = z.infer<typeof NeedsLoveReason>;

/** An entry on a list of the queue. */
export const EntryRow = z.object({
  path: VaultPath,
  title: z.string(),
  /** The folder it is in; "" at the top of the library. */
  folder: z.string(),
  /** The entry's `type` field, or null when it has none. */
  type: z.string().nullable(),
  /** Words of body text. */
  words: z.number().int().min(0),
  /** How many entries link to it. */
  linkedFrom: z.number().int().min(0),
  /** How many entries it links to. */
  linksTo: z.number().int().min(0),
});
export type EntryRow = z.infer<typeof EntryRow>;

export const NeedsLoveRow = EntryRow.extend({ reasons: z.array(NeedsLoveReason).min(1) });
export type NeedsLoveRow = z.infer<typeof NeedsLoveRow>;

/** A name that is linked and has no entry. */
export const WantedRow = z.object({
  /** As the first link writes it. */
  name: z.string(),
  /** How many entries mention it. */
  mentions: z.number().int().min(1),
  /** The folder most of the mentioning entries are in; null when there is none to suggest. */
  folder: z.string().nullable(),
  /** Up to three of the entries that mention it. */
  examples: z.array(z.object({ path: VaultPath, title: z.string() })),
});
export type WantedRow = z.infer<typeof WantedRow>;

/** One top folder: how many entries it holds and how many of them are stubs. */
export const FolderStubs = z.object({
  folder: z.string(),
  entries: z.number().int().min(0),
  stubs: z.number().int().min(0),
});
export type FolderStubs = z.infer<typeof FolderStubs>;

const queueList = <T extends z.ZodTypeAny>(row: T) =>
  z.object({ total: z.number().int().min(0), rows: z.array(row) });

/** The most rows of each list `GET /api/keep-going/queue` sends. */
export const QUEUE_ROWS = 200;

/** `GET /api/keep-going/queue`. Built from the published index; drafts do not change it. */
export const QueueResponse = z.object({
  /** The rules in force, from Settings. */
  rules: NeedsLoveRules,
  needsLove: queueList(NeedsLoveRow),
  wanted: queueList(WantedRow),
  orphans: queueList(EntryRow),
  deadEnds: queueList(EntryRow),
  /** The top folders, in the tree's order. */
  folders: z.array(FolderStubs),
  /** How many entries the library has, not counting the README and the appendices. */
  entries: z.number().int().min(0),
});
export type QueueResponse = z.infer<typeof QueueResponse>;

// ---- This week and on this day -----------------------------------------------------------

export const WeekDay = z.object({
  /** The day, "YYYY-MM-DD", in the reader's time zone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Entries saved in a version that day. */
  entries: z.number().int().min(0),
  /** Words added that day. */
  words: z.number().int().min(0),
});
export type WeekDay = z.infer<typeof WeekDay>;

export const OnThisDayRow = z.object({
  /** How long ago: a month, six months or a year. */
  span: z.enum(["month", "sixMonths", "year"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** First written that day, or last changed that day. */
  kind: z.enum(["written", "changed"]),
  path: VaultPath,
  title: z.string(),
});
export type OnThisDayRow = z.infer<typeof OnThisDayRow>;

/** `GET /api/keep-going/week?tz=<minutes east of UTC>`, from the library's saved versions. */
export const WeekResponse = z.object({
  week: z.object({
    /** Entries saved in a version in the last 7 days. */
    entriesTouched: z.number().int().min(0),
    /** Words added across them. */
    wordsAdded: z.number().int().min(0),
    /** Entries written this week that other entries already linked to. */
    linksFilled: z.number().int().min(0),
    /** The last 7 days, oldest first; the last one is today. */
    days: z.array(WeekDay).length(7),
  }),
  onThisDay: z.array(OnThisDayRow),
});
export type WeekResponse = z.infer<typeof WeekResponse>;

// ---- From here ----------------------------------------------------------------------------

/** A mention of an entry's name in another entry that does not link to it. */
export const UnlinkedMention = z.object({
  /** The entry the mention is in. */
  path: VaultPath,
  title: z.string(),
  /** The sentence it is in, as written. */
  sentence: z.string(),
  /** Where the name is in `sentence`: [from, to) in characters. */
  at: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  /** The name that was found: the title or one of the aliases, as written there. */
  name: z.string(),
});
export type UnlinkedMention = z.infer<typeof UnlinkedMention>;

/** A linked entry that trips a needs-love rule. */
export const ThinNeighbour = z.object({
  path: VaultPath,
  title: z.string(),
  words: z.number().int().min(0),
  reasons: z.array(NeedsLoveReason).min(1),
  /** Whether this entry links to it, it links here, or both. */
  direction: z.enum(["links", "linkedFrom", "both"]),
});
export type ThinNeighbour = z.infer<typeof ThinNeighbour>;

export const RelatedEntry = z.object({
  path: VaultPath,
  title: z.string(),
  /** How many entries both are linked with. */
  shared: z.number().int().min(1),
});
export type RelatedEntry = z.infer<typeof RelatedEntry>;

export const EntryRef = z.object({ path: VaultPath, title: z.string() });
export type EntryRef = z.infer<typeof EntryRef>;

/** The most unlinked mentions `GET /api/keep-going/from-here` sends. */
export const MENTION_LIMIT = 20;

/** `GET /api/keep-going/from-here?path=`. */
export const FromHereResponse = z.object({
  path: VaultPath,
  /** This entry's links that have no entry, most mentioned first. */
  missing: z.array(WantedRow),
  /** Other entries that name this one and do not link to it; at most one mention each. */
  unlinked: z.array(UnlinkedMention),
  /** True when more than `MENTION_LIMIT` entries mention it. */
  unlinkedMore: z.boolean(),
  /** Entries linked either way that trip a needs-love rule, most linked first. */
  thin: z.array(ThinNeighbour),
  /** Entries that share the most links with this one, not linked to it directly. Up to 6. */
  related: z.array(RelatedEntry),
  /** The entries either side of this one in its folder, in the tree's order. */
  previous: EntryRef.nullable(),
  next: EntryRef.nullable(),
});
export type FromHereResponse = z.infer<typeof FromHereResponse>;

// ---- Link it ------------------------------------------------------------------------------

/** `POST /api/keep-going/link-it`: link the first unlinked mention in `path` to `target`. */
export const LinkItRequest = z.object({ path: VaultPath, target: VaultPath });
export type LinkItRequest = z.infer<typeof LinkItRequest>;

/**
 * What Undo needs; the page keeps it and sends it back as it is. It is only a token: the server
 * keeps what it stands for (the draft, its revision and its earlier text) for a while.
 */
export const LinkItUndo = z.object({
  token: z.string().min(16).max(128),
});
export type LinkItUndo = z.infer<typeof LinkItUndo>;

export const LinkItResponse = z.object({
  path: VaultPath,
  /** The sentence before and after the change. */
  before: z.string(),
  after: z.string(),
  undo: LinkItUndo,
});
export type LinkItResponse = z.infer<typeof LinkItResponse>;

/** `POST /api/keep-going/link-it/undo` takes what `LinkItResponse.undo` held. */
export const LinkItUndoRequest = LinkItUndo;
export type LinkItUndoRequest = LinkItUndo;

// ---- Random entry ------------------------------------------------------------------------

export const RANDOM_KINDS = ["any", "stub", "folder", "old"] as const;
export const RandomKind = z.enum(RANDOM_KINDS);
export type RandomKind = z.infer<typeof RandomKind>;

/** `GET /api/keep-going/random`. With `kind=folder`, `folder` is required. */
export const RandomQuery = z.object({
  kind: RandomKind.default("any"),
  folder: z.string().max(400).optional(),
  /** An entry not to pick again, such as the one open now. */
  not: VaultPath.optional(),
});
export type RandomQuery = z.input<typeof RandomQuery>;

/** `entry` is null when no entry fits. */
export const RandomResponse = z.object({
  entry: z
    .object({ path: VaultPath, title: z.string(), words: z.number().int().min(0) })
    .nullable(),
});
export type RandomResponse = z.infer<typeof RandomResponse>;

/** Untouched for this many months makes an entry "old" for the dice. */
export const OLD_MONTHS = 6;

// ---- Pins ---------------------------------------------------------------------------------

export const PINS_FILE = ".frontier/pins.json";
/** At most this many entries are pinned. */
export const MAX_PINS = 30;

export const PinPath = VaultPath.refine((p) => p.toLowerCase().endsWith(".md"), "An entry.");

export const PinLine = z.object({ path: PinPath }).passthrough();
export type PinLine = z.infer<typeof PinLine>;

/** The pins file: one line per pinned entry, in the order the author keeps them. */
export const PinsFile = z
  .object({ version: z.literal(1), pins: z.array(PinLine).max(MAX_PINS) })
  .passthrough()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const line of file.pins) {
      if (seen.has(line.path)) {
        ctx.addIssue({ code: "custom", message: `"${line.path}" is pinned twice.` });
        return;
      }
      seen.add(line.path);
    }
  });
export type PinsFile = z.infer<typeof PinsFile>;

/** Pinned entries after a rename of an entry or a folder. */
export function renameInPins(file: PinsFile, from: string, to: string): PinsFile {
  return {
    ...file,
    pins: file.pins.map((line) => {
      if (line.path === from) return { ...line, path: to };
      if (line.path.startsWith(from + "/"))
        return { ...line, path: to + line.path.slice(from.length) };
      return line;
    }),
  };
}

/** The pins file's entry in the table of library files. */
export const PINS: LibraryFileKind<PinsFile> = {
  name: "pins",
  path: PINS_FILE,
  label: "Pins",
  noun: "pins",
  schema: PinsFile,
  list: "pins",
  topKeys: ["version", "pins"],
  itemKeys: ["path"],
  key: (item) => (item as PinLine).path,
  conflict: "pins_changed_on_both",
  empty: () => ({ version: 1, pins: [] }),
  follow: (file, from, to) => renameInPins(file, from, to),
};

export const parsePins = (text: string): ParsedLibraryFile<PinsFile> =>
  parseLibraryFile(PINS, text);
export const serialisePins = (file: PinsFile): string => serialiseLibraryFile(PINS, file);
export const mergePins = (
  base: PinsFile,
  mine: PinsFile,
  theirs: PinsFile,
): { file: PinsFile; clashes: string[] } => mergeLibraryFile(PINS, base, mine, theirs);

/** `GET /api/pins`: the pinned entries that still exist, in order. */
export const PinsResponse = z.object({
  pins: z.array(z.object({ path: VaultPath, title: z.string(), words: z.number().int().min(0) })),
});
export type PinsResponse = z.infer<typeof PinsResponse>;

/** `POST /api/pins` and `DELETE /api/pins`. */
export const PinRequest = z.object({ path: PinPath });
export type PinRequest = z.infer<typeof PinRequest>;

/** `PUT /api/pins`: the new order. Paths not pinned are ignored; pins left out go to the end. */
export const PinOrderRequest = z.object({ paths: z.array(PinPath).max(MAX_PINS) });
export type PinOrderRequest = z.infer<typeof PinOrderRequest>;

// ---- AI: what's missing here -----------------------------------------------------------

export const WhatsMissingRequest = z.object({ path: VaultPath });
export type WhatsMissingRequest = z.infer<typeof WhatsMissingRequest>;

export const MissingProposal = z.object({
  /** The name of the entry to write; no entry has it. */
  name: z.string().min(1),
  /** One line: why the entry implies it. */
  reason: z.string(),
  /** A folder for it that exists in the library; null when none was suggested. */
  folder: z.string().nullable(),
});
export type MissingProposal = z.infer<typeof MissingProposal>;

/** `POST /api/keep-going/whats-missing`. Nothing is saved. */
export const WhatsMissingResponse = z.object({
  path: VaultPath,
  /** Up to five. */
  proposals: z.array(MissingProposal).max(5),
  /** Up to two open questions the entry raises. */
  questions: z.array(z.string()).max(2),
  model: z.string(),
});
export type WhatsMissingResponse = z.infer<typeof WhatsMissingResponse>;

// ---- AI: the question of the day -----------------------------------------------------------

/** `/data/state/question.json` and the answers about it. */
export const DayQuestion = z.object({
  /** The day it was made, "YYYY-MM-DD", in the reader's time zone. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The thin entry it was drawn from; "Answer it" opens the editor there. */
  path: VaultPath,
  title: z.string(),
  question: z.string().min(1),
  model: z.string(),
  madeAt: z.string().datetime(),
});
export type DayQuestion = z.infer<typeof DayQuestion>;

/** `GET /api/keep-going/question?tz=`: today's question if there is one; never makes one. */
export const QuestionResponse = z.object({ question: DayQuestion.nullable() });
export type QuestionResponse = z.infer<typeof QuestionResponse>;

/** `POST /api/keep-going/question`. With `another`, a new question replaces today's. */
export const MakeQuestionRequest = z.object({
  another: z.boolean().optional(),
  /** Minutes east of UTC, to decide what day it is. */
  tz: z.number().int().min(-840).max(840).optional(),
});
export type MakeQuestionRequest = z.infer<typeof MakeQuestionRequest>;

// ---- After Publish -------------------------------------------------------------------------

export const AfterPublishRequest = z.object({ paths: z.array(VaultPath).min(1).max(500) });
export type AfterPublishRequest = z.infer<typeof AfterPublishRequest>;

export const AfterPublishStep = z.discriminatedUnion("kind", [
  /** A stub that a published entry links to. */
  z.object({
    kind: z.literal("stub"),
    path: VaultPath,
    title: z.string(),
    words: z.number().int().min(0),
    from: EntryRef,
  }),
  /** A link in a published entry that has no entry yet. */
  z.object({
    kind: z.literal("missing"),
    name: z.string(),
    mentions: z.number().int().min(1),
    folder: z.string().nullable(),
    from: EntryRef,
  }),
  /** An entry untouched for six months. */
  z.object({ kind: z.literal("old"), path: VaultPath, title: z.string() }),
]);
export type AfterPublishStep = z.infer<typeof AfterPublishStep>;

/** `POST /api/keep-going/after-publish`: up to three, in the order stub, missing, old. */
export const AfterPublishResponse = z.object({ steps: z.array(AfterPublishStep).max(3) });
export type AfterPublishResponse = z.infer<typeof AfterPublishResponse>;
