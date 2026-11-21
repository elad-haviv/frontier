import { z } from "zod";
import { DraftKind, Id, Origin, ProposalOperation, VaultPath } from "./state.js";

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
      /** Where the content came from, when the author did not type it. */
      origins: z.array(Origin),
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
  unreadableFields: z.array(z.object({ path: VaultPath, problems: z.array(z.string()) })),
  duplicateIds: z.array(z.object({ id: z.string(), paths: z.array(VaultPath) })),
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
  /** With `branch`: a new image on that proposal branch, shown in the inbox. */
  branch: z.string().optional(),
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

/** `GET /api/inbox` */
export const InboxResponse = z.object({
  branches: z.array(InboxBranch),
  proposals: z.array(InboxProposal),
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

/** `GET /api/settings`. No secret is ever part of it. */
export const SettingsResponse = z.object({
  ai: z.object({
    keySet: z.boolean(),
    /** Where the key in use comes from. */
    keyFrom: z.enum(["settings", "environment", "none"]),
    keyLast4: z.string().nullable(),
    /** False when SECRETS_KEY is not set, so a key cannot be stored here. */
    canStoreKey: z.boolean(),
    models: z.object({ extraction: z.string().nullable() }),
    monthlyCapUsd: z.number(),
    proposeOnPublish: z.boolean(),
    spentUsd: z.number(),
  }),
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

/** `PUT /api/settings/ai`. `key: null` removes the stored key. */
export const AiSettingsRequest = z.object({
  key: z.string().min(8).nullable().optional(),
  models: z.object({ extraction: z.string().min(1).nullable() }).optional(),
  monthlyCapUsd: z.number().min(0).max(10_000).optional(),
  proposeOnPublish: z.boolean().optional(),
});

export const ModelsResponse = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      /** US dollars per million tokens. */
      promptPrice: z.number(),
      completionPrice: z.number(),
    }),
  ),
});
export type ModelsResponse = z.infer<typeof ModelsResponse>;

/** `GET /api/proposals/job` */
export const FieldJobState = z.object({
  state: z.enum(["none", "running", "done", "cancelled", "stopped"]),
  folder: z.string().optional(),
  done: z.number().optional(),
  total: z.number().optional(),
  /** Operations proposed so far. */
  made: z.number().optional(),
  failed: z.array(z.object({ path: VaultPath, message: z.string() })).optional(),
  /** Why the job stopped early. */
  stoppedBy: z.string().optional(),
});
export type FieldJobState = z.infer<typeof FieldJobState>;
