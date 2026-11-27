import { z } from "zod";
import { OtherUnsaved, Reading } from "./api.js";
import { VaultPath } from "./state.js";

/** `GET /api/status`, and the data of each `status` server-sent event. */
export const StatusSnapshot = z.object({
  /** Where the knowledge base lives: Frontier's own library, GitHub, or the made-up sample. */
  library: z.enum(["own", "github", "sample"]),
  /** False when the only backup is on the server's own disk. */
  backupOutside: z.boolean(),
  lastFetchAt: z.string().datetime().nullable(),
  lastPushAt: z.string().datetime().nullable(),
  /** The message of the last failed push, cleared by the next successful one. */
  failedPush: z.string().nullable(),
  unpublished: z.number().int().min(0),
  conflicts: z.number().int().min(0),
  /** The commit the index was built from. */
  indexCommit: z.string().nullable(),
  /** True when the index was built from a commit older than the fetched `main`. */
  indexStale: z.boolean(),
  lastBackupAt: z.string().datetime().nullable(),
  backupError: z.string().nullable(),
  /** What waits in the inbox. */
  inbox: z.object({
    branches: z.number().int().min(0),
    /** Operations proposed by Frontier's AI that wait for a decision. */
    operations: z.number().int().min(0),
    /** Notes that arrived unreviewed and wait for a decision. */
    quarantined: z.number().int().min(0),
  }),
  /** One-time notices the web app shows and then clears. */
  notices: z.object({
    /** AI keys that were stored on the server were deleted at start (stage 27f). */
    keysRemoved: z
      .object({
        at: z.string(),
        providers: z.array(z.string()),
        environment: z.array(z.string()).default([]),
      })
      .nullable(),
  }),
  /** Rises each time the server itself changes a draft, so an open editor can reload it. */
  serverDraftChanges: z.number().int().min(0),
  /**
   * Stage 27e. Rises each time an entry's shared comments change (a comment, a reply, an edit, a
   * resolve, a delete), and names the entry, so an open page reads that entry's comments again.
   * No text, no author: comments are read from their own routes, by the role that may.
   */
  comments: z.object({ changes: z.number().int().min(0), path: VaultPath.nullable() }).optional(),
  /**
   * Rises on every draft save, server change and discard, from any device, so a device keeping
   * copies for offline reading reads them again even when the unpublished count stays the same.
   */
  drafts: z.number().int().min(0),
  /** Files Frontier reads its rules from that could not be read, in words. */
  problems: z.array(z.string()),
  attention: z.object({
    ambiguousLinks: z.number().int().min(0),
    duplicateImages: z.number().int().min(0),
    mixedEndings: z.number().int().min(0),
    brokenAppendixLinks: z.number().int().min(0),
    nearFolderNotes: z.number().int().min(0),
    unreadableFields: z.number().int().min(0),
    duplicateIds: z.number().int().min(0),
    /** Drafts with texts kept from other devices, waiting to be merged. */
    keptCopies: z.number().int().min(0),
  }),
  /**
   * Stage 27d. `unpublished`, `conflicts`, `drafts`, `serverDraftChanges` and `attention.keptCopies`
   * above are the caller's own. These two are about other people, and only writers and owners get
   * them: for a reader both are empty.
   *
   * `othersUnsaved`: the entries someone else in the project has unsaved changes to, and who (the
   * names and the time, never the text), for the "has unsaved changes" notice and the tree's dot.
   * `presence`: who is reading which entry now, apart from the caller.
   */
  othersUnsaved: z.array(z.object({ path: VaultPath, people: z.array(OtherUnsaved) })).optional(),
  presence: z.array(Reading).optional(),
});
export type StatusSnapshot = z.infer<typeof StatusSnapshot>;

/** `GET /health`. Times and a commit hash; no vault content. */
export const Health = z.object({
  ok: z.boolean(),
  indexCommit: z.string().nullable(),
  lastFetchAt: z.string().datetime().nullable(),
  lastBackupAt: z.string().datetime().nullable(),
});
export type Health = z.infer<typeof Health>;
