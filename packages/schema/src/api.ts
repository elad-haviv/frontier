import { z } from "zod";
import { DraftKind, Id, Origin, ProposalOperation, VaultPath } from "./state.js";
import { ModelPrice } from "./ai.js";
import { EmailInfo } from "./email.js";
import { AccountEmail } from "./people.js";
import { KeepGoingSettings } from "./keepGoingSettings.js";

const Ok = z.object({ ok: z.literal(true) });

// ---- Session -------------------------------------------------------------------------------

/** The email may be empty only for the one account that has none yet (stage 31a). */
export const LoginRequest = z.object({
  email: z.string().trim().max(200).default(""),
  password: z.string().min(1),
});
export const LoginResponse = Ok;
export const LogoutResponse = Ok;
export const SessionResponse = z.object({
  loggedIn: z.boolean(),
  /** Who is logged in; null when nobody is. */
  person: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      /** Stage 32: what the banner needs. */
      emailInfo: EmailInfo.optional(),
    })
    .nullable()
    .default(null),
  /** True while the only account has no email, so the login page can say to leave it empty. */
  emailless: z.boolean().default(false),
  /** Whether a passkey exists, so the login page can offer it. */
  passkeys: z.boolean(),
  /** False when the password is switched off. */
  password: z.boolean(),
  /** Whether this server offers "Continue with Google" (stage 31c); the app hides the button when false. */
  google: z.boolean().default(false),
  /** Stage 32: whether this server sends mail. False hides every email feature (Forgot password, the banner, the invite field). */
  mail: z.boolean().default(false),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

// ---- Tree and entries ----------------------------------------------------------------------

/** `quarantined` is used from stage 3. */
export const EntryState = z.enum(["published", "unpublished", "conflict", "quarantined"]);
export type EntryState = z.infer<typeof EntryState>;

/** Who made a saved version, or whose unsaved change this is: the person's id, and the name to show. */
export const AuthorRef = z.object({
  /** The person's id; null for a version Git alone says something about (an older one, a bot, an outside push). */
  id: z.string().nullable(),
  name: z.string(),
});
export type AuthorRef = z.infer<typeof AuthorRef>;

/** Someone else in the project who has unsaved changes to an entry (stage 31d). Never their text. */
export const OtherUnsaved = z.object({
  id: z.string(),
  name: z.string(),
  /** When their unsaved changes to the entry began. */
  since: z.string().datetime(),
});
export type OtherUnsaved = z.infer<typeof OtherUnsaved>;

export const TreeNote = z.object({
  path: VaultPath,
  title: z.string(),
  state: EntryState,
  /** Someone else in the project has unsaved changes to this entry: the tree shows a dot (stage 31d). Writers and owners only. */
  othersUnsaved: z.boolean().optional(),
  /** Where the entry still is while a rename moves it here: its link opens this path. */
  moved: VaultPath.optional(),
  /** Words of body text, for the stub mark; sent for published entries. */
  words: z.number().int().min(0).optional(),
});

export interface TreeFolder {
  path: string;
  folders: TreeFolder[];
  notes: z.infer<typeof TreeNote>[];
  /** From the folder file: a lucide icon name and one of the named colours. */
  icon?: string | undefined;
  color?: string | undefined;
  /** Its place among its siblings; folders without one follow, by name. */
  order?: string | undefined;
  /** The type its entries are given, from the folder file or the schema. */
  type?: string | undefined;
  /** A line of the folder file with no file under it. */
  empty?: boolean | undefined;
  /** Where it is in the library while a rename intent moves it here, until a version is saved. */
  moved?: string | undefined;
  /** The id of the rename intent that moves it, for Undo. */
  renameId?: string | undefined;
  /** Its line in the folder file differs from the library's, or it is moved. */
  unpublished?: boolean | undefined;
}
export const TreeFolder: z.ZodType<TreeFolder> = z.lazy(() =>
  z.object({
    path: z.string(),
    folders: z.array(TreeFolder),
    notes: z.array(TreeNote),
    icon: z.string().optional(),
    color: z.string().optional(),
    order: z.string().optional(),
    type: z.string().optional(),
    empty: z.boolean().optional(),
    moved: z.string().optional(),
    renameId: z.string().optional(),
    unpublished: z.boolean().optional(),
  }),
);

/** `GET /api/tree`. The root is a folder with an empty path. */
export const TreeResponse = z.object({ folders: z.array(TreeFolder), notes: z.array(TreeNote) });
export type TreeResponse = z.infer<typeof TreeResponse>;

export const LinkKind = z.enum(["resolved", "unresolved", "ambiguous", "outside", "image"]);

export const EntryLink = z.object({
  /** The link as written. */
  raw: z.string(),
  /** Character positions of the whole link in the text sent with the entry. */
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  kind: LinkKind,
  /** The vault path the link points at, for `resolved` and `image`. */
  target: VaultPath.optional(),
  /** The paths to choose from, for `ambiguous`. */
  candidates: z.array(VaultPath).optional(),
});
export type EntryLink = z.infer<typeof EntryLink>;

export const Backlink = z.object({
  path: VaultPath,
  title: z.string(),
  line: z.number().int().min(1),
});
export const EntryHeading = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
  line: z.number().int().min(1),
});

/** `GET /api/entries?path=` */
/** The structured fields of an entry, read from its frontmatter. */
export const EntryFields = z.object({
  /** The type in use: the `type` field, or else the one its folder gives. */
  type: z.string().nullable(),
  typeFrom: z.enum(["field", "folder", "none"]),
  /** False when the type is not in the schema. */
  typeKnown: z.boolean(),
  time: z.array(
    z.object({
      what: z.string(),
      when: z.string(),
      /** False when `what` is not in the schema. */
      known: z.boolean(),
      /** The links inside `when`, in the order they are written. */
      links: z.array(z.object({ raw: z.string(), kind: LinkKind, target: z.string().optional() })),
    }),
  ),
  /** Values that are present and cannot be read. */
  problems: z.array(z.string()),
  /** What Frontier's AI proposes for the entry and the author has not decided yet. */
  proposed: z.array(ProposalOperation),
});
export type EntryFields = z.infer<typeof EntryFields>;

export const EntryResponse = z.object({
  path: VaultPath,
  /** The text with line endings normalised: the draft's text if there is one, else the published text. */
  text: z.string(),
  lineEnding: z.enum(["lf", "crlf", "mixed"]),
  /** True for append-only files and for files with mixed line endings. */
  readOnly: z.boolean(),
  state: EntryState,
  links: z.array(EntryLink),
  backlinks: z.array(Backlink),
  headings: z.array(EntryHeading),
  draft: z.object({ id: Id, revision: z.number().int().min(0), kind: DraftKind }).nullable(),
  /** The entry's id from its frontmatter, when it has one. */
  id: z.string().nullable(),
  fields: EntryFields,
  /** The maps, drafts included, that have a feature for this entry. */
  maps: z.array(z.object({ id: z.string(), title: z.string(), feature: z.string() })),
  /** The chronicles, drafts included, that have a span for this entry. */
  chronicles: z.array(z.object({ id: z.string(), title: z.string(), span: z.string() })),
  /** Present while the note waits in quarantine for the author's decision. */
  quarantine: z.object({ commit: z.string(), pushedBy: z.string(), at: z.string() }).optional(),
  /** The Git blob hash of the file in the library, or "" when it is not there. A save sends it back. */
  blob: z.string(),
  /**
   * The rename waiting to be saved that moves this entry, and where it goes. An entry has at most
   * one: a second rename or move replaces it.
   */
  rename: z.object({ id: Id, to: VaultPath }).nullable(),
  /**
   * The other people in the project who have unsaved changes to this entry (stage 31d): who and
   * since when, never what. Writers and owners get the list; a reader always gets an empty one.
   */
  othersUnsaved: z.array(OtherUnsaved).optional(),
  /** Who made the entry's last saved version, and when; absent for an entry with none. */
  lastVersion: z
    .object({ commit: z.string(), at: z.string(), by: AuthorRef })
    .nullable()
    .optional(),
});
export type EntryResponse = z.infer<typeof EntryResponse>;

// ---- Drafts --------------------------------------------------------------------------------

/** `PUT /api/drafts`. The browser makes the id. `revision` is the one the browser last saw; 0 for a new draft. */
export const SaveDraftRequest = z.object({
  id: Id,
  path: VaultPath,
  kind: DraftKind,
  /** Empty for `delete`. */
  text: z.string(),
  revision: z.number().int().min(0),
  /**
   * The blob of the library file this device started from ("" for a new file). Without it, as
   * from an older build, the server behaves as it did before saves said what they started from.
   */
  baseBlob: z.string().optional(),
  /** Made on the device for this send. A retry sends the same one, and the server writes nothing. */
  op: Id.optional(),
});
export type SaveDraftRequest = z.infer<typeof SaveDraftRequest>;

export const SaveDraftResponse = z.object({ id: Id, revision: z.number().int().min(1) });
export type SaveDraftResponse = z.infer<typeof SaveDraftResponse>;

/** One device's text kept beside a draft, as the compare screen shows it. */
export const KeptCopyText = z.object({
  device: z.string(),
  /** Made from the device's browser, such as "Safari on iPhone"; empty when not known. */
  deviceName: z.string(),
  savedAt: z.string().datetime(),
  text: z.string(),
  /** `server` for the other side of an item clash (stage 15c), with the keys of its items. */
  source: z.literal("server").optional(),
  clashes: z.array(z.string()).optional(),
});
export type KeptCopyText = z.infer<typeof KeptCopyText>;

/** `GET /api/drafts/:id/versions`: the draft and every kept copy, oldest first. */
export const DraftVersionsResponse = z.object({
  /** The draft's path, which says how its texts are compared (stage 15c). */
  path: VaultPath.optional(),
  current: z.object({ text: z.string(), revision: z.number().int().min(0) }),
  others: z.array(KeptCopyText),
});
export type DraftVersionsResponse = z.infer<typeof DraftVersionsResponse>;

/** `POST /api/drafts/:id/merge-versions` and `POST /api/drafts/:id/resolve` */
export const DraftTextRequest = z.object({ text: z.string() });

/**
 * `POST /api/drafts/:id/resolve` (stage 31d): the person's text, and `theirsBlob`, the blob of the
 * saved version the compare screen showed as "theirs" (from the plan's conflict or merge, or the
 * compare answer; `null` when it showed no file, as for an entry that was deleted). The text is
 * rebuilt on exactly that version, and refused (`saved_by_other`) when the saved version is another
 * one by now, so a version saved while the person was comparing is never overwritten unseen. Left
 * out, as by the web app before 31d: it is accepted only when the saved version is the one the
 * server last compared for this change.
 */
export const DraftResolveRequest = z.object({
  text: z.string(),
  theirsBlob: z.string().nullable().optional(),
  /**
   * The revision of the unsaved change the compare screen showed as "mine" (from the plan or the
   * compare answer). Refused with `stale_revision`, text untouched, when the change has been
   * written to since (another tab or device). Left out, the rule is as before.
   */
  revision: z.number().int().optional(),
});

export const DeleteResponse = Ok;

// ---- Unpublished and publish ---------------------------------------------------------------

export const RenameSummary = z.object({
  id: Id,
  from: VaultPath,
  to: VaultPath,
  /** Notes whose links will be rewritten. */
  affected: z.array(VaultPath),
});
export type RenameSummary = z.infer<typeof RenameSummary>;

/** A decision about a quarantined note that waits to be published. */
export const ReviewDecision = z.object({
  id: Id,
  path: VaultPath,
  decision: z.enum(["accepted", "reverted"]),
  draftId: Id.optional(),
});
export type ReviewDecision = z.infer<typeof ReviewDecision>;

/** `GET /api/unpublished`. The browser shows the differences. */
export const UnpublishedResponse = z.object({
  drafts: z.array(
    z.object({
      id: Id,
      path: VaultPath,
      kind: DraftKind,
      binary: z.boolean(),
      text: z.string(),
      /** The published text; null for a new file. */
      mainText: z.string().nullable(),
      /** Where the content came from, when the author did not type it. */
      origins: z.array(Origin),
    }),
  ),
  renames: z.array(RenameSummary),
  /** Decisions about quarantined notes. They go out with the next publish. */
  decisions: z.array(ReviewDecision),
});
export type UnpublishedResponse = z.infer<typeof UnpublishedResponse>;

/** `POST /api/publish/plan` */
export const PublishPlanRequest = z.object({
  draftIds: z.array(Id),
  renameIds: z.array(Id),
  decisionIds: z.array(Id).default([]),
});

export const PlannedMerge = z.object({
  id: z.string(),
  draftId: Id,
  path: VaultPath,
  mergedText: z.string(),
  mainText: z.string(),
  baseText: z.string(),
  /** Who saved `mainText`, and when (stage 31d). */
  theirsBy: AuthorRef.nullable().optional(),
  theirsAt: z.string().nullable().optional(),
  /** The blob `mainText` was read from: send it back when resolving (stage 31d). */
  theirsBlob: z.string().nullable().optional(),
  /** The revision of the unsaved change this was worked out for: send it back when resolving. */
  revision: z.number().int().optional(),
});

export const ConflictReason = z.enum([
  "overlap",
  "created_on_main",
  "deleted_on_main",
  "delete_of_changed_file",
  "binary_changed_on_both",
  /** A map changed here and in the vault in ways that cannot be merged item by item. */
  "map_changed_on_both",
  /** A chronicle changed here and in the library in ways that cannot be merged item by item. */
  "chronicle_changed_on_both",
  /** A rename cannot be carried out, for the reason given in `mine`. */
  "rename_blocked",
  /** The folder file changed here and in the library on the same folders. */
  "folders_changed_on_both",
  /** The map styles file changed here and in the library on the same styles. */
  "map_styles_changed_on_both",
  /** The biomes file changed here and in the library on the same biomes. */
  "biomes_changed_on_both",
  /** The pins file changed here and in the library on the same pins. */
  "pins_changed_on_both",
  /**
   * Someone else in the project saved a newer version of this entry than the one this change was
   * made from (stage 31d, decision C). Compare `mine`, `theirs` and `base`; `theirsBy` and
   * `theirsAt` say who and when.
   */
  "saved_by_other",
  /** The trees file changed here and in the library on the same trees. */
  "trees_changed_on_both",
]);

export const PlannedConflict = z.object({
  draftId: Id,
  path: VaultPath,
  reason: ConflictReason,
  /** Empty strings for images. */
  mine: z.string(),
  theirs: z.string().nullable(),
  base: z.string().nullable(),
  /**
   * Who saved the version `theirs` is, and when (stage 31d): the person (or the name Git has) behind
   * the last saved version of the file. Absent when it cannot be told.
   */
  theirsBy: AuthorRef.nullable().optional(),
  theirsAt: z.string().nullable().optional(),
  /**
   * The blob `theirs` was read from, `null` when there is no file (stage 31d). Resolving sends it
   * back, so the person's text is rebuilt on exactly the version they compared.
   */
  theirsBlob: z.string().nullable().optional(),
  /** The revision of the unsaved change this was worked out for: send it back when resolving. */
  revision: z.number().int().optional(),
  /**
   * With `saved_by_other`, when the two changes merge cleanly: the merged text, for the compare
   * screen to offer as a pre-filled "merged" choice (stage 31d). Absent when they do not merge.
   */
  mergedText: z.string().optional(),
});

export const PublishPlan = z.object({
  planId: Id,
  /** The commit on `main` the plan was computed against. */
  mainCommit: z.string(),
  ready: z.array(Id),
  merges: z.array(PlannedMerge),
  conflicts: z.array(PlannedConflict),
  renames: z.array(RenameSummary),
  /** Draft and rename ids that are published together or not at all. */
  groups: z.array(z.array(Id)),
  /** The review decisions this plan publishes. */
  decisions: z.array(ReviewDecision).default([]),
});
export type PublishPlan = z.infer<typeof PublishPlan>;

/** `POST /api/publish/confirm` */
export const PublishConfirmRequest = z.object({
  planId: Id,
  confirmedMergeIds: z.array(z.string()),
  message: z.string().trim().min(1).max(2000),
});
export const PublishConfirmResponse = z.object({
  commit: z.string(),
  /**
   * The notes whose own text was just published. The browser that published asks for field
   * proposals for them with its own AI key, when the settings ask for it (stage 31f).
   */
  published: z.array(VaultPath).default([]),
  /**
   * Entries of this save that were refused because someone else saved a newer version of them
   * between the plan and the confirm (stage 31d). They stay unsaved changes; the others went in.
   */
  conflicts: z.array(PlannedConflict).default([]),
});
export type PublishConfirmResponse = z.infer<typeof PublishConfirmResponse>;

/**
 * `GET /api/drafts/:id/compare` (stage 31d): what a compare screen needs for one unsaved change,
 * without making a plan. `outcome` is what saving it now would do: `ready`, a `merge` to confirm,
 * a `conflict`, or `none` (nothing differs from the saved version any more).
 */
export const DraftCompareResponse = z.object({
  draftId: Id,
  path: VaultPath,
  outcome: z.enum(["ready", "merge", "conflict", "none"]),
  conflict: PlannedConflict.optional(),
  merge: PlannedMerge.optional(),
  /**
   * The blob of the saved version at the path now, `null` when there is none (stage 31d): the same
   * as the conflict's or merge's `theirsBlob`, and given when `outcome` is `ready` or `none` too.
   */
  theirsBlob: z.string().nullable().optional(),
  /** The revision of the unsaved change the answer is for: send it back when resolving. */
  revision: z.number().int().optional(),
  /** The person's own text as it is now (empty for an image), whatever the outcome. */
  mine: z.string().optional(),
});
export type DraftCompareResponse = z.infer<typeof DraftCompareResponse>;

// ---- Who is reading (stage 31d) --------------------------------------------------------------

/**
 * `PUT /api/presence`: this device says which entry it has open (`path`), or that it has none
 * (`null`). `client` names the device or tab, so one person's two tabs are told apart; it is
 * optional (one anonymous client per person). Repeat every 25 seconds or so: it lapses after 60.
 */
export const PresenceRequest = z.object({
  path: VaultPath.refine((p) => p.length <= 1024, "A path of reasonable length.").nullable(),
  client: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export type PresenceRequest = z.infer<typeof PresenceRequest>;

/** One person reading one entry now, as the status stream tells writers and owners. */
export const Reading = z.object({
  id: z.string(),
  name: z.string(),
  path: VaultPath,
  since: z.string().datetime(),
});
export type Reading = z.infer<typeof Reading>;

// ---- Saved versions and who made them (stage 31d) --------------------------------------------

/** One saved version in `GET /api/history`. */
export const HistoryVersion = z.object({
  commit: z.string(),
  at: z.string(),
  message: z.string(),
  paths: z.array(z.string()),
  /** Who saved it. Never an email. */
  by: AuthorRef,
});
export type HistoryVersion = z.infer<typeof HistoryVersion>;
export const HistoryResponse = z.object({ versions: z.array(HistoryVersion) });
export type HistoryResponse = z.infer<typeof HistoryResponse>;

// ---- Renames -------------------------------------------------------------------------------

/** `POST /api/renames`. `from` is a note, a file or a folder. */
export const CreateRenameRequest = z.object({ from: VaultPath, to: VaultPath });
/**
 * `replaced` is the rename this one took the place of, so Undo can bring it back: an entry keeps
 * one rename, from where it is in the library to where it goes.
 */
export const CreateRenameResponse = z.object({
  id: Id,
  affected: z.array(VaultPath),
  replaced: z.object({ from: VaultPath, to: VaultPath }).nullable(),
});
export type CreateRenameResponse = z.infer<typeof CreateRenameResponse>;

// ---- Library item files and folders ------------------------------------------------------

/**
 * The keys of the items a device's merge found changed on both sides (stage 15c), sent with the
 * merged save of a map, a chronicle or a library item file. The server keeps the side the save
 * replaces as a kept copy of the draft, and answers `kept` with the draft's id. Older builds send
 * none, and nothing is kept.
 */
export const ClashKeys = z.array(z.string().min(1).max(200)).max(5000);

/** `GET /api/library-files/:name`: the file as the author sees it. */
export const LibraryFileResponse = z.object({
  file: z.unknown(),
  /** The draft's revision; 0 when there is no draft. */
  revision: z.number().int().min(0),
  /** The blob of the file in the library, or "" when it is not there. */
  blob: z.string(),
});
export type LibraryFileResponse = z.infer<typeof LibraryFileResponse>;

/** `PUT /api/library-files/:name`. The file is checked against its kind's schema. */
export const SaveLibraryFileRequest = z.object({
  file: z.unknown(),
  revision: z.number().int().min(0),
  baseBlob: z.string().optional(),
  op: Id.optional(),
  clashes: ClashKeys.optional(),
});
export const SaveLibraryFileResponse = z.object({
  file: z.unknown(),
  revision: z.number().int().min(0),
  /** The draft the other side of a clash was kept beside, when one was (stage 15c). */
  kept: Id.optional(),
});

/** `POST /api/library-files/:name/resolve` */
export const ResolveLibraryFileRequest = z.object({ keep: z.enum(["mine", "theirs"]) });

/** `POST /api/folders/delete`: a folder and everything under it, marked for deletion. */
export const DeleteFolderRequest = z.object({
  path: VaultPath,
  /** Only checks and counts, so the question can name the counts; nothing is marked. */
  dryRun: z.boolean().default(false),
});
export const DeleteFolderResponse = z.object({
  /** The entries marked for deletion. */
  entries: z.number().int().min(0),
  /** The folders under it, itself not counted. */
  folders: z.number().int().min(0),
});
/** Why a folder cannot be deleted; the error's code. */
export const DeleteFolderRefusal = z.enum([
  "has_drafts",
  "has_images",
  "append_only",
  "read_only_file",
]);

/** `POST /api/folders/apply-type`: writes the folder's type into its entries that have none. */
export const ApplyTypeRequest = z.object({ path: VaultPath });
export const ApplyTypeResponse = z.object({ made: z.number().int().min(0) });

// ---- Attention -----------------------------------------------------------------------------

/** `GET /api/attention` */
export const AttentionResponse = z.object({
  ambiguousLinks: z.array(
    z.object({ path: VaultPath, raw: z.string(), candidates: z.array(VaultPath) }),
  ),
  duplicateImages: z.array(z.array(VaultPath)),
  mixedEndings: z.array(VaultPath),
  brokenAppendixLinks: z.array(z.object({ path: VaultPath, raw: z.string() })),
  nearFolderNotes: z.array(VaultPath),
  unreadableFields: z.array(z.object({ path: VaultPath, problems: z.array(z.string()) })),
  duplicateIds: z.array(z.object({ id: z.string(), paths: z.array(VaultPath) })),
  /** Drafts with texts kept from other devices, waiting to be compared and merged. */
  versions: z.array(z.object({ draftId: Id, path: VaultPath, count: z.number().int().min(1) })),
});
export type AttentionResponse = z.infer<typeof AttentionResponse>;

// ---- Images --------------------------------------------------------------------------------

/** The last two are for maps: they bound the longer side, whichever it is. */
export const IMAGE_WIDTHS = [320, 640, 1280, 2560, 4096] as const;
export const MAP_IMAGE_SIZES: readonly number[] = [2560, 4096];

/** `GET /api/images?path=&w=&draft=` */
export const ImageQuery = z.object({
  path: VaultPath,
  w: z.coerce
    .number()
    .refine((n) => (IMAGE_WIDTHS as readonly number[]).includes(n))
    .optional(),
  draft: Id.optional(),
  /** With `branch`: a new image on that proposal branch, shown in the inbox. */
  branch: z.string().optional(),
});

/** `POST /api/images` (stage 2) */
export const UploadImageResponse = z.object({ path: VaultPath, embed: z.string() });

/** `POST /api/images/from-url` (stage 12): an image taken from a web address, kept as an upload. */
export const ImageFromUrlRequest = z.object({ url: z.string().max(2048) });
export type ImageFromUrlRequest = z.infer<typeof ImageFromUrlRequest>;

// ---- Search (stage 2) ----------------------------------------------------------------------

export const SearchQuery = z.object({
  q: z.string().min(1),
  appendices: z.enum(["0", "1"]).optional(),
});
export const SearchResponse = z.object({
  results: z.array(
    z.object({
      path: VaultPath,
      title: z.string(),
      snippet: z.string(),
      draftOnly: z.boolean(),
      /** Words of body text, for the stub mark; sent for published entries. */
      words: z.number().int().min(0).optional(),
    }),
  ),
});
export const SwitcherResponse = z.object({
  results: z.array(
    z.object({
      path: VaultPath,
      title: z.string(),
      alias: z.string().optional(),
      /** True when another note shares this name, so a link to it must be written with its path. */
      shared: z.boolean().optional(),
      /** Words of body text, for the stub mark; sent for published entries. */
      words: z.number().int().min(0).optional(),
    }),
  ),
});
export const PreviewResponse = z.object({ path: VaultPath, text: z.string() });

/** One file changed on an agent's proposal branch. */
export const BranchFile = z.object({
  path: VaultPath,
  kind: z.enum(["added", "changed", "removed"]),
  /** True for anything that is not a note. */
  binary: z.boolean(),
  /** The file's blob on the branch; empty for a removed file. A decision must carry it. */
  blob: z.string(),
  /** Why the file can only be rejected. */
  blocked: z.string().optional(),
  decision: z.enum(["accepted", "rejected"]).optional(),
});
export type BranchFile = z.infer<typeof BranchFile>;

export const InboxBranch = z.object({
  name: z.string(),
  tip: z.string(),
  /** First lines of the branch's commit messages, oldest first. */
  commits: z.array(z.string()),
  /**
   * `open`: files wait for a decision. `empty`: nothing differs from `main`. `no_fork`: the branch
   * shares no history with `main`. `too_many`: more files than Frontier lists. `decided`: every
   * file is decided and the branch could not be removed yet.
   */
  state: z.enum(["open", "empty", "no_fork", "too_many", "decided"]),
  files: z.array(BranchFile),
});
export type InboxBranch = z.infer<typeof InboxBranch>;

/** The operations Frontier's AI proposes for one entry, as the inbox shows them. */
export const InboxProposal = z.object({
  id: Id,
  path: VaultPath,
  operations: z.array(
    z.object({
      operation: ProposalOperation,
      /** False when the sentence it was taken from is no longer in the entry. */
      applies: z.boolean(),
    }),
  ),
});
export type InboxProposal = z.infer<typeof InboxProposal>;

/** A note that reached `main` without review, as the sync listed it. */
export const InboxQuarantined = z.object({
  path: VaultPath,
  /** The first commit of the unreviewed push that touched the note. */
  commit: z.string(),
  pushedBy: z.string(),
  at: z.string(),
  kind: z.enum(["added", "changed", "removed"]),
  /** The note before that commit and as that commit left it. */
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** Why the note can only be accepted. */
  revertBlocked: z.string().optional(),
  /** The author's decision, when it waits to be published. */
  pending: z.object({ id: Id, decision: z.enum(["accepted", "reverted"]) }).optional(),
});
export type InboxQuarantined = z.infer<typeof InboxQuarantined>;

/** `GET /api/inbox` */
export const InboxResponse = z.object({
  branches: z.array(InboxBranch),
  proposals: z.array(InboxProposal),
  quarantine: z.array(InboxQuarantined),
});

/** `POST /api/quarantine` */
export const QuarantineDecision = z.object({
  path: VaultPath,
  commit: z.string(),
  decision: z.enum(["accept", "revert"]),
});

export type InboxResponse = z.infer<typeof InboxResponse>;

/** `POST /api/inbox/branch-file` */
export const BranchFileDecision = z.object({
  branch: z.string(),
  path: VaultPath,
  blob: z.string(),
  decision: z.enum(["accept", "reject"]),
});

/** `POST /api/inbox/branch` */
export const BranchDecision = z.object({
  branch: z.string(),
  tip: z.string(),
  decision: z.enum(["reject", "remove"]),
});

/** `GET /api/schema`: the types and `what` names in use. */
export const SchemaResponse = z.object({
  /** The schema as YAML text. */
  text: z.string(),
  /** True when the vault has no schema file of its own. */
  builtIn: z.boolean(),
  /** Why the vault's own file is not used, when it exists and cannot be. */
  problem: z.string().nullable(),
  types: z.array(z.string()),
  what: z.array(z.string()),
});
export type SchemaResponse = z.infer<typeof SchemaResponse>;

/** `POST /api/proposals/:id/operations/:op` */
export const OperationDecision = z.object({
  decision: z.enum(["accept", "reject", "dismiss"]),
  /** With `accept`: the author's corrections. */
  what: z.string().min(1).optional(),
  when: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
});

/** `GET /api/me`: the logged-in person, and the ways their account signs in. No secret in it. */
export const MeResponse = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  admin: z.boolean(),
  /** The name or the email is still missing, so the app asks for them. */
  needsProfile: z.boolean(),
  passkeys: z.array(z.object({ id: z.string(), name: z.string(), addedAt: z.string() })),
  /** Whether the account has a password at all. */
  passwordSet: z.boolean(),
  passwordOff: z.boolean(),
  /** How this session logged in. Switching the password off needs a passkey session. */
  method: z.enum(["password", "passkey", "google"]),
  /** The ways this account signs in, for Settings → You → Signing in (stage 31c). */
  signingIn: z
    .object({
      password: z.object({ set: z.boolean(), off: z.boolean() }),
      passkeys: z.array(z.object({ id: z.string(), name: z.string(), addedAt: z.string() })),
      /** The linked Google account's email, or null when none is linked. */
      google: z.object({ email: z.string(), addedAt: z.string() }).nullable(),
      /** Whether this server offers Google sign-on at all, so Settings can offer to link it. */
      googleAvailable: z.boolean(),
    })
    .optional(),
  /**
   * An email to offer in Settings → Profile when the account has none: the commit author's, which
   * is usually the same person. Only a suggestion; nothing is saved until the person saves.
   */
  suggestedEmail: z.string().default(""),
  /** Stage 32: the state of the address, for the banner and Settings → You → Signing in. */
  emailInfo: EmailInfo.optional(),
  /** The address of the project the person used last, if they are still in it; null before they used one. */
  lastProject: z.string().nullable().optional(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** `PUT /api/me` */
export const ProfileRequest = z.object({
  name: z.string().trim().min(1, "Give a name.").max(80, "Use 80 characters or fewer."),
  email: AccountEmail,
});
export type ProfileRequest = z.infer<typeof ProfileRequest>;

/** `PUT /api/me/password`. `current` is needed when the account already has a password. */
export const PasswordRequest = z.object({
  current: z.string().optional(),
  password: z.string().min(12, "Use at least 12 characters.").max(500),
});
export type PasswordRequest = z.infer<typeof PasswordRequest>;

/** `GET /api/settings`. No secret is ever part of it. */
export const SettingsResponse = z.object({
  ai: z.object({
    /** Prices the author entered, by provider-qualified model id. */
    modelPrices: z.record(z.string(), ModelPrice),
    models: z.object({
      extraction: z.string().nullable(),
      conversation: z.string().nullable(),
      art: z.string().nullable(),
    }),
    artStyle: z.string(),
    proposeOnPublish: z.boolean(),
    spentUsd: z.number(),
  }),
  /**
   * Kept for devices still on the build before stage 31a, whose Settings page reads it and would
   * crash without it. The current app reads `GET /api/me` instead. Remove once none are left.
   */
  signIn: z.object({
    passkeys: z.array(z.object({ id: z.string(), name: z.string(), addedAt: z.string() })),
    passwordOff: z.boolean(),
    method: z.enum(["password", "passkey", "google"]),
  }),
  /** Stage 25: which needs-love rules are on. */
  keepGoing: KeepGoingSettings,
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

/** `PUT /api/settings/ai`. */
export const AiSettingsRequest = z.object({
  models: z
    .object({
      extraction: z.string().min(1).nullable().optional(),
      conversation: z.string().min(1).nullable().optional(),
      art: z.string().min(1).nullable().optional(),
    })
    .optional(),
  artStyle: z.string().trim().min(1).max(600).optional(),
  proposeOnPublish: z.boolean().optional(),
});

// ---- Pictures for entries (stage 29) ---------------------------------------------------------

/** The shape a picture is asked for in; a model that takes no size ignores it. */
export const PictureShape = z.enum(["square", "wide", "tall"]);
export type PictureShape = z.infer<typeof PictureShape>;

/** One picture made for an entry and not yet inserted. Kept on the server for seven days. */
export const PictureTry = z.object({
  id: z.string().regex(/^[a-z0-9]{12}$/),
  entry: z.string(),
  prompt: z.string(),
  style: z.string(),
  shape: PictureShape,
  /** The file extension the picture is kept with, from its bytes: png, jpg or webp. */
  ext: z.enum(["png", "jpg", "webp"]),
  at: z.string(),
});
export type PictureTry = z.infer<typeof PictureTry>;

/** `GET /api/pictures?entry=…`: whether pictures can be made, what they cost, and the tries. */
export const PicturesResponse = z.object({
  /** Null when a picture can be made; otherwise why not and where to fix it. */
  off: z.object({ message: z.string(), href: z.string().nullable() }).nullable(),
  /** The art style from the settings, added to every prompt unless changed for one picture. */
  style: z.string(),
  /** What one picture has cost lately with the chosen model, when known. */
  perPictureUsd: z.number().nullable(),
  tries: z.array(PictureTry),
});
export type PicturesResponse = z.infer<typeof PicturesResponse>;

/** `POST /api/pictures`: makes one picture for an entry. */
export const MakePictureRequest = z.object({
  entry: z.string().min(1).max(1000),
  prompt: z.string().trim().min(1, "Describe the picture first.").max(4000),
  style: z.string().max(2000).default(""),
  shape: PictureShape.default("square"),
});
export type MakePictureRequest = z.infer<typeof MakePictureRequest>;

/** `POST /api/pictures/:id/insert`: keeps a try as an unpublished image, named as asked. */
export const InsertPictureRequest = z.object({ name: z.string().max(120).default("") });
export type InsertPictureRequest = z.infer<typeof InsertPictureRequest>;
