import { z } from "zod";

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
});
export type DraftRecord = z.infer<typeof DraftRecord>;

/** `/data/state/drafts/renames/<id>.json` */
export const RenameIntent = z.object({
  id: Id,
  from: VaultPath,
  to: VaultPath,
  createdAt: z.string().datetime(),
});
export type RenameIntent = z.infer<typeof RenameIntent>;

/** `/data/state/settings.json` */
export const Settings = z.object({
  passwordHash: z.string(),
});
export type Settings = z.infer<typeof Settings>;

/** `/data/state/backup.json` */
export const BackupState = z.object({
  lastSuccessAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type BackupState = z.infer<typeof BackupState>;
