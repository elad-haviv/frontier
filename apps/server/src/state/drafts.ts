/**
 * Unpublished work, kept as files under /data/state/drafts.
 *
 *   drafts/<id>/record.json      the draft's record
 *   drafts/<id>/content          text with "\n" line endings
 *   drafts/<id>/record.v2.json   present only when another device saved an older revision
 *   drafts/<id>/content.v2
 *   drafts/renames/<id>.json     a rename or move, stored as an intent
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DraftRecord, type DraftKind, type Origin, RenameIntent } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { StateFiles } from "./files.js";

export interface SaveInput {
  id: string;
  path: string;
  kind: DraftKind;
  text: string;
  revision: number;
}

/** What the store needs to know about the published file when a draft is first made. */
export interface PublishedInfo {
  /** The blob hash of the file on `main`, or "" when there is none. */
  blob: string;
  lineEnding: "lf" | "crlf";
}

export class DraftStore {
  private records = new Map<string, DraftRecord>();
  private renames = new Map<string, RenameIntent>();
  private readonly dir: string;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.dir = join(stateDir, "drafts");
  }

  private folder(id: string): string {
    return join(this.dir, id);
  }

  /** Reads every stored draft and rename intent. Called once at start. */
  async load(): Promise<void> {
    this.records.clear();
    this.renames.clear();
    if (!existsSync(this.dir)) return;
    for (const name of await readdir(this.dir)) {
      if (name === "renames") continue;
      const record = await this.files
        .readJson(join(this.dir, name, "record.json"), DraftRecord)
        .catch(() => null);
      // A folder without a readable record is an interrupted first save; it holds nothing to keep.
      if (record && existsSync(join(this.dir, name, "content")))
        this.records.set(record.id, record);
    }
    const renameDir = join(this.dir, "renames");
    if (existsSync(renameDir)) {
      for (const name of await readdir(renameDir)) {
        if (!name.endsWith(".json")) continue;
        const intent = await this.files
          .readJson(join(renameDir, name), RenameIntent)
          .catch(() => null);
        if (intent) this.renames.set(intent.id, intent);
      }
    }
  }

  list(): DraftRecord[] {
    return [...this.records.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  get(id: string): DraftRecord | undefined {
    return this.records.get(id);
  }

  byPath(path: string): DraftRecord | undefined {
    for (const r of this.records.values()) if (r.path === path) return r;
    return undefined;
  }

  async text(id: string): Promise<string> {
    return readFile(join(this.folder(id), "content"), "utf8");
  }

  /** The stored content as bytes. For an image draft this is the image itself. */
  async bytes(id: string): Promise<Buffer> {
    return readFile(join(this.folder(id), "content"));
  }

  /** Stores a new file that is not text, such as an uploaded image, as a draft. */
  async saveBinary(
    id: string,
    path: string,
    content: Buffer,
    now = new Date(),
  ): Promise<DraftRecord> {
    const record: DraftRecord = {
      id,
      revision: 1,
      path,
      kind: "create",
      baseBlob: "",
      lineEnding: "lf",
      binary: true,
      origins: [],
      updatedAt: now.toISOString(),
    };
    await this.files.write(join(this.folder(id), "content"), content);
    await this.files.writeJson(join(this.folder(id), "record.json"), record);
    this.records.set(id, record);
    return record;
  }

  /**
   * Makes a draft from content the author accepted rather than typed, such as a file from an
   * agent's branch. The base is given by the caller, so Publish merges from where that content
   * started. The path must have no draft yet.
   */
  async saveFrom(
    input: {
      id: string;
      path: string;
      kind: DraftRecord["kind"];
      content: string | Buffer;
      baseBlob: string;
      lineEnding: DraftRecord["lineEnding"];
      origin: Origin;
    },
    now = new Date(),
  ): Promise<DraftRecord> {
    if (this.byPath(input.path)) {
      throw new ApiError("not_allowed", "You have an unpublished change to this file already.");
    }
    const record: DraftRecord = {
      id: input.id,
      revision: 1,
      path: input.path,
      kind: input.kind,
      baseBlob: input.baseBlob,
      lineEnding: input.lineEnding,
      binary: typeof input.content !== "string",
      updatedAt: now.toISOString(),
      origins: [input.origin],
    };
    await this.files.write(join(this.folder(record.id), "content"), input.content);
    await this.files.writeJson(join(this.folder(record.id), "record.json"), record);
    this.records.set(record.id, record);
    return record;
  }

  hasSecondVersion(id: string): boolean {
    return existsSync(join(this.folder(id), "content.v2"));
  }

  private async put(record: DraftRecord, text: string): Promise<void> {
    // Content first: a record must never point at content that is not there yet.
    await this.files.write(join(this.folder(record.id), "content"), text);
    await this.files.writeJson(join(this.folder(record.id), "record.json"), record);
    this.records.set(record.id, record);
  }

  /**
   * Saves a draft. The browser makes the id and sends the revision it last saw (0 for a new draft).
   *
   * A save with an older revision, or with a new id for a path that already has a draft, is kept as
   * a second version and answered with `stale_revision`, so no text is lost and none is overwritten.
   */
  async save(input: SaveInput, published: PublishedInfo, now = new Date()): Promise<DraftRecord> {
    const existing = this.records.get(input.id) ?? this.byPath(input.path);
    if (!existing) {
      if (input.revision !== 0) {
        throw new ApiError("invalid", "This draft is not known to the server. Reload the page.");
      }
      const record: DraftRecord = {
        id: input.id,
        revision: 1,
        path: input.path,
        kind: input.kind,
        baseBlob: published.blob,
        lineEnding: published.lineEnding,
        binary: false,
        origins: [],
        updatedAt: now.toISOString(),
      };
      await this.put(record, input.text);
      return record;
    }

    if (existing.binary) {
      throw new ApiError("invalid", "An uploaded image cannot be edited as text.");
    }
    if (existing.id === input.id && existing.path !== input.path) {
      throw new ApiError("invalid", "A draft cannot change which file it belongs to.");
    }
    if (existing.id === input.id && input.revision > existing.revision) {
      throw new ApiError("invalid", "This draft is newer than the server's copy. Reload the page.");
    }
    if (existing.id !== input.id || input.revision < existing.revision) {
      await this.files.write(join(this.folder(existing.id), "content.v2"), input.text);
      await this.files.writeJson(join(this.folder(existing.id), "record.v2.json"), {
        ...existing,
        kind: input.kind,
        updatedAt: now.toISOString(),
      });
      throw new ApiError(
        "stale_revision",
        "This file was changed from another device. Both versions are kept for you to merge.",
        { id: existing.id },
      );
    }

    const record: DraftRecord = {
      ...existing,
      kind: input.kind,
      revision: existing.revision + 1,
      updatedAt: now.toISOString(),
    };
    await this.put(record, input.text);
    return record;
  }

  /** The stored text and the one kept from another device. */
  async versions(
    id: string,
  ): Promise<{ current: { text: string; revision: number }; other: { text: string } }> {
    const record = this.require(id);
    if (!this.hasSecondVersion(id))
      throw new ApiError("not_found", "This draft has only one version.");
    return {
      current: { text: await this.text(id), revision: record.revision },
      other: { text: await readFile(join(this.folder(id), "content.v2"), "utf8") },
    };
  }

  /** Replaces the draft with the text the author merged by hand and drops the second version. */
  async mergeVersions(id: string, text: string, now = new Date()): Promise<DraftRecord> {
    const record = this.require(id);
    const next = { ...record, revision: record.revision + 1, updatedAt: now.toISOString() };
    await this.put(next, text);
    await this.files.remove(join(this.folder(id), "content.v2"));
    await this.files.remove(join(this.folder(id), "record.v2.json"));
    return next;
  }

  /**
   * Sets a draft's text and the version it is based on. Used when the author resolves a conflict
   * and when a merge he confirmed is about to be published.
   */
  async rebase(
    id: string,
    text: string,
    baseBlob: string,
    bump: boolean,
    now = new Date(),
  ): Promise<DraftRecord> {
    const record = this.require(id);
    const next = {
      ...record,
      baseBlob,
      revision: bump ? record.revision + 1 : record.revision,
      updatedAt: now.toISOString(),
    };
    await this.put(next, text);
    return next;
  }

  /** Points a draft at a new path, after the rename of its file has been published. */
  async movePath(id: string, path: string): Promise<DraftRecord> {
    const record = this.require(id);
    const next = { ...record, path };
    await this.files.writeJson(join(this.folder(id), "record.json"), next);
    this.records.set(id, next);
    return next;
  }

  async discard(id: string): Promise<void> {
    this.require(id);
    this.records.delete(id);
    await this.files.remove(this.folder(id));
  }

  private require(id: string): DraftRecord {
    const record = this.records.get(id);
    if (!record) throw new ApiError("not_found", "There is no such draft.");
    return record;
  }

  // ---- Rename intents ------------------------------------------------------------------------

  listRenames(): RenameIntent[] {
    return [...this.renames.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getRename(id: string): RenameIntent | undefined {
    return this.renames.get(id);
  }

  async addRename(intent: RenameIntent): Promise<void> {
    await this.files.writeJson(join(this.dir, "renames", `${intent.id}.json`), intent);
    this.renames.set(intent.id, intent);
  }

  async removeRename(id: string): Promise<void> {
    if (!this.renames.delete(id)) throw new ApiError("not_found", "There is no such rename.");
    await this.files.remove(join(this.dir, "renames", `${id}.json`));
  }

  /** How many unpublished changes there are, for the status area. */
  count(): number {
    return this.records.size + this.renames.size;
  }
}
