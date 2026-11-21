import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const MapParam = z.object({ id: z.string().regex(/^[a-z0-9]{8}$/) });
const ItemParam = MapParam.extend({ d: z.string().regex(/^[a-z0-9]{12}$/) });
const Discover = z.object({
  at: z.tuple([z.number(), z.number()]),
  chronicle: z
    .string()
    .regex(/^[a-z0-9]{8}$/)
    .nullable()
    .default(null),
  year: z.number().nullable().default(null),
});
const Keep = z.object({ folder: z.string().min(1).max(300) });

export function discoverRoutes(app: FastifyInstance, s: Services): void {
  app.get("/api/maps/:id/discoveries", async (request) => {
    const { id } = MapParam.parse(request.params);
    // The folders a kept discovery can go to: those of the library's entries, appendices aside.
    const folders = [
      ...new Set(
        s.index
          .allNotes()
          .map((n) => n.path.split("/").slice(0, -1).join("/"))
          .filter((f) => f !== "" && !f.startsWith("99 Appendices") && !f.startsWith(".")),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const settings = await s.settings.read();
    return {
      discoveries: await s.discoverer.list(id),
      ready: await s.ai.ready("conversation"),
      art: Boolean(settings?.ai.models.art),
      folders,
    };
  });

  app.post("/api/maps/:id/discover", async (request) => {
    const { id } = MapParam.parse(request.params);
    const { at, chronicle, year } = Discover.parse(request.body);
    return { discoveries: await s.discoverer.discover(id, at, { chronicle, year }) };
  });

  app.post("/api/maps/:id/discoveries/:d/art", async (request) => {
    const { id, d } = ItemParam.parse(request.params);
    return { discovery: await s.discoverer.art(id, d) };
  });

  app.get("/api/maps/:id/discoveries/:d/art", async (request, reply) => {
    const { d } = ItemParam.parse(request.params);
    const bytes = await readFile(s.discoverer.artFile(d)).catch(() => null);
    if (!bytes) throw new ApiError("not_found", "This discovery has no picture.");
    return reply.type("image/png").header("cache-control", "private, max-age=3600").send(bytes);
  });

  app.post("/api/maps/:id/discoveries/:d/keep", async (request) => {
    const { id, d } = ItemParam.parse(request.params);
    const { folder } = Keep.parse(request.body);
    const kept = await s.discoverer.keep(id, d, folder);
    s.status.drafts(s.drafts.count(), 0);
    return kept;
  });

  app.delete("/api/maps/:id/discoveries/:d", async (request) => {
    const { id, d } = ItemParam.parse(request.params);
    await s.discoverer.remove(id, d);
    return { ok: true as const };
  });
}
