import { type ErrorCode, statusOf } from "@frontier/schema";

/** An error that is sent to the browser as `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get status(): number {
    return statusOf(this.code);
  }
}
