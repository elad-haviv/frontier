import type { FastifyInstance } from "fastify";
import { VaultPath } from "@frontier/schema";
import { isNote } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const Rewrite = z.object({
  path: VaultPath,
  passage: z.string().min(1).max(6000),
  before: z.string().max(1500).default(""),
  after: z.string().max(1500).default(""),
  how: z.string().trim().min(1).max(400),
});

export function writingRoutes(app: FastifyInstance, s: Services): void {
  /** A selected passage rewritten as asked. Nothing is saved: the editor puts it in the text. */
  app.post("/api/write/rewrite", async (request) => {
    const input = Rewrite.parse(request.body);
    if (!isNote(input.path)) throw new ApiError("invalid", "Only an entry can be rewritten.");
    // A note waiting in quarantine is never sent to the AI.
    const held = s.quarantine.aiMayRead(input.path);
    if (held !== null) throw new ApiError("not_allowed", held);
    return { text: await s.writing.rewrite(input) };
  });
}
