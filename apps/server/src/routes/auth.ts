import type { FastifyInstance } from "fastify";
import {
  emailKey,
  LoginRequest,
  PasswordRequest,
  ProfileRequest,
  type MeResponse,
  type Person,
} from "@frontier/schema";
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
import type { Services } from "../app.js";

/** Said for a wrong email and a wrong password alike, so neither tells which was wrong. */
const WRONG = "Wrong email or password.";

/** Whether the account can log in with its password right now. */
export const passwordWorks = (p: Person): boolean => p.passwordHash !== "" && !p.passwordOff;

/** The ways an account has to log in: each passkey, and the password when it works. */
export const waysIn = (p: Person): number => p.passkeys.length + (passwordWorks(p) ? 1 : 0);

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

export function me(p: Person, method: "password" | "passkey", authorEmail = ""): MeResponse {
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
  };
}

/** A hash to check against when no account matches, so a wrong email takes as long as a wrong password. */
let decoy: Promise<string> | null = null;

export function authRoutes(app: FastifyInstance, s: Services): void {
  // 5 attempts per 15 minutes per network address, counted together with passkey logins.
  app.post("/api/login", async (request) => {
    s.server.loginLimit.attempt(request.ip);
    const { email, password } = LoginRequest.parse(request.body);
    const people = await s.server.people.all();
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
            const none = people.filter((p) => emailKey(p.email) === "");
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

  app.get("/api/session", async (request) => {
    const people = await s.server.people.all();
    const person = await currentPerson(request, s.server.people);
    return {
      loggedIn: person !== null,
      person: person && { id: person.id, name: person.name, email: person.email },
      emailless: people.length === 1 && emailKey(people[0]!.email) === "",
      passkeys: people.some((p) => p.passkeys.length > 0),
      // Before any account exists the form is shown, so the page says what is missing on use.
      password: people.length === 0 || people.some((p) => !p.passwordOff),
    };
  });

  app.get("/api/me", async (request) =>
    me(personOf(request), request.session.get("method") ?? "password", s.config.commitAuthor.email),
  );

  app.put("/api/me", async (request) => {
    const { name, email } = ProfileRequest.parse(request.body);
    const person = await s.server.people.update(personOf(request).id, (p) => ({
      ...p,
      name,
      email,
    }));
    return me(person, request.session.get("method") ?? "password", s.config.commitAuthor.email);
  });

  // Changes the password, or sets one for an account that has none. The one asked for is the
  // current password, so a stolen session alone cannot take the account over; with none to ask
  // for, a login from the last few minutes stands in for it. It guesses at the current password,
  // so it draws on the same allowance as logging in.
  app.put("/api/me/password", async (request) => {
    s.server.loginLimit.attempt(request.ip);
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
    const now = await s.server.people.update(person.id, (p) =>
      endOtherSessions({
        ...p,
        passwordHash,
        // A password set for the first time works at once.
        passwordOff: p.passwordHash === "" ? false : p.passwordOff,
      }),
    );
    // Every other device is logged out; this one stays in.
    followEpoch(request, now);
    return { ok: true as const };
  });
}
