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
  ai_failed: 502,
  ai_bad_answer: 502,
  // The author stopped the call while it ran.
  ai_stopped: 409,
  // What the author was shown has changed since; he looks again before going on.
  changed: 409,
  // Another account already uses this email.
  email_taken: 409,
  // A folder cannot be deleted while something under it has an unpublished change, or is an image.
  has_drafts: 409,
  has_images: 409,
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
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export function statusOf(code: ErrorCode): number {
  return ERROR_STATUS[code];
}
