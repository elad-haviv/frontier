import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { RouteApp } from "../projects/facade.js";
import {
  CreateRenameRequest,
  type CreateRenameResponse,
  type DraftCompareResponse,
  DraftResolveRequest,
  DraftTextRequest,
  Id,
  makeId,
  PublishConfirmRequest,
  PublishPlanRequest,
  SaveDraftRequest,
  type UnpublishedResponse,
} from "@frontier/schema";
import { extension, isEditable, isExcluded, isNote, stem } from "@frontier/vault";
import { z } from "zod";
import { authorOf, personOf } from "../auth/session.js";
import { ApiError } from "../errors.js";
import { movedPath } from "../publish/publish.js";
import { type Device, SERVER_SLOT, UNKNOWN_DEVICE } from "../state/drafts.js";
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

export function draftRoutes(app: RouteApp, s: Services): void {
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

  /** Whether a path holds an entry now: published, or as a draft that is not a delete. */
  const taken = (path: string) =>
    s.index.note(path) !== undefined ||
    (s.drafts.byPath(path) !== undefined && s.drafts.byPath(path)!.kind !== "delete");

  /**
   * Where a rename or move recorded on the server took `path`: a pending rename intent from it or
   * from a folder above it, then the renames that reached the library, in the order they did.
   * Null when none did.
   */
  function renamedTo(path: string): string | null {
    let now = path;
    for (const r of [...s.drafts.renamedLog(), ...s.drafts.listRenames()]) {
      now = movedPath(now, r.from, r.to) ?? now;
    }
    return now === path ? null : now;
  }

  /** What a draft made at `path` starts from: the library's text, or a new entry's heading. */
  async function startAt(path: string) {
    const note = s.index.note(path);
    if (note) {
      return {
        kind: "edit" as const,
        text: note.text,
        baseBlob: (await s.git.blobHash(path)) ?? "",
        lineEnding: note.lineEnding === "crlf" ? ("crlf" as const) : ("lf" as const),
      };
    }
    return {
      kind: "create" as const,
      text: `# ${stem(path)}\n\n`,
      baseBlob: "",
      lineEnding: "lf" as const,
    };
  }

  /** Whether the server may write a kept copy's draft at `path`. */
  const writable = (path: string) =>
    extension(path) === "md" &&
    !isExcluded(path) &&
    isEditable(path) &&
    s.index.note(path)?.lineEnding !== "mixed";

  /**
   * A path for an entry whose own path is gone with no rename to follow: `<folder>/<name> (from
   * <device>).md`, with a number added while that is taken.
   */
  function recoveredPath(path: string, device: Device): string {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const from = device.name
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const base = `${stem(path)} (from ${from || "another device"})`;
    const free = (p: string) => !taken(p) && caseTwin(p) === null;
    let n = 1;
    let out = `${folder}${base}.md`;
    while (!free(out)) out = `${folder}${base} ${++n}.md`;
    return out;
  }

  /** An entry, published or a draft, whose path is `path` when letter case is ignored. */
  function caseTwin(path: string): string | null {
    const lower = path.toLowerCase();
    for (const note of s.index.allNotes()) {
      if (note.path !== path && note.path.toLowerCase() === lower) return note.path;
    }
    for (const d of s.drafts.list()) {
      if (d.binary || d.kind === "delete" || d.path === path) continue;
      if (d.path.toLowerCase() === lower) return d.path;
    }
    return null;
  }

  /** Whether a folder holds anything now, in the library or as a draft. */
  const folderHolds = (folder: string) =>
    s.index.files.some((f) => f.startsWith(folder + "/")) ||
    s.drafts.list().some((d) => d.path.startsWith(folder + "/"));

  /**
   * Saves an entry that another device may have changed under this one (stage 15c). A new entry
   * whose path, or the same path in other letter case, was taken meanwhile, and an edit of an
   * entry renamed or moved elsewhere, end as this device's kept copy beside the draft where the
   * entry is now, never refused and never brought back at the old path.
   */
  async function saveEntry(input: SaveDraftRequest, device: Device) {
    const text = input.kind === "delete" ? "" : input.text.replace(/\r\n/g, "\n");
    const sent = { ...input, text };
    const known = s.drafts.get(input.id);
    // The draft this device knew is at another path now: moved with its folder, or renamed.
    if (known && !known.binary && known.path !== input.path) {
      if (input.kind === "delete") {
        throw new ApiError(
          "not_allowed",
          `Moved to "${known.path}" on another device; delete it there.`,
        );
      }
      return s.drafts.save(sent, await check(known.path, "edit", true), device);
    }
    if (!taken(input.path) && extension(input.path) === "md" && !isExcluded(input.path)) {
      if (input.kind === "create") {
        // The same name in other letter case: one library cannot hold both on every system.
        const twin = caseTwin(input.path);
        if (twin !== null && writable(twin)) {
          return s.drafts.keepBeside(twin, await startAt(twin), text, device);
        }
        // A new entry in a folder renamed or moved elsewhere goes where the folder went.
        const folder = input.path.slice(0, Math.max(0, input.path.lastIndexOf("/")));
        const target = folder && !folderHolds(folder) ? renamedTo(input.path) : null;
        if (target !== null && writable(target)) {
          return s.drafts.keepBeside(target, await startAt(target), text, device);
        }
      } else if (input.baseBlob !== undefined && input.baseBlob !== "") {
        // An entry this device read is gone from its path: renamed or moved, or deleted.
        const target = renamedTo(input.path);
        if (input.kind === "delete") {
          if (target !== null) {
            throw new ApiError(
              "not_allowed",
              `Moved to "${target}" on another device; delete it there.`,
            );
          }
        } else if (target !== null && taken(target) && writable(target)) {
          return s.drafts.keepBeside(target, await startAt(target), text, device);
        } else {
          // No rename to follow: the text the device started from comes back beside its own.
          const started = await s.git.readBlob(input.baseBlob);
          return s.drafts.keepBeside(
            recoveredPath(input.path, device),
            {
              kind: "create",
              text: started === null ? "" : started.toString("utf8").replace(/\r\n/g, "\n"),
              baseBlob: "",
              lineEnding: "lf",
            },
            text,
            device,
          );
        }
      }
    }
    // A save that says what it started from may be stale: a new entry made offline too, whose
    // path may have been taken meanwhile. Its text is then kept beside the library's.
    const published = await check(
      input.path,
      input.kind,
      input.baseBlob !== undefined && (input.revision > 0 || input.kind === "create"),
    );
    return s.drafts.save(sent, published, device);
  }

  app.put("/api/drafts", async (request) => {
    const input = SaveDraftRequest.parse(request.body);
    const device = deviceOf(request);
    try {
      const record = await saveEntry(input, device);
      // A device is answered with the id it uses (see `DraftStore.save`).
      return { id: record.clientId ?? record.id, revision: record.revision };
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

  /** Dismisses the other side of an item clash once the author has looked at it (stage 15c). */
  app.delete("/api/drafts/:id/versions/server", async (request) => {
    const { id } = IdParam.parse(request.params);
    if (!s.drafts.get(id)) throw new ApiError("not_found", "There is no such draft.");
    await s.drafts.dropKept(id, SERVER_SLOT);
    s.status.drafts(s.drafts.count(), 0);
    return { ok: true as const };
  });

  app.post("/api/drafts/:id/merge-versions", async (request) => {
    const { id } = IdParam.parse(request.params);
    const { text } = DraftTextRequest.parse(request.body);
    onlyNotes(id);
    const record = await s.drafts.mergeVersions(id, text.replace(/\r\n/g, "\n"));
    s.status.drafts(s.drafts.count(), 0);
    return { id: record.id, revision: record.revision };
  });

  /**
   * The person settled a conflict: their text now builds on the saved version they compared
   * (`theirsBlob`), or is refused when someone saved another one meanwhile (stage 27d).
   */
  app.post("/api/drafts/:id/resolve", async (request) => {
    const { id } = IdParam.parse(request.params);
    const { text, theirsBlob, revision } = DraftResolveRequest.parse(request.body);
    if (!s.drafts.get(id)) throw new ApiError("not_found", "There is no such draft.");
    onlyNotes(id);
    const record = await s.publisher.resolve(id, text.replace(/\r\n/g, "\n"), theirsBlob, revision);
    return { id: record.id, revision: record.revision };
  });

  /**
   * What a compare screen shows for one unsaved change (stage 27d): the person's text, the saved
   * text, the text it started from, and who saved the saved version and when. Without making a plan;
   * the answer is what saving it now would do.
   */
  app.get("/api/drafts/:id/compare", async (request): Promise<DraftCompareResponse> => {
    const { id } = IdParam.parse(request.params);
    const { outcome, c, draft, theirsBlob, mine } = await s.publisher.compare(id);
    return {
      draftId: draft.id,
      path: draft.path,
      outcome,
      theirsBlob,
      revision: draft.revision,
      mine,
      ...(c?.conflict ? { conflict: c.conflict } : {}),
      ...(c?.merge ? { merge: c.merge } : {}),
    };
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
    // A revert is saved by the person who decided it: its unsaved text is theirs alone.
    const decisions = s.quarantine
      .pendingDecisions()
      .filter((d) => !d.draftId || !s.drafts.existsAny(d.draftId) || s.drafts.get(d.draftId))
      .map((d) => ({
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
    const author = authorOf(personOf(request), s.config.commitAuthor);
    let published: string[] = [];
    const { commit, conflicts } = await s.publisher.confirm(
      planId,
      confirmedMergeIds,
      message,
      author,
      (paths) => {
        published = paths;
      },
    );
    // `published` lists the notes whose own text went out, for the browser to propose fields for.
    // `conflicts` lists entries left out because someone else saved a newer version since the plan.
    return { commit, published, conflicts };
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
