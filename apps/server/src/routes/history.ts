import { spawn } from "node:child_process";
import type { RouteApp } from "../projects/facade.js";
import { type HistoryResponse, VaultPath } from "@frontier/schema";
import { Authors } from "../publish/authors.js";
import { normaliseLineEndings } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const HistoryQuery = z.object({ path: VaultPath.optional() });
const VersionQuery = z.object({ path: VaultPath, commit: z.string().regex(/^[0-9a-f]{7,64}$/) });

export function historyRoutes(app: RouteApp, s: Services): void {
  /** The saved versions of one file, or of the whole library, newest first. */
  app.get("/api/history", async (request): Promise<HistoryResponse> => {
    const { path } = HistoryQuery.parse(request.query);
    const authors = new Authors(s.server.people);
    const versions = await s.git.history(path);
    // Each version says who saved it: the person (by id and the name they have now) when it was
    // saved through the app, else the name Git has. Never an email.
    const by = new Map<string, Awaited<ReturnType<Authors["resolve"]>>>();
    const who = async (a: { name: string; email: string }) => {
      const key = `${a.name}\u0000${a.email}`;
      if (!by.has(key)) by.set(key, await authors.resolve(a));
      return by.get(key)!;
    };
    return {
      versions: await Promise.all(
        versions.map(async ({ author, ...v }) => ({ ...v, by: await who(author) })),
      ),
    };
  });

  /** A note as it was at one version, and as it was just before, to show what that version did. */
  app.get("/api/history/version", async (request) => {
    const { path, commit } = VersionQuery.parse(request.query);
    // Only a version of the published library: a commit of a branch nobody has kept yet is not
    // readable by its id, and so is not shown to a reader (or anyone).
    if (!(await s.git.isPublished(commit))) {
      throw new ApiError("not_found", "This file is not part of that version.");
    }
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
      cwd: s.paths.vault,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="library-${day}.zip"`)
      .send(child.stdout);
  });
}
