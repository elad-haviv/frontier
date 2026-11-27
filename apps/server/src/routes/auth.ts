import type { FastifyInstance } from "fastify";
import {
  emailKey,
  LoginRequest,
  PasswordRequest,
  ProfileRequest,
  type EmailInfo,
  type MeResponse,
  type Person,
} from "@frontier/schema";
import { emailInfo } from "../mail/accounts.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  currentPerson,
  endOtherSessions,
  followEpoch,
  personOf,
  requireRecentLogin,
  startSession,
} from "../auth/session.js";
import { ApiError } from "../errors.js";
import { lastProjectSlug } from "../projects/guard.js";
import { PUBLIC } from "../auth/openness.js";
import type { Server } from "../server.js";

/** Said for a wrong email and a wrong password alike, so neither tells which was wrong. */
const WRONG = "Wrong email or password.";

/** Whether the account can log in with its password right now. */
export const passwordWorks = (p: Person): boolean => p.passwordHash !== "" && !p.passwordOff;

/** The Google account linked to an account, if any. */
export const googleOf = (p: Person) => p.identities.find((i) => i.provider === "google") ?? null;

/**
 * The ways an account has to log in: each passkey, the password when it works, and Google, which
 * counts only while the server offers it (a linked identity is no way in on a server without it).
 */
export const waysIn = (p: Person, googleOn: boolean): number =>
  p.passkeys.length + (passwordWorks(p) ? 1 : 0) + (googleOn ? p.identities.length : 0);

/**
 * The commit author's email as a suggestion for an account that has none. Not a stand-in address
 * and not a no-reply one (GitHub's): those are no one's email to log in with.
 */
export function suggestEmail(p: Person, authorEmail: string): string {
  const email = authorEmail.trim();
  if (p.email.trim() !== "" || email === "") return "";
  if (/@frontier\.invalid$/i.test(email) || /noreply/i.test(email)) return "";
  return email;
}

export function me(
  p: Person,
  method: "password" | "passkey" | "google",
  authorEmail = "",
  lastProject: string | null = null,
  googleAvailable = false,
  info: EmailInfo | undefined = undefined,
): MeResponse {
  const google = googleOf(p);
  return {
    suggestedEmail: suggestEmail(p, authorEmail),
    id: p.id,
    name: p.name,
    email: p.email,
    admin: p.admin,
    needsProfile: p.name.trim() === "" || p.email.trim() === "",
    passkeys: p.passkeys.map(({ id, name, addedAt }) => ({ id, name, addedAt })),
    passwordSet: p.passwordHash !== "",
    passwordOff: p.passwordOff,
    method,
    signingIn: {
      password: { set: p.passwordHash !== "", off: p.passwordOff },
      passkeys: p.passkeys.map(({ id, name, addedAt }) => ({ id, name, addedAt })),
      google: google ? { email: google.email ?? "", addedAt: google.addedAt } : null,
      googleAvailable,
    },
    lastProject,
    ...(info ? { emailInfo: info } : {}),
  };
}

/** A hash to check against when no account matches, so a wrong email takes as long as a wrong password. */
let decoy: Promise<string> | null = null;

export function authRoutes(app: FastifyInstance, s: Server): void {
  // 5 attempts per 15 minutes per network address, counted together with passkey logins.
  app.post("/api/login", { config: PUBLIC }, async (request) => {
    s.loginLimit.attempt(request.ip);
    const { email, password } = LoginRequest.parse(request.body);
    const people = await s.people.all();
    if (people.length === 0) {
      throw new ApiError(
        "unauthenticated",
        "No account has been made yet. Run the set-password command on the server.",
      );
    }
    // An empty email stands for the one account that has no email yet, so the owner who has not
    // given one is never locked out.
    const person =
      emailKey(email) === ""
        ? (() => {
            // An account whose address a Google sign-in took is not "the account with no email".
            const none = people.filter((p) => emailKey(p.email) === "" && !p.emailDisplaced);
            return none.length === 1 ? none[0]! : null;
          })()
        : (people.find((p) => emailKey(p.email) === emailKey(email)) ?? null);
    decoy ??= hashPassword("not the password of anyone");
    const right = await verifyPassword(
      person && person.passwordHash !== "" ? person.passwordHash : await decoy,
      password,
    );
    if (!person || !right || person.passwordHash === "")
      throw new ApiError("unauthenticated", WRONG);
    // Said only to someone who knows the password, so it does not tell a stranger the account exists.
    if (person.passwordOff) {
      throw new ApiError(
        "unauthenticated",
        "Logging in with the password is switched off. Use a passkey.",
      );
    }
    startSession(request, person, "password");
    return { ok: true as const };
  });

  app.post("/api/logout", async (request) => {
    request.session.delete();
    return { ok: true as const };
  });

  app.get("/api/session", { config: PUBLIC }, async (request) => {
    const people = await s.people.all();
    const person = await currentPerson(request, s.people);
    return {
      loggedIn: person !== null,
      person: person && {
        id: person.id,
        name: person.name,
        email: person.email,
        emailInfo: emailInfo(s, person),
      },
      // The project the person used last, as its address; null until they have used one (stage 31b).
      lastProject: person ? await lastProjectSlug(s, person) : null,
      // Exactly one account has no email: a blank email at login means that account. (Every new
      // account is given one, so this is only an owner from before emails were asked for.)
      emailless: people.filter((p) => emailKey(p.email) === "" && !p.emailDisplaced).length === 1,
      passkeys: people.some((p) => p.passkeys.length > 0),
      // Whether the server offers "Continue with Google"; the app hides the buttons when not.
      google: s.google !== null,
      // Whether this server sends mail (stage 32): "Forgot password", the banner, the invite field.
      mail: s.mail.enabled,
      // Before any account exists the form is shown, so the page says what is missing on use.
      password: people.length === 0 || people.some((p) => !p.passwordOff),
    };
  });

  app.get("/api/me", async (request) =>
    me(
      personOf(request),
      request.session.get("method") ?? "password",
      s.config.commitAuthor.email,
      await lastProjectSlug(s, personOf(request)),
      s.google !== null,
      emailInfo(s, personOf(request)),
    ),
  );

  app.put("/api/me", async (request) => {
    const { name, email } = ProfileRequest.parse(request.body);
    const before = personOf(request);
    const sameAddress = emailKey(email) === emailKey(before.email);
    // With mail on, no address is set or changed here, the first one of an account that has none
    // included: that goes through Change address, which asks for the password (or a recent login)
    // and sends a link to confirm the new address. A session cookie alone must not be able to put
    // an address on an account. Without mail every address is set at once, as before.
    if (!sameAddress && s.mail.enabled) {
      throw new ApiError(
        "use_change_address",
        "To set or change your email address, use Change address under Settings, Signing in.",
      );
    }
    const person = await s.people.update(before.id, (p) => ({
      ...p,
      name,
      // The same address in another case is the same address: it is saved as typed and keeps
      // whatever confirmation it had.
      email,
      ...(sameAddress
        ? {}
        : {
            emailConfirmedAt: null,
            emailConfirmedBy: null,
            emailCode: null,
            emailUsed: null,
            emailPending: null,
            resetCode: null,
            emailDisplaced: false,
            emailSetBySelf: true,
            emailLinkSentUntil: null,
          }),
    }));
    return me(
      person,
      request.session.get("method") ?? "password",
      s.config.commitAuthor.email,
      await lastProjectSlug(s, person),
      s.google !== null,
      emailInfo(s, person),
    );
  });

  // Unlinks Google. Like any change to how the account is logged into, it ends the other
  // sessions, and the last way to sign in cannot be removed (checked on the account as it is when
  // the change is made).
  app.delete("/api/me/google", async (request) => {
    const now = await s.people.update(personOf(request).id, (person) => {
      if (!googleOf(person)) throw new ApiError("not_found", "No Google account is linked.");
      const rest = {
        ...person,
        identities: person.identities.filter((i) => i.provider !== "google"),
      };
      // Taking away a link that cannot be used here anyway loses nothing.
      if (s.google !== null && waysIn(rest, true) < 1) {
        throw new ApiError(
          "not_allowed",
          "This is your only way to log in. Set a password or add a passkey first.",
        );
      }
      return endOtherSessions({
        ...person,
        identities: rest.identities,
      });
    });
    followEpoch(request, now);
    return { ok: true as const };
  });

  // Changes the password, or sets one for an account that has none. The one asked for is the
  // current password, so a stolen session alone cannot take the account over; with none to ask
  // for, a login from the last few minutes stands in for it. It guesses at the current password,
  // so it draws on the same allowance as logging in.
  app.put("/api/me/password", async (request) => {
    s.loginLimit.attempt(request.ip);
    const { current, password } = PasswordRequest.parse(request.body);
    const person = personOf(request);
    if (person.passwordHash !== "") {
      if (!current || !(await verifyPassword(person.passwordHash, current))) {
        throw new ApiError("invalid", "The current password is not right.");
      }
    } else {
      requireRecentLogin(request);
    }
    const passwordHash = await hashPassword(password);
    const now = await s.people.update(person.id, (p) =>
      endOtherSessions({
        ...p,
        passwordHash,
        // A password set for the first time works at once.
        passwordOff: p.passwordHash === "" ? false : p.passwordOff,
        // A reset link sent before is no longer needed, and must not be usable after this.
        resetCode: null,
      }),
    );
    // Every other device is logged out; this one stays in.
    followEpoch(request, now);
    return { ok: true as const };
  });
}
