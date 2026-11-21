/**
 * Serves vault images, resized on request and cached on disk by content hash and width.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export interface ServedImage {
  body: Buffer;
  contentType: string;
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  tiff: "image/tiff",
};

export class ImageServer {
  private readonly cacheDir: string;

  constructor(
    private readonly vaultDir: string,
    dataDir: string,
  ) {
    this.cacheDir = join(dataDir, "assets", "thumbs");
  }

  /**
   * Returns the image at a vault path. With a width, the image is scaled down to it; an image
   * already narrower is returned as it is. The real type is read from the file's content, since a
   * file's extension can be wrong.
   */
  async get(path: string, width?: number): Promise<ServedImage> {
    return this.serve(await readFile(join(this.vaultDir, path)), width);
  }

  /** The same for image bytes that are not in the vault yet, such as an unpublished upload. */
  async serve(original: Buffer, width?: number): Promise<ServedImage> {
    const meta = await sharp(original).metadata();
    const format = meta.format ?? "png";
    const contentType = TYPES[format] ?? "application/octet-stream";

    // Vector images and images that need no shrinking are sent as stored.
    if (width === undefined || format === "svg" || (meta.width ?? 0) <= width) {
      return { body: original, contentType };
    }

    const key = createHash("sha1").update(original).digest("hex");
    const cached = join(this.cacheDir, `${key}-${width}.${format}`);
    if (existsSync(cached)) return { body: await readFile(cached), contentType };

    const body = await sharp(original, { animated: format === "gif" })
      .resize({ width, withoutEnlargement: true })
      .toBuffer();
    await mkdir(this.cacheDir, { recursive: true });
    const temp = `${cached}.${process.pid}.tmp`;
    await writeFile(temp, body);
    await rename(temp, cached);
    return { body, contentType };
  }
}
