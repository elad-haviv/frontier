/**
 * Email (stage 28): confirming an address, changing it, and forgotten passwords.
 *
 * Public routes (`confirm`, `forgot-password`, `reset`) answer alike for every link that does not
 * work and for every address, count against the per-address allowance of the other public routes,
 * and never start or change a session: opening a link while logged in as someone else changes
 * the account the link belongs to and nothing about who is logged in.
 */
import type { FastifyInstance } from "fastify";
import {
  ChangeEmailRequest,
  emailKey,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  type ConfirmResponse,
  type EmailChangeResponse,
} from "@frontier/schema";
import { z } from "zod";
import { PUBLIC } from "../auth/openness.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { currentPerson, personOf, requireRecentLogin } from "../auth/session.js";
import { ApiError } from "../errors.js";
import {
  checkReset,
  handleForgot,
  noteAddressChanged,
  passwordWorks,
  sendConfirm,
  useConfirmCode,
  useResetCode,
} from "../mail/accounts.js";
import { mailable, recipientKey } from "../mail/mailer.js";
import { confirmedOf, withoutPendingChange } from "../state/people.js";
import type { Server } from "../server.js";

const CodeParam = z.object({ code: z.string().max(200) });

const mailOff = () => new ApiError("mail_off", "This server cannot send email.");
const badAddress = () => new ApiError("invalid", "That doesn't look like an email address.");

export function emailRoutes(app: FastifyInstance, s: Server): void {
  /**
   * Asks to change the address. The current password is needed (or, for an account whose password
   * does not work, a login from the last five minutes). With mail on the new address must be
   * confirmed first and the old one stays in force until then, and is told; with no mail, or for
   * an account that has no address yet, it applies at once, as before.
   */
  app.post("/api/me/email", async (request): Promise<EmailChangeResponse> => {
    // It guesses at the current password, so it draws on the same allowance as logging in.
    s.loginLimit.attempt(request.ip);
    const { email, password } = ChangeEmailRequest.parse(request.body);
    const person = personOf(request);
    if (passwordWorks(person)) {
      if (!password || !(await verifyPassword(person.passwordHash, password))) {
        throw new ApiError("invalid", "The current password is not right.");
      }
    } else {
      requireRecentLogin(request);
    }
    if (emailKey(email) === emailKey(person.email)) {
      throw new ApiError("invalid", "That is already your address.");
    }
    if (s.mail.enabled && !mailable(email)) throw badAddress();
    if (await s.people.byEmail(email)) {
      throw new ApiError("email_taken", "Another account already uses this email.");
    }
    const applyNow = !s.mail.enabled || person.email.trim() === "";
    if (applyNow) {
      await s.people.update(person.id, (p) => ({
        ...p,
        email,
        emailConfirmedAt: null,
        emailConfirmedBy: null,
        emailCode: null,
        emailUsed: null,
        emailPending: null,
        resetCode: null,
        emailDisplaced: false,
        // Set by the account itself: no reset link goes to it until it is confirmed.
        emailSetBySelf: true,
        emailLinkSentUntil: null,
      }));
      if (!s.mail.enabled) return { ok: true, applied: true, mail: "off" };
      const mail = await sendConfirm(s, person.id, email, { pending: false });
      return { ok: true, applied: true, mail: mail === "sent" ? "sent" : "failed" };
    }
    // Asking again for the change that already waits does not tell the old address again.
    const again =
      person.emailPending !== null && emailKey(person.emailPending.address) === emailKey(email);
    const mail = await sendConfirm(s, person.id, email, { pending: true });
    // The old address is told that a change was asked for.
    if (!again) noteAddressChanged(s, "asked", person.email, email);
    return { ok: true, applied: false, mail: mail === "sent" ? "sent" : "failed" };
  });

  /** Cancels a change of address that waits for its link. */
  app.delete("/api/me/email/pending", async (request): Promise<{ ok: true }> => {
    const id = personOf(request).id;
    await s.people.mutate((people) => {
      const me = people.find((p) => p.id === id);
      if (!me?.emailPending) throw new ApiError("not_found", "No change of address is waiting.");
      const next = withoutPendingChange(me);
      return { people: people.map((p) => (p.id === id ? next : p)), result: undefined };
    });
    return { ok: true };
  });

  /** Sends the confirm link again (to the new address while a change waits), replacing the old link. */
  app.post("/api/me/email/resend", async (request): Promise<EmailChangeResponse> => {
    if (!s.mail.enabled) throw mailOff();
    const person = personOf(request);
    const pending = person.emailPending;
    if (!pending && person.email.trim() === "") {
      throw new ApiError("invalid", "Add an email address first.");
    }
    if (!pending && confirmedOf(person)) {
      throw new ApiError("already_confirmed", "Your email address is already confirmed.");
    }
    s.resendLimit.attempt(person.id);
    const mail = await sendConfirm(s, person.id, pending?.address ?? person.email, {
      pending: pending !== null,
      resend: true,
    });
    return { ok: true, applied: false, mail: mail === "sent" ? "sent" : "failed" };
  });

  /**
   * Opens a confirm link. The page calls this when it loads (the link in the email is the page's,
   * so a mail program that fetches it does not use the link up).
   */
  app.post(
    "/api/confirm/:code",
    { config: PUBLIC },
    async (request, reply): Promise<ConfirmResponse> => {
      s.joinLimit.attempt(request.ip);
      reply.header("cache-control", "no-store");
      const { code } = CodeParam.parse(request.params);
      const done = await useConfirmCode(s, code);
      if (done.status === "changed") {
        noteAddressChanged(s, "done", done.oldAddress, done.person.email);
      }
      const me = await currentPerson(request, s.people);
      return { ok: true, status: done.status, you: me?.id === done.person.id };
    },
  );

  /**
   * Forgot password. The answer is the same for every address and comes before any lookup: what
   * is done (a reset link, an explanatory email, or nothing) is done after it, so the time it takes
   * says nothing either.
   */
  app.post("/api/forgot-password", { config: PUBLIC }, async (request): Promise<{ ok: true }> => {
    if (!s.mail.enabled) throw mailOff();
    s.forgotIpLimit.attempt(request.ip);
    const { email } = ForgotPasswordRequest.parse(request.body);
    // Counted for every address alike, whether or not it has an account, and for a mailbox once
    // whatever +tag is put in it.
    s.forgotAddressLimit.attempt(recipientKey(email));
    s.mail.background(() => handleForgot(s, email));
    return { ok: true };
  });

  /** Whether a reset link is good (nothing changes). */
  app.get("/api/reset/:code", { config: PUBLIC }, async (request, reply): Promise<{ ok: true }> => {
    s.joinLimit.attempt(request.ip);
    reply.header("cache-control", "no-store");
    await checkReset(s, CodeParam.parse(request.params).code);
    return { ok: true };
  });

  /** Sets the new password. Ends every session of the account, confirms the address, logs nobody in. */
  app.post(
    "/api/reset/:code",
    { config: PUBLIC },
    async (request, reply): Promise<{ ok: true }> => {
      s.joinLimit.attempt(request.ip);
      reply.header("cache-control", "no-store");
      const { code } = CodeParam.parse(request.params);
      const { password } = ResetPasswordRequest.parse(request.body);
      // A dead link is told so before the password is hashed.
      await checkReset(s, code);
      await useResetCode(s, code, await hashPassword(password));
      return { ok: true };
    },
  );

  // Tests read the mail the memory transport collected. The route exists only on a server
  // configured with MAIL_TEST_TRANSPORT, which the configuration refuses in production.
  const outbox = s.mail.outbox;
  if (outbox) {
    app.get("/api/test/mail", { config: PUBLIC }, async () => {
      await s.mail.settled();
      return { messages: outbox.messages };
    });
    app.delete("/api/test/mail", { config: PUBLIC }, async () => {
      await s.mail.settled();
      outbox.messages.length = 0;
      return { ok: true };
    });
  }
}
