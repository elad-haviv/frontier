import type { FastifyInstance } from "fastify";
import { Id, MapFile, mapPath, VaultPath, versionMark } from "@frontier/schema";
import { stem } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const IdParam = z.object({ id: z.string().regex(/^[a-z0-9]{8}$/) });
const Create = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["sphere", "flat"]),
  image: VaultPath,
});
const Save = z.object({
  map: MapFile,
  revision: z.number().int().min(0),
  link: z.array(z.object({ feature: z.string(), path: VaultPath })).default([]),
  /** The blob of the library file the device started from; absent from an older build. */
  baseBlob: z.string().optional(),
  op: Id.optional(),
});
const Resolve = z.object({ keep: z.enum(["mine", "theirs"]) });

export function mapRoutes(app: FastifyInstance, s: Services): void {
  const changed = () => s.status.drafts(s.drafts.count(), 0);

  app.get("/api/maps", async () => {
    const blobs = await s.git.blobs().catch(() => new Map<string, string>());
    return {
      maps: (await s.maps.list()).map(({ map, state, revision }) => ({
        id: map.id,
        title: map.title,
        space: map.space,
        under: map.under ?? null,
        features: map.features.length,
        state,
        // What a device holding this map compares, to know whether to read it again.
        v: versionMark(blobs.get(mapPath(map.id)), revision),
      })),
      problems: s.maps.problems,
    };
  });

  app.get("/api/maps/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    const loaded = await s.maps.open(id);
    if (!loaded) throw new ApiError("not_found", "There is no such map.");
    const entries: Record<string, { path: string; title: string }> = {};
    const children: Record<string, string> = {};
    for (const f of loaded.map.features) {
      if (f.entry && !(f.entry in entries)) {
        const path = await s.maps.entryPath(f.entry);
        if (path) entries[f.entry] = { path, title: stem(path) };
      }
      if (f.child && !(f.child in children)) {
        const child = await s.maps.get(f.child);
        if (child) children[f.child] = child.map.title;
      }
    }
    return { ...loaded, entries, children };
  });

  app.post("/api/maps", async (request) => {
    const id = await s.maps.create(Create.parse(request.body));
    changed();
    return { id };
  });

  app.put("/api/maps/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    const { map, revision, link, baseBlob, op } = Save.parse(request.body);
    const result = await s.maps.save(id, map, revision, link, { baseBlob, op });
    changed();
    return result;
  });

  app.post("/api/maps/:id/resolve", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.maps.resolve(id, Resolve.parse(request.body).keep);
    changed();
    return { ok: true as const };
  });

  app.delete("/api/maps/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.maps.remove(id);
    changed();
    return { ok: true as const };
  });

  app.get("/api/marker-sets", async () => ({ sets: s.maps.markerSets() }));
}
