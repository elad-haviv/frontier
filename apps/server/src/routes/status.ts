import type { FastifyRequest } from "fastify";
import type { FastifyInstance } from "fastify";
import type { RouteApp } from "../projects/facade.js";
import { PUBLIC } from "../auth/openness.js";
import type { Server } from "../server.js";
import type { StatusService } from "../status/status.js";
import { PresenceRequest, type StatusSnapshot } from "@frontier/schema";
import { personOf } from "../auth/session.js";
import type { Services } from "../app.js";

/** What may name a device or tab: the shape `PUT /presence` accepts for `client`. */
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;

/** How often the status stream says it is still there. */
export const HEARTBEAT_MS = 20_000;

export function statusRoutes(app: RouteApp, s: Services): void {
  /**
   * The snapshot as this person gets it. The project's facts are everyone's; the unsaved changes,
   * conflicts and kept copies are the person's own (stage 31d), and what other people have in
   * progress and who is reading is for writers and owners. The notice about keys the server deleted
   * is for the server's owner, who can revoke them.
   */
  const snapshotFor = (request: FastifyRequest, status: StatusService): StatusSnapshot => {
    const snapshot = request.person ? status.snapshotFor(request.person.id) : status.snapshot();
    const shown = request.person?.admin
      ? snapshot
      : { ...snapshot, notices: { ...snapshot.notices, keysRemoved: null } };
    // A reader sees the saved library: none of the writers' unsaved changes, conflicts, inbox or
    // kept copies (stage 31c), nor who is working on what or reading (31d). The role is read live,
    // so a demotion shows on the next event.
    const live = request.project
      ? s.server.projects.roleOfSync(request.project.record.id, request.person?.id)
      : null;
    return (live ?? request.project?.role) === "reader"
      ? {
          ...shown,
          unpublished: 0,
          conflicts: 0,
          drafts: 0,
          serverDraftChanges: 0,
          inbox: { branches: 0, operations: 0, quarantined: 0 },
          attention: { ...shown.attention, keptCopies: 0 },
          othersUnsaved: [],
          presence: [],
        }
      : shown;
  };

  app.get("/api/status", async (request) => snapshotFor(request, s.status));

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
    const status = s.status;
    // What this stream sent last: an event that would say the same again is not sent, so a reader's
    // stream shows nothing of a writer's saves that change nothing it may know (stage 31d).
    let last = "";
    const send = () => {
      const data = JSON.stringify(snapshotFor(request, status));
      if (data === last) return;
      last = data;
      reply.raw.write(`event: status\ndata: ${data}\n\n`);
    };
    // Presence is told to nobody until this stream is the person's: whoever is here is reading.
    const who = request.person?.id;
    // The tab this stream belongs to, when it says (`?client=`, the name its announcements use), so
    // that closing it takes away only what that tab announced.
    const named = (request.query as { client?: unknown } | undefined)?.client;
    const client = typeof named === "string" && CLIENT.test(named) ? named : undefined;
    // Read now: a close handler runs outside this request's project (`projects/context.ts`).
    const presence = s.presence;
    if (who) presence.streamOpened(who, client);
    send();
    const stop = status.subscribe(send);
    const beat = setInterval(() => reply.raw.write(": heartbeat\n\n"), HEARTBEAT_MS);
    request.raw.on("close", () => {
      clearInterval(beat);
      stop();
      // Nobody is reading through a stream that ended; with their last one gone, they have left.
      if (who) presence.streamClosed(who, client);
    });
  });
}

/**
 * Who is reading what (stage 31d). The web app announces the entry it has open, and repeats it every
 * 25 seconds; the answer is delivered to writers and owners with the status. Nothing is stored, and
 * the project is the one in the address: presence never crosses projects.
 */
export function presenceRoutes(app: RouteApp, s: Services): void {
  app.put("/api/presence", async (request) => {
    const { path, client } = PresenceRequest.parse(request.body);
    // Only a published entry is announced: what a person reads of their own unsaved new entry, or
    // of a path that is nothing, tells others nothing and is dropped (as if they had none open).
    const shown = path !== null && s.index.hasFile(path) ? path : null;
    s.presence.announce(personOf(request).id, client, shown);
    return { ok: true as const };
  });

  /**
   * For a closing tab (`navigator.sendBeacon` posts): the device has left. A beacon sent as a plain
   * string arrives as `text/plain`, so a body that is text is read as JSON too.
   */
  app.post("/api/presence/leave", async (request) => {
    let body: unknown = request.body ?? {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const named = (body as { client?: unknown } | null)?.client;
    const client = typeof named === "string" && CLIENT.test(named) ? named : undefined;
    s.presence.leave(personOf(request).id, client);
    return { ok: true as const };
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
