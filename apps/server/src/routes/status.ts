import type { FastifyInstance } from "fastify";
import type { Services } from "../app.js";

export function statusRoutes(app: FastifyInstance, s: Services): void {
  app.get("/api/status", async () => s.status.snapshot());

  app.get("/api/attention", async () => s.index.attention());

  /** Server-sent events: one `status` event now, and one after every change. */
  app.get("/api/status/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (snapshot: unknown) =>
      reply.raw.write(`event: status\ndata: ${JSON.stringify(snapshot)}\n\n`);
    send(s.status.snapshot());
    const stop = s.status.subscribe(send);
    request.raw.on("close", stop);
  });

  /** For Coolify's health check. Times and a commit hash; no vault content. */
  app.get("/health", async (_request, reply) => {
    const health = s.status.health();
    return reply.status(health.ok ? 200 : 503).send(health);
  });
}
