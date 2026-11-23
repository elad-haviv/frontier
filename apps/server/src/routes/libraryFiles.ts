import type { FastifyInstance } from "fastify";
import {
  LIBRARY_FILE_NAMES,
  type LibraryFileResponse,
  ResolveLibraryFileRequest,
  SaveLibraryFileRequest,
} from "@frontier/schema";
import { z } from "zod";
import type { Services } from "../app.js";

const NameParam = z.object({ name: z.enum(LIBRARY_FILE_NAMES as [string, ...string[]]) });

/** The routes every library item file shares, by its name in the table. */
export function libraryFileRoutes(app: FastifyInstance, s: Services): void {
  const changed = () => s.status.drafts(s.drafts.count(), 0);

  app.get("/api/library-files/:name", async (request): Promise<LibraryFileResponse> => {
    const { name } = NameParam.parse(request.params);
    const { file, revision, blob } = s.libraryFiles.current(name);
    return { file, revision, blob };
  });

  app.put("/api/library-files/:name", async (request) => {
    const { name } = NameParam.parse(request.params);
    const { file, revision, baseBlob, op } = SaveLibraryFileRequest.parse(request.body);
    const result = await s.libraryFiles.save(name, file, revision, { baseBlob, op });
    changed();
    return result;
  });

  app.post("/api/library-files/:name/resolve", async (request) => {
    const { name } = NameParam.parse(request.params);
    await s.libraryFiles.resolve(name, ResolveLibraryFileRequest.parse(request.body).keep);
    changed();
    return { ok: true as const };
  });
}
