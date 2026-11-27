import type { RouteApp } from "../projects/facade.js";
import {
  LIBRARY_FILE_NAMES,
  type LibraryFileResponse,
  type ProjectRole,
  ResolveLibraryFileRequest,
  SaveLibraryFileRequest,
  TYPES,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import { z } from "zod";
import type { Services } from "../app.js";

const NameParam = z.object({ name: z.enum(LIBRARY_FILE_NAMES as [string, ...string[]]) });

/** The routes every library item file shares, by its name in the table. */
export function libraryFileRoutes(app: RouteApp, s: Services): void {
  const changed = () => s.status.drafts(s.drafts.count(), 0);

  app.get("/api/library-files/:name", async (request): Promise<LibraryFileResponse> => {
    const { name } = NameParam.parse(request.params);
    const { file, revision, blob } = s.libraryFiles.current(name);
    return { file, revision, blob };
  });

  /** Types and dates belong to the project: only an owner changes that file (stage 35). */
  const ownersOnly = (name: string, role: ProjectRole | undefined) => {
    if (name === TYPES.name && role !== "owner") {
      throw new ApiError(
        "role_too_low",
        "Only an owner of the project can change types and dates.",
      );
    }
  };

  app.put("/api/library-files/:name", async (request) => {
    const { name } = NameParam.parse(request.params);
    ownersOnly(name, request.project?.role);
    const { file, revision, baseBlob, op, clashes } = SaveLibraryFileRequest.parse(request.body);
    const result = await s.libraryFiles.save(name, file, revision, { baseBlob, op, clashes });
    changed();
    return result;
  });

  app.post("/api/library-files/:name/resolve", async (request) => {
    const { name } = NameParam.parse(request.params);
    ownersOnly(name, request.project?.role);
    await s.libraryFiles.resolve(name, ResolveLibraryFileRequest.parse(request.body).keep);
    changed();
    return { ok: true as const };
  });
}
