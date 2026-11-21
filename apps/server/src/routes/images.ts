import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ImageQuery, makeId } from "@frontier/schema";
import { basename, isExcluded, isImage, nextFreeName } from "@frontier/vault";
import sharp from "sharp";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

export function imageRoutes(app: FastifyInstance, s: Services): void {
  app.get("/api/images", async (request, reply) => {
    const { path, w } = ImageQuery.parse(request.query);
    // Only files the index knows about are served, so a path can never leave the vault.
    if (!isImage(path) || isExcluded(path)) {
      throw new ApiError("not_found", `There is no image at "${path}".`);
    }
    // An image uploaded but not yet published is served from its draft.
    const draft = s.index.hasFile(path) ? undefined : s.drafts.byPath(path);
    if (!s.index.hasFile(path) && !draft?.binary) {
      throw new ApiError("not_found", `There is no image at "${path}".`);
    }
    const image = draft
      ? await s.images.serve(await s.drafts.bytes(draft.id), w)
      : await s.images.get(path, w);
    return reply
      .header("content-type", image.contentType)
      .header("cache-control", "private, max-age=3600")
      .send(image.body);
  });

  /**
   * Takes an uploaded image and keeps it as a draft, to be published with the entry that uses it.
   * The name is made unique across the whole vault, ignoring letter case.
   */
  app.post("/api/images", async (request) => {
    const file = await request.file();
    if (!file) throw new ApiError("invalid", "No file was sent.");
    const content = await file.toBuffer();
    try {
      await sharp(content).metadata();
    } catch {
      throw new ApiError("invalid", "This file is not an image Frontier can read.");
    }
    const wanted = basename(file.filename.replace(/\\/g, "/"))
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .trim();
    if (!isImage(wanted)) {
      throw new ApiError("invalid", "The file needs an image extension, such as .png or .jpg.");
    }
    const taken = [...s.index.files, ...s.drafts.list().map((d) => d.path)];
    const name = nextFreeName(wanted, taken);
    const path = `${s.config.uploadFolder}/${name}`;
    await s.drafts.saveBinary(makeId(randomBytes), path, content);
    s.status.drafts(s.drafts.count(), 0);
    return { path, embed: `![[${name}]]` };
  });
}
