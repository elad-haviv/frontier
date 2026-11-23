import type { FastifyInstance } from "fastify";
import { Id, ChronicleFile, VaultPath } from "@frontier/schema";
import { stem } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const IdParam = z.object({ id: z.string().regex(/^[a-z0-9]{8}$/) });
const Create = z
  .object({
    title: z.string().trim().max(120).optional(),
    copyOf: z
      .string()
      .regex(/^[a-z0-9]{8}$/)
      .optional(),
  })
  .refine((c) => c.copyOf !== undefined || (c.title ?? "") !== "", "A chronicle needs a title.");
const Save = z.object({
  chronicle: ChronicleFile,
  revision: z.number().int().min(0),
  link: z.array(z.object({ span: z.string(), path: VaultPath })).default([]),
  /** The blob of the library file the device started from; absent from an older build. */
  baseBlob: z.string().optional(),
  op: Id.optional(),
});
const Resolve = z.object({ keep: z.enum(["mine", "theirs"]) });

export function chronicleRoutes(app: FastifyInstance, s: Services): void {
  const changed = () => s.status.drafts(s.drafts.count(), 0);

  app.get("/api/chronicles", async () => ({
    chronicles: (await s.chronicles.list()).map(({ chronicle, state }) => ({
      id: chronicle.id,
      title: chronicle.title,
      main: chronicle.main,
      spans: chronicle.spans.length,
      state,
    })),
    problems: s.chronicles.problems,
  }));

  app.get("/api/chronicles/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    const loaded = await s.chronicles.open(id);
    if (!loaded) throw new ApiError("not_found", "There is no such chronicle.");
    const entries: Record<string, { path: string; title: string }> = {};
    for (const span of loaded.chronicle.spans) {
      if (span.entry && !(span.entry in entries)) {
        const path = await s.maps.entryPath(span.entry);
        if (path) entries[span.entry] = { path, title: stem(path) };
      }
    }
    return { ...loaded, entries };
  });

  app.post("/api/chronicles", async (request) => {
    const id = await s.chronicles.create(Create.parse(request.body));
    changed();
    return { id };
  });

  app.put("/api/chronicles/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    const { chronicle, revision, link, baseBlob, op } = Save.parse(request.body);
    const result = await s.chronicles.save(id, chronicle, revision, link, { baseBlob, op });
    changed();
    return result;
  });

  app.post("/api/chronicles/:id/main", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.chronicles.makeMain(id);
    changed();
    return { ok: true as const };
  });

  app.post("/api/chronicles/:id/resolve", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.chronicles.resolve(id, Resolve.parse(request.body).keep);
    changed();
    return { ok: true as const };
  });

  app.delete("/api/chronicles/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.chronicles.remove(id);
    changed();
    return { ok: true as const };
  });
}
