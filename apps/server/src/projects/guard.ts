import type { FastifyInstance, FastifyRequest } from "fastify";
import { type ProjectRecord, type ProjectRole, roleAtLeast } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";
import type { Server } from "../server.js";
import { decodedPath } from "../auth/openness.js";
import { PROJECT_PREFIX, type RouteBook } from "./facade.js";
import { roleFor } from "./roles.js";

/** What a project route's handler gets from the guard. */
export interface RequestProject {
  record: ProjectRecord;
  /** The person's role in it. */
  role: ProjectRole;
  services: Services;
  /** The old address the request used, when the project was renamed since. */
  movedFrom: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** The project a project route is for; null on routes that are not. Set by `guardProjects`. */
    project: RequestProject | null;
  }
}

/**
 * One answer for a project that is not there and a project the person is not in, so an address
 * cannot be used to find out which projects exist.
 */
const NO_PROJECT = "There is no project here that you can open.";

/**
 * The slug of a project route, from the parameter the router matched (it is decoded by the router,
 * as the path is), or null when the route is not a project's. Never from the raw address.
 */
export function slugOf(request: FastifyRequest): string | null {
  const routeUrl = request.routeOptions?.url;
  // An address under a project that matched no route: its slug is read from the decoded path, only
  // so that it is answered as any other address of that project is (never a way into anything: the
  // request matched no handler, and a person is already required).
  if (routeUrl === undefined) {
    const path = decodedPath(request.url);
    if (!path.startsWith("/api/p/")) return null;
    return path.slice("/api/p/".length).split("/")[0] || null;
  }
  if (!routeUrl.startsWith(`${PROJECT_PREFIX}/`)) return null;
  const slug = (request.params as { project?: unknown } | undefined)?.project;
  return typeof slug === "string" ? slug : null;
}

/**
 * A project the first admin has not claimed: the server made its first project before there was an
 * account (a server from before accounts, started once), so it has no members. The admin is its
 * owner, as they would have been had the account existed.
 */
async function claimOwnerless(server: Server, personId: string): Promise<void> {
  const all = await server.projects.all();
  for (const p of all) {
    if (p.members.some((m) => m.role === "owner")) continue;
    await server.projects.update(p.id, (now) => ({
      ...now,
      members: [
        ...now.members.filter((m) => m.personId !== personId),
        { personId, role: "owner", addedAt: new Date().toISOString() },
      ],
    }));
  }
}

/** Gives the server's admin the projects that have no owner. Cheap: reads what is in memory. */
export async function claimForAdmin(server: Server, person: { id: string; admin: boolean }) {
  if (!person.admin) return;
  const all = await server.projects.all();
  if (all.some((p) => !p.members.some((m) => m.role === "owner"))) {
    await claimOwnerless(server, person.id);
  }
}

/**
 * The person's last-used project, if they are still in it, else the first they are in: where a
 * request for devices still on the previous web build goes.
 */
export async function aliasProject(
  server: Server,
  person: { id: string; lastProject: string | null },
) {
  const mine = await server.projects.of(person.id);
  return mine.find((p) => p.id === person.lastProject) ?? mine[0] ?? null;
}

/**
 * Runs after the login check, for every project route: finds the project (by slug in the address,
 * or for the old unprefixed addresses the person's last-used one), refuses a person who is not in
 * it, refuses a role below what the route needs, and opens the project's services.
 */
export function guardProjects(app: FastifyInstance, server: Server, book: RouteBook): void {
  app.decorateRequest("project", null);
  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    const routeUrl = request.routeOptions?.url;
    const slug = slugOf(request);
    const aliased =
      slug === null && routeUrl !== undefined && book.aliases.has(`${request.method} ${routeUrl}`);
    if (slug === null && !aliased) return;
    // The login check runs first and sets the person; a project route that reaches here without
    // one is refused, never let through.
    const person = request.person;
    if (!person) throw new ApiError("unauthenticated", "Log in first.");

    await claimForAdmin(server, person);
    let record: ProjectRecord | null;
    let movedFrom: string | null = null;
    if (slug !== null) {
      const found = await server.projects.resolve(slug);
      record = found?.record ?? null;
      movedFrom = found?.movedFrom ?? null;
    } else {
      record = await aliasProject(server, person);
    }
    const member = record?.members.find((m) => m.personId === person.id);
    if (!record || !member) throw new ApiError("no_project", NO_PROJECT);

    // The route a request matched, as the table knows it: the path after `/api`.
    const pattern =
      routeUrl === undefined
        ? undefined
        : slug !== null
          ? routeUrl.slice(PROJECT_PREFIX.length)
          : routeUrl.slice("/api".length);
    const need = pattern === undefined ? undefined : roleFor(request.method, pattern);
    if (need && !roleAtLeast(member.role, need)) {
      throw new ApiError(
        "role_too_low",
        need === "owner"
          ? "Only an owner of this project can do this."
          : "You can read and comment here. You cannot change the text.",
      );
    }
    // A route that matched nothing goes on to the not-found answer; the project is not opened for it.
    if (routeUrl === undefined) return;
    // A route under a project that the table does not know is refused, never let through.
    if (need === undefined) {
      throw new ApiError(
        "not_allowed",
        "This route has no entry in the role table, so it is closed.",
      );
    }
    const services = await server.registry.open(record);
    request.project = { record, role: member.role, services, movedFrom };
    // Removing the person (or changing their role) cuts what they have open here, and the time
    // they were last here is kept, to within a few minutes.
    server.live.track(request, reply, record.id, person.id);
    server.projects.touchMember(record.id, person.id).catch((err: unknown) => {
      request.log.warn({ err }, "Could not note a member's last activity");
    });
  });
}

/** The address of the project the person used last, when they are still in it; null otherwise. */
export async function lastProjectSlug(
  server: Server,
  person: { id: string; lastProject: string | null },
): Promise<string | null> {
  if (!person.lastProject) return null;
  const mine = await server.projects.of(person.id);
  return mine.find((p) => p.id === person.lastProject)?.slug ?? null;
}
