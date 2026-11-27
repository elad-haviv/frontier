import type { FastifyInstance, FastifyRequest } from "fastify";
import type { StatusSnapshot } from "@frontier/schema";
import type { Services } from "../app.js";

/** How often the status stream says it is still there. */
export const HEARTBEAT_MS = 20_000;

export function statusRoutes(app: FastifyInstance, s: Services): void {
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

  /** For Coolify's health check. Times and a commit hash; no vault content. */
  app.get("/health", async (_request, reply) => {
    const health = s.status.health();
    return reply.status(health.ok ? 200 : 503).send(health);
  });
}
