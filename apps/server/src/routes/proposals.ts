import type { FastifyInstance } from "fastify";
import {
  type FieldJobState,
  Id,
  kindsOf,
  OperationDecision,
  type TreesFile,
  VaultPath,
} from "@frontier/schema";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const FieldsRequest = z.object({ path: VaultPath });
const JobRequest = z.object({ folder: z.string(), confirm: z.boolean().optional() });
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

export function proposalRoutes(app: FastifyInstance, s: Services): void {
  app.post("/api/proposals/fields", async (request) => {
    const { path } = FieldsRequest.parse(request.body);
    try {
      return { made: await s.fields.propose(path) };
    } finally {
      s.status.ai(await s.ai.ready("extraction"), s.ai.lastError, await s.ai.ready("conversation"));
    }
  });

  app.post("/api/proposals/job", async (request) => {
    const { folder, confirm } = JobRequest.parse(request.body);
    const clean = folder.replace(/^\/+|\/+$/g, "");
    if (clean.split("/").includes(".."))
      throw new ApiError("invalid", "Not a folder of the vault.");
    const paths = s.fields.candidates(clean);
    if (!confirm) return { entries: paths.length, estimateUsd: await s.fields.estimate(paths) };
    if (!(await s.ai.ready("extraction"))) {
      throw new ApiError("ai_off", "Set a provider key and a model on the settings page first.");
    }
    s.fieldJob.start(clean);
    return { started: true as const };
  });

  app.get("/api/proposals/job", async (): Promise<FieldJobState> => s.fieldJob.snapshot());

  app.delete("/api/proposals/job", async () => {
    s.fieldJob.cancel();
    return { ok: true as const };
  });

  /** Accepts one or more relations of one entry's proposal (stage 31), in one change. */
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

  /** Takes back the last Accept of relations, if nothing has changed the entry since. */
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
