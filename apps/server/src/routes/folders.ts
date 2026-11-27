import type { RouteApp } from "../projects/facade.js";
import { ApplyTypeRequest, DeleteFolderRequest } from "@frontier/schema";
import type { Services } from "../app.js";

/** What acts on a whole folder at once. Its settings are saved through the library-file routes. */
export function folderRoutes(app: RouteApp, s: Services): void {
  const changed = () => s.status.drafts(s.drafts.count(), 0);

  app.post("/api/folders/delete", async (request) => {
    const { path, dryRun } = DeleteFolderRequest.parse(request.body);
    const counts = await s.folders.remove(path, dryRun);
    if (!dryRun) changed();
    return counts;
  });

  app.post("/api/folders/apply-type", async (request) => {
    const { path } = ApplyTypeRequest.parse(request.body);
    const result = await s.folders.applyType(path);
    changed();
    return result;
  });
}
