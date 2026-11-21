import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ImageQuery, makeId } from "@frontier/schema";
import { basename, isExcluded, isImage, nextFreeName } from "@frontier/vault";
import sharp from "sharp";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

export function imageRoutes(app: FastifyInstance, s: Services): void {
  /** Every image of the library, with the entries that show or link it. */
  app.get("/api/gallery", async () => {
    const usedBy = new Map<string, { path: string; title: string }[]>();
    for (const note of s.index.allNotes()) {
      const seen = new Set<string>();
      for (const { resolution } of note.links) {
        if (resolution.kind !== "file" || !isImage(resolution.path)) continue;
        if (seen.has(resolution.path)) continue;
        seen.add(resolution.path);
        const list = usedBy.get(resolution.path) ?? [];
        list.push({ path: note.path, title: note.title });
        usedBy.set(resolution.path, list);
      }
    }
    const icons = s.config.iconFolder + "/";
    const images = s.index.files
      .filter((f) => isImage(f) && !isExcluded(f))
      .sort((x, y) => x.localeCompare(y))
      .map((path) => ({
        path,
        icon: path.startsWith(icons),
        usedBy: (usedBy.get(path) ?? []).sort((x, y) => x.title.localeCompare(y.title)),
      }));
    return { images };
  });

  app.get("/api/images", async (request, reply) => {
    const { path, w, branch } = ImageQuery.parse(request.query);
    if (branch !== undefined) {
      const shown = await s.images.serve(await s.branches.image(branch, path), w);
      return reply
        .header("content-type", shown.contentType)
        .header("cache-control", "private, no-store")
        .send(shown.body);
    }
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
