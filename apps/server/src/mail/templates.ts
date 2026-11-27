/**
 * The five emails of stage 28: invite, confirm address, reset password, reset with no password,
 * and address changed. Plain text first, then simple HTML with one button and the same link as
 * text. No images, no tracking. Everything a person typed (names, project names, addresses) is
 * escaped in the HTML, and a subject is one line.
 */
import type { ProjectRole } from "@frontier/schema";
import type { MailSender } from "../config.js";
import { oneLine } from "./mailer.js";

export interface Composed {
  subject: string;
  text: string;
  html: string;
}

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** One paragraph of the plain version, one of the HTML version. */
interface Part {
  /** Plain text of the paragraph, and HTML made from escaped pieces. */
  text: string;
  html: string;
}

const para = (text: string): Part => ({ text, html: `<p>${escapeHtml(text)}</p>` });
/** A paragraph with a bold run: `before`, `bold`, `after`. */
const withBold = (before: string, bold: string, after: string): Part => ({
  text: `${before}${bold}${after}`,
  html: `<p>${escapeHtml(before)}<b>${escapeHtml(bold)}</b>${escapeHtml(after)}</p>`,
});

function compose(
  subject: string,
  parts: Part[],
  button: { label: string; url: string },
  after: Part[],
  fine: string[],
): Composed {
  const text = [
    ...parts.map((p) => p.text),
    `${button.label}: ${button.url}`,
    ...after.map((p) => p.text),
    "--",
    ...fine,
  ].join("\n\n");
  const url = escapeHtml(button.url);
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f2;font-family:${FONT};color:#1d1d1b">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #deded8;border-radius:10px;padding:24px;font-size:15px;line-height:1.5">` +
    `<div style="font-weight:600;letter-spacing:.02em;margin-bottom:16px">Frontier</div>` +
    parts.map((p) => p.html).join("") +
    `<p><a href="${url}" style="display:inline-block;background:#2f5d50;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px">${escapeHtml(button.label)}</a></p>` +
    `<p style="font-size:13px;color:#555">Or paste this link into your browser:<br>${url}</p>` +
    after.map((p) => p.html).join("") +
    `<hr style="border:none;border-top:1px solid #deded8;margin:20px 0">` +
    fine.map((f) => `<p style="font-size:13px;color:#555">${escapeHtml(f)}</p>`).join("") +
    `</div></body></html>`;
  return { subject: oneLine(subject), text, html };
}

const sentBy = (from: MailSender, why = ""): string =>
  `Sent by Frontier (${from.address})${why}. Replies to this address are not read.`;

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const ROLE_VERB: Record<ProjectRole, string> = {
  owner: "help look after",
  writer: "write in",
  reader: "read",
};

/** `y•••@example.net`: enough for the owner of the old address to recognise it, not to learn it. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${Array.from(address.slice(0, at))[0] ?? ""}•••${address.slice(at)}`;
}

/**
 * How to name the inviter where the email says to ask them: the first name when the name has
 * several words and the first is a real name (not an initial), otherwise the whole name.
 */
export function askName(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? "";
  return words.length > 1 && first.length > 1 && !/[.@]/.test(first) ? first : name.trim();
}

export function inviteMail(d: {
  from: MailSender;
  inviter: string;
  project: string;
  role: ProjectRole;
  url: string;
  expiresAt: string;
}): Composed {
  return compose(
    `${d.inviter} invited you to ${d.project} on Frontier`,
    [
      withBold(
        `${d.inviter} invited you to ${ROLE_VERB[d.role]} `,
        d.project,
        ", a project on Frontier.",
      ),
    ],
    { label: `Join ${d.project}`, url: d.url },
    [
      para(
        `The link works once and stops working on ${day(d.expiresAt)}. Anyone who opens it can join with it, so only pass it on to the person you mean.`,
      ),
    ],
    [
      "If you were not expecting this, ignore this email. Nothing happens unless the link is opened.",
      sentBy(d.from, ` because ${d.inviter} typed your address`).replace(
        "Replies to this address are not read.",
        `Replies to this address are not read; ask ${askName(d.inviter)} directly.`,
      ),
    ],
  );
}

export function confirmMail(d: {
  from: MailSender;
  name: string;
  address: string;
  url: string;
}): Composed {
  const first = d.name.trim().split(/\s+/)[0] ?? "";
  return compose(
    "Confirm your email address for Frontier",
    [
      withBold(
        `${first ? `Hello ${first}, p` : "P"}lease confirm that `,
        d.address,
        " is your email address on Frontier.",
      ),
    ],
    { label: "Confirm my email", url: d.url },
    [
      para(
        "The link works once and for 24 hours. If it has expired, open Frontier and press Resend.",
      ),
    ],
    [
      "If you did not join Frontier, ignore this email. The address stays unconfirmed and nothing else happens.",
      sentBy(d.from),
    ],
  );
}

export function resetMail(d: { from: MailSender; url: string }): Composed {
  return compose(
    "Reset your Frontier password",
    [
      para(
        "Someone asked to reset the password for the Frontier account with this address. If that was you, choose a new one here.",
      ),
    ],
    { label: "Choose a new password", url: d.url },
    [para("The link works once and for 30 minutes. Resetting logs you out on your other devices.")],
    [
      "If you did not ask for this, ignore this email. Your password has not changed.",
      sentBy(d.from),
    ],
  );
}

/** How an account with no usable password logs in, for the explanatory email. */
export type Ways = { google: boolean; passkey: boolean; passwordOff: boolean };

export function noPasswordMail(d: { from: MailSender; ways: Ways; loginUrl: string }): Composed {
  const parts: string[] = [];
  if (d.ways.google) parts.push("Google");
  if (d.ways.passkey) parts.push("a passkey");
  const how = parts.length > 0 ? parts.join(" or ") : "another way";
  const why = d.ways.passwordOff
    ? "The password on this account is switched off"
    : "This account has no password";
  return compose(
    "About your Frontier password",
    [
      para(
        `Someone asked to reset the password for the Frontier account with this address. ${why}: you log in with ${how}.`,
      ),
    ],
    { label: "Go to log in", url: d.loginUrl },
    [
      para(
        d.ways.passwordOff
          ? "There is nothing to reset. If you want to use a password again, log in and switch it on under Settings, Signing in."
          : "There is nothing to reset. If you want a password as well, log in and add one under Settings, Signing in.",
      ),
    ],
    ["If you did not ask for this, ignore this email. Nothing has changed.", sentBy(d.from)],
  );
}

/** Sent to the OLD address, when a change is asked for and when it is done. */
export function addressChangedMail(d: {
  from: MailSender;
  phase: "asked" | "done";
  oldAddress: string;
  newAddress: string;
  openUrl: string;
}): Composed {
  const asked = d.phase === "asked";
  const lead = asked
    ? withBold(
        "Someone asked to change the email address on your Frontier account from ",
        d.oldAddress,
        ` to ${maskAddress(d.newAddress)}.`,
      )
    : withBold(
        "The email address on your Frontier account was changed from ",
        d.oldAddress,
        ` to ${maskAddress(d.newAddress)}.`,
      );
  return compose(
    asked
      ? "Your Frontier email address is being changed"
      : "Your Frontier email address has been changed",
    [
      lead,
      para(
        asked
          ? "Nothing changes until the new address is confirmed. If this was you, you do not need to do anything."
          : "The new address was confirmed, so it replaces this one. You now log in with the new address.",
      ),
    ],
    { label: "Open Frontier", url: d.openUrl },
    [],
    [
      asked
        ? "If this was not you, log in and change your password, then cancel the change under Settings, Signing in. We will write again when the change is complete."
        : "If this was not you, ask whoever runs this Frontier server for help, and change your password if you can still log in.",
      sentBy(d.from),
    ],
  );
}
