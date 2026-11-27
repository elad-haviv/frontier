import { z } from "zod";

/**
 * Stage 28: email. Confirming an address, emailing an invitation, changing an address, and
 * forgotten passwords. Nothing here is sent unless the server has a mail relay configured
 * (`mail` in `GET /api/session` says so), and every shape degrades to today's when it has not.
 */

/** How long a confirm link works. */
export const CONFIRM_LINK_HOURS = 24;
/** How long a reset link works. */
export const RESET_LINK_MINUTES = 30;
/** The shortest and longest a new password can be (the same as everywhere else). */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 500;

/** How an address came to count as confirmed. */
export const ConfirmedBy = z.enum([
  /** Google verified it. */
  "google",
  /** The person opened the confirm link. */
  "link",
  /** They joined with the very address an invitation was emailed to. */
  "invite",
  /** They opened a reset link sent to it. */
  "reset",
]);
export type ConfirmedBy = z.infer<typeof ConfirmedBy>;

/** What became of a message: `queued` while it is on its way, `sent` once the relay took it. */
export const MailState = z.enum(["queued", "sent", "failed"]);
export type MailState = z.infer<typeof MailState>;

/** An address as someone types it into a form (an invitation, a change, forgot password). */
export const EmailAddress = z
  .string()
  .trim()
  .min(1, "That doesn't look like an email address.")
  .max(200, "That doesn't look like an email address.")
  .email("That doesn't look like an email address.");

/** A confirm link waiting to be opened, as stored on the account: only a hash of the code. */
export const EmailCode = z.object({
  codeHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** The address the link confirms: the account's own, or a pending new one. */
  address: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  mail: MailState.default("queued"),
});
export type EmailCode = z.infer<typeof EmailCode>;

/**
 * A confirm link that was used, kept (its hash only) until the day it would have run out anyway,
 * so opening it a second time, or a second request arriving at once, is answered "already
 * confirmed" and not as a dead link.
 */
export const EmailUsed = z.object({
  codeHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.string().datetime(),
});
export type EmailUsed = z.infer<typeof EmailUsed>;

/** A change of address that waits for its link to be opened. The old address stays in force. */
export const EmailPending = z.object({ address: z.string(), requestedAt: z.string().datetime() });
export type EmailPending = z.infer<typeof EmailPending>;

/** A reset link waiting to be opened, as stored on the account. */
export const ResetCode = z.object({
  codeHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type ResetCode = z.infer<typeof ResetCode>;

/** When the last confirm mail was made and whether it went; `ok` is null while it is on its way. */
export const MailSent = z.object({ at: z.string(), ok: z.boolean().nullable() });
export type MailSent = z.infer<typeof MailSent>;

/**
 * What the app needs to show the banner and Settings → You → Signing in. In `GET /api/me`
 * (`emailInfo`) and, for the person asking, `GET /api/session` (`person.emailInfo`).
 */
export const EmailInfo = z.object({
  /** Whether the server sends mail. False: show no banner, no marks, no "Forgot password". */
  mailOn: z.boolean(),
  /** `none`: the account has no address (asked to add one). */
  status: z.enum(["none", "unconfirmed", "confirmed"]),
  confirmedBy: ConfirmedBy.nullable(),
  confirmedAt: z.string().nullable(),
  /** The latest confirm mail for the current address; null if none was made yet. */
  sent: MailSent.nullable(),
  /** A change of address waiting for its link, with its own mail state. */
  pending: z
    .object({ address: z.string(), requestedAt: z.string(), sent: MailSent.nullable() })
    .nullable(),
  /** The address was taken by a Google sign-in that verified it: the person is asked to add another. */
  needsAddress: z.boolean(),
});
export type EmailInfo = z.infer<typeof EmailInfo>;

/** `POST /api/me/email`: ask to change the address. `password` is the current one (see the design). */
export const ChangeEmailRequest = z.object({
  email: EmailAddress,
  password: z.string().max(PASSWORD_MAX).optional(),
});
export type ChangeEmailRequest = z.infer<typeof ChangeEmailRequest>;

/**
 * The answer to a change of address or a resend. `applied` is true when the address changed at
 * once (no mail relay, or the account had no address yet); `mail` says whether the link went.
 */
export const EmailChangeResponse = z.object({
  ok: z.literal(true),
  applied: z.boolean(),
  mail: z.enum(["sent", "failed", "off"]),
});
export type EmailChangeResponse = z.infer<typeof EmailChangeResponse>;

/** `POST /api/confirm/:code`. */
export const ConfirmResponse = z.object({
  ok: z.literal(true),
  /** `changed`: a new address replaced the old one. `already_confirmed`: nothing was left to do. */
  status: z.enum(["confirmed", "already_confirmed", "changed"]),
  /** The person who opened the link is logged in as the account it confirmed. The session is never touched. */
  you: z.boolean(),
});
export type ConfirmResponse = z.infer<typeof ConfirmResponse>;

/** `POST /api/forgot-password`. */
export const ForgotPasswordRequest = z.object({ email: EmailAddress });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

/** `POST /api/reset/:code`. */
export const ResetPasswordRequest = z.object({
  password: z
    .string()
    .min(PASSWORD_MIN, "Use at least 12 characters.")
    .max(PASSWORD_MAX, "Use 500 characters or fewer."),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

/** `POST /api/p/:project/invites/:id/resend`: no body. */
export const InviteMailState = z.enum(["sent", "failed"]);
export type InviteMailState = z.infer<typeof InviteMailState>;
