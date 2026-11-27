import type { FastifyRequest } from "fastify";
import type { FastifyInstance } from "fastify";
import type { RouteApp } from "../projects/facade.js";
import { PUBLIC } from "../auth/openness.js";
import type { Server } from "../server.js";
import type { StatusSnapshot } from "@frontier/schema";
import type { Services } from "../app.js";

/** How often the status stream says it is still there. */
export const HEARTBEAT_MS = 20_000;

export function statusRoutes(app: RouteApp, s: Services): void {
  /** The notice about keys the server deleted is for the server's owner, who can revoke them. */
  const forPersonOf = (request: FastifyRequest) => (snapshot: StatusSnapshot) =>
    request.person?.admin
      ? snapshot
      : { ...snapshot, notices: { ...snapshot.notices, keysRemoved: null } };

  app.get("/api/status", async (request) => forPersonOf(request)(s.status.snapshot()));

  app.get("/api/attention", async () => ({
    ...s.index.attention(),
    versions: s.drafts.keptList(),
  }));

  /**
   * Server-sent events: one `status` event now, and one after every change. A comment line every
   * 20 seconds lets the browser notice a dead connection, and keeps proxies from closing an idle one.
   */
  app.get("/api/status/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const mine = forPersonOf(request);
    const send = (snapshot: StatusSnapshot) =>
      reply.raw.write(`event: status\ndata: ${JSON.stringify(mine(snapshot))}\n\n`);
    send(s.status.snapshot());
    const stop = s.status.subscribe(send);
    const beat = setInterval(() => reply.raw.write(": heartbeat\n\n"), HEARTBEAT_MS);
    request.raw.on("close", () => {
      clearInterval(beat);
      stop();
    });
  });
}

/**
 * For Coolify's health check, which has no login: times and a commit hash of the first project's
 * library, no vault content.
 */
export function healthRoute(app: FastifyInstance, server: Server): void {
  app.get("/health", { config: PUBLIC }, async (_request, reply) => {
    const first = (await server.projects.all()).find((p) => p.layout === "legacy");
    if (!first) return reply.status(503).send({ ok: false });
    const health = (await server.registry.open(first)).status.health();
    return reply.status(health.ok ? 200 : 503).send(health);
  });
}
