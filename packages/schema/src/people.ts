import { z } from "zod";
import { Passkey } from "./state.js";

/**
 * `/data/state/people.json`: everyone who has an account. Stage 27a holds the one account that
 * the single "author" used to be; later parts add more people beside it.
 *
 * The shape leaves room without changing: a way of signing in that is not a password or a
 * passkey (Google) goes in `identities`, and a project's members are kept by the project, by
 * person id, so neither needs a new field here.
 */

/** A sign-in through another service, such as Google. Google, from stage 27c. */
export const Identity = z.object({
  provider: z.string().min(1),
  /** The service's own, stable id for the person. */
  subject: z.string().min(1),
  /** The email the service gave when it was linked, for Settings to show; never used to find an account. */
  email: z.string().optional(),
  addedAt: z.string().datetime(),
});
export type Identity = z.infer<typeof Identity>;

export const Person = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  /** As the person typed it. Compared without regard to case; empty until they give one. */
  email: z.string().default(""),
  /** Empty when the account has no password. */
  passwordHash: z.string().default(""),
  /** When true the password no longer logs in; only another way does. */
  passwordOff: z.boolean().default(false),
  passkeys: z.array(Passkey).default([]),
  identities: z.array(Identity).default([]),
  createdAt: z.string().datetime(),
  /**
   * Counted up whenever the way into the account changes (a new password, a passkey removed, the
   * password switched off or on). A session carries the number it started with, and one that
   * does not match is over, so a stolen session does not outlive the change that was made to
   * shut it out.
   */
  sessionEpoch: z.number().int().default(0),
  /** The server's first account. Only it may do what only the server's owner may. */
  admin: z.boolean().default(false),
  /** The id of the project the person used last (stage 27b), so the app opens it after a login. */
  lastProject: z.string().nullable().default(null),
});
export type Person = z.infer<typeof Person>;

export const PeopleFile = z.object({
  version: z.literal(1).default(1),
  people: z.array(Person).default([]),
});
export type PeopleFile = z.infer<typeof PeopleFile>;

/**
 * The same address however it is typed: in any case, with spaces around it, and with look-alike
 * characters (full-width letters, ligatures) written the plain way.
 */
export const emailKey = (email: string): string => email.normalize("NFKC").trim().toLowerCase();

/** Two letters for a round avatar: the first letters of the first and last name, or of the email. */
export function initialsOf(name: string, email = ""): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const from =
    words.length >= 2
      ? [words[0]!, words[words.length - 1]!]
      : words.length === 1
        ? [words[0]!]
        : [email.trim()];
  const letters = from.map((w) => Array.from(w)[0] ?? "").join("");
  return (letters || "?").toLocaleUpperCase();
}
