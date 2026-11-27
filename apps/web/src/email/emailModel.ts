/**
 * The words and rules of the email screens (stage 32), kept apart from the pages so they can be
 * tested: what the banner says for each state of an address, how each new refusal is worded, the
 * count under a new password, and the one address a reset can send a person back to.
 */
import type { EmailInfo } from "@frontier/schema";

/** The same plain check as the join page and the profile: something, an at sign, a dot. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const looksLikeEmail = (address: string): boolean => EMAIL.test(address.trim());

export const BAD_ADDRESS = "That doesn't look like an email address.";
export const TRY_LATER = "Too many requests. Try again later.";
export const NEED_PASSWORD = "Enter your password to change it.";
export const SENT_AGAIN = "Sent again. Check your inbox and spam.";
export const NOT_SENT = "We could not send it. Try again in a minute.";
export const NO_MAIL = "This server cannot send email, so copy the link and send it yourself.";

/** The shortest a new password can be. */
export const PASSWORD_MIN = 12;

/**
 * Words for a refusal on one of the email calls, in the app's plain voice. The server's own
 * message is kept where it already says it well (a wrong password, an address already taken).
 */
export function mailFailure(code: string, message: string): string {
  switch (code) {
    case "rate_limited":
      return TRY_LATER;
    case "mail_off":
      return "This server cannot send email.";
    case "already_confirmed":
      return "That address is already confirmed.";
    case "link_invalid":
      return "That link has run out, or was already used.";
    case "use_change_address":
      return "The address is changed under Signing in, with Change address.";
    case "email_taken":
      return "Another account already uses that address.";
    case "recent_login_needed":
      return "This asks for a login from the last few minutes. Log in again and try once more.";
    default:
      return message || "That did not work. Try again.";
  }
}

/** What a button that sent a confirm link says afterwards, whether the mail went or not. */
export function sentWords(mail: "sent" | "failed" | "off", address: string): string {
  if (mail === "failed") return NOT_SENT;
  if (mail === "off") return `Your address is now ${address}.`;
  return SENT_AGAIN;
}

/** The count under a new password: how many more are needed, or that it will do. */
export function passwordCount(length: number): string {
  if (length === 0) return `${PASSWORD_MIN} or more characters.`;
  if (length < PASSWORD_MIN) {
    const more = PASSWORD_MIN - length;
    return `${more} more ${more === 1 ? "character" : "characters"} needed.`;
  }
  return "Good.";
}

/** How the person is shown, in the banner and in Settings. */
export type MailState = "sent" | "unsent" | "failed" | "sending";

/** What the latest confirm mail came to: sent, never made, failed, or still on its way. */
export function mailState(sent: EmailInfo["sent"]): MailState {
  if (sent === null) return "unsent";
  if (sent.ok === null) return "sending";
  return sent.ok ? "sent" : "failed";
}

/** What the banner is about; null when it is not shown. */
export type BannerView =
  | { kind: "confirm"; address: string; state: MailState; pending: boolean; current: string }
  | { kind: "add" };

/**
 * Whether the banner shows, and for which address. Never with mail off, and not for an address
 * that is confirmed (a change that waits is told in Settings). While a change waits it is about
 * the new address.
 */
export function bannerView(info: EmailInfo | undefined, address: string): BannerView | null {
  if (!info || !info.mailOn) return null;
  if (info.needsAddress) return { kind: "add" };
  if (info.status !== "unconfirmed") return null;
  if (info.pending) {
    return {
      kind: "confirm",
      address: info.pending.address,
      state: mailState(info.pending.sent),
      pending: true,
      current: address,
    };
  }
  return {
    kind: "confirm",
    address,
    state: mailState(info.sent),
    pending: false,
    current: address,
  };
}

/** The line in the banner for a confirm view, without its address. */
export function bannerLead(view: Extract<BannerView, { kind: "confirm" }>): string {
  return view.pending ? "Confirm your new address:" : "Confirm your email:";
}

/** Where a person who asked for a new password from an invitation goes once it is set. */
const AFTER_RESET = "frontier.afterReset";
const HOUR = 60 * 60 * 1000;
/** Only an invite page of this app, never an address from elsewhere, and never a query. */
const JOIN_PATH = /^\/join\/[A-Za-z0-9_-]{1,64}$/;
/** The same, as a login form holds it: with the emailed link's proof when it came with one. */
const JOIN_LINK = /^\/join\/[A-Za-z0-9_-]{1,64}(\?m=[A-Za-z0-9_-]{1,64})?$/;

/** Whether `path` is the bare invite page of this app, which a reset may send a person back to. */
export const isJoinPath = (path: unknown): path is string =>
  typeof path === "string" && JOIN_PATH.test(path);

/** Whether `path` is an invite page of this app, with or without the emailed link's proof. */
export const isJoinLink = (path: unknown): path is string =>
  typeof path === "string" && JOIN_LINK.test(path);

/** The bare invite page of an invite address (its proof taken off), or undefined for any other. */
export const joinPageOf = (path: unknown): string | undefined =>
  isJoinLink(path) ? path.split("?")[0] : undefined;

/**
 * Remembers the invite page a person came from to ask for a new password, for an hour, so the
 * email's link (which opens in another tab or app) can bring them back to it. Only the invite
 * page's own address is kept: never a confirm or reset link, and never the emailed link's proof
 * (it is a secret that does not belong in storage, and it saved one confirm email at most).
 */
export function rememberInvitation(path: string | undefined, now = Date.now()): void {
  try {
    const page = joinPageOf(path);
    if (page) localStorage.setItem(AFTER_RESET, JSON.stringify({ path: page, until: now + HOUR }));
  } catch {
    /* without storage the person logs in and opens the invitation again */
  }
}

/** The invite page remembered, once: it is forgotten as it is read, and when it is too old. */
export function takeInvitation(now = Date.now()): string | null {
  try {
    const text = localStorage.getItem(AFTER_RESET);
    localStorage.removeItem(AFTER_RESET);
    if (!text) return null;
    const kept = JSON.parse(text) as { path?: unknown; until?: unknown };
    if (typeof kept.until !== "number" || kept.until < now) return null;
    return isJoinPath(kept.path) ? kept.path : null;
  } catch {
    return null;
  }
}
