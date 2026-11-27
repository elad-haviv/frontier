import type { FastifyInstance } from "fastify";
import { Id, OperationDecision, VaultPath } from "@frontier/schema";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const FieldsRequest = z.object({ path: VaultPath });
const JobRequest = z.object({ folder: z.string() });
const OperationParams = z.object({ id: Id, op: Id });

export function proposalRoutes(app: FastifyInstance, s: Services): void {
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

  app.post("/api/proposals/:id/operations/:op", async (request) => {
    const { id, op } = OperationParams.parse(request.params);
    const { decision, ...edits } = OperationDecision.parse(request.body);
    return s.proposals.decide(id, op, decision, edits);
  });
}
