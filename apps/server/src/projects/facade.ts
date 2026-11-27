import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProjectRole } from "@frontier/schema";
import { runWithProject } from "./context.js";
import { roleFor } from "./roles.js";
import { asSavedView } from "./view.js";

/** The part of Fastify the route files use. */
export type RouteApp = Pick<FastifyInstance, "get" | "post" | "put" | "patch" | "delete" | "log">;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One route of a project, as registered. */
export interface ProjectRoute {
  method: Method;
  /** The path after `/api`, as registered: `/entries`, `/maps/:id`. */
  pattern: string;
  role: ProjectRole;
}

/** The prefix every project route has; `:project` is the project's slug. */
export const PROJECT_PREFIX = "/api/p/:project";

/**
 * The register of what `projectApp` made, for the guard: by registered URL (prefixed, and the
 * unprefixed alias), the path after `/api`.
 */
export class RouteBook {
  readonly routes: ProjectRoute[] = [];
  /** `METHOD /api/entries` of the aliases for devices on the previous web build. */
  readonly aliases = new Map<string, string>();
}

/**
 * What the route files register on, in place of the Fastify app. A route written as
 * `app.get("/api/entries", handler)` is registered as `GET /api/p/:project/entries` and runs for
 * the project of the request; it needs an entry in the role table or the server does not start.
 *
 * It is registered a second time at its old address, `GET /api/entries`, for devices still on the
 * web build from before projects. That address works on the person's last-used project, or their
 * first. Kept for devices still on the previous web build and removed later: delete the second
 * registration below, and with it `aliasOf` in `guard.ts`.
 */
export function projectApp(
  app: FastifyInstance,
  book: RouteBook,
  { aliases = true }: { aliases?: boolean } = {},
): RouteApp {
  const make = (method: Method) => {
    return (url: string, ...rest: unknown[]) => {
      if (!url.startsWith("/api/")) throw new Error(`A project route starts with /api/: ${url}`);
      const pattern = url.slice("/api".length);
      const role = roleFor(method, pattern);
      if (!role) {
        throw new Error(
          `${method} ${pattern} has no entry in the role table (projects/roles.ts). Say which role it needs.`,
        );
      }
      book.routes.push({ method, pattern, role });
      if (aliases) book.aliases.set(`${method} ${url}`, pattern);
      const handler = rest[rest.length - 1] as (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => unknown;
      const wrapped = (request: FastifyRequest, reply: FastifyReply) => {
        const project = request.project;
        if (!project) throw new Error(`${method} ${url} ran without a project.`);
        // A reader sees the last saved version only, never anyone's unsaved changes (`view.ts`).
        const run = () => runWithProject(project.services, () => handler(request, reply));
        return project.role === "reader" ? asSavedView(run) : run();
      };
      const options = rest.length > 1 ? [rest[0]] : [];
      const lower = method.toLowerCase() as "get";
      for (const at of aliases
        ? [`${PROJECT_PREFIX}${pattern}`, url]
        : [`${PROJECT_PREFIX}${pattern}`]) {
        (app[lower] as (...args: unknown[]) => unknown)(at, ...options, wrapped);
      }
    };
  };
  return {
    get: make("GET"),
    post: make("POST"),
    put: make("PUT"),
    patch: make("PATCH"),
    delete: make("DELETE"),
    log: app.log,
  } as unknown as RouteApp;
}
