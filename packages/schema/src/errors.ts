import { z } from "zod";

/** Every error code the API can return, with its HTTP status. */
export const ERROR_STATUS = {
  unauthenticated: 401,
  rate_limited: 429,
  not_found: 404,
  append_only: 403,
  read_only_file: 403,
  stale_revision: 409,
  main_moved: 409,
  plan_expired: 410,
  git_busy: 503,
  push_failed: 502,
  merge_failed: 500,
  invalid: 400,
  not_allowed: 403,
  proposal_moved: 409,
  ai_off: 409,
  // The person has no key on this device for the provider the task needs (stage 27f).
  ai_key_missing: 409,
  // The provider turned the key on this device away (stage 27f): the person adds a working one.
  ai_key_rejected: 409,
  ai_failed: 502,
  ai_bad_answer: 502,
  // The author stopped the call while it ran.
  ai_stopped: 409,
  // What the author was shown has changed since; he looks again before going on.
  changed: 409,
  // The change needs a login from the last few minutes; the web app asks the person to log in
  // again and then tries once more.
  recent_login_needed: 403,
  // Another account already uses this email.
  email_taken: 409,
  // A folder cannot be deleted while something under it has an unpublished change, or is an image.
  has_drafts: 409,
  has_images: 409,
  // Stage 27b: the project is not there for this person (it does not exist, or they are not a member:
  // the two answers are the same, so an address cannot be used to find out which projects exist).
  no_project: 403,
  // The person's role in the project is below what the route needs.
  role_too_low: 403,
  // This address is used by another project, or is a reserved word.
  slug_taken: 409,
  // The first project's files are the server's old layout and cannot be deleted from the app, and
  // a server's last project cannot be deleted.
  project_not_deletable: 409,
  // Stage 27c: a project always keeps one owner.
  last_owner: 409,
  // Invite links. `unknown` is a link that never existed (or is not shaped like one); the others
  // say why a link that did exist no longer works, and the page names the person to ask.
  invite_unknown: 404,
  invite_used: 410,
  invite_cancelled: 410,
  invite_expired: 410,
  // The person is already in the project the link is for. The link is not used up.
  already_member: 409,
  // The email belongs to an account already: the page says to log in and join with it.
  account_exists: 409,
  // An image could not be taken from a web address; the server log says why.
  image_fetch_failed: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ErrorCodeSchema = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    /** Present with `stale_revision`: the id of the draft the server holds for that path. */
    id: z.string().optional(),
    /** Where in the app the problem is put right, such as "/settings/device/ai-keys". */
    href: z.string().optional(),
    /** With `ai_key_missing`: the provider kind whose key this device lacks. */
    provider: z.string().optional(),
    /** With `invite_used`, `invite_cancelled` and `invite_expired`: the name of the person who made the link, to ask for a new one. */
    inviter: z.string().optional(),
    /** With `already_member`: the address (slug) of the project the person is already in. */
    project: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export function statusOf(code: ErrorCode): number {
  return ERROR_STATUS[code];
}
