import type { RouteApp } from "../projects/facade.js";
import { Id, QuarantineDecision } from "@frontier/schema";
import { z } from "zod";
import type { Services } from "../app.js";

export function quarantineRoutes(app: RouteApp, s: Services): void {
  const report = () => {
    s.status.drafts(s.drafts.count(), 0);
    s.status.quarantine(s.quarantine.count(), [
      ...(s.quarantine.problem ? [s.quarantine.problem] : []),
      ...s.maps.problems.map((p) => `${p.path} is not shown as a map. ${p.message}`),
      ...s.chronicles.problems.map((p) => `${p.path} is not shown as a chronicle. ${p.message}`),
    ]);
  };

  app.post("/api/quarantine", async (request) => {
    const { path, commit, decision } = QuarantineDecision.parse(request.body);
    const made = await s.quarantine.decide(
      path,
      commit,
      decision === "accept" ? "accepted" : "reverted",
    );
    report();
    return { id: made.id, ...(made.draftId ? { draftId: made.draftId } : {}) };
  });

  app.delete("/api/quarantine/:id", async (request) => {
    const { id } = z.object({ id: Id }).parse(request.params);
    await s.quarantine.withdraw(id);
    report();
    return { ok: true as const };
  });
}
