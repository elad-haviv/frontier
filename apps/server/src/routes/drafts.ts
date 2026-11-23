import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CreateRenameRequest,
  type CreateRenameResponse,
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
import { type Device, UNKNOWN_DEVICE } from "../state/drafts.js";
import type { Services } from "../app.js";

const IdParam = z.object({ id: Id });

/** How long a device's name may be, in characters. */
const NAME_LENGTH = 40;

/**
 * The device a save comes from, from its `Frontier-Device` and `Frontier-Device-Name` headers. The
 * id names a file, so only Frontier's id format is accepted; a save without one, as from an older
 * build, comes from device `unknown`. The name is sent URI-encoded.
 */
export function deviceOf(request: FastifyRequest): Device {
  const id = request.headers["frontier-device"];
  if (id === undefined) return UNKNOWN_DEVICE;
  if (typeof id !== "string" || !Id.safeParse(id).success) {
    throw new ApiError("invalid", "The Frontier-Device header is not a device id.");
  }
  const raw = request.headers["frontier-device-name"];
  let name = "";
  if (typeof raw === "string") {
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = "";
    }
  }
  // Control characters have no place in a name shown on screen.
  name = [...name.replace(/\p{Cc}/gu, "")].slice(0, NAME_LENGTH).join("").trim();
  return { id, name };
}

export function draftRoutes(app: FastifyInstance, s: Services): void {
  /**
   * Refuses a draft for a path that may not be changed, and returns what is published there.
   * `stale` is true for a save that started from a file the server may no longer have: its text is
   * then kept beside a draft of whatever the library holds, rather than refused.
   */
  async function check(path: string, kind: "edit" | "create" | "delete", stale = false) {
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
      if (kind === "create" && !hasDraft && !stale) {
        throw new ApiError("invalid", `"${path}" already exists.`);
      }
    } else if (kind !== "create" && !hasDraft && !stale) {
      throw new ApiError("not_found", `There is no note at "${path}".`);
    }
    return {
      blob: published ? ((await s.git.blobHash(path)) ?? "") : "",
      lineEnding: published?.lineEnding === "crlf" ? ("crlf" as const) : ("lf" as const),
      text: published?.text ?? null,
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
    const device = deviceOf(request);
    const published = await check(
      input.path,
      input.kind,
      input.revision > 0 && input.baseBlob !== undefined,
    );
    try {
      const record = await s.drafts.save(
        { ...input, text: input.kind === "delete" ? "" : input.text.replace(/\r\n/g, "\n") },
        published,
        device,
      );
      return { id: record.id, revision: record.revision };
    } finally {
      // A kept copy raises the attention count, so every open page hears of it too.
      s.status.drafts(s.drafts.count(), 0);
    }
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
    s.status.drafts(s.drafts.count(), 0);
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
        mainText:
          s.index.note(d.path)?.text ??
          s.maps.publishedText(d.path) ??
          s.chronicles.publishedText(d.path) ??
          s.libraryFiles.publishedText(d.path),
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

  /**
   * Records a rename. Something has at most one: a rename of what another rename already moves,
   * named where it is or where it goes, replaces that one with a single rename from where it is
   * in the library, so renames never chain.
   */
  app.post("/api/renames", async (request): Promise<CreateRenameResponse> => {
    const { from, to } = CreateRenameRequest.parse(request.body);
    const earlier = s.drafts.listRenames().find((r) => r.from === from || r.to === from);
    const start = earlier?.from ?? from;
    if (start === to) {
      throw new ApiError("invalid", "It is there already. Undo the rename to keep it there.");
    }
    const intent = {
      id: makeId(randomBytes),
      from: start,
      to,
      createdAt: new Date().toISOString(),
    };
    const affected = await s.publisher.previewRename(intent, earlier?.id);
    if (earlier) await s.drafts.removeRename(earlier.id);
    await s.drafts.addRename(intent);
    s.status.drafts(s.drafts.count(), 0);
    return {
      id: intent.id,
      affected,
      replaced: earlier ? { from: earlier.from, to: earlier.to } : null,
    };
  });

  app.delete("/api/renames/:id", async (request) => {
    const { id } = IdParam.parse(request.params);
    await s.drafts.removeRename(id);
    s.status.drafts(s.drafts.count(), 0);
    return { ok: true as const };
  });
}
