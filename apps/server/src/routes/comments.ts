import type { FastifyRequest } from "fastify";
import type { RouteApp } from "../projects/facade.js";
import { roleAtLeast, VaultPath } from "@frontier/schema";
import { isNote } from "@frontier/vault";
import { z } from "zod";
import { LoginLimiter } from "../auth/limit.js";
import { canDelete, canEdit, canHand, canResolve, canSee, type Who } from "../comments/rules.js";
import type { Comment } from "../comments/store.js";
import { ApiError } from "../errors.js";
import { displayName } from "../members/names.js";
import type { Services } from "../app.js";
import { Previous, whileAsked } from "./writing.js";

const For = z.enum(["me", "ai"]);
const Words = z.string().trim().min(1).max(2000);

const New = z.object({
  path: VaultPath,
  /** The passage; empty for a comment on the entry as a whole. */
  quote: z
    .string()
    .max(6000)
    .refine((q) => q === "" || q.replace(/\s/g, "").length >= 3, "A passage needs a few words."),
  prefix: z.string().max(200).default(""),
  suffix: z.string().max(200).default(""),
  text: Words,
  for: For.default("me"),
});

const Change = z.object({ text: Words.optional(), for: For.optional() });
const Id = z.object({ id: z.string().regex(/^[a-z0-9]{12}$/) });
const ReplyId = Id.extend({ rid: z.string().regex(/^[a-z0-9]{12}$/) });
const Reply = z.object({ text: Words });
const PathQuery = z.object({ path: VaultPath });
const Work = z.object({
  before: z.string().max(1500).default(""),
  after: z.string().max(1500).default(""),
  previous: Previous,
});

/** Words with the Markdown marks and the spacing taken out, to tell whether a passage is in a text. */
const plain = (t: string): string =>
  t
    .replace(/<\/?u>|[*_~`#>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Comments and replies written per minute by one person, however many projects. */
const WRITES_PER_MINUTE = 40;

export function commentRoutes(app: RouteApp, s: Services): void {
  const limit = new LoginLimiter(
    WRITES_PER_MINUTE,
    60_000,
    undefined,
    undefined,
    "Too many comments just now. Wait a minute and try again.",
  );

  /** The person and role of this request. */
  const who = (request: FastifyRequest): Who => {
    if (!request.person || !request.project) throw new ApiError("unauthenticated", "Log in first.");
    return { id: request.person.id, role: request.project.role };
  };

  /**
   * A name as it is shown: the person's own, or as it was written when they are gone, and never an
   * email except to an owner of the project, who may see the emails of members.
   */
  const named = (me: Who, id: string | undefined, kept: string | undefined) => {
    const person = id ? s.server.people.getSync(id) : null;
    return {
      id: id ?? "",
      name: person ? displayName(person, me.role === "owner") : kept?.trim() || "Someone",
      /** Their role now; null when they have left the project. */
      role: id ? s.server.projects.roleOfSync(s.project.id, id) : null,
    };
  };

  const shown = (c: Comment, me: Who) => ({
    id: c.id,
    path: c.path,
    quote: c.quote,
    prefix: c.prefix,
    suffix: c.suffix,
    text: c.text,
    for: c.for,
    at: c.at,
    editedAt: c.editedAt ?? null,
    author: named(me, c.person, c.name),
    resolved: c.resolved
      ? { by: named(me, c.resolved.person, c.resolved.name), at: c.resolved.at }
      : null,
    replies: c.replies.map((r) => ({
      id: r.id,
      text: r.text,
      at: r.at,
      editedAt: r.editedAt ?? null,
      author: named(me, r.person, r.name),
      can: { edit: canEdit(r, me), delete: canDelete(r, me) },
    })),
    can: {
      edit: canEdit(c, me),
      delete: canDelete(c, me),
      resolve: canResolve(c, me),
      hand: canHand(c, me),
    },
  });

  /** A comment the caller may see, or the same answer as for one that is not there. */
  async function visible(request: FastifyRequest, id: string): Promise<{ c: Comment; me: Who }> {
    const me = who(request);
    const c = await s.comments.get(id);
    if (!c || !canSee(c, me))
      throw new ApiError("not_found", "That comment is not there any more.");
    return { c, me };
  }

  const refuse = (what: string): never => {
    throw new ApiError("role_too_low", what);
  };

  app.get("/api/comments", async (request) => {
    const { path } = PathQuery.parse(request.query);
    const me = who(request);
    const list = (await s.comments.forPath(path)).filter((c) => canSee(c, me));
    return { comments: list.map((c) => shown(c, me)) };
  });

  app.get("/api/comments/count", async (request) => {
    const { path } = PathQuery.parse(request.query);
    const me = who(request);
    const list = (await s.comments.forPath(path)).filter((c) => canSee(c, me) && !c.resolved);
    return { open: list.length };
  });

  app.post("/api/comments", async (request) => {
    const me = who(request);
    const input = New.parse(request.body);
    if (!isNote(input.path)) throw new ApiError("invalid", "Only an entry can have comments.");
    if (input.for === "ai" && !roleAtLeast(me.role, "writer")) {
      refuse("Only a writer can leave a comment for the AI.");
    }
    if (input.for === "me") {
      // What others read must be what is saved: never text only someone's unsaved changes hold.
      const saved = s.index.note(input.path);
      if (!saved) {
        throw new ApiError(
          "invalid",
          "This entry is not saved yet. Save a version first, so the others can read your comment.",
        );
      }
      if (input.quote !== "" && !plain(saved.text).includes(plain(input.quote))) {
        throw new ApiError(
          "invalid",
          "That passage is not in the saved entry. Comment on saved text, or save your changes first.",
        );
      }
    }
    limit.attempt(me.id);
    const whole = input.quote === "";
    const comment = await s.comments.add({
      ...input,
      prefix: whole ? "" : input.prefix,
      suffix: whole ? "" : input.suffix,
    });
    return { comment: shown(comment, me) };
  });

  app.patch("/api/comments/:id", async (request) => {
    const { c, me } = await visible(request, Id.parse(request.params).id);
    const change = Change.parse(request.body);
    if (change.text !== undefined && !canEdit(c, me)) {
      refuse("You can edit only your own comments.");
    }
    if (change.for !== undefined && change.for !== c.for && !canHand(c, me)) {
      refuse("Only the writer of a comment can give it to the AI or take it back.");
    }
    const edited = change.text !== undefined && change.text !== c.text;
    const next = await s.comments.change(c.id, {
      text: edited ? change.text : undefined,
      for: change.for,
      edited,
    });
    return { comment: shown(next, me) };
  });

  app.delete("/api/comments/:id", async (request) => {
    const { c, me } = await visible(request, Id.parse(request.params).id);
    if (!canDelete(c, me)) refuse("You can delete only your own comments.");
    await s.comments.remove(c.id);
    return { ok: true as const };
  });

  app.post("/api/comments/:id/resolve", async (request) => {
    const { c, me } = await visible(request, Id.parse(request.params).id);
    if (!canResolve(c, me))
      refuse("Only the writer of a comment, a writer or an owner can resolve it.");
    return { comment: shown(await s.comments.resolve(c.id, true), me) };
  });

  app.post("/api/comments/:id/reopen", async (request) => {
    const { c, me } = await visible(request, Id.parse(request.params).id);
    if (!canResolve(c, me))
      refuse("Only the writer of a comment, a writer or an owner can reopen it.");
    return { comment: shown(await s.comments.resolve(c.id, false), me) };
  });

  app.post("/api/comments/:id/replies", async (request) => {
    const { c, me } = await visible(request, Id.parse(request.params).id);
    if (c.for === "ai") throw new ApiError("invalid", "A comment for the AI has no replies.");
    limit.attempt(me.id);
    const { text } = Reply.parse(request.body);
    return { comment: shown(await s.comments.addReply(c.id, text), me) };
  });

  app.patch("/api/comments/:id/replies/:rid", async (request) => {
    const { id, rid } = ReplyId.parse(request.params);
    const { c, me } = await visible(request, id);
    const reply = c.replies.find((r) => r.id === rid);
    if (!reply) throw new ApiError("not_found", "That reply is not there any more.");
    if (!canEdit(reply, me)) refuse("You can edit only your own replies.");
    const { text } = Reply.parse(request.body);
    const next = text === reply.text ? c : await s.comments.editReply(c.id, reply.id, text);
    return { comment: shown(next, me) };
  });

  app.delete("/api/comments/:id/replies/:rid", async (request) => {
    const { id, rid } = ReplyId.parse(request.params);
    const { c, me } = await visible(request, id);
    const reply = c.replies.find((r) => r.id === rid);
    if (!reply) throw new ApiError("not_found", "That reply is not there any more.");
    if (!canDelete(reply, me)) refuse("You can delete only your own replies.");
    return { comment: shown(await s.comments.removeReply(c.id, reply.id), me) };
  });

  /** The passage rewritten as a comment for the AI asks. Nothing is saved: the editor shows it. */
  app.post("/api/comments/:id/work", async (request, reply) => {
    const { id } = Id.parse(request.params);
    const { before, after, previous } = Work.parse(request.body);
    const { c: comment } = await visible(request, id);
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
