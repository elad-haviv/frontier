/** People and addresses as the server describes them, for the tests of the email screens (stage 32). */
import type { EmailInfo, MeResponse } from "@frontier/schema";

const AT = "2026-11-27T10:00:00.000Z";

export const emailInfo = (over: Partial<EmailInfo> = {}): EmailInfo => ({
  mailOn: true,
  status: "unconfirmed",
  confirmedBy: null,
  confirmedAt: null,
  sent: { at: AT, ok: true },
  pending: null,
  needsAddress: false,
  ...over,
});

/** Yael, who joined by password with an address nobody has confirmed yet. */
export const person = (over: Partial<MeResponse> = {}): MeResponse => ({
  id: "p1",
  name: "Yael Stern",
  email: "yael@example.org",
  admin: false,
  needsProfile: false,
  passkeys: [],
  passwordSet: true,
  passwordOff: false,
  method: "password",
  suggestedEmail: "",
  signingIn: {
    password: { set: true, off: false },
    passkeys: [],
    google: null,
    googleAvailable: false,
  },
  emailInfo: emailInfo(),
  ...over,
});

/** The words of a button in the document, for the tests that list them. */
export const buttonNames = (host: HTMLElement): (string | undefined)[] =>
  [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
