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

export const Encrypted = z.object({ iv: z.string(), data: z.string(), tag: z.string() });
export type Encrypted = z.infer<typeof Encrypted>;

export const AiSettings = z.object({
  /** The provider key, encrypted with the key from the SECRETS_KEY variable. */
  key: Encrypted.nullable().default(null),
  /** One model name per task. Null until the author picks one; the task is off until then. */
  models: z
    .object({
      extraction: z.string().nullable().default(null),
      conversation: z.string().nullable().default(null),
    })
    .default({}),
  /** Frontier stops calling the provider when this month's spending reaches it. */
  monthlyCapUsd: z.number().min(0).default(10),
  /** Propose fields for the notes of each Publish. */
  proposeOnPublish: z.boolean().default(false),
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
  /** Empty when no password is set. */
  passwordHash: z.string(),
  ai: AiSettings.default({}),
  passkeys: z.array(Passkey).default([]),
  /** When true the password no longer logs in; only a passkey does. */
  passwordOff: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;
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
]);
export type RejectedOperation = z.infer<typeof RejectedOperation>;
