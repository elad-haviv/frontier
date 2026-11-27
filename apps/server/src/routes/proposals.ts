import type { FastifyInstance } from "fastify";
import { type FieldJobState, Id, OperationDecision, VaultPath } from "@frontier/schema";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const FieldsRequest = z.object({ path: VaultPath });
const JobRequest = z.object({ folder: z.string(), confirm: z.boolean().optional() });
const OperationParams = z.object({ id: Id, op: Id });

export function proposalRoutes(app: FastifyInstance, s: Services): void {
  app.post("/api/proposals/fields", async (request) => {
    const { path } = FieldsRequest.parse(request.body);
    return { made: await s.fields.propose(path) };
  });

  app.post("/api/proposals/job", async (request) => {
    const { folder, confirm } = JobRequest.parse(request.body);
    const clean = folder.replace(/^\/+|\/+$/g, "");
    if (clean.split("/").includes(".."))
      throw new ApiError("invalid", "Not a folder of the vault.");
    const paths = s.fields.candidates(clean);
    if (!confirm) return { entries: paths.length, estimateUsd: await s.fields.estimate(paths) };
    // Says now, before a run starts, if there is no model or no key on this device.
    await s.ai.assertCanRun("extraction", "proposing fields");
    s.fieldJob.start(clean);
    return { started: true as const };
  });

  app.get("/api/proposals/job", async (): Promise<FieldJobState> => s.fieldJob.snapshot());

  app.delete("/api/proposals/job", async () => {
    s.fieldJob.cancel();
    return { ok: true as const };
  });

  app.post("/api/proposals/:id/operations/:op", async (request) => {
    const { id, op } = OperationParams.parse(request.params);
    const { decision, ...edits } = OperationDecision.parse(request.body);
    return s.proposals.decide(id, op, decision, edits);
  });
}
