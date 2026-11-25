import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PLACES_PER_CALL, SPOT_KIND_IDS } from "../ai/discover.js";
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
/** A place to explore as the map page sends it: a point of interest, or a place clicked. */
const Spot = z.object({
  at: z.tuple([z.number(), z.number()]),
  kind: z.enum(SPOT_KIND_IDS),
  title: z.string().trim().min(1).max(200),
  lines: z.array(z.string().max(600)).max(14).default([]),
  features: z.array(z.string().max(40)).max(30).default([]),
});
const Moment = Discover.omit({ at: true });
/** The places of one call: up to six; `{ at }` alone, as before, is one place clicked. */
const Ask = Moment.extend({
  at: z.tuple([z.number(), z.number()]).optional(),
  spots: z.array(Spot).min(1).max(PLACES_PER_CALL).optional(),
}).refine((b) => b.spots || b.at, "Say which places to explore.");
const Estimate = Moment.extend({ spots: z.array(Spot).min(1).max(120) });
const Keep = z.object({ folder: z.string().min(1).max(300) });
const Generate = Discover.extend({
  kind: z.enum(["marker", "path", "zone", "label"]),
  count: z.number().int().min(1).max(5).default(1),
  prompt: z
    .string()
    .max(500)
    .nullable()
    .default(null)
    .transform((p) => p?.trim() || null),
  exclude: z.string().max(40).nullable().default(null),
  choices: z
    .array(z.object({ id: z.string().min(1).max(200), name: z.string().max(200) }))
    .max(200)
    .default([]),
});

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
    const { at, spots, chronicle, year } = Ask.parse(request.body);
    const places = spots ?? [
      { at: at!, kind: "here" as const, title: "This place", lines: [], features: [] },
    ];
    return { discoveries: await s.discoverer.discover(id, places, { chronicle, year }) };
  });

  // What asking about places would cost, before it is asked; nothing is sent to the AI.
  app.post("/api/maps/:id/discover/estimate", async (request) => {
    const { id } = MapParam.parse(request.params);
    const { spots, chronicle, year } = Estimate.parse(request.body);
    return await s.discoverer.estimate(id, spots, { chronicle, year });
  });

  // Names and descriptions for features the author fills in or places: proposals, not stored.
  app.post("/api/maps/:id/generate", async (request) => {
    const { id } = MapParam.parse(request.params);
    return { items: await s.discoverer.generate(id, Generate.parse(request.body)) };
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
