/**
 * What mail does to accounts (stage 32): confirm links, a change of address, reset links, and the
 * explanatory email for an account with no password.
 *
 * Every code is 192 random bits, kept only as a SHA-256 on the account, looked up in constant time
 * across all accounts, used once, and used inside the people store's serialized change, so two
 * requests with the same code cannot both succeed and what the code changes is written with it.
 * A code that is unknown, used, expired or replaced is the same answer (`link_invalid`).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  CONFIRM_LINK_HOURS,
  emailKey,
  INVITE_CODE_PATTERN,
  RESET_LINK_MINUTES,
  type EmailCode,
  type EmailInfo,
  type MailSent,
  type Person,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import { newInviteCode } from "../members/invites.js";
import type { Server } from "../server.js";
import { confirmedOf, mayDisplace, withoutPendingChange } from "../state/people.js";
import { MailError, recipientKey } from "./mailer.js";
import { addressChangedMail, confirmMail, noPasswordMail, resetMail } from "./templates.js";

const hashOf = (code: string): Buffer => createHash("sha256").update(code, "utf8").digest();
const ZERO = Buffer.alloc(32);

/** The public address a link in an email is built on: the configured one, never the request's. */
export const linkTo = (server: Server, path: string): string =>
  `${server.config.publicUrl.replace(/\/+$/, "")}${path}`;

/** Whether a reset link (or the explanatory email) may go to the account's address now. */
export const mayReceiveReset = (p: Person): boolean => !p.emailSetBySelf || confirmedOf(p) !== null;

/** Whether the account can log in with its password right now (the only case a reset link is sent). */
export const passwordWorks = (p: Person): boolean => p.passwordHash !== "" && !p.passwordOff;

/**
 * The account holding a code. Every account is compared, in constant time and without stopping at
 * the first match, so how long it takes says nothing about whether, or where, a code is.
 */
function holder(
  people: Person[],
  code: string,
  field: "emailCode" | "resetCode" | "emailUsed",
): Person | null {
  const valid = INVITE_CODE_PATTERN.test(code);
  const wanted = hashOf(valid ? code : "");
  let found: Person | null = null;
  for (const p of people) {
    const stored = p[field]?.codeHash;
    const same = timingSafeEqual(stored ? Buffer.from(stored, "hex") : ZERO, wanted);
    if (same && stored && valid) found = p;
  }
  return found;
}

const dead = () => new ApiError("link_invalid", "This link has been used or has run out.");

/** A mail still "on its way" after this long was lost (the server stopped, or the relay hung). */
const QUEUED_STALE_MS = 60_000;

const sentOf = (code: EmailCode | null): MailSent | null => {
  if (!code) return null;
  if (code.mail === "queued") {
    const lost = Date.now() - Date.parse(code.createdAt) > QUEUED_STALE_MS;
    return { at: code.createdAt, ok: lost ? false : null };
  }
  return { at: code.createdAt, ok: code.mail === "sent" };
};

/** What the app needs to know about a person's address, for the banner and Settings. */
export function emailInfo(server: Server, p: Person): EmailInfo {
  const on = server.mail.enabled;
  const code = p.emailCode;
  const forCurrent = code !== null && emailKey(code.address) === emailKey(p.email);
  const pending = p.emailPending;
  const confirmed = confirmedOf(p);
  return {
    mailOn: on,
    status: p.email.trim() === "" ? "none" : confirmed ? "confirmed" : "unconfirmed",
    confirmedBy: confirmed?.by ?? null,
    confirmedAt: confirmed?.at ?? null,
    sent: forCurrent ? sentOf(code) : null,
    pending: pending
      ? {
          address: pending.address,
          requestedAt: pending.requestedAt,
          sent: code && emailKey(code.address) === emailKey(pending.address) ? sentOf(code) : null,
        }
      : null,
    needsAddress: p.emailDisplaced && p.email.trim() === "",
  };
}

/** Whether to show the person's address as unconfirmed, as owners see it in the members list. */
export const isUnconfirmed = (server: Server, p: Person | null | undefined): boolean =>
  server.mail.enabled && !!p && p.email.trim() !== "" && confirmedOf(p) === null;

const addMs = (ms: number): string => new Date(Date.now() + ms).toISOString();

// ---- Confirming an address -----------------------------------------------------------------

/**
 * Makes a confirm link for an address of the account and sends it, and says what became of the
 * mail. A new link replaces the one before it. With `pending` the address is a change that waits
 * for the link; without it, it is the account's own. A caller that must not wait (joining) runs
 * this with `server.mail.background`. `quiet`: when the address has used its allowance, make no
 * link and say nothing (joining must not fail on it). `resend`: the caller read the account a
 * moment ago and asked for the link it saw; it is checked again inside the serialized change, so
 * a link opened, a change cancelled or an address changed in between is not brought back.
 */
export async function sendConfirm(
  server: Server,
  personId: string,
  address: string,
  options: { pending: boolean; quiet?: boolean; resend?: boolean },
): Promise<"sent" | "failed"> {
  if (!server.mail.enabled) throw new ApiError("mail_off", "This server cannot send email.");
  const key = emailKey(address);
  try {
    server.mailLimit.attempt(recipientKey(address));
  } catch (err) {
    if (options.quiet) return "failed";
    throw err;
  }
  const code = newInviteCode();
  const hash = hashOf(code).toString("hex");
  const now = new Date().toISOString();
  const person = await server.people.mutate((people) => {
    const me = people.find((p) => p.id === personId);
    if (!me) throw new ApiError("unauthenticated", "Log in first.");
    if (options.resend && options.pending) {
      if (!me.emailPending || emailKey(me.emailPending.address) !== key) {
        throw new ApiError("not_found", "No change of address is waiting.");
      }
    }
    if (!options.pending) {
      if (emailKey(me.email) !== key) {
        throw new ApiError("invalid", "Your email address has changed. Try again.");
      }
      if (confirmedOf(me)) {
        throw new ApiError("already_confirmed", "Your email address is already confirmed.");
      }
    }
    const next: Person = {
      ...me,
      emailCode: {
        codeHash: hash,
        address,
        createdAt: now,
        expiresAt: addMs(CONFIRM_LINK_HOURS * 3_600_000),
        mail: "queued",
      },
      emailPending: options.pending ? { address, requestedAt: now } : me.emailPending,
    };
    return { people: people.map((p) => (p.id === personId ? next : p)), result: next };
  });
  let ok = true;
  try {
    await server.mail.send({
      to: address,
      ...confirmMail({
        from: server.mail.sender!,
        name: person.name,
        address,
        url: linkTo(server, `/confirm/${code}`),
      }),
    });
  } catch (err) {
    if (!(err instanceof MailError)) throw err;
    ok = false;
  }
  // Recorded for the banner, only if this is still the link the account holds. A link to the
  // account's own address that went out also starts the clock that decides whether an address
  // nobody ever confirmed may be given up to a Google-verified person (see `linkLapsed`).
  await server.people
    .mutate((people) => ({
      people: people.map((p) =>
        p.id === personId && p.emailCode?.codeHash === hash
          ? {
              ...p,
              emailCode: { ...p.emailCode, mail: ok ? ("sent" as const) : ("failed" as const) },
              emailLinkSentUntil:
                ok && !options.pending ? p.emailCode.expiresAt : p.emailLinkSentUntil,
            }
          : p,
      ),
      result: undefined,
    }))
    .catch(() => undefined);
  return ok ? "sent" : "failed";
}

/** What opening a confirm link did. */
export interface Confirmed {
  person: Person;
  status: "confirmed" | "already_confirmed" | "changed";
  /** With `changed`: where the old-address notice goes. */
  oldAddress: string;
}

/**
 * Uses a confirm link. The account it belongs to is the one changed, whoever opens it and
 * whatever session they have. A link that names a new address (a change) puts that address in
 * force; it fails like a dead link when another account has taken the address meanwhile.
 *
 * A link that was used is remembered (its hash, until it would have run out anyway): opening it
 * again, or a second request arriving at the same moment, is answered `already_confirmed` and
 * changes nothing, where an unknown, replaced or expired link is dead.
 */
export function useConfirmCode(server: Server, code: string): Promise<Confirmed> {
  return server.people.mutate<Confirmed>((people) => {
    const me = holder(people, code, "emailCode");
    if (!me?.emailCode || Date.parse(me.emailCode.expiresAt) <= Date.now()) {
      const used = holder(people, code, "emailUsed");
      if (used?.emailUsed && Date.parse(used.emailUsed.expiresAt) > Date.now()) {
        return {
          people,
          result: { person: used, status: "already_confirmed", oldAddress: "" },
        };
      }
      throw dead();
    }
    const address = me.emailCode.address;
    const now = new Date().toISOString();
    const replace = (next: Person) => people.map((p) => (p.id === me.id ? next : p));
    const remember = { codeHash: me.emailCode.codeHash, expiresAt: me.emailCode.expiresAt };
    if (emailKey(address) === emailKey(me.email)) {
      const already = confirmedOf(me) !== null;
      const next: Person = {
        ...me,
        emailCode: null,
        emailUsed: remember,
        emailConfirmedAt: me.emailConfirmedAt ?? confirmedOf(me)?.at ?? now,
        emailConfirmedBy: me.emailConfirmedBy ?? confirmedOf(me)?.by ?? "link",
        // A change to this very address that is still waiting has nothing left to wait for.
        emailPending:
          me.emailPending && emailKey(me.emailPending.address) === emailKey(address)
            ? null
            : me.emailPending,
      };
      return {
        people: replace(next),
        result: {
          person: next,
          status: already ? "already_confirmed" : "confirmed",
          oldAddress: "",
        },
      };
    }
    // A change of address: only if this is the one the account asked for and nobody has it now.
    if (!me.emailPending || emailKey(me.emailPending.address) !== emailKey(address)) throw dead();
    if (people.some((p) => p.id !== me.id && emailKey(p.email) === emailKey(address))) throw dead();
    const next: Person = {
      ...me,
      email: address,
      emailConfirmedAt: now,
      emailConfirmedBy: "link",
      emailCode: null,
      emailUsed: remember,
      emailPending: null,
      emailLinkSentUntil: null,
      // A reset link was sent to the address that is no longer the account's.
      resetCode: null,
      emailDisplaced: false,
    };
    return {
      people: replace(next),
      result: { person: next, status: "changed", oldAddress: me.email },
    };
  });
}

/** After a change of address is done: the old address is told, once, without holding anything up. */
export function noteAddressChanged(
  server: Server,
  phase: "asked" | "done",
  oldAddress: string,
  newAddress: string,
): void {
  server.mail.background(async () => {
    if (!oldAddress.trim() || emailKey(oldAddress) === emailKey(newAddress)) return;
    // The "asked" notice goes to an address a stranger may type in, so it counts against that
    // address's mail allowance like any other mail, and is skipped quietly when it is used up.
    if (phase === "asked") {
      try {
        server.mailLimit.attempt(recipientKey(oldAddress));
      } catch {
        return;
      }
    }
    try {
      await server.mail.send({
        to: oldAddress,
        ...addressChangedMail({
          from: server.mail.sender!,
          phase,
          oldAddress,
          newAddress,
          openUrl: linkTo(server, "/"),
        }),
      });
    } catch (err) {
      if (!(err instanceof MailError)) throw err;
    }
  });
}

// ---- Forgot password -----------------------------------------------------------------------

/**
 * The work behind "Forgot password", done after the answer has gone so that it takes the same time
 * for every address. A password account gets a reset link; an account with no usable password
 * gets the email that says how it logs in; an unknown address gets nothing.
 */
export async function handleForgot(server: Server, address: string): Promise<void> {
  const person = await server.people.byEmail(address);
  if (!person) return;
  // An address the account itself set after stage 32 and nobody confirmed gets no reset link:
  // whoever set it need not own the mailbox. (An address given at joining, or from before stage
  // 28, still gets one, and opening it confirms the address.)
  if (!mayReceiveReset(person)) return;
  if (!passwordWorks(person)) {
    await send(server, person.email, (from) =>
      noPasswordMail({
        from,
        loginUrl: linkTo(server, "/login"),
        ways: {
          google: person.identities.some((i) => i.provider === "google") && server.google !== null,
          passkey: person.passkeys.length > 0,
          passwordOff: person.passwordHash !== "" && person.passwordOff,
        },
      }),
    );
    return;
  }
  const code = newInviteCode();
  const hash = hashOf(code).toString("hex");
  await server.people.mutate((people) => ({
    people: people.map((p) =>
      p.id === person.id
        ? {
            ...p,
            resetCode: {
              codeHash: hash,
              createdAt: new Date().toISOString(),
              expiresAt: addMs(RESET_LINK_MINUTES * 60_000),
            },
          }
        : p,
    ),
    result: undefined,
  }));
  await send(server, person.email, (from) =>
    resetMail({ from, url: linkTo(server, `/reset/${code}`) }),
  );
}

async function send(
  server: Server,
  to: string,
  compose: (from: NonNullable<Server["mail"]["sender"]>) => ReturnType<typeof resetMail>,
): Promise<void> {
  try {
    await server.mail.send({ to, ...compose(server.mail.sender!) });
  } catch (err) {
    if (!(err instanceof MailError)) throw err;
  }
}

/** Whether a reset link is good right now (no change made). Dead links answer alike. */
export async function checkReset(server: Server, code: string): Promise<void> {
  const person = holder(await server.people.all(), code, "resetCode");
  if (
    !person?.resetCode ||
    Date.parse(person.resetCode.expiresAt) <= Date.now() ||
    !passwordWorks(person)
  ) {
    throw dead();
  }
}

/**
 * Uses a reset link: sets the password, confirms the address the link went to, and ends every
 * session of the account (this browser's too). Nobody is logged in by it.
 */
export function useResetCode(server: Server, code: string, passwordHash: string): Promise<void> {
  return server.people.mutate((people) => {
    const me = holder(people, code, "resetCode");
    if (!me?.resetCode || Date.parse(me.resetCode.expiresAt) <= Date.now() || !passwordWorks(me)) {
      throw dead();
    }
    const now = new Date().toISOString();
    const next: Person = {
      ...withoutPendingChange(me),
      passwordHash,
      resetCode: null,
      sessionEpoch: me.sessionEpoch + 1,
      // The link went to this address and was opened: it is the person's.
      emailConfirmedAt: me.emailConfirmedAt ?? confirmedOf(me)?.at ?? now,
      emailConfirmedBy: me.emailConfirmedBy ?? confirmedOf(me)?.by ?? "reset",
    };
    // The link made for the address itself is no longer needed (a change's link went with it).
    if (next.emailCode && emailKey(next.emailCode.address) === emailKey(next.email)) {
      next.emailCode = null;
    }
    return { people: people.map((p) => (p.id === me.id ? next : p)), result: undefined };
  });
}

/** Whether Google joining may displace this account's address (see `mayDisplace`); mail must be on. */
export const canDisplace = (server: Server, p: Person): boolean =>
  server.mail.enabled && mayDisplace(p);
