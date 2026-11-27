import { z } from "zod";
import { ConfirmedBy, EmailCode, EmailPending, EmailUsed, ResetCode } from "./email.js";
import { Passkey } from "./state.js";

/**
 * `/data/state/people.json`: everyone who has an account. Stage 31a holds the one account that
 * the single "author" used to be; later parts add more people beside it.
 *
 * The shape leaves room without changing: a way of signing in that is not a password or a
 * passkey (Google) goes in `identities`, and a project's members are kept by the project, by
 * person id, so neither needs a new field here.
 */

/** A sign-in through another service, such as Google. Google, from stage 31c. */
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
  /** The id of the project the person used last (stage 31b), so the app opens it after a login. */
  lastProject: z.string().nullable().default(null),
  /**
   * Stage 32. When the address was confirmed (a link opened, Google's own check, or an emailed
   * invitation joined with that address). Null for an address nobody has checked, which is every
   * account from before stage 32 and every address typed on a server without mail.
   */
  emailConfirmedAt: z.string().datetime().nullable().default(null),
  emailConfirmedBy: ConfirmedBy.nullable().default(null),
  /** The confirm link waiting to be opened (hash only), for the address it names. */
  emailCode: EmailCode.nullable().default(null),
  /** A new address waiting for its confirm link; the old one stays in force until then. */
  emailPending: EmailPending.nullable().default(null),
  /** The reset link waiting to be opened (hash only). */
  resetCode: ResetCode.nullable().default(null),
  /**
   * The address was taken away because a Google sign-in verified the same one: the person is asked
   * to add another. Such an account never counts as "the account with no email" at login.
   */
  emailDisplaced: z.boolean().default(false),
  /**
   * The account itself set its current address after stage 32 (Change address, or the profile
   * form), as against giving it when it joined. Until such an address is confirmed no reset link
   * is sent to it.
   */
  emailSetBySelf: z.boolean().default(false),
  /**
   * When the latest confirm link Frontier successfully sent to the current address runs (or ran)
   * out; null when none was ever sent. An unconfirmed address whose link lapsed unopened may be
   * given up to a Google-verified person; one never sent a link never is.
   */
  emailLinkSentUntil: z.string().datetime().nullable().default(null),
  /** The confirm link used last, so opening it again says "already confirmed". */
  emailUsed: EmailUsed.nullable().default(null),
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

/**
 * The domain a saved version is authored under for a person who has no email of their own (stage
 * 31d): `<person id>@people.frontier.invalid`. It receives nothing and names a person only for the
 * author lookup, so no account may ever have an address on it.
 */
export const STAND_IN_DOMAIN = "people.frontier.invalid";

/**
 * Whether an address is on the stand-in domain or any domain below it, in any letter case and
 * however it is typed (full-width letters, a dot at the end).
 */
export function isStandInAddress(email: string): boolean {
  const key = emailKey(email);
  const domain = key.slice(key.lastIndexOf("@") + 1).replace(/\.+$/, "");
  return domain === STAND_IN_DOMAIN || domain.endsWith(`.${STAND_IN_DOMAIN}`);
}

/** The email of an account: an address, never one on the stand-in domain (stage 31d). */
export const AccountEmail = z
  .string()
  .trim()
  .min(1, "Give an email.")
  .max(200)
  .email("This is not an email address.")
  .refine((e) => !isStandInAddress(e), "This address cannot be used. Give your own email.");

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
