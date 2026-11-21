import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  CreateRenameRequest,
  DraftTextRequest,
  Id,
  makeId,
  PublishConfirmRequest,
  PublishPlanRequest,
  SaveDraftRequest,
  type UnpublishedResponse,
} from "@frontier/schema";
import { extension, isEditable, isExcluded, isNote } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const IdParam = z.object({ id: Id });

export function draftRoutes(app: FastifyInstance, s: Services): void {
  /** Refuses a draft for a path that may not be changed, and returns what is published there. */
  async function check(path: string, kind: "edit" | "create" | "delete") {
    if (extension(path) !== "md" || isExcluded(path)) {
      throw new ApiError(
        "invalid",
        "Only Markdown notes outside the settings folders can be edited here.",
      );
    }
    const published = s.index.note(path);
    const hasDraft = s.drafts.byPath(path) !== undefined;
    if (published) {
      if (!isEditable(path)) {
        throw new ApiError(
          "append_only",
          "Files under 99 Appendices are append-only and cannot be changed.",
        );
      }
      if (published.lineEnding === "mixed") {
        throw new ApiError(
          "read_only_file",
          "This file mixes two kinds of line endings. Fix that first.",
        );
      }
      if (kind === "create" && !hasDraft) {
        throw new ApiError("invalid", `"${path}" already exists.`);
      }
    } else if (kind !== "create" && !hasDraft) {
      throw new ApiError("not_found", `There is no note at "${path}".`);
    }
    return {
      blob: published ? ((await s.git.blobHash(path)) ?? "") : "",
      lineEnding: published?.lineEnding === "crlf" ? ("crlf" as const) : ("lf" as const),
    };
  }

  /** Maps are changed through the map routes, which keep them valid. */
  function onlyNotes(id: string): void {
    const draft = s.drafts.get(id);
    if (draft && !draft.binary && !isNote(draft.path)) {
      throw new ApiError("invalid", "This is not a note. Change it on its own page.");
    }
  }

  app.put("/api/drafts", async (request) => {
    const input = SaveDraftRequest.parse(request.body);
    const published = await check(input.path, input.kind);
    const record = await s.drafts.save(
      { ...input, text: input.kind === "delete" ? "" : input.text.replace(/\r\n/g, "\n") },
      published,
    );
    s.status.drafts(s.drafts.count(), 0);
    return { id: record.id, revision: record.revision };
  });

  app.delete("/api/drafts/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.drafts.discard(id);
    s.status.drafts(s.drafts.count(), 0);
    return { ok: true as const };
  });

  app.get("/api/drafts/:id/versions", async (request) => {
    const { id } = IdParam.parse(request.params);
    return s.drafts.versions(id);
  });

  app.post("/api/drafts/:id/merge-versions", async (request) => {
    const { id } = IdParam.parse(request.params);
    const { text } = DraftTextRequest.parse(request.body);
    onlyNotes(id);
    const record = await s.drafts.mergeVersions(id, text.replace(/\r\n/g, "\n"));
    return { id: record.id, revision: record.revision };
  });

  /** The author settled a conflict: his text now builds on what is on `main`. */
  app.post("/api/drafts/:id/resolve", async (request) => {
    const { id } = IdParam.parse(request.params);
    const { text } = DraftTextRequest.parse(request.body);
    const draft = s.drafts.get(id);
    if (!draft) throw new ApiError("not_found", "There is no such draft.");
    onlyNotes(id);
    const blob = (await s.git.blobHash(draft.path)) ?? "";
    const record = await s.drafts.rebase(id, text.replace(/\r\n/g, "\n"), blob, true);
    return { id: record.id, revision: record.revision };
  });

  app.get("/api/unpublished", async (): Promise<UnpublishedResponse> => {
    const drafts = await Promise.all(
      s.drafts.list().map(async (d) => ({
        id: d.id,
        path: d.path,
        kind: d.kind,
        binary: d.binary,
        text: d.binary ? "" : await s.drafts.text(d.id),
        // A map is not a note: its published text is read from the file in the vault.
        mainText: s.index.note(d.path)?.text ?? s.maps.publishedText(d.path),
        origins: d.origins,
      })),
    );
    const renames = [];
    for (const intent of s.drafts.listRenames()) {
      const affected = await s.publisher.previewRename(intent).catch(() => []);
      renames.push({ id: intent.id, from: intent.from, to: intent.to, affected });
    }
    await s.quarantine.prune();
    const decisions = s.quarantine.pendingDecisions().map((d) => ({
      id: d.id,
      path: d.path,
      decision: d.decision,
      ...(d.draftId ? { draftId: d.draftId } : {}),
    }));
    return { drafts, renames, decisions };
  });

  app.post("/api/publish/plan", async (request) => {
    const { draftIds, renameIds, decisionIds } = PublishPlanRequest.parse(request.body);
    return s.publisher.plan(draftIds, renameIds, decisionIds);
  });

  app.post("/api/publish/confirm", async (request) => {
    const { planId, confirmedMergeIds, message } = PublishConfirmRequest.parse(request.body);
    return { commit: await s.publisher.confirm(planId, confirmedMergeIds, message) };
  });

  app.post("/api/renames", async (request) => {
    const { from, to } = CreateRenameRequest.parse(request.body);
    const intent = { id: makeId(randomBytes), from, to, createdAt: new Date().toISOString() };
    const affected = await s.publisher.previewRename(intent);
    await s.drafts.addRename(intent);
    s.status.drafts(s.drafts.count(), 0);
    return { id: intent.id, affected };
  });

  app.delete("/api/renames/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.drafts.removeRename(id);
    s.status.drafts(s.drafts.count(), 0);
    return { ok: true as const };
  });
}
