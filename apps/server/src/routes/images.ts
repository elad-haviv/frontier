import type { FastifyInstance } from "fastify";
import { ImageQuery } from "@frontier/schema";
import { isExcluded, isImage } from "@frontier/vault";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

export function imageRoutes(app: FastifyInstance, s: Services): void {
  app.get("/api/images", async (request, reply) => {
    const { path, w } = ImageQuery.parse(request.query);
    // Only files the index knows about are served, so a path can never leave the vault.
    if (!isImage(path) || isExcluded(path) || !s.index.hasFile(path)) {
      throw new ApiError("not_found", `There is no image at "${path}".`);
    }
    const image = await s.images.get(path, w);
    return reply
      .header("content-type", image.contentType)
      .header("cache-control", "private, max-age=3600")
      .send(image.body);
  });
}
