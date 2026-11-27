import type { RouteApp } from "../projects/facade.js";
import { Id, kindsOf, OperationDecision, type TreesFile, VaultPath } from "@frontier/schema";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const FieldsRequest = z.object({ path: VaultPath });
const JobRequest = z.object({ folder: z.string() });
const OperationParams = z.object({ id: Id, op: Id });
const IdParams = z.object({ id: Id });
const RelationEdits = z
  .object({
    what: z.string().min(1).optional(),
    who: z.string().min(1).optional(),
    with: z.string().min(1).nullable().optional(),
    how: z.string().min(1).nullable().optional(),
    when: z.string().min(1).nullable().optional(),
    saveOn: VaultPath.optional(),
  })
  .optional();
const AcceptRelations = z.object({
  accept: z.array(z.object({ op: Id, edits: RelationEdits })).min(1),
});

export function proposalRoutes(app: RouteApp, s: Services): void {
  app.post("/api/proposals/fields", async (request) => {
    const { path } = FieldsRequest.parse(request.body);
    return { made: await s.fields.propose(path) };
  });

  /**
   * The entries of a folder that a run would read, and what it would cost. The server does not run
   * it: the browser asks for each entry in turn, with its key, while its page is open.
   */
  app.post("/api/proposals/job", async (request) => {
    const { folder } = JobRequest.parse(request.body);
    const clean = folder.replace(/^\/+|\/+$/g, "");
    if (clean.split("/").includes(".."))
      throw new ApiError("invalid", "Not a folder of the vault.");
    const paths = s.fields.candidates(clean);
    return { paths, entries: paths.length, estimateUsd: await s.fields.estimate(paths) };
  });

  /** Accepts one or more relations of one entry's proposal (stage 33), in one change. */
  app.post("/api/proposals/:id/relations", async (request) => {
    const { id } = IdParams.parse(request.params);
    const { accept } = AcceptRelations.parse(request.body);
    const kinds = () => kindsOf((s.libraryFiles.current("trees").file as TreesFile).kinds);
    const done = await s.proposals.acceptRelations(
      id,
      accept.map((a) => ({ op: a.op, ...(a.edits ? { edits: a.edits } : {}) })),
      kinds,
    );
    s.status.drafts(s.drafts.count(), 0);
    return done;
  });

  /** Takes back the person's last Accept of relations, if nothing has changed the entry since. */
  app.post("/api/proposals/undo", async () => {
    const done = await s.proposals.undoAccept();
    s.status.drafts(s.drafts.count(), 0);
    return done;
  });

  app.post("/api/proposals/:id/operations/:op", async (request) => {
    const { id, op } = OperationParams.parse(request.params);
    const { decision, ...edits } = OperationDecision.parse(request.body);
    return s.proposals.decide(id, op, decision, edits);
  });
}
