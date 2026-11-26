import type { FastifyRequest } from "fastify";
import type { Person } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { PeopleStore } from "../state/people.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Who the session belongs to. Set for every route that is not open; see `requirePerson`. */
    person: Person | null;
  }
}

/** How a person proved who they are, kept in the session for the rules that depend on it. */
export type Method = "password" | "passkey";

/** Starts a session for a person. The session holds their id and nothing else about them. */
export function startSession(request: FastifyRequest, person: Person, method: Method): void {
  request.session.set("user", person.id);
  request.session.set("method", method);
}

/**
 * The person the session belongs to, or null. A session that names no account, such as the one
 * from before accounts existed, which said "author", is a session of nobody: the person logs in
 * again, and nothing breaks.
 */
export async function currentPerson(
  request: FastifyRequest,
  people: PeopleStore,
): Promise<Person | null> {
  const id = request.session.get("user");
  return id ? people.get(id) : null;
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
