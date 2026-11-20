import { z } from "zod";
import { DraftKind, Id, VaultPath } from "./state.js";

const Ok = z.object({ ok: z.literal(true) });

// ---- Session -------------------------------------------------------------------------------

export const LoginRequest = z.object({ password: z.string().min(1) });
export const LoginResponse = Ok;
export const LogoutResponse = Ok;
export const SessionResponse = z.object({ loggedIn: z.boolean() });

// ---- Tree and entries ----------------------------------------------------------------------

/** `quarantined` is used from stage 3. */
export const EntryState = z.enum(["published", "unpublished", "conflict", "quarantined"]);
export type EntryState = z.infer<typeof EntryState>;

export const TreeNote = z.object({ path: VaultPath, title: z.string(), state: EntryState });

export interface TreeFolder {
  path: string;
  folders: TreeFolder[];
  notes: z.infer<typeof TreeNote>[];
}
export const TreeFolder: z.ZodType<TreeFolder> = z.lazy(() =>
  z.object({ path: z.string(), folders: z.array(TreeFolder), notes: z.array(TreeNote) }),
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
});
export type SaveDraftRequest = z.infer<typeof SaveDraftRequest>;

export const SaveDraftResponse = z.object({ id: Id, revision: z.number().int().min(1) });
export type SaveDraftResponse = z.infer<typeof SaveDraftResponse>;

/** `GET /api/drafts/:id/versions` */
export const DraftVersionsResponse = z.object({
  current: z.object({ text: z.string(), revision: z.number().int().min(0) }),
  other: z.object({ text: z.string() }),
});

/** `POST /api/drafts/:id/merge-versions` and `POST /api/drafts/:id/resolve` */
export const DraftTextRequest = z.object({ text: z.string() });

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
    }),
  ),
  renames: z.array(RenameSummary),
});
export type UnpublishedResponse = z.infer<typeof UnpublishedResponse>;

/** `POST /api/publish/plan` */
export const PublishPlanRequest = z.object({ draftIds: z.array(Id), renameIds: z.array(Id) });

export const PlannedMerge = z.object({
  id: z.string(),
  draftId: Id,
  path: VaultPath,
  mergedText: z.string(),
  mainText: z.string(),
  baseText: z.string(),
});

export const ConflictReason = z.enum([
  "overlap",
  "created_on_main",
  "deleted_on_main",
  "delete_of_changed_file",
  "binary_changed_on_both",
  /** A rename cannot be carried out, for the reason given in `mine`. */
  "rename_blocked",
]);

export const PlannedConflict = z.object({
  draftId: Id,
  path: VaultPath,
  reason: ConflictReason,
  /** Empty strings for images. */
  mine: z.string(),
  theirs: z.string().nullable(),
  base: z.string().nullable(),
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
});
export type PublishPlan = z.infer<typeof PublishPlan>;

/** `POST /api/publish/confirm` */
export const PublishConfirmRequest = z.object({
  planId: Id,
  confirmedMergeIds: z.array(z.string()),
  message: z.string().trim().min(1).max(2000),
});
export const PublishConfirmResponse = z.object({ commit: z.string() });

// ---- Renames -------------------------------------------------------------------------------

/** `POST /api/renames`. `from` is a note, a file or a folder. */
export const CreateRenameRequest = z.object({ from: VaultPath, to: VaultPath });
export const CreateRenameResponse = z.object({ id: Id, affected: z.array(VaultPath) });

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
});
export type AttentionResponse = z.infer<typeof AttentionResponse>;

// ---- Images --------------------------------------------------------------------------------

export const IMAGE_WIDTHS = [320, 640, 1280] as const;

/** `GET /api/images?path=&w=&draft=` */
export const ImageQuery = z.object({
  path: VaultPath,
  w: z.coerce
    .number()
    .refine((n) => (IMAGE_WIDTHS as readonly number[]).includes(n))
    .optional(),
  draft: Id.optional(),
});

/** `POST /api/images` (stage 2) */
export const UploadImageResponse = z.object({ path: VaultPath, embed: z.string() });

// ---- Search (stage 2) ----------------------------------------------------------------------

export const SearchQuery = z.object({
  q: z.string().min(1),
  appendices: z.enum(["0", "1"]).optional(),
});
export const SearchResponse = z.object({
  results: z.array(
    z.object({ path: VaultPath, title: z.string(), snippet: z.string(), draftOnly: z.boolean() }),
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
    }),
  ),
});
export const PreviewResponse = z.object({ path: VaultPath, text: z.string() });
