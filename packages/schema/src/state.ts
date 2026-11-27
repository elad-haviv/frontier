import { z } from "zod";
import { ModelPrice, qualifyModelId } from "./ai.js";
import { KeepGoingSettings } from "./keepGoingSettings.js";

/** Ids are 12 characters from lower-case letters and digits. Draft ids are made by the browser. */
export const Id = z.string().regex(/^[a-z0-9]{12}$/);

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Makes a new id. `random` returns 12 bytes; the caller supplies it so this package needs no platform API. */
export function makeId(random: (bytes: number) => Uint8Array): string {
  // 252 is the largest multiple of 36 below 256; bytes above it are redrawn so every character is equally likely.
  let out = "";
  while (out.length < 12) {
    for (const byte of random(12)) {
      if (byte < 252 && out.length < 12) out += ALPHABET[byte % 36];
    }
  }
  return out;
}

export const VaultPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), "A path inside the vault.");

export const DraftKind = z.enum(["edit", "create", "delete"]);
export type DraftKind = z.infer<typeof DraftKind>;

export const StoredLineEnding = z.enum(["lf", "crlf"]);

/**
 * Where a draft's content came from when the author did not type it: an agent's branch, or a field
 * proposed by Frontier's own AI. Drafts from one branch are published together or not at all, and
 * the commit names each origin in a trailer.
 */
export const Origin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch"), ref: z.string(), tip: z.string() }),
  z.object({ kind: z.literal("fields"), ref: z.string(), model: z.string() }),
  /** An addition drafted in a lore conversation: `ref` is the conversation and turn. */
  z.object({ kind: z.literal("lore"), ref: z.string(), model: z.string() }),
]);
export type Origin = z.infer<typeof Origin>;

/** `/data/state/drafts/<id>/record.json` */
export const DraftRecord = z.object({
  id: Id,
  revision: z.number().int().min(0),
  path: VaultPath,
  kind: DraftKind,
  /** The Git blob hash of the version the draft was based on. Empty for a new file. */
  baseBlob: z.string(),
  lineEnding: StoredLineEnding,
  binary: z.boolean(),
  updatedAt: z.string().datetime(),
  /** Empty for a draft the author typed. */
  origins: z.array(Origin).default([]),
  /** The `op` of the last save the server accepted, so a retry of it writes nothing. */
  lastOp: z.string().optional(),
  /**
   * The id of the person whose unsaved change this is (stage 31d). A record from before people
   * has none, and belongs to the project's first owner (see `state/drafts.ts`, "the move").
   */
  person: z.string().optional(),
  /** When the person's unsaved change to this file began; absent from a record made before 31d. */
  startedAt: z.string().datetime().optional(),
  /**
   * The id the person's device made for this draft, when it was another person's draft id already
   * and the draft got a new id of its own (stage 31d): the device goes on using its id, which names
   * this draft for that person.
   */
  clientId: Id.optional(),
});
export type DraftRecord = z.infer<typeof DraftRecord>;

/**
 * `/data/state/drafts/<id>/versions/<device>.json`: a save from a device that started from older
 * text, kept beside the draft instead of overwriting it. Its text is in `<device>.txt`.
 */
export const KeptCopy = z.object({
  /** The device's id, or `unknown` for a save without one. */
  device: z.string(),
  deviceName: z.string(),
  savedAt: z.string().datetime(),
  /**
   * `server` for the other side of an item clash in a map, a chronicle or a library item file
   * (stage 15c): the draft's text that a device's merged save replaced, kept in the slot
   * `versions/server`. Absent for a device's text.
   */
  source: z.literal("server").optional(),
  /** With `source`: the keys of the items that clashed, such as a feature's id or a folder's path. */
  clashes: z.array(z.string()).optional(),
});
export type KeptCopy = z.infer<typeof KeptCopy>;

/**
 * `/data/state/drafts/renamed.json` (stage 15c): the renames and moves that reached the library,
 * newest last, the last 500. A save from a device that still knows the old path is kept at the
 * new one.
 */
export const RenamedLog = z.array(
  z.object({ from: VaultPath, to: VaultPath, at: z.string().datetime() }),
);
export type RenamedLog = z.infer<typeof RenamedLog>;

/** `/data/state/drafts/renames/<id>.json` */
export const RenameIntent = z.object({
  id: Id,
  from: VaultPath,
  to: VaultPath,
  createdAt: z.string().datetime(),
  /** The person whose rename it is (stage 31d); absent from one made before, which is the first owner's. */
  person: z.string().optional(),
});
export type RenameIntent = z.infer<typeof RenameIntent>;

const ModelChoice = z
  .string()
  .nullable()
  .default(null)
  // Ids written before there was more than one provider are OpenRouter's.
  .transform((id) => (id === null || id.trim() === "" ? null : qualifyModelId(id)));

/** How many art styles one person's library holds. */
export const ART_STYLES_MAX = 24;

/**
 * One art style of a person's library (stage 34): a name, the words put before a picture's
 * description, and a sample picture. `sample` is the token of a picture kept on the server, or
 * `starter-<look>` for the drawing the web app ships with a starter style, or null.
 */
export const ArtStyle = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(600),
  sample: z
    .string()
    .regex(/^([a-z0-9]{12}|starter-[a-z]+)$/)
    .nullable()
    .default(null),
});
export type ArtStyle = z.infer<typeof ArtStyle>;

/** The style every library began as, before there were several. */
export const DEFAULT_ART_STYLE =
  "Pencil and ink sketch on aged paper: hand-drawn, fine linework, light sepia washes, like a page of an explorer's field notebook.";

/** The styles a library starts with. They are the person's own from then on: edited or deleted. */
export const STARTER_ART_STYLES: readonly ArtStyle[] = [
  {
    id: "field-notebook",
    name: "Field notebook",
    text: DEFAULT_ART_STYLE,
    sample: "starter-notebook",
  },
  {
    id: "watercolour-wash",
    name: "Watercolour wash",
    text: "Loose watercolour on cold-pressed paper: soft edges, colours bleeding into each other, bare paper left for the light.",
    sample: "starter-water",
  },
  {
    id: "woodcut-print",
    name: "Woodcut print",
    text: "Black-and-white woodcut print: bold carved lines, strong contrast, hatching for shadow, no grey tones.",
    sample: "starter-woodcut",
  },
  {
    id: "oil-on-canvas",
    name: "Oil on canvas",
    text: "Oil painting with visible brushwork: deep shadows, warm light at dusk, rich colour, like a nineteenth-century landscape.",
    sample: "starter-oil",
  },
  {
    id: "atlas-engraving",
    name: "Atlas engraving",
    text: "Fine copperplate engraving as in an old atlas: thin parallel lines, cross-hatching, one ink colour on cream paper.",
    sample: "starter-engrave",
  },
  {
    id: "gouache-poster",
    name: "Gouache poster",
    text: "Flat gouache shapes in a limited palette: clean silhouettes, no outlines, like a mid-century travel poster.",
    sample: "starter-gouache",
  },
];

/**
 * A person's library of art styles and the one used unless another is picked. Before the library
 * was first changed it is worked out: the starter styles, with the one style the person had
 * (when they had written their own) first and usual.
 */
export function artLibrary(ai: {
  artStyle: string;
  artStyles?: ArtStyle[] | null | undefined;
  usualArtStyle?: string | null | undefined;
}): { styles: ArtStyle[]; usual: string } {
  if (ai.artStyles && ai.artStyles.length > 0) {
    const usual = ai.artStyles.find((s) => s.id === ai.usualArtStyle) ?? ai.artStyles[0]!;
    return { styles: ai.artStyles, usual: usual.id };
  }
  const starters = STARTER_ART_STYLES.map((s) => ({ ...s }));
  const own = ai.artStyle.trim().slice(0, 600);
  const same = starters.find((s) => s.text === own);
  if (!own || same) return { styles: starters, usual: (same ?? starters[0]!).id };
  return {
    styles: [{ id: "my-style", name: "My style", text: own, sample: null }, ...starters],
    usual: "my-style",
  };
}

/** The settings with a library put in: the old single style stays the usual one's words. */
export function withArtLibrary<T extends { artStyle: string }>(
  ai: T,
  styles: ArtStyle[],
  usual: string,
): T & { artStyles: ArtStyle[]; usualArtStyle: string } {
  const chosen = styles.find((s) => s.id === usual) ?? styles[0]!;
  return { ...ai, artStyles: styles, usualArtStyle: chosen.id, artStyle: chosen.text };
}

export const AiSettings = z.object({
  /**
   * One provider-qualified model id per task ("anthropic:claude-…"). Null until the author picks
   * one; the task is off until then.
   */
  models: z
    .object({
      extraction: ModelChoice,
      conversation: ModelChoice,
      art: ModelChoice,
    })
    .default({}),
  /** Prices the author entered for models whose provider does not publish them, by model id. */
  modelPrices: z.record(z.string(), ModelPrice).default({}),
  /**
   * The words of the usual art style, put before every picture's description. Since stage 34 the
   * styles are `artStyles`; this stays what the usual one says, for the code and the devices that
   * read one style.
   */
  artStyle: z.string().default(DEFAULT_ART_STYLE),
  /** The person's art styles; null until the library is first changed (see `artLibrary`). */
  artStyles: z.array(ArtStyle).max(ART_STYLES_MAX).nullable().default(null),
  /** The id of the style used unless another is picked. */
  usualArtStyle: z.string().nullable().default(null),
  /** Propose fields for the notes of each Publish. */
  proposeOnPublish: z.boolean().default(false),
  /**
   * Set once at start when the settings file still held AI keys from before they moved to each
   * device (stage 31f): the keys were deleted, and the web app says so once.
   */
  keysRemoved: z
    .object({
      at: z.string(),
      providers: z.array(z.string()),
      /** Provider key variables still set in the server's environment, which are not read. */
      environment: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  /** Set once the owner was told about provider key variables in the environment. */
  envKeysNoticed: z.boolean().default(false),
});
export type AiSettings = z.infer<typeof AiSettings>;

/**
 * `/data/state/settings.json`. Every key but the password has a default, so a file written by an
 * earlier version reads without loss and a write never drops a key it does not know about.
 */
/** A passkey the author registered: the public half only. */
export const Passkey = z.object({
  /** The credential id, base64url. */
  id: z.string(),
  /** The public key, base64url. */
  publicKey: z.string(),
  counter: z.number().int().min(0),
  transports: z.array(z.string()).default([]),
  name: z.string(),
  addedAt: z.string().datetime(),
});
export type Passkey = z.infer<typeof Passkey>;

export const Settings = z.object({
  /**
   * The password, passkeys and switch below belong to the one account that existed before stage
   * 31a. At the first start after it they are copied into the people store (`people.json`) and
   * are no longer read; the file keeps them as they were.
   */
  passwordHash: z.string(),
  ai: AiSettings.default({}),
  passkeys: z.array(Passkey).default([]),
  /** When true the password no longer logs in; only a passkey does. */
  passwordOff: z.boolean().default(false),
  /**
   * Set once the people store (`people.json`) has been made. From then on the fields above are
   * never read again, so a deleted people file cannot bring an old password back.
   */
  migratedToPeople: z.boolean().default(false),
  /** Stage 25: which needs-love rules are on. */
  keepGoing: KeepGoingSettings.default({}),
});
export type Settings = z.infer<typeof Settings>;
/**
 * What belongs to one person (stage 31b review): the models they chose, the prices they entered,
 * the look of their concept art, whether Publish proposes fields, and their Keep going rules.
 * Kept in `/data/state/person-settings.json` by person id. A person with no entry has the
 * defaults, but for the admin, whose entry is what `settings.json` held before there were people.
 */
export const PersonSettings = z.object({
  ai: AiSettings.pick({
    models: true,
    modelPrices: true,
    artStyle: true,
    artStyles: true,
    usualArtStyle: true,
    proposeOnPublish: true,
  }).default({}),
  keepGoing: KeepGoingSettings.default({}),
});
export type PersonSettings = z.infer<typeof PersonSettings>;

/** `/data/state/person-settings.json` */
export const PersonSettingsFile = z.object({
  people: z.record(z.string(), PersonSettings).default({}),
});
export type PersonSettingsFile = z.infer<typeof PersonSettingsFile>;

/** What a caller may pass when writing: the password, and any other part it wants to set. */
export type SettingsInput = z.input<typeof Settings>;

/** `/data/state/backup.json` */
export const BackupState = z.object({
  lastSuccessAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type BackupState = z.infer<typeof BackupState>;

/** One change Frontier's AI proposes for an entry. The author decides each one. */
export const ProposalOperation = z.discriminatedUnion("op", [
  z.object({
    id: z.string(),
    op: z.literal("add_time"),
    what: z.string(),
    when: z.string(),
    /** The sentence of the entry the date was taken from, word for word. */
    quote: z.string(),
    /** SHA-256 of the quote with white space collapsed. */
    quoteHash: z.string(),
    model: z.string(),
  }),
  z.object({ id: z.string(), op: z.literal("set_type"), type: z.string(), model: z.string() }),
  /**
   * A relation the entry's text states (stage 33), written on this entry in its own direction:
   * "parent: Corin Vane" on Wren. `words` are the exact words of the quote that state it, holding
   * both the relation word and the name.
   */
  z.object({
    id: z.string(),
    op: z.literal("add_relation"),
    what: z.string(),
    /** The name as the text gives it. */
    who: z.string(),
    /** The entry it was matched to, and how: by title, by another name, or not at all. */
    whoPath: VaultPath.nullable(),
    match: z.enum(["title", "alias", "none"]),
    /** With no match: the closest entry, offered as "Is this …?". */
    maybe: VaultPath.nullable(),
    with: z.string().nullable(),
    withPath: VaultPath.nullable(),
    how: z.string().nullable(),
    when: z.string().nullable(),
    quote: z.string(),
    words: z.string(),
    quoteHash: z.string(),
    /** False when the text only lets it be worked out. */
    stated: z.boolean(),
    /** The same relation stated in other entries' text, read later. */
    also: z.array(z.object({ path: VaultPath, quote: z.string(), words: z.string() })).optional(),
    model: z.string(),
  }),
]);
export type ProposalOperation = z.infer<typeof ProposalOperation>;

/** `/data/state/proposals/<id>.json`: the undecided operations for one entry. */
export const Proposal = z.object({
  id: Id,
  source: z.literal("fields"),
  path: VaultPath,
  createdAt: z.string().datetime(),
  operations: z.array(ProposalOperation),
});
export type Proposal = z.infer<typeof Proposal>;

/** `/data/state/proposals/rejected.json`: what the author turned down, so it is not proposed again. */
export const RejectedOperation = z.union([
  z.object({ path: VaultPath, op: z.literal("add_time"), what: z.string(), quoteHash: z.string() }),
  z.object({ path: VaultPath, op: z.literal("set_type"), type: z.string() }),
  z.object({
    path: VaultPath,
    op: z.literal("add_relation"),
    what: z.string(),
    who: z.string(),
    quoteHash: z.string(),
  }),
]);
export type RejectedOperation = z.infer<typeof RejectedOperation>;
