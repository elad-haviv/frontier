import type { FastifyRequest } from "fastify";
import type { Person } from "@frontier/schema";
import { ApiError } from "../errors.js";
import { withoutPendingChange, type PeopleStore } from "../state/people.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Who the session belongs to. Set for every route that is not open; see `requirePerson`. */
    person: Person | null;
  }
}

/** How a person proved who they are, kept in the session for the rules that depend on it. */
export type Method = "password" | "passkey" | "google";

/** How recent a login must be for what could take an account over: a first password, a passkey. */
export const RECENT_LOGIN_MS = 5 * 60 * 1000;

/**
 * Starts a session for a person. The session holds their id, how they logged in, when, and the
 * epoch of their way in, and nothing else about them.
 */
export function startSession(request: FastifyRequest, person: Person, method: Method): void {
  request.session.set("user", person.id);
  request.session.set("method", method);
  request.session.set("epoch", person.sessionEpoch);
  request.session.set("loginAt", Date.now());
}

/**
 * Ends every other session of the account, for a change to how it is logged into. Use it inside
 * the people store's change, so the new epoch is written with the change itself. A change of
 * address that was waiting for its link is dropped with them (stage 28): whoever asked for it may
 * be exactly who was just logged out.
 */
export const endOtherSessions = (p: Person): Person => ({
  ...withoutPendingChange(p),
  sessionEpoch: p.sessionEpoch + 1,
});

/**
 * Keeps this device's session going after `endOtherSessions`: it takes the new epoch, and stays
 * logged in. The login time stays what it was, because this was not a login.
 */
export function followEpoch(request: FastifyRequest, person: Person): void {
  request.session.set("epoch", person.sessionEpoch);
}

/**
 * Refuses unless the person logged in within the last five minutes. A session cookie alone must
 * not be enough to add a way into the account that outlasts the cookie.
 */
export function requireRecentLogin(request: FastifyRequest): void {
  const at = request.session.get("loginAt") ?? 0;
  if (Date.now() - at > RECENT_LOGIN_MS) {
    throw new ApiError("recent_login_needed", "Log in again to do this.");
  }
}

/**
 * The person the session belongs to, or null. A session that names no account, such as the one
 * from before accounts existed, which said "author", is a session of nobody: the person logs in
 * again, and nothing breaks. So is a session whose epoch is not the account's any more: the
 * password or a passkey changed since, and every session from before it is over. A session made
 * before epochs existed has none, which counts as the first epoch.
 */
export async function currentPerson(
  request: FastifyRequest,
  people: PeopleStore,
): Promise<Person | null> {
  const id = request.session.get("user");
  const person = id ? await people.get(id) : null;
  if (!person || (request.session.get("epoch") ?? 0) !== person.sessionEpoch) return null;
  return person;
}

/**
 * The one way a route learns who is asking, and refuses when nobody is. The check before every
 * route that is not open runs it, so a handler that needs the person reads `personOf`.
 */
export async function requirePerson(request: FastifyRequest, people: PeopleStore): Promise<Person> {
  const person = await currentPerson(request, people);
  if (!person) throw new ApiError("unauthenticated", "Log in first.");
  request.person = person;
  return person;
}

/** The person of a request that passed the check; for use in a handler of a guarded route. */
export function personOf(request: FastifyRequest): Person {
  if (!request.person) throw new ApiError("unauthenticated", "Log in first.");
  return request.person;
}

/**
 * Who a saved version is by: the person's own name and email where they have them, and the
 * configured author for what they have not given.
 */
export function authorOf(
  person: Person,
  configured: { name: string; email: string },
): { name: string; email: string } {
  return {
    name: person.name.trim() || configured.name,
    email: person.email.trim() || configured.email,
  };
}
