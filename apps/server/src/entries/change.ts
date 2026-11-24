/**
 * Changes an entry's text from the server side: into the author's draft when there is one,
 * otherwise into a new draft made from what is published. Nothing here publishes.
 */
import { randomBytes } from "node:crypto";
import { type DraftRecord, makeId, type Origin } from "@frontier/schema";
import { makeEntryId, readFields, readFrontmatter, setFrontmatterKey } from "@frontier/vault";
import { ApiError } from "../errors.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import type { DraftStore } from "../state/drafts.js";
import type { StatusService } from "../status/status.js";

export interface EntryChangerDeps {
  git: GitGateway;
  index: VaultIndex;
  drafts: DraftStore;
  status: StatusService;
}

export class EntryChanger {
  constructor(private readonly d: EntryChangerDeps) {}

  /** The text the author would see: his draft, or else what is published. Null when neither exists. */
  async text(path: string): Promise<string | null> {
    const draft = this.d.drafts.byPath(path);
    if (draft && !draft.binary && draft.kind !== "delete") return this.d.drafts.text(draft.id);
    return draft ? null : (this.d.index.note(path)?.text ?? null);
  }

  /**
   * Applies `change` to the entry's text. Returns the draft that now holds it, or the existing
   * draft (or null) when the change makes no difference.
   */
  async apply(
    path: string,
    change: (text: string) => string,
    origin?: Origin,
  ): Promise<DraftRecord | null> {
    const note = this.d.index.note(path);
    const draft = this.d.drafts.byPath(path);
    if (!note && !draft) throw new ApiError("not_found", `There is no note at "${path}".`);
    if (draft?.kind === "delete") {
      throw new ApiError("not_allowed", "This entry is marked for deletion.");
    }
    if (draft?.binary) throw new ApiError("not_allowed", "This file is not a note.");
    if (draft && this.d.drafts.hasKeptCopies(draft.id)) {
      throw new ApiError(
        "not_allowed",
        "This entry has texts from other devices to compare. Merge them first.",
      );
    }
    if (this.d.index.readOnly(path) && note) {
      throw new ApiError("not_allowed", "This file is read-only.");
    }
    const text = draft ? await this.d.drafts.text(draft.id) : note!.text;
    if (readFrontmatter(text).error) {
      throw new ApiError(
        "not_allowed",
        "The properties block at the top of this entry cannot be read. Correct it in the text first.",
      );
    }
    const next = change(text);
    if (next === text) return draft ?? null;

    const record = draft
      ? await this.d.drafts.serverChange(draft.id, next, { origin })
      : await this.d.drafts.saveFrom({
          id: makeId(randomBytes),
          path,
          kind: "edit",
          content: next,
          baseBlob: (await this.d.git.blobHash(path)) ?? "",
          lineEnding: note!.lineEnding === "crlf" ? "crlf" : "lf",
          ...(origin ? { origin } : {}),
        });
    this.d.status.drafts(this.d.drafts.count(), 0);
    this.d.status.serverChangedDraft();
    return record;
  }

  /** The entry's id. When it has none, one is made and written into a draft of the entry. */
  async ensureId(path: string): Promise<string> {
    const text = await this.text(path);
    if (text === null) throw new ApiError("not_found", `There is no note at "${path}".`);
    const existing = readFields(text).id;
    if (existing) return existing;
    let id = makeEntryId(randomBytes);
    while (this.d.index.hasId(id)) id = makeEntryId(randomBytes);
    await this.apply(path, (t) => setFrontmatterKey(t, "id", id));
    return id;
  }
}
