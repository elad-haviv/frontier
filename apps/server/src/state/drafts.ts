/**
 * Unpublished work, kept as files under /data/state/drafts.
 *
 *   drafts/<id>/record.json             the draft's record
 *   drafts/<id>/content                 text with "\n" line endings
 *   drafts/<id>/versions/<device>.txt   a kept copy: a save from a device that started from older
 *   drafts/<id>/versions/<device>.json  text, one per device, with its record
 *   drafts/<id>/versions/server.txt     the other side of an item clash in a map, a chronicle or a
 *   drafts/<id>/versions/server.json    library item file, which a device's merged save replaced
 *   drafts/renames/<id>.json            a rename or move, stored as an intent
 *   drafts/renamed.json                 the renames and moves that reached the library, the last 500
 *
 * Before kept copies there was one spare slot, `content.v2` with `record.v2.json`. One still
 * found is read as the copy of an earlier device.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  combineKept,
  DraftRecord,
  type DraftKind,
  itemShapeOf,
  KeptCopy,
  type KeptCopyText,
  makeId,
  type Origin,
  RenamedLog,
  RenameIntent,
  unionClashes,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { StateFiles } from "./files.js";

export interface SaveInput {
  id: string;
  path: string;
  kind: DraftKind;
  text: string;
  revision: number;
  /** The blob of the library file the device started from; absent from an older build. */
  baseBlob?: string | undefined;
  /** The device's id for this send; a retry repeats it. */
  op?: string | undefined;
}

/** What the store needs to know about the published file when a draft is first made. */
export interface PublishedInfo {
  /** The blob hash of the file on `main`, or "" when there is none. */
  blob: string;
  lineEnding: "lf" | "crlf";
  /** The file's text on `main`, or null when there is none. */
  text: string | null;
}

/** The device a save came from. `id` is checked by the route before it names a file. */
export interface Device {
  id: string;
  name: string;
}

/** A save with no device header, as from an older build. */
export const UNKNOWN_DEVICE: Device = { id: "unknown", name: "" };

/** The device the single spare slot of an earlier Frontier is read as. */
const EARLIER = "earlier";

/** The slot that holds the other side of an item clash, beside the devices' slots. */
export const SERVER_SLOT = "server";

/** How many published renames `renamed.json` remembers. */
const RENAMED_KEPT = 500;

/** What may name a kept copy's files: an id, `unknown`, `earlier` or `server`; never a path. */
const DEVICE_NAME = /^[a-z0-9]{1,32}$/;

/**
 * Keeps the other side of an item clash before a device's merged save replaces it (stage 15c), for
 * the stores of maps, chronicles and library item files. Without a draft, one is made first from
 * the library's copy, which is then the other side. Returns the draft the save goes to.
 */
export async function keepOtherSide(
  drafts: DraftStore,
  draft: DraftRecord | undefined,
  clashes: string[],
  library: () => Promise<{ path: string; text: string; blob: string }>,
): Promise<DraftRecord> {
  let record = draft;
  if (!record) {
    const from = await library();
    record = await drafts.saveFrom({
      id: makeId(randomBytes),
      path: from.path,
      kind: from.blob === "" ? "create" : "edit",
      content: from.text,
      baseBlob: from.blob,
      lineEnding: "lf",
    });
  }
  await drafts.keepOther(record.id, await drafts.text(record.id), clashes);
  return record;
}

/** The `kept` of a repeated send's answer: the draft, when the send had clashes and it keeps one. */
export const keptOf = (
  drafts: DraftStore,
  id: string,
  clashes: string[] | undefined,
): { kept?: string } => (clashes?.length && drafts.hasServerCopy(id) ? { kept: id } : {});

/** A record without the op of the save before, for the next save to set its own. */
function withoutOp(record: DraftRecord): DraftRecord {
  const copy = { ...record };
  delete copy.lastOp;
  return copy;
}

export class DraftStore {
  private records = new Map<string, DraftRecord>();
  private renames = new Map<string, RenameIntent>();
  /** How many kept copies each draft has, for drafts that have any. */
  private kept = new Map<string, number>();
  /** The drafts whose kept copies include the other side of an item clash. */
  private serverKept = new Set<string>();
  /** The renames and moves that reached the library, oldest first. */
  private renamed: RenamedLog = [];
  private readonly dir: string;
  /**
   * Rises on every write of a draft and every discard, whoever made it, for the status snapshot:
   * a device keeping copies for offline reading reads them again when it changes.
   */
  changes = 0;

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
    this.kept.clear();
    this.serverKept.clear();
    this.renamed = [];
    if (!existsSync(this.dir)) return;
    this.renamed =
      (await this.files.readJson(this.renamedFile(), RenamedLog).catch(() => null)) ?? [];
    for (const name of await readdir(this.dir)) {
      if (name === "renames" || name.endsWith(".json")) continue;
      const record = await this.files
        .readJson(join(this.dir, name, "record.json"), DraftRecord)
        .catch(() => null);
      // A folder without a readable record is an interrupted first save; it holds nothing to keep.
      if (record && existsSync(join(this.dir, name, "content"))) {
        this.records.set(record.id, record);
        this.countKept(record.id);
      }
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

  /** As `text`, read at once; for the few readers that cannot wait, such as the schema. */
  textNow(id: string): string {
    return readFileSync(join(this.folder(id), "content"), "utf8");
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
    this.changes++;
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
      origin?: Origin;
      /** The device's id for this send, kept so a retry of it writes nothing. */
      op?: string | undefined;
    },
    now = new Date(),
  ): Promise<DraftRecord> {
    const existing = this.byPath(input.path);
    if (existing && input.op !== undefined && existing.lastOp === input.op) return existing;
    if (existing) {
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
      origins: input.origin ? [input.origin] : [],
      ...(input.op !== undefined ? { lastOp: input.op } : {}),
    };
    await this.files.write(join(this.folder(record.id), "content"), input.content);
    await this.files.writeJson(join(this.folder(record.id), "record.json"), record);
    this.records.set(record.id, record);
    this.changes++;
    return record;
  }

  /**
   * Replaces a text draft's content from the server side, such as when a proposed field is
   * accepted into it, or when a map is saved. The revision rises like a save, so a device holding
   * the older text is told. With `op`, a repeat of the last accepted send writes nothing.
   */
  async serverChange(
    id: string,
    text: string,
    extra: { origin?: Origin | undefined; op?: string | undefined } = {},
    now = new Date(),
  ): Promise<DraftRecord> {
    const existing = this.records.get(id);
    if (!existing) throw new ApiError("not_found", "This draft no longer exists.");
    const { origin, op } = extra;
    if (op !== undefined && existing.lastOp === op) return existing;
    const known = (o: Origin) => origin && o.kind === origin.kind && o.ref === origin.ref;
    const record: DraftRecord = {
      ...withoutOp(existing),
      revision: existing.revision + 1,
      updatedAt: now.toISOString(),
      origins:
        origin && !existing.origins.some(known) ? [...existing.origins, origin] : existing.origins,
      ...(op !== undefined ? { lastOp: op } : {}),
    };
    await this.put(record, text);
    return record;
  }

  // ---- Kept copies ---------------------------------------------------------------------------

  private versionsDir(id: string): string {
    return join(this.folder(id), "versions");
  }

  /** Counts a draft's kept copies on disk, after a change to them. */
  private countKept(id: string): void {
    const dir = this.versionsDir(id);
    let n = existsSync(join(this.folder(id), "content.v2")) ? 1 : 0;
    if (existsSync(dir)) n += readdirSync(dir).filter((f) => f.endsWith(".txt")).length;
    if (n > 0) this.kept.set(id, n);
    else this.kept.delete(id);
    if (existsSync(join(dir, `${SERVER_SLOT}.txt`))) this.serverKept.add(id);
    else this.serverKept.delete(id);
  }

  hasKeptCopies(id: string): boolean {
    return this.kept.has(id);
  }

  /** Whether the draft keeps the other side of an item clash. */
  hasServerCopy(id: string): boolean {
    return this.serverKept.has(id);
  }

  /**
   * Whether the draft has texts from devices to compare and merge by hand. The other side of an
   * item clash is only shown, so it holds nothing back: saving the draft as a version clears it.
   */
  hasDeviceCopies(id: string): boolean {
    return (this.kept.get(id) ?? 0) > (this.serverKept.has(id) ? 1 : 0);
  }

  /** The drafts that have kept copies, and how many each has. */
  keptList(): { draftId: string; path: string; count: number }[] {
    return this.list()
      .filter((r) => this.kept.has(r.id))
      .map((r) => ({ draftId: r.id, path: r.path, count: this.kept.get(r.id)! }));
  }

  /** How many drafts have kept copies, for the attention count. */
  keptCount(): number {
    return this.kept.size;
  }

  /** Keeps a device's text beside a draft. A second copy from the same device replaces the first. */
  private async keep(id: string, device: Device, text: string, now: Date): Promise<void> {
    // The route lets only an id through; this guards the file name all the same.
    const name =
      DEVICE_NAME.test(device.id) && device.id !== EARLIER && device.id !== SERVER_SLOT
        ? device.id
        : "unknown";
    const record: KeptCopy = { device: name, deviceName: device.name, savedAt: now.toISOString() };
    // Text first: a record must never point at text that is not there yet.
    await this.files.write(join(this.versionsDir(id), `${name}.txt`), text);
    await this.files.writeJson(join(this.versionsDir(id), `${name}.json`), record);
    this.countKept(id);
  }

  /** Every kept copy of a draft, oldest first. */
  async keptCopies(id: string): Promise<KeptCopyText[]> {
    const out: KeptCopyText[] = [];
    const old = join(this.folder(id), "content.v2");
    if (existsSync(old)) {
      const record = await this.files
        .readJson(join(this.folder(id), "record.v2.json"), DraftRecord)
        .catch(() => null);
      out.push({
        device: EARLIER,
        deviceName: "",
        savedAt: record?.updatedAt ?? this.require(id).updatedAt,
        text: await readFile(old, "utf8"),
      });
    }
    const dir = this.versionsDir(id);
    if (existsSync(dir)) {
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort()) {
        const device = file.slice(0, -".txt".length);
        const record = await this.files
          .readJson(join(dir, `${device}.json`), KeptCopy)
          .catch(() => null);
        out.push({
          device,
          deviceName: record?.deviceName ?? "",
          savedAt: record?.savedAt ?? this.require(id).updatedAt,
          text: await readFile(join(dir, file), "utf8"),
          ...(record?.source ? { source: record.source } : {}),
          ...(record?.clashes ? { clashes: record.clashes } : {}),
        });
      }
    }
    return out.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  }

  /**
   * Keeps the other side of an item clash (stage 15c): `text` is the draft's text that a device's
   * merged save is about to replace, and `clashes` the keys of the items both sides changed. A
   * copy kept by an earlier clash is combined with it item by item, so nothing it kept is lost:
   * the new clashing items come from `text`, earlier ones stay as they were.
   */
  async keepOther(id: string, text: string, clashes: string[], at = new Date()): Promise<void> {
    const record = this.require(id);
    const dir = this.versionsDir(id);
    const earlier = await this.files
      .readJson(join(dir, `${SERVER_SLOT}.json`), KeptCopy)
      .catch(() => null);
    let kept = text;
    let all = unionClashes(clashes);
    if (earlier && existsSync(join(dir, `${SERVER_SLOT}.txt`))) {
      const before = earlier.clashes ?? [];
      all = unionClashes(before, clashes);
      const shape = itemShapeOf(record.path);
      const older = shape?.parse(await readFile(join(dir, `${SERVER_SLOT}.txt`), "utf8"));
      const newer = shape?.parse(text);
      if (shape && older && newer) {
        const keep = before.filter((c) => !clashes.includes(c));
        kept = shape.serialise(combineKept(shape, older, newer, keep));
      }
    }
    const copy: KeptCopy = {
      device: SERVER_SLOT,
      deviceName: "",
      savedAt: at.toISOString(),
      source: "server",
      clashes: all,
    };
    await this.files.write(join(dir, `${SERVER_SLOT}.txt`), kept);
    await this.files.writeJson(join(dir, `${SERVER_SLOT}.json`), copy);
    this.countKept(id);
  }

  /**
   * Removes one kept copy by its slot (a device's id, `earlier` or `server`), or every one without
   * a slot. Removing one that is not there does nothing.
   */
  async dropKept(id: string, slot?: string): Promise<void> {
    this.require(id);
    if (slot === undefined || slot === EARLIER) {
      await this.files.remove(join(this.folder(id), "content.v2"));
      await this.files.remove(join(this.folder(id), "record.v2.json"));
    }
    if (slot === undefined) await this.files.remove(this.versionsDir(id));
    else if (slot !== EARLIER) {
      if (!DEVICE_NAME.test(slot)) throw new ApiError("invalid", "There is no such kept copy.");
      await this.files.remove(join(this.versionsDir(id), `${slot}.txt`));
      await this.files.remove(join(this.versionsDir(id), `${slot}.json`));
    }
    this.countKept(id);
  }

  private async put(record: DraftRecord, text: string): Promise<void> {
    // Content first: a record must never point at content that is not there yet.
    await this.files.write(join(this.folder(record.id), "content"), text);
    await this.files.writeJson(join(this.folder(record.id), "record.json"), record);
    this.records.set(record.id, record);
    this.changes++;
  }

  /**
   * Saves a draft. The browser makes the id and sends the revision it last saw (0 for a new draft)
   * and the blob of the library file it started from.
   *
   * A repeat of the last accepted `op` writes nothing. A save that started from older text never
   * builds a draft on it: the text is kept beside the draft as this device's kept copy and the
   * answer is `stale_revision`, so no text is lost and none is overwritten.
   */
  async save(
    input: SaveInput,
    published: PublishedInfo,
    device: Device = UNKNOWN_DEVICE,
    now = new Date(),
  ): Promise<DraftRecord> {
    const existing = this.records.get(input.id) ?? this.byPath(input.path);
    if (existing && input.op !== undefined && existing.lastOp === input.op) return existing;
    const op = input.op !== undefined ? { lastOp: input.op } : {};
    if (!existing) {
      if (input.revision !== 0 && input.baseBlob === undefined) {
        throw new ApiError("invalid", "This draft is not known to the server. Reload the page.");
      }
      {
        if (input.baseBlob !== undefined && input.baseBlob !== published.blob) {
          // The file has moved on since this device read it: another device saved a version of it,
          // or the draft this device knew of was saved or discarded. This holds for a device's
          // first save too (revision 0), as when it began editing offline. The draft starts from
          // the library's text; the device's text is kept beside it.
          const record: DraftRecord = {
            id: input.id,
            revision: 1,
            path: input.path,
            kind: published.text === null ? "create" : "edit",
            baseBlob: published.blob,
            lineEnding: published.lineEnding,
            binary: false,
            origins: [],
            updatedAt: now.toISOString(),
          };
          await this.put(record, published.text ?? "");
          await this.keep(record.id, device, input.text, now);
          throw this.stale(record.id);
        }
        // Otherwise the old draft was discarded elsewhere, and this text starts a new one.
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
        ...op,
      };
      await this.put(record, input.text);
      return record;
    }

    if (existing.binary) {
      throw new ApiError("invalid", "An uploaded image cannot be edited as text.");
    }
    if (existing.id === input.id && existing.path !== input.path) {
      // The draft this device knew was renamed or moved on another device: the text is kept
      // beside it where it is now, never refused and never written back at the old path.
      await this.keep(existing.id, device, input.text, now);
      throw this.stale(existing.id);
    }
    if (existing.id === input.id && input.revision > existing.revision) {
      throw new ApiError("invalid", "This draft is newer than the server's copy. Reload the page.");
    }
    if (existing.id !== input.id || input.revision < existing.revision) {
      await this.keep(existing.id, device, input.text, now);
      throw this.stale(existing.id);
    }

    const record: DraftRecord = {
      ...withoutOp(existing),
      kind: input.kind,
      revision: existing.revision + 1,
      updatedAt: now.toISOString(),
      ...op,
    };
    await this.put(record, input.text);
    return record;
  }

  /**
   * Keeps a device's text beside the draft at `path` (stage 15c): a new entry whose path, or a
   * path differing only in letter case, was taken meanwhile, or an edit of an entry renamed or
   * moved elsewhere. With no draft there, one is made from `start`, as the library's text or the
   * text the device started from. Always ends with `stale_revision`, naming that draft.
   */
  async keepBeside(
    path: string,
    start: { kind: DraftKind; text: string; baseBlob: string; lineEnding: "lf" | "crlf" },
    text: string,
    device: Device = UNKNOWN_DEVICE,
    now = new Date(),
  ): Promise<never> {
    let draft = this.byPath(path);
    if (draft?.binary) throw new ApiError("invalid", "An uploaded image cannot be edited as text.");
    if (!draft) {
      draft = {
        id: makeId(randomBytes),
        revision: 1,
        path,
        kind: start.kind,
        baseBlob: start.baseBlob,
        lineEnding: start.lineEnding,
        binary: false,
        origins: [],
        updatedAt: now.toISOString(),
      };
      await this.put(draft, start.text);
    }
    await this.keep(draft.id, device, text, now);
    throw this.stale(draft.id);
  }

  private stale(id: string): ApiError {
    return new ApiError(
      "stale_revision",
      "This file was changed from another device. Both texts are kept for you to compare.",
      { id },
    );
  }

  /** The stored text and every text kept from other devices. */
  async versions(id: string): Promise<{
    path: string;
    current: { text: string; revision: number };
    others: KeptCopyText[];
  }> {
    const record = this.require(id);
    if (!this.hasKeptCopies(id))
      throw new ApiError("not_found", "This draft has no texts from other devices.");
    return {
      path: record.path,
      current: { text: await this.text(id), revision: record.revision },
      others: await this.keptCopies(id),
    };
  }

  /** Replaces the draft with the text the author merged by hand and drops every kept copy. */
  async mergeVersions(id: string, text: string, now = new Date()): Promise<DraftRecord> {
    const record = this.require(id);
    const next = { ...record, revision: record.revision + 1, updatedAt: now.toISOString() };
    await this.put(next, text);
    await this.dropKept(id);
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
    this.changes++;
    return next;
  }

  async discard(id: string): Promise<void> {
    this.require(id);
    this.records.delete(id);
    this.changes++;
    this.kept.delete(id);
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

  private renamedFile(): string {
    return join(this.dir, "renamed.json");
  }

  /** Notes a rename or move that reached the library, keeping the last 500. */
  async noteRenamed(from: string, to: string, now = new Date()): Promise<void> {
    this.renamed = [...this.renamed, { from, to, at: now.toISOString() }].slice(-RENAMED_KEPT);
    await this.files.writeJson(this.renamedFile(), this.renamed);
  }

  /** The renames and moves that reached the library, oldest first. */
  renamedLog(): RenamedLog {
    return this.renamed;
  }

  /** How many unpublished changes there are, for the status area. */
  count(): number {
    return this.records.size + this.renames.size;
  }
}
