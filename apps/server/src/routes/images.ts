import type { FastifyInstance } from "fastify";
import { ImageFromUrlRequest, ImageQuery } from "@frontier/schema";
import { isExcluded, isImage } from "@frontier/vault";
import sharp from "sharp";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";
import { ImageFetchError, nameFromUrl } from "../images/fromUrl.js";
import { cleanImageName, saveImage } from "../images/save.js";

/** The one answer to every failed fetch: what went wrong is for the server log, not the page. */
const FETCH_FAILED = "Frontier could not get an image from that address.";

export function imageRoutes(app: FastifyInstance, s: Services): void {
  /**
   * Every image of the library, with the entries that show or link it, and the images uploaded
   * but not yet published, marked.
   */
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
    const uploaded = s.drafts
      .list()
      .filter((d) => d.binary && d.kind === "create" && isImage(d.path) && !s.index.hasFile(d.path))
      .map((d) => ({ path: d.path, icon: false, usedBy: [], unpublished: true }))
      .sort((x, y) => x.path.localeCompare(y.path));
    return { images: [...images, ...uploaded] };
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
    const wanted = cleanImageName(file.filename);
    if (!isImage(wanted)) {
      throw new ApiError("invalid", "The file needs an image extension, such as .png or .jpg.");
    }
    return saveImage(s, wanted, content);
  });

  /**
   * Takes an image from a web address and keeps it as an upload. The server fetches it with the
   * safeguards in images/fromUrl.ts; at most ten a minute.
   */
  app.post(
    "/api/images/from-url",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          errorResponseBuilder: () =>
            new ApiError(
              "rate_limited",
              "Too many images from web addresses at once. Wait a minute and try again.",
            ),
        },
      },
    },
    async (request) => {
      const { url: address } = ImageFromUrlRequest.parse(request.body);
      let url: URL;
      try {
        url = new URL(address.trim());
      } catch {
        throw new ApiError("invalid", "That is not a web address.");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ApiError("invalid", "A web address starts with http:// or https://.");
      }
      try {
        const image = await s.imageFetcher.fetch(url.toString());
        const name = nameFromUrl(url, image.extension, cleanImageName);
        const saved = await saveImage(s, name, image.bytes);
        // The query is left out of the log: it can hold a key.
        request.log.info({ host: url.hostname, size: image.bytes.length, result: "saved" });
        return saved;
      } catch (err) {
        if (!(err instanceof ImageFetchError)) throw err;
        request.log.warn({ host: url.hostname, result: "refused", reason: err.reason });
        throw new ApiError("image_fetch_failed", FETCH_FAILED);
      }
    },
  );
}
