import type { RouteApp } from "../projects/facade.js";
import { BranchDecision, BranchFileDecision, type InboxResponse } from "@frontier/schema";
import { z } from "zod";
import type { Services } from "../app.js";

const FileQuery = z.object({ branch: z.string(), path: z.string() });

export function inboxRoutes(app: RouteApp, s: Services): void {
  app.get("/api/inbox", async (): Promise<InboxResponse> => {
    // Opening the inbox looks for new branches. Without a connection it shows the last known ones.
    await s.sync().catch(() => undefined);
    return {
      branches: await s.branches.list(),
      proposals: await s.proposals.list(),
      quarantine: await s.quarantine.list(),
    };
  });

  app.get("/api/inbox/branch-file", async (request) => {
    const { branch, path } = FileQuery.parse(request.query);
    return s.branches.texts(branch, path);
  });

  app.post("/api/inbox/branch-file", async (request) => {
    const input = BranchFileDecision.parse(request.body);
    const result = await s.branches.decide(input.branch, input.path, input.blob, input.decision);
    s.status.drafts(s.drafts.count(), 0);
    s.status.inbox(await s.branches.count());
    return result;
  });

  app.post("/api/inbox/branch", async (request) => {
    const input = BranchDecision.parse(request.body);
    const result = await s.branches.decideBranch(input.branch, input.tip, input.decision);
    s.status.inbox(await s.branches.count());
    return result;
  });
}
