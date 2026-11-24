import { spawn } from "node:child_process";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { VaultPath } from "@frontier/schema";
import { normaliseLineEndings } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const HistoryQuery = z.object({ path: VaultPath.optional() });
const VersionQuery = z.object({ path: VaultPath, commit: z.string().regex(/^[0-9a-f]{7,64}$/) });

export function historyRoutes(app: FastifyInstance, s: Services): void {
  /** The saved versions of one file, or of the whole library, newest first. */
  app.get("/api/history", async (request) => {
    const { path } = HistoryQuery.parse(request.query);
    return { versions: await s.git.history(path) };
  });

  /** A note as it was at one version, and as it was just before, to show what that version did. */
  app.get("/api/history/version", async (request) => {
    const { path, commit } = VersionQuery.parse(request.query);
    const read = async (at: string) => {
      const bytes = await s.git.readFile(path, at).catch(() => null);
      return bytes ? normaliseLineEndings(bytes.toString("utf8")) : null;
    };
    const text = await read(commit);
    if (text === null) throw new ApiError("not_found", "This file is not part of that version.");
    return { text, before: await read(`${commit}^`) };
  });

  /** The library as it stands at the last saved version, as a zip that opens in Obsidian. */
  app.get("/api/export/library.zip", async (_request, reply) => {
    const child = spawn("git", ["archive", "--format=zip", "HEAD"], {
      cwd: join(s.config.dataDir, "vault"),
      stdio: ["ignore", "pipe", "ignore"],
    });
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="library-${day}.zip"`)
      .send(child.stdout);
  });
}
