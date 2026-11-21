/**
 * Bringing notes and media into the library: single files as unsaved changes, or a whole vault
 * as one saved version.
 */
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { makeId } from "@frontier/schema";
import {
  basename,
  detectLineEnding,
  isEditable,
  isExcluded,
  isImage,
  isNote,
  nextFreeName,
  normaliseLineEndings,
} from "@frontier/vault";
import sharp from "sharp";
import yauzl from "yauzl";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const MB = 1024 * 1024;

/** A file name without any folder and without characters a vault cannot hold. */
const clean = (name: string): string =>
  basename(name.replace(/\\/g, "/"))
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .trim();

/** Unpacks a zip into a folder, leaving out `.git` and anything that would land outside. */
function unzip(file: string, into: string): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new ApiError("invalid", "This file is not a zip."));
      const names: string[] = [];
      zip.on("error", () => reject(new ApiError("invalid", "This zip could not be read.")));
      zip.on("entry", (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, "/");
        const parts = name.split("/");
        const skip =
          name.endsWith("/") ||
          name.startsWith("/") ||
          parts.includes("..") ||
          parts.includes(".git");
        if (skip) return zip.readEntry();
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream)
            return reject(new ApiError("invalid", "This zip could not be read."));
          const target = join(into, name);
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => {
              names.push(name);
              zip.readEntry();
            }, reject);
        });
      });
      zip.on("end", () => resolve(names.length));
      zip.readEntry();
    });
  });
}

export function importRoutes(app: FastifyInstance, s: Services): void {
  /**
   * Takes notes and images and keeps them as unsaved changes. A note whose name is taken in the
   * folder is listed as a clash unless the author said to replace it or to keep both.
   */
  app.post("/api/import", async (request) => {
    let folder = "";
    let existing: "ask" | "replace" | "both" = "ask";
    const imported: { name: string; path: string; kind: "note" | "image" }[] = [];
    const clashes: { name: string; path: string }[] = [];
    const refused: { name: string; reason: string }[] = [];

    // Fields come before files in the form, so the folder is known when the first file arrives.
    for await (const part of request.parts({ limits: { fileSize: 25 * MB, files: 100 } })) {
      if (part.type === "field") {
        const value = String(part.value);
        if (part.fieldname === "folder") folder = value.replace(/^\/+|\/+$/g, "");
        if (part.fieldname === "existing" && ["ask", "replace", "both"].includes(value)) {
          existing = value as typeof existing;
        }
        continue;
      }
      const content = await part.toBuffer();
      const name = clean(part.filename);
      const refuse = (reason: string) => refused.push({ name: part.filename, reason });
      if (name === "") {
        refuse("It has no usable name.");
        continue;
      }

      if (isImage(name)) {
        try {
          await sharp(content).metadata();
        } catch {
          refuse("It is not an image Frontier can read.");
          continue;
        }
        const taken = [...s.index.files, ...s.drafts.list().map((d) => d.path)];
        const path = `${s.config.uploadFolder}/${nextFreeName(name, taken)}`;
        await s.drafts.saveBinary(makeId(randomBytes), path, content);
        imported.push({ name, path, kind: "image" });
        continue;
      }
      if (!isNote(name)) {
        refuse("Only Markdown notes and images can be imported one by one.");
        continue;
      }
      if (folder.split("/").includes("..") || isExcluded(`${folder}/x.md`)) {
        refuse("Notes cannot be imported into that folder.");
        continue;
      }
      let raw: string;
      try {
        raw = new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        refuse("It is not readable as text.");
        continue;
      }
      if (detectLineEnding(raw) === "mixed") raw = normaliseLineEndings(raw);
      const text = normaliseLineEndings(raw);
      const lineEnding = detectLineEnding(raw) === "crlf" ? ("crlf" as const) : ("lf" as const);
      let path = folder === "" ? name : `${folder}/${name}`;
      const published = s.index.note(path);
      const draft = s.drafts.byPath(path);

      if (published || draft) {
        if (existing === "ask") {
          clashes.push({ name, path });
          continue;
        }
        if (existing === "both") {
          const inFolder = [...s.index.files, ...s.drafts.list().map((d) => d.path)]
            .filter((p) => (folder === "" ? !p.includes("/") : p.startsWith(folder + "/")))
            .map((p) => basename(p));
          const free = nextFreeName(name, inFolder);
          path = folder === "" ? free : `${folder}/${free}`;
        } else if (draft) {
          refuse("It has unsaved changes here already. Save or discard those first.");
          continue;
        } else if (!isEditable(path) || published?.lineEnding === "mixed") {
          refuse("The note of this name cannot be changed.");
          continue;
        } else {
          // Replacing: an edit of the existing note, so the difference can be read before saving.
          await s.drafts.saveFrom({
            id: makeId(randomBytes),
            path,
            kind: "edit",
            content: text,
            baseBlob: (await s.git.blobHash(path)) ?? "",
            lineEnding: published!.lineEnding === "crlf" ? "crlf" : "lf",
          });
          imported.push({ name, path, kind: "note" });
          continue;
        }
      }
      await s.drafts.saveFrom({
        id: makeId(randomBytes),
        path,
        kind: "create",
        content: text,
        baseBlob: "",
        lineEnding,
      });
      imported.push({ name, path, kind: "note" });
    }
    s.status.drafts(s.drafts.count(), 0);
    return { imported, clashes, refused };
  });

  /**
   * Takes a zip of a vault and saves its files as one version. Files that exist are replaced,
   * new ones are added, and nothing is removed.
   */
  app.post("/api/import/vault", async (request) => {
    const scratch = await mkdtemp(join(tmpdir(), "frontier-import-"));
    try {
      let message = "";
      let got = false;
      const zipFile = join(scratch, "upload.zip");
      for await (const part of request.parts({ limits: { fileSize: 1024 * MB, files: 1 } })) {
        if (part.type === "field") {
          if (part.fieldname === "message") message = String(part.value).trim();
          continue;
        }
        await pipeline(part.file, createWriteStream(zipFile));
        if (part.file.truncated) throw new ApiError("invalid", "The zip is larger than 1 GB.");
        got = true;
      }
      if (!got) throw new ApiError("invalid", "No zip was sent.");
      const folder = join(scratch, "files");
      await mkdir(folder);
      if ((await unzip(zipFile, folder)) === 0) {
        throw new ApiError("invalid", "The zip holds no files.");
      }
      // A download from GitHub wraps everything in one folder; that folder is not part of the vault.
      const { readdir, stat } = await import("node:fs/promises");
      let root = folder;
      const top = await readdir(folder);
      if (top.length === 1 && (await stat(join(folder, top[0]!))).isDirectory()) {
        root = join(folder, top[0]!);
      }
      let made;
      try {
        made = await s.git.commitFolder(root, message || "Import a vault");
      } catch (err) {
        throw new ApiError("invalid", err instanceof Error ? err.message : "Nothing was imported.");
      }
      await s.git.push(made.commit);
      await s.sync();
      return made;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
