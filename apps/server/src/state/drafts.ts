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
 *   drafts/away.json                    when each person who left the project (or was removed) was
 *                                       last seen leaving, by person id, for the 30 days their
 *                                       unsaved changes are kept
 *
 * Whose they are (stage 27d): every draft's `record.json` and every rename intent carries the id of
 * the person it belongs to (`person`). Each person has their own: this store answers for the person
 * set by `asPerson` (`projects/view.ts`) and for nobody else, so a person cannot read, change or
 * discard another's draft by its id, by its path or by listing. A record with no `person` (made
 * before 27d, by the only author there was) belongs to the project's first owner; the first start
 * with 27d writes that into each file, one at a time (`stampOwners`), so a start cut off halfway is
 * finished by the next, and the files read the same way before they are stamped.
 *
 * Before kept copies there was one spare slot, `content.v2` with `record.v2.json`. One still
 * found is read as the copy of an earlier device.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { asPerson, currentPersonId, outsideSavedView, savedViewOnly } from "../projects/view.js";
import {
  AWAY_KEEP_DAYS,
  type OtherUnsaved,
  type ProjectRole,
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

/** What the store asks of the project and the server to know people: kept apart so the store can be tested alone. */
export interface DraftPeople {
  /**
   * The person a record or rename without an owner belongs to, and whom a call made outside any
   * request speaks for: the project's first owner. Null when there is none yet.
   */
  legacyOwner?: () => string | null;
  /** A person's role in the project as it is now; null when they are not a member. */
  roleOf?: (personId: string) => ProjectRole | null;
  /** The name shown for a person. */
  nameOf?: (personId: string) => string;
}

/** The owner of nobody: used where there is no first owner to name. */
const NOBODY = "";

/** How many days a person's unsaved changes are kept after they leave the project. */
const AWAY_MS = AWAY_KEEP_DAYS * 24 * 60 * 60 * 1000;

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
   * Rises on every write of a draft and every discard, for the status snapshot: a device keeping
   * copies for offline reading reads them again when it changes. One count for each person (the
   * getter below is the one of the person being served), since each has their own drafts.
   */
  private changeCounts = new Map<string, number>();
  /** How many conflicts each person's last plan found, until their next change. */
  private conflictCounts = new Map<string, number>();
  /** How many times the server changed a draft of each person itself (a proposal accepted into it). */
  private serverChangeCounts = new Map<string, number>();
  /**
   * The blob of the saved version each unsaved change was last compared with (a plan or a compare
   * found it needs choosing, or merging), by draft id; null when there was no file. In memory: what
   * the web app before 27d relies on when it resolves without saying which version it compared.
   */
  private compared = new Map<string, string | null>();
  /**
   * The ids a person's devices use for a draft whose own id is different, by person and device id.
   * A device may name an id of a draft someone else has (a draft from before people, shared by the
   * browser profile); its text then goes to a draft of its own under a new id, and the id the device
   * used keeps working as a name for it, so a device cannot tell that the id was taken.
   */
  private aliases = new Map<string, string>();
  /** When each person who is no longer in the project was seen leaving it, by person id. */
  private away: Record<string, string> = {};

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
    private readonly people: DraftPeople = {},
  ) {
    this.dir = join(stateDir, "drafts");
  }

  // ---- Whose ---------------------------------------------------------------------------------

  /** The person a record belongs to. */
  private ownerOf(r: { person?: string | undefined }): string {
    return r.person ?? this.people.legacyOwner?.() ?? NOBODY;
  }

  /** The person being served: the request's, or the project's first owner outside any request. */
  private me(): string {
    return currentPersonId() ?? this.people.legacyOwner?.() ?? NOBODY;
  }

  /** The id of the person being served (empty for nobody: a library from before people with no owner yet). */
  personId(): string {
    return this.me();
  }

  private isMine(r: { person?: string | undefined }): boolean {
    return this.ownerOf(r) === this.me();
  }

  /** The person's stamp for a new record: nothing for nobody, so a file stays as it was made. */
  private stamp(): { person?: string } {
    const me = this.me();
    return me === NOBODY ? {} : { person: me };
  }

  private bump(owner = this.me()): void {
    this.changeCounts.set(owner, (this.changeCounts.get(owner) ?? 0) + 1);
    this.conflictCounts.delete(owner);
  }

  /** Rises on every change to the drafts of the person being served. */
  get changes(): number {
    return this.changeCounts.get(this.me()) ?? 0;
  }

  /** The conflicts the person's last plan found, until they change something. */
  conflictCount(): number {
    return this.conflictCounts.get(this.me()) ?? 0;
  }

  noteConflicts(n: number): void {
    if (n > 0) this.conflictCounts.set(this.me(), n);
    else this.conflictCounts.delete(this.me());
  }

  /** Notes the saved version an unsaved change of the person was just compared with. */
  noteCompared(id: string, blob: string | null): void {
    const record = this.owned(id);
    if (record) this.compared.set(record.id, blob);
  }

  /** The saved version the change was last compared with: its blob, null for none, undefined if never. */
  comparedBlob(id: string): string | null | undefined {
    const record = this.owned(id);
    return record ? this.compared.get(record.id) : undefined;
  }

  /** Notes that the server itself changed a draft of the person being served. */
  noteServerChange(): void {
    this.serverChangeCounts.set(this.me(), (this.serverChangeCounts.get(this.me()) ?? 0) + 1);
  }

  serverChanges(): number {
    return this.serverChangeCounts.get(this.me()) ?? 0;
  }

  /**
   * A person's own record by the id they use: the draft's own id, or the id their device made when
   * that was another person's already (see `save`). Another's is "not found", as if it were not
   * there. Whatever calls this must go on with the record's `id`, never the one it was asked with,
   * which for an alias names someone else's folder.
   */
  private owned(id: string): DraftRecord | undefined {
    const direct = this.records.get(id);
    if (direct && this.isMine(direct)) return direct;
    const alias = this.aliases.get(this.aliasKey(this.me(), id));
    const record = alias === undefined ? undefined : this.records.get(alias);
    return record && this.isMine(record) ? record : undefined;
  }

  private aliasKey(person: string, clientId: string): string {
    return `${person}\u0000${clientId}`;
  }

  /**
   * Runs `work` once for each person who has anything unsaved here, as that person and outside the
   * saved view, for what must reach everyone's work: clearing what is already in the library, and
   * the sweep of people who left. Never use it to show one person another's.
   */
  async eachPerson(work: (person: string) => Promise<void>): Promise<void> {
    const owners = new Set<string>();
    for (const r of this.records.values()) owners.add(this.ownerOf(r));
    for (const r of this.renames.values()) owners.add(this.ownerOf(r));
    for (const owner of owners) {
      await outsideSavedView(() => asPerson(owner, () => work(owner)));
    }
  }

  /** Whether any person has a draft with this id. For the few callers that follow an id across people. */
  existsAny(id: string): boolean {
    return this.records.has(id);
  }

  /** Runs `work` as a person, outside the saved view: for the status stream, which speaks to one person at a time. */
  as<T>(personId: string, work: () => T): T {
    return outsideSavedView(() => asPerson(personId, work));
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
    this.away = {};
    this.aliases.clear();
    if (!existsSync(this.dir)) return;
    this.renamed =
      (await this.files.readJson(this.renamedFile(), RenamedLog).catch(() => null)) ?? [];
    this.away = await this.readAway();
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
    // The aliases are read after every record is: the person of a record from before is not known yet.
    this.indexAliases();
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
    await this.stampOwners();
  }

  /**
   * The move to unsaved changes per person: writes the first owner's id into every record and rename
   * intent that has none. Each file is rewritten whole and renamed into place by itself, so a stop
   * halfway leaves some stamped and some not, which read alike (`ownerOf`), and the next start finishes
   * it; run again with everything stamped it writes nothing. Without a first owner to name it waits.
   * Returns how many files it stamped.
   */
  async stampOwners(): Promise<number> {
    const owner = this.people.legacyOwner?.() ?? null;
    if (owner === null) return 0;
    let stamped = 0;
    for (const [id, record] of [...this.records]) {
      if (record.person !== undefined) continue;
      const next = { ...record, person: owner };
      await this.files.writeJson(join(this.folder(id), "record.json"), next);
      this.records.set(id, next);
      stamped++;
    }
    for (const [id, intent] of [...this.renames]) {
      if (intent.person !== undefined) continue;
      const next = { ...intent, person: owner };
      await this.files.writeJson(join(this.dir, "renames", `${id}.json`), next);
      this.renames.set(id, next);
      stamped++;
    }
    return stamped;
  }

  /** Builds the alias table from the records that say which id their device uses. */
  private indexAliases(): void {
    this.aliases.clear();
    for (const r of this.records.values()) {
      if (r.clientId !== undefined)
        this.aliases.set(this.aliasKey(this.ownerOf(r), r.clientId), r.id);
    }
  }

  /** The unsaved changes of the person being served, by path. A reader has none. */
  list(): DraftRecord[] {
    if (savedViewOnly()) return [];
    return [...this.records.values()]
      .filter((r) => this.isMine(r))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  get(id: string): DraftRecord | undefined {
    if (savedViewOnly()) return undefined;
    return this.owned(id);
  }

  byPath(path: string): DraftRecord | undefined {
    if (savedViewOnly()) return undefined;
    for (const r of this.records.values()) if (r.path === path && this.isMine(r)) return r;
    return undefined;
  }

  async text(id: string): Promise<string> {
    id = this.require(id).id;
    return readFile(join(this.folder(id), "content"), "utf8");
  }

  /** As `text`, read at once; for the few readers that cannot wait, such as the schema. */
  textNow(id: string): string {
    id = this.require(id).id;
    return readFileSync(join(this.folder(id), "content"), "utf8");
  }

  /** The stored content as bytes. For an image draft this is the image itself. */
  async bytes(id: string): Promise<Buffer> {
    id = this.require(id).id;
    return readFile(join(this.folder(id), "content"));
  }

  /** Stores a new file that is not text, such as an uploaded image, as a draft. */
  async saveBinary(
    id: string,
    path: string,
    content: Buffer,
    now = new Date(),
  ): Promise<DraftRecord> {
    this.assertFree(id);
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
      startedAt: now.toISOString(),
      ...this.stamp(),
    };
    await this.files.write(join(this.folder(id), "content"), content);
    await this.files.writeJson(join(this.folder(id), "record.json"), record);
    this.records.set(id, record);
    this.bump();
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
    this.assertFree(input.id);
    const record: DraftRecord = {
      id: input.id,
      revision: 1,
      path: input.path,
      kind: input.kind,
      baseBlob: input.baseBlob,
      lineEnding: input.lineEnding,
      binary: typeof input.content !== "string",
      updatedAt: now.toISOString(),
      startedAt: now.toISOString(),
      origins: input.origin ? [input.origin] : [],
      ...(input.op !== undefined ? { lastOp: input.op } : {}),
      ...this.stamp(),
    };
    await this.files.write(join(this.folder(record.id), "content"), input.content);
    await this.files.writeJson(join(this.folder(record.id), "record.json"), record);
    this.records.set(record.id, record);
    this.bump();
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
    const existing = this.owned(id);
    if (!existing) throw new ApiError("not_found", "This draft no longer exists.");
    id = existing.id;
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
    const record = this.owned(id);
    return record !== undefined && this.kept.has(record.id);
  }

  /** Whether the draft keeps the other side of an item clash. */
  hasServerCopy(id: string): boolean {
    const record = this.owned(id);
    return record !== undefined && this.serverKept.has(record.id);
  }

  /**
   * Whether the draft has texts from devices to compare and merge by hand. The other side of an
   * item clash is only shown, so it holds nothing back: saving the draft as a version clears it.
   */
  hasDeviceCopies(id: string): boolean {
    const record = this.owned(id);
    if (record === undefined) return false;
    return (this.kept.get(record.id) ?? 0) > (this.serverKept.has(record.id) ? 1 : 0);
  }

  /** The drafts that have kept copies, and how many each has. */
  keptList(): { draftId: string; path: string; count: number }[] {
    return this.list()
      .filter((r) => this.kept.has(r.id))
      .map((r) => ({ draftId: r.id, path: r.path, count: this.kept.get(r.id)! }));
  }

  /** How many of the person's drafts have kept copies, for the attention count. */
  keptCount(): number {
    return this.list().filter((r) => this.kept.has(r.id)).length;
  }

  /** Keeps a device's text beside a draft. A second copy from the same device replaces the first. */
  private async keep(id: string, device: Device, text: string, now: Date): Promise<void> {
    id = this.require(id).id;
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
    id = this.require(id).id;
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
    id = record.id;
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
    id = this.require(id).id;
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

  private async put(made: DraftRecord, text: string): Promise<void> {
    const had = this.records.get(made.id);
    if (!had) this.assertFree(made.id);
    // A record is the person's who first made it (never moved to whoever changes it later), and
    // knows when their change to the file began.
    const record: DraftRecord = {
      ...made,
      ...(made.person === undefined ? this.stamp() : {}),
      ...(made.startedAt === undefined && !had ? { startedAt: made.updatedAt } : {}),
    };
    // Content first: a record must never point at content that is not there yet.
    await this.files.write(join(this.folder(record.id), "content"), text);
    await this.files.writeJson(join(this.folder(record.id), "record.json"), record);
    this.records.set(record.id, record);
    if (record.clientId !== undefined) {
      this.aliases.set(this.aliasKey(this.ownerOf(record), record.clientId), record.id);
    }
    this.bump();
  }

  /** Forgets the id a device used for a draft that is gone. */
  private dropAlias(record: DraftRecord): void {
    if (record.clientId !== undefined) {
      this.aliases.delete(this.aliasKey(this.ownerOf(record), record.clientId));
    }
  }

  /**
   * A new draft takes an id nobody else's draft has: the id names its folder, and a person must
   * not be able to write into, or find out about, another's by choosing the same one.
   */
  private assertFree(id: string): void {
    if (this.records.has(id)) throw new ApiError("not_found", "There is no such draft.");
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
    // The id this device uses is the draft's own, or an alias for it (see below). An id that is
    // another person's draft is no business of this person's, and is told by nothing: it is treated
    // exactly as an id nobody has, except that the draft they make is under a new id of its own,
    // which their device's id then names (`clientId`). The device sees the answers it would for a
    // free id, so it cannot learn that the id is someone else's.
    const clientId = input.id;
    let id = this.owned(clientId)?.id ?? clientId;
    let alias: string | undefined;
    const taken = this.records.get(id);
    if (taken && !this.isMine(taken)) {
      id = makeId(randomBytes);
      alias = clientId;
    }
    input = { ...input, id };
    const existing = this.owned(id) ?? this.byPath(input.path);
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
            ...(alias !== undefined ? { clientId: alias } : {}),
          };
          await this.put(record, published.text ?? "");
          await this.keep(record.id, device, input.text, now);
          throw this.stale(record.id, alias);
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
        ...(alias !== undefined ? { clientId: alias } : {}),
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
      throw this.stale(existing.id, existing.clientId);
    }
    if (existing.id === input.id && input.revision > existing.revision) {
      throw new ApiError("invalid", "This draft is newer than the server's copy. Reload the page.");
    }
    if (existing.id !== input.id || input.revision < existing.revision) {
      await this.keep(existing.id, device, input.text, now);
      throw this.stale(existing.id, existing.clientId);
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

  /** `stale_revision` for a draft, named by the id its device uses when that is not its own. */
  private stale(id: string, as?: string): ApiError {
    return new ApiError(
      "stale_revision",
      "This file was changed from another device. Both texts are kept for you to compare.",
      { id: as ?? id },
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
    id = record.id;
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
    id = record.id;
    const next = {
      ...record,
      baseBlob,
      revision: bump ? record.revision + 1 : record.revision,
      updatedAt: now.toISOString(),
    };
    await this.put(next, text);
    this.compared.delete(id);
    return next;
  }

  /**
   * Makes another draft of the person's a kept copy of this one, and removes it: for two drafts that
   * would be at one path. Its text, and the texts it kept itself, are kept beside this draft's, each
   * in a slot of its own, so nothing is lost. A draft that deletes has no text to keep.
   */
  async absorb(intoId: string, fromId: string, now = new Date()): Promise<void> {
    const into = this.require(intoId);
    const from = this.require(fromId);
    if (into.binary || from.binary || into.id === from.id) {
      throw new ApiError("invalid", "These cannot be put together.");
    }
    if (from.kind !== "delete") {
      await this.keep(
        into.id,
        { id: from.id, name: "your other change at this path" },
        await this.text(from.id),
        now,
      );
    }
    for (const copy of await this.keptCopies(from.id)) {
      const slot = `${from.id.slice(0, 6)}${copy.device.replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
      await this.keep(into.id, { id: slot, name: copy.deviceName }, copy.text, now);
    }
    await this.discard(from.id);
  }

  /** Points a rename waiting to be saved at where its file is now, after another rename moved it. */
  async retargetRename(id: string, from: string): Promise<void> {
    const intent = this.renames.get(id);
    if (!intent || !this.isMine(intent)) {
      throw new ApiError("not_found", "There is no such rename.");
    }
    const next = { ...intent, from };
    await this.files.writeJson(join(this.dir, "renames", `${id}.json`), next);
    this.renames.set(id, next);
    this.conflictCounts.delete(this.me());
  }

  /** Points a draft at a new path, after the rename of its file has been published. */
  async movePath(id: string, path: string): Promise<DraftRecord> {
    const record = this.require(id);
    id = record.id;
    const next = { ...record, path };
    await this.files.writeJson(join(this.folder(id), "record.json"), next);
    this.records.set(id, next);
    this.bump();
    return next;
  }

  async discard(id: string): Promise<void> {
    id = this.require(id).id;
    this.dropAlias(this.records.get(id)!);
    this.records.delete(id);
    this.compared.delete(id);
    this.bump();
    this.kept.delete(id);
    this.serverKept.delete(id);
    await this.files.remove(this.folder(id));
  }

  private require(id: string): DraftRecord {
    const record = this.owned(id);
    if (!record) throw new ApiError("not_found", "There is no such draft.");
    return record;
  }

  // ---- Rename intents ------------------------------------------------------------------------

  listRenames(): RenameIntent[] {
    if (savedViewOnly()) return [];
    return [...this.renames.values()]
      .filter((r) => this.isMine(r))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getRename(id: string): RenameIntent | undefined {
    if (savedViewOnly()) return undefined;
    const intent = this.renames.get(id);
    return intent && this.isMine(intent) ? intent : undefined;
  }

  async addRename(made: RenameIntent): Promise<void> {
    const taken = this.renames.get(made.id);
    if (taken) throw new ApiError("not_found", "There is no such rename.");
    const intent: RenameIntent = { ...made, ...(made.person === undefined ? this.stamp() : {}) };
    await this.files.writeJson(join(this.dir, "renames", `${intent.id}.json`), intent);
    this.renames.set(intent.id, intent);
    this.conflictCounts.delete(this.me());
  }

  async removeRename(id: string): Promise<void> {
    const intent = this.renames.get(id);
    if (!intent || !this.isMine(intent)) {
      throw new ApiError("not_found", "There is no such rename.");
    }
    this.renames.delete(id);
    await this.files.remove(join(this.dir, "renames", `${id}.json`));
    this.conflictCounts.delete(this.me());
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

  /** How many unpublished changes the person being served has, for the status area. */
  count(): number {
    return this.list().length + this.listRenames().length;
  }

  // ---- Other people's work in progress (never their text) -----------------------------------

  /**
   * Who else in the project has unsaved changes to which entry: a draft of it, or a rename of it.
   * Only people who are writers or owners of the project now count (someone demoted or gone keeps
   * their changes, but they are hidden), and the answer is the person being served's to see only
   * when they are a writer or owner themselves: a reader gets nothing, as they see no drafts.
   * Names and times, never text.
   */
  othersUnsaved(): Map<string, OtherUnsaved[]> {
    const out = new Map<string, OtherUnsaved[]>();
    if (savedViewOnly()) return out;
    const me = this.me();
    const add = (owner: string, path: string, since: string) => {
      if (owner === me || owner === NOBODY || !this.isActive(owner)) return;
      const list = out.get(path) ?? [];
      const known = list.find((p) => p.id === owner);
      if (known) {
        if (since < known.since) known.since = since;
      } else {
        list.push({ id: owner, name: this.people.nameOf?.(owner) ?? "Someone", since });
      }
      out.set(path, list);
    };
    for (const r of this.records.values()) {
      if (r.binary) continue;
      add(this.ownerOf(r), r.path, r.startedAt ?? r.updatedAt);
    }
    for (const r of this.renames.values()) add(this.ownerOf(r), r.from, r.createdAt);
    for (const list of out.values()) list.sort((a, b) => a.since.localeCompare(b.since));
    return out;
  }

  /** Whether a person may write in the project now: their unsaved changes are shown to others only then. */
  private isActive(personId: string): boolean {
    const role = this.people.roleOf?.(personId);
    return role === undefined || role === "owner" || role === "writer";
  }

  // ---- People who leave --------------------------------------------------------------------

  /** How many unsaved changes (drafts and renames) a person has here, whoever is being served. */
  unsavedOf(personId: string): number {
    let n = 0;
    for (const r of this.records.values()) if (this.ownerOf(r) === personId) n++;
    for (const r of this.renames.values()) if (this.ownerOf(r) === personId) n++;
    return n;
  }

  private awayFile(): string {
    return join(this.dir, "away.json");
  }

  private async readAway(): Promise<Record<string, string>> {
    try {
      const raw = JSON.parse(await readFile(this.awayFile(), "utf8")) as unknown;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(
        Object.entries(raw).filter(
          (e): e is [string, string] => typeof e[1] === "string" && !Number.isNaN(Date.parse(e[1])),
        ),
      );
    } catch {
      return {};
    }
  }

  private async writeAway(): Promise<void> {
    if (Object.keys(this.away).length === 0) await this.files.remove(this.awayFile());
    else await this.files.writeJson(this.awayFile(), this.away);
  }

  /**
   * Told when a person's place in the project changed. Left or removed (`role` null): their unsaved
   * changes are kept for 30 days from now. In again, whatever the role: the clock stops and
   * everything is where it was (a reader's stay hidden until they write again, as a reader sees
   * only the saved view). A person with nothing unsaved is not noted.
   */
  async memberChanged(personId: string, role: ProjectRole | null, now = new Date()): Promise<void> {
    if (role !== null) {
      if (personId in this.away) {
        delete this.away[personId];
        await this.writeAway();
      }
      return;
    }
    if (this.unsavedOf(personId) === 0) return;
    this.away[personId] = now.toISOString();
    await this.writeAway();
  }

  /**
   * The sweep: makes sure everyone who has unsaved changes here and is not a member is on the clock
   * (a leaving that was never told of, such as the project not being open then, starts counting
   * now), takes anyone who is a member again off it, and removes the unsaved changes of whoever has
   * been away more than 30 days. Returns how many people it cleared.
   */
  async tidyAway(isMember: (personId: string) => boolean, now = new Date()): Promise<number> {
    const owners = new Set<string>();
    for (const r of this.records.values()) owners.add(this.ownerOf(r));
    for (const r of this.renames.values()) owners.add(this.ownerOf(r));
    owners.delete(NOBODY);
    let changed = false;
    let cleared = 0;
    for (const id of Object.keys(this.away)) {
      if (!owners.has(id) || isMember(id)) {
        delete this.away[id];
        changed = true;
      }
    }
    for (const id of owners) {
      if (isMember(id)) continue;
      const since = this.away[id];
      if (since === undefined) {
        this.away[id] = now.toISOString();
        changed = true;
        continue;
      }
      if (now.getTime() - Date.parse(since) < AWAY_MS) continue;
      await this.removeAllOf(id);
      delete this.away[id];
      changed = true;
      cleared++;
    }
    if (changed) await this.writeAway();
    return cleared;
  }

  /** Removes everything one person has unsaved here: their drafts with their kept copies, and their renames. */
  private async removeAllOf(personId: string): Promise<void> {
    for (const [id, r] of [...this.records]) {
      if (this.ownerOf(r) !== personId) continue;
      this.dropAlias(r);
      this.records.delete(id);
      this.compared.delete(id);
      this.kept.delete(id);
      this.serverKept.delete(id);
      await this.files.remove(this.folder(id));
      this.bump(personId);
    }
    for (const [id, r] of [...this.renames]) {
      if (this.ownerOf(r) !== personId) continue;
      this.renames.delete(id);
      await this.files.remove(join(this.dir, "renames", `${id}.json`));
    }
  }

  /** When a person who is away was seen leaving, or null. */
  awaySince(personId: string): string | null {
    return this.away[personId] ?? null;
  }
}
