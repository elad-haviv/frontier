import type { FastifyRequest } from "fastify";

/**
 * Whether a route needs no session is declared on the route: `config: PUBLIC`. Nothing decides it
 * from the address of a request, because the address a request carries is not the address the
 * router matched: Fastify decodes the path before it matches, so `/%61pi/projects/x` reaches the
 * handler of `/api/projects/x`. The rules below read what the router matched, never `request.url`.
 */
export const PUBLIC = { public: true } as const;

declare module "fastify" {
  interface FastifyContextConfig {
    /** True on a route that needs no session (login, the webhook, the health check). */
    public?: boolean;
  }
}

/** True when the matched route says it is open. */
export const isPublicRoute = (request: FastifyRequest): boolean =>
  request.routeOptions?.config?.public === true;

/** The path of a request as the router reads it: decoded, without the query. Never throws. */
export function decodedPath(url: string): string {
  const raw = url.split("?")[0] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const underApi = (path: string) => path === "/api" || path.startsWith("/api/");

/**
 * Whether a request is for the API: its matched route is under `/api`, or, when nothing matched,
 * its decoded path is. An unmatched request under `/api` is the API's too, and needs a session
 * before it is told there is nothing there.
 */
export function isApiRequest(request: FastifyRequest): boolean {
  const matched = request.routeOptions?.url;
  if (matched !== undefined) return underApi(matched);
  return underApi(decodedPath(request.url));
}
