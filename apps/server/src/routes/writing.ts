import type { FastifyInstance, FastifyReply } from "fastify";
import { VaultPath } from "@frontier/schema";
import { isNote } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

/** Suggestions made before, so another one is different: a few, each about a passage long. */
export const Previous = z.array(z.string().max(8000)).max(5).optional();

const Rewrite = z.object({
  path: VaultPath,
  passage: z.string().min(1).max(6000),
  before: z.string().max(1500).default(""),
  after: z.string().max(1500).default(""),
  how: z.string().trim().min(1).max(400),
  previous: Previous,
  /** Change a suggestion further: the suggestion, and what to change in it. */
  refine: z
    .object({
      suggestion: z.string().min(1).max(8000),
      how: z.string().trim().min(1).max(400),
    })
    .optional(),
});

/**
 * A signal that aborts when the browser goes away before the answer is sent, as when the author
 * presses Stop, so the provider call stops too instead of running on for nobody.
 */
export function whileAsked(reply: FastifyReply): AbortSignal {
  const stop = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) stop.abort();
  });
  return stop.signal;
}

export function writingRoutes(app: FastifyInstance, s: Services): void {
  /** A selected passage rewritten as asked. Nothing is saved: the editor puts it in the text. */
  app.post("/api/write/rewrite", async (request, reply) => {
    const input = Rewrite.parse(request.body);
    if (!isNote(input.path)) throw new ApiError("invalid", "Only an entry can be rewritten.");
    // A note waiting in quarantine is never sent to the AI.
    const held = s.quarantine.aiMayRead(input.path);
    if (held !== null) throw new ApiError("not_allowed", held);
    return { text: await s.writing.rewrite({ ...input, signal: whileAsked(reply) }) };
  });
}
