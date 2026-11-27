import type { RouteApp } from "../projects/facade.js";
import { InsertPictureRequest, MakePictureRequest, type PicturesResponse } from "@frontier/schema";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const EntryQuery = z.object({ entry: z.string().min(1).max(1000) });
const TryParam = z.object({ id: z.string().regex(/^[a-z0-9]{12}$/) });
const Width = z.object({ w: z.coerce.number().int().min(16).max(4096).optional() });

/** Pictures made for entries (stage 29): see ai/pictures.ts. */
export function pictureRoutes(app: RouteApp, s: Services): void {
  app.get("/api/pictures", async (request): Promise<PicturesResponse> => {
    const { entry } = EntryQuery.parse(request.query);
    return s.pictures.status(entry);
  });

  // A picture costs a few cents and takes a while; a dozen a minute is far more than a person makes.
  app.post(
    "/api/pictures",
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
          errorResponseBuilder: () =>
            new ApiError("rate_limited", "Too many pictures at once. Wait a minute and try again."),
        },
      },
    },
    async (request) => ({ try: await s.pictures.make(MakePictureRequest.parse(request.body)) }),
  );

  app.get("/api/pictures/:id", async (request, reply) => {
    const { id } = TryParam.parse(request.params);
    const { w } = Width.parse(request.query);
    const shown = await s.images.serve(await s.pictures.bytes(id), w);
    return reply
      .header("content-type", shown.contentType)
      .header("cache-control", "private, max-age=3600")
      .send(shown.body);
  });

  app.post("/api/pictures/:id/insert", async (request) => {
    const { id } = TryParam.parse(request.params);
    const { name } = InsertPictureRequest.parse(request.body ?? {});
    return s.pictures.insert(id, name);
  });
}
