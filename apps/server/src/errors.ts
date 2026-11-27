import { type ErrorCode, statusOf } from "@frontier/schema";

/**
 * Where an AI error is put right, for the errors raised without one: the AI features each say
 * "on the settings page" in their own words, and the page links there instead.
 */
export function settingsLink(error: ApiError): { href?: string } {
  if (error.code === "ai_key_missing") return { href: "/settings/device/ai-keys" };
  if (error.code !== "ai_off") return {};
  const m = /No model is chosen for ([a-z ]+)/i.exec(error.message);
  if (!m) return { href: "/settings/you/ai-models" };
  const what = m[1]!.toLowerCase();
  const task = what.includes("fields")
    ? "extraction"
    : what.includes("art")
      ? "art"
      : "conversation";
  return { href: `/settings/you/ai-models/${task}` };
}

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
