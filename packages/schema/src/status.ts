import { z } from "zod";

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
  ai: z.object({
    /** A key and a model for proposing fields are set. */
    on: z.boolean(),
    lastError: z.string().nullable(),
  }),
  /** Rises each time the server itself changes a draft, so an open editor can reload it. */
  serverDraftChanges: z.number().int().min(0),
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
  }),
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
