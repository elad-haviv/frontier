/**
 * Sign-on with Google (stage 27c), the two public routes of the authorization code flow.
 *
 * Google only says who someone is. What that means for an account is decided here, in this order,
 * and never by matching an email:
 *
 *   1. The Google subject is linked to an account: log in. With an invitation they land on its
 *      join page to accept (they are not joined by the sign-in itself).
 *   2. An invitation came with the flow and is still unused: make the account from Google's name
 *      and verified email, and join. The invitation is checked again here and used only on success.
 *   3. Someone logged in asked, from Settings, to link Google (and logged in recently): link it.
 *   4. Otherwise: nothing. `/login?problem=google_no_account`. An account is never made without
 *      an invitation, and an existing account is never taken over because the email matches.
 *
 * The browser's own request is bound by the signed session cookie: `state`, `nonce` and the PKCE
 * verifier live there, for ten minutes, and are used once. Every answer is a redirect to a page of
 * the app, with a `problem` the page can word; nothing sensitive goes in an address but the
 * invitation code the person already holds.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { emailKey, INVITE_CODE_PATTERN } from "@frontier/schema";
import { z } from "zod";
import { GoogleError, safeReturnTo, sameSecret } from "../auth/google.js";
import { PUBLIC } from "../auth/openness.js";
import {
  currentPerson,
  endOtherSessions,
  followEpoch,
  RECENT_LOGIN_MS,
  startSession,
} from "../auth/session.js";
import { ApiError } from "../errors.js";
import { joinAsNewPerson, liveInvite } from "../members/join.js";
import type { Server } from "../server.js";
import { googleOf } from "./auth.js";

const TEN_MINUTES = 10 * 60 * 1000;

const StartQuery = z.object({
  invite: z.string().max(200).optional(),
  returnTo: z.string().max(1000).optional(),
  link: z.enum(["1"]).optional(),
});
const CallbackQuery = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(500).optional(),
  error: z.string().max(200).optional(),
});

/** Problems the app words: the `problem` parameter of `/login`, `/join/<code>` and Settings. */
export type GoogleProblem =
  | "google_off"
  | "google_no_account"
  | "google_denied"
  | "google_failed"
  | "google_unverified"
  | "google_expired"
  | "google_taken"
  | "google_already_linked"
  | "account_exists"
  | "recent_login_needed";

export function googleRoutes(app: FastifyInstance, s: Server): void {
  /**
   * States already used, until they would have run out. The cookie holding a pending sign-in is
   * stateless, so an old copy of it could be replayed; this makes "once" true on the server.
   */
  const usedStates = new Map<string, number>();
  const spend = (state: string, until: number): boolean => {
    const now = Date.now();
    for (const [key, end] of usedStates) if (end < now) usedStates.delete(key);
    if (usedStates.has(state)) return false;
    usedStates.set(state, until);
    return true;
  };

  const go = (reply: FastifyReply, to: string) =>
    reply.header("cache-control", "no-store").code(302).header("location", to).send();
  const withProblem = (path: string, problem: GoogleProblem) =>
    `${path}${path.includes("?") ? "&" : "?"}problem=${problem}`;
  /** The join page of a code, for the problems that belong there. */
  const joinPage = (code: string, problem?: GoogleProblem) => {
    const path = `/join/${encodeURIComponent(code)}`;
    return problem ? withProblem(path, problem) : path;
  };
  const SETTINGS = "/settings/you/signing-in";

  app.get("/api/auth/google/start", { config: PUBLIC }, async (request, reply) => {
    s.joinLimit.attempt(request.ip);
    const query = StartQuery.safeParse(request.query);
    if (!s.google) return go(reply, withProblem("/login", "google_off"));
    if (!query.success) return go(reply, withProblem("/login", "google_failed"));
    const returnTo = safeReturnTo(query.data.returnTo);
    let invite: string | null = null;
    let link: string | null = null;

    if (query.data.link) {
      // Linking is for someone logged in, and, like adding a passkey, only soon after a login.
      const person = await currentPerson(request, s.people);
      if (!person) return go(reply, withProblem("/login", "google_no_account"));
      if (Date.now() - (request.session.get("loginAt") ?? 0) > RECENT_LOGIN_MS) {
        return go(reply, withProblem(SETTINGS, "recent_login_needed"));
      }
      link = person.id;
    } else if (query.data.invite !== undefined) {
      const code = query.data.invite;
      try {
        await liveInvite(s, code);
      } catch {
        // A link that does not work: the join page says why.
        return go(reply, INVITE_CODE_PATTERN.test(code) ? joinPage(code) : "/login");
      }
      invite = code;
    }

    let begun;
    try {
      begun = await s.google.begin();
    } catch (err) {
      request.log.error({ err }, "Google sign-on could not start");
      return go(reply, withProblem(invite ? joinPage(invite) : "/login", "google_failed"));
    }
    request.session.set("google", {
      state: begun.state,
      nonce: begun.nonce,
      verifier: begun.verifier,
      until: Date.now() + TEN_MINUTES,
      invite,
      returnTo,
      link,
    });
    return go(reply, begun.url);
  });

  app.get("/api/auth/google/callback", { config: PUBLIC }, async (request, reply) => {
    s.joinLimit.attempt(request.ip);
    // Taken out of the session at once: a state can be used only one time.
    const pending = request.session.get("google");
    request.session.set("google", undefined);
    const query = CallbackQuery.safeParse(request.query);
    const page = (problem: GoogleProblem, path?: string) =>
      go(
        reply,
        withProblem(path ?? (pending?.invite ? joinPage(pending.invite) : "/login"), problem),
      );

    if (!s.google) return page("google_off", "/login");
    if (!query.success || !pending) return page("google_expired", "/login");
    if (query.data.error) {
      return page(query.data.error === "access_denied" ? "google_denied" : "google_failed");
    }
    if (
      pending.until < Date.now() ||
      !query.data.state ||
      !sameSecret(query.data.state, pending.state) ||
      !query.data.code
    ) {
      return page("google_expired");
    }
    if (!spend(pending.state, pending.until)) return page("google_expired");

    let profile;
    try {
      profile = await s.google.complete(query.data.code, pending.verifier, pending.nonce);
    } catch (err) {
      if (err instanceof GoogleError) {
        // The reason is the server's to know: it is logged without the code or any token.
        request.log.warn({ reason: err.reason, detail: err.message }, "Google sign-on refused");
        return page(err.reason === "unverified" ? "google_unverified" : "google_failed");
      }
      request.log.error({ err }, "Google sign-on failed");
      return page("google_failed");
    }

    const linked = (await s.people.all()).find((p) =>
      p.identities.some((i) => i.provider === "google" && i.subject === profile.subject),
    );
    const identity = {
      provider: "google",
      subject: profile.subject,
      email: profile.email,
      addedAt: new Date().toISOString(),
    };
    const landing = pending.returnTo ?? "/";

    // 3 (checked first, since it starts from a session): linking from Settings.
    if (pending.link) {
      const me = await currentPerson(request, s.people);
      if (!me || me.id !== pending.link) return page("google_no_account", "/login");
      if (Date.now() - (request.session.get("loginAt") ?? 0) > RECENT_LOGIN_MS) {
        return page("recent_login_needed", SETTINGS);
      }
      if (linked && linked.id !== me.id) return page("google_taken", SETTINGS);
      if (googleOf(me)) return page("google_already_linked", SETTINGS);
      const now = await s.people.update(me.id, (p) =>
        endOtherSessions({
          ...p,
          identities: [...p.identities, identity],
          // Google verified an address that is the account's own: that counts as confirmed.
          ...(emailKey(p.email) !== "" && emailKey(p.email) === emailKey(profile.email)
            ? {
                emailConfirmedAt: p.emailConfirmedAt ?? new Date().toISOString(),
                emailConfirmedBy: p.emailConfirmedBy ?? ("google" as const),
              }
            : {}),
        }),
      );
      followEpoch(request, now);
      return go(reply, pending.returnTo ?? SETTINGS);
    }

    // 1: an account that already has this Google identity.
    if (linked) {
      // An account from before stage 28 whose address is the one Google verifies is confirmed by
      // Google; `confirmedOf` already reads it so, and this login writes it down.
      if (
        linked.emailConfirmedAt === null &&
        emailKey(linked.email) !== "" &&
        emailKey(linked.email) === emailKey(profile.email)
      ) {
        await s.people.update(linked.id, (p) => ({
          ...p,
          emailConfirmedAt: p.emailConfirmedAt ?? new Date().toISOString(),
          emailConfirmedBy: p.emailConfirmedBy ?? ("google" as const),
        }));
      }
      startSession(request, linked, "google");
      // With an invitation they are logged in but not joined: the join page asks them to accept,
      // as it does anyone else who has an account, so a link is never used without a click.
      if (pending.invite) return go(reply, joinPage(pending.invite));
      return go(reply, landing);
    }

    // 2: someone new, with an invitation that is still good.
    if (pending.invite) {
      const code = pending.invite;
      try {
        // Google verified the address: it counts as confirmed, and it wins over an account that
        // only typed it (see `joinAsNewPerson`).
        const joined = await joinAsNewPerson(
          s,
          code,
          { name: profile.name, email: profile.email, identities: [identity] },
          { google: true },
        );
        startSession(request, joined.person, "google");
        return go(reply, `/p/${encodeURIComponent(joined.project.slug)}`);
      } catch (err) {
        if (err instanceof ApiError && err.code === "account_exists") {
          // An account has this email but is not linked to this Google identity: the person logs
          // in the way that account allows and joins as that account. Nothing is linked by email.
          return go(reply, joinPage(code, "account_exists"));
        }
        if (err instanceof ApiError) return go(reply, joinPage(code));
        throw err;
      }
    }

    // 4: Google says who this is, and that is all it says.
    return page("google_no_account", "/login");
  });
}
