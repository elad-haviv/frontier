import type { FastifyInstance } from "fastify";
import {
  ArtSampleRequest,
  ArtStyle,
  ArtStyleChange,
  type ArtStylesResponse,
  NewArtStyleRequest,
} from "@frontier/schema";
import { z } from "zod";
import { personOf } from "../auth/session.js";
import { ApiError } from "../errors.js";
import type { Server } from "../server.js";

const StyleParam = z.object({ id: ArtStyle.shape.id });
const SampleParam = z.object({ token: z.string().regex(/^[a-z0-9]{12}$/) });

/** A person's library of art styles (stage 34): see ai/artStyles.ts. */
export function artStyleRoutes(app: FastifyInstance, s: Server): void {
  const me = (request: Parameters<typeof personOf>[0]) => personOf(request).id;

  app.get("/api/settings/art-styles", async (request): Promise<ArtStylesResponse> =>
    s.artStyles.library(me(request)),
  );

  app.post("/api/settings/art-styles", async (request) =>
    s.artStyles.add(me(request), NewArtStyleRequest.parse(request.body)),
  );

  app.post("/api/settings/art-styles/starters", async (request) =>
    s.artStyles.starters(me(request)),
  );

  // A sample is a picture: it costs a few cents and takes a while.
  app.post(
    "/api/settings/art-styles/sample",
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
          errorResponseBuilder: () =>
            new ApiError("rate_limited", "Too many samples at once. Wait a minute and try again."),
        },
      },
    },
    async (request) => {
      const { text } = ArtSampleRequest.parse(request.body);
      return s.artStyles.sample(me(request), text);
    },
  );

  app.get("/api/settings/art-styles/sample/:token", async (request, reply) => {
    const { token } = SampleParam.parse(request.params);
    const bytes = await s.artStyles.sampleBytes(me(request), token);
    return reply
      .header("content-type", "image/webp")
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(bytes);
  });

  app.put("/api/settings/art-styles/:id", async (request) => {
    const { id } = StyleParam.parse(request.params);
    return s.artStyles.edit(me(request), id, ArtStyleChange.parse(request.body));
  });

  app.delete("/api/settings/art-styles/:id", async (request) => {
    const { id } = StyleParam.parse(request.params);
    return s.artStyles.remove(me(request), id);
  });
}
