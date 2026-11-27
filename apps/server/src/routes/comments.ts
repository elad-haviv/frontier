import type { RouteApp } from "../projects/facade.js";
import { VaultPath } from "@frontier/schema";
import { isNote } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";
import { Previous, whileAsked } from "./writing.js";

const For = z.enum(["me", "ai"]);
const Words = z.string().trim().min(1).max(2000);

const New = z.object({
  path: VaultPath,
  quote: z
    .string()
    .max(6000)
    .refine((q) => q.replace(/\s/g, "").length >= 3, "A passage needs a few words."),
  prefix: z.string().max(200).default(""),
  suffix: z.string().max(200).default(""),
  text: Words,
  for: For,
});

const Change = z.object({ text: Words.optional(), for: For.optional() });
const Id = z.object({ id: z.string().regex(/^[a-z0-9]{12}$/) });
const PathQuery = z.object({ path: VaultPath });
const Work = z.object({
  before: z.string().max(1500).default(""),
  after: z.string().max(1500).default(""),
  previous: Previous,
});

export function commentRoutes(app: RouteApp, s: Services): void {
  app.get("/api/comments", async (request) => {
    const { path } = PathQuery.parse(request.query);
    return { comments: await s.comments.forPath(path) };
  });

  app.get("/api/comments/count", async (request) => {
    const { path } = PathQuery.parse(request.query);
    return { open: (await s.comments.forPath(path)).length };
  });

  app.post("/api/comments", async (request) => {
    const input = New.parse(request.body);
    if (!isNote(input.path)) throw new ApiError("invalid", "Only an entry can have comments.");
    return { comment: await s.comments.add(input) };
  });

  app.patch("/api/comments/:id", async (request) => {
    const { id } = Id.parse(request.params);
    return { comment: await s.comments.change(id, Change.parse(request.body)) };
  });

  app.delete("/api/comments/:id", async (request) => {
    const { id } = Id.parse(request.params);
    await s.comments.remove(id);
    return { ok: true as const };
  });

  /** The passage rewritten as a comment for the AI asks. Nothing is saved: the editor shows it. */
  app.post("/api/comments/:id/work", async (request, reply) => {
    const { id } = Id.parse(request.params);
    const { before, after, previous } = Work.parse(request.body);
    const comment = await s.comments.get(id);
    if (!comment) throw new ApiError("not_found", "That comment is not there any more.");
    if (comment.for !== "ai") {
      throw new ApiError("invalid", "This comment is for you, not for the AI.");
    }
    const held = s.quarantine.aiMayRead(comment.path);
    if (held !== null) throw new ApiError("not_allowed", held);
    const text = await s.writing.rewrite({
      path: comment.path,
      passage: comment.quote,
      before,
      after,
      how: `Do what this comment on the passage asks: ${comment.text}`,
      previous,
      signal: whileAsked(reply),
    });
    return { text };
  });
}
