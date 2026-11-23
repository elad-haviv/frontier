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
  ai_cap_reached: 402,
  ai_failed: 502,
  ai_bad_answer: 502,
  // What the author was shown has changed since; he looks again before going on.
  changed: 409,
  secrets_key_missing: 409,
  // A folder cannot be deleted while something under it has an unpublished change, or is an image.
  has_drafts: 409,
  has_images: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ErrorCodeSchema = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    /** Present with `stale_revision`: the id of the draft the server holds for that path. */
    id: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export function statusOf(code: ErrorCode): number {
  return ERROR_STATUS[code];
}
