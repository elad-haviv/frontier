/**
 * Chronicles: read from the library and from the author's drafts, and written as drafts. A
 * chronicle is saved as a version like a note or a map.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHRONICLE_FOLDER,
  type ChronicleFile,
  chronicleIdOf,
  chroniclePath,
  type DraftRecord,
  emptyChronicle,
  makeId,
  parseChronicle,
  serialiseChronicle,
} from "@frontier/schema";
import { isNote, makeEntryId } from "@frontier/vault";
import type { EntryChanger } from "../entries/change.js";
import { ApiError } from "../errors.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import type { DraftStore } from "../state/drafts.js";

export type ChronicleState = "published" | "unpublished" | "new";

export interface LoadedChronicle {
  chronicle: ChronicleFile;
  /** The draft's revision; 0 when the chronicle has no draft. */
  revision: number;
  state: ChronicleState;
}

export interface ChronicleStoreDeps {
  vaultDir: string;
  git: GitGateway;
  index: VaultIndex;
  drafts: DraftStore;
  changer: EntryChanger;
}

export class ChronicleStore {
  private published = new Map<string, ChronicleFile>();
  /** Chronicle files in the library that cannot be read, with the reason. */
  problems: { path: string; message: string }[] = [];

  constructor(private readonly d: ChronicleStoreDeps) {}

  /** Reads every chronicle file from the working copy. Called after each fetch. */
  refresh(): void {
    this.published.clear();
    this.problems = [];
    const dir = join(this.d.vaultDir, CHRONICLE_FOLDER);
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const path = `${CHRONICLE_FOLDER}/${name}`;
      const id = chronicleIdOf(path);
      if (id === null) continue;
      const parsed = parseChronicle(readFileSync(join(dir, name), "utf8"));
      if (!parsed.ok) this.problems.push({ path, message: parsed.message });
      else if (parsed.chronicle.id !== id) {
        this.problems.push({ path, message: "The id inside does not match the file's name." });
      } else this.published.set(id, parsed.chronicle);
    }
    const mains = [...this.published.values()].filter((c) => c.main);
    if (mains.length > 1) {
      this.problems.push({
        path: CHRONICLE_FOLDER,
        message: `${mains.length} chronicles are marked as the main one. The first by title counts.`,
      });
    }
  }

  /** The text of a chronicle as it is saved in the library, or null. */
  publishedText(path: string): string | null {
    const full = join(this.d.vaultDir, path);
    return chronicleIdOf(path) !== null && existsSync(full) ? readFileSync(full, "utf8") : null;
  }

  private draftOf(id: string): DraftRecord | undefined {
    return this.d.drafts.byPath(chroniclePath(id));
  }

  /** The chronicle as the author sees it: his draft, or else what is saved. */
  async get(id: string): Promise<LoadedChronicle | null> {
    const draft = this.draftOf(id);
    const published = this.published.get(id);
    if (draft) {
      if (draft.kind === "delete") return null;
      const parsed = parseChronicle(await this.d.drafts.text(draft.id));
      if (parsed.ok) {
        return {
          chronicle: parsed.chronicle,
          revision: draft.revision,
          state: published ? "unpublished" : "new",
        };
      }
    }
    return published ? { chronicle: published, revision: 0, state: "published" } : null;
  }

  /** As `get`, with the blob of the library file, which a save sends back to say where it started. */
  async open(id: string): Promise<(LoadedChronicle & { blob: string }) | null> {
    const loaded = await this.get(id);
    if (!loaded) return null;
    return { ...loaded, blob: (await this.d.git.blobHash(chroniclePath(id))) ?? "" };
  }

  async list(): Promise<LoadedChronicle[]> {
    const ids = new Set(this.published.keys());
    for (const draft of this.d.drafts.list()) {
      const id = chronicleIdOf(draft.path);
      if (id) ids.add(id);
    }
    const out: LoadedChronicle[] = [];
    for (const id of ids) {
      const loaded = await this.get(id);
      if (loaded) out.push(loaded);
    }
    return out.sort((a, b) => a.chronicle.title.localeCompare(b.chronicle.title));
  }

  private async freshId(): Promise<string> {
    let id = makeEntryId(randomBytes);
    while ((await this.get(id)) !== null) id = makeEntryId(randomBytes);
    return id;
  }

  private async write(
    chronicle: ChronicleFile,
    kind: "create" | "edit",
    op?: string,
  ): Promise<DraftRecord> {
    const path = chroniclePath(chronicle.id);
    return this.d.drafts.saveFrom({
      id: makeId(randomBytes),
      path,
      kind,
      content: serialiseChronicle(chronicle),
      baseBlob: kind === "create" ? "" : ((await this.d.git.blobHash(path)) ?? ""),
      lineEnding: "lf",
      op,
    });
  }

  /** Makes an empty chronicle, or a copy of one as the author sees it. */
  async create(input: {
    title?: string | undefined;
    copyOf?: string | undefined;
  }): Promise<string> {
    const id = await this.freshId();
    if (input.copyOf) {
      const source = await this.get(input.copyOf);
      if (!source) throw new ApiError("not_found", "There is no such chronicle to copy.");
      // The copy keeps the ids of everything in it, so the two can be compared item by item.
      await this.write(
        {
          ...source.chronicle,
          id,
          title: input.title?.trim() || `Copy of ${source.chronicle.title}`,
          main: false,
        },
        "create",
      );
      return id;
    }
    const title = input.title?.trim();
    if (!title) throw new ApiError("invalid", "A chronicle needs a title.");
    await this.write(emptyChronicle(id, title, makeEntryId(randomBytes)), "create");
    return id;
  }

  /**
   * Saves the whole chronicle as a draft. `link` names entries by path for spans that should
   * carry their id; an entry without an id gets one, written into a draft of the entry.
   */
  async save(
    id: string,
    input: ChronicleFile,
    revision: number,
    link: { span: string; path: string }[] = [],
    sent: { baseBlob?: string | undefined; op?: string | undefined } = {},
  ): Promise<{
    chronicle: ChronicleFile;
    revision: number;
    unlinked: { span: string; reason: string }[];
  }> {
    if (input.id !== id) throw new ApiError("invalid", "The chronicle's id cannot be changed.");
    const draft = this.draftOf(id);
    // A repeat of the last accepted send: what it stored is the answer.
    if (draft && sent.op !== undefined && draft.lastOp === sent.op) {
      const parsed = parseChronicle(await this.d.drafts.text(draft.id));
      if (parsed.ok) return { chronicle: parsed.chronicle, revision: draft.revision, unlinked: [] };
    }
    if (!draft && !this.published.has(id)) {
      throw new ApiError("not_found", "There is no such chronicle.");
    }
    if (draft?.kind === "delete") {
      throw new ApiError("not_allowed", "This chronicle is marked for deletion.");
    }
    const stale = () =>
      new ApiError(
        "stale_revision",
        "This chronicle was changed from another device. The two are being merged.",
        draft ? { id: draft.id } : {},
      );
    if (draft && revision !== draft.revision) throw stale();
    // A save with no draft starts one: its draft was saved as a version, or equalled the library's
    // copy, and was cleared. When the device says which file it started from and the library has
    // moved on since, it merges with the library's copy first. Without that, as from an older
    // build, it starts one whatever revision the page last saw.
    if (!draft && revision > 0 && sent.baseBlob !== undefined) {
      const blob = (await this.d.git.blobHash(chroniclePath(id))) ?? "";
      if (sent.baseBlob !== blob) throw stale();
    }

    const unlinked: { span: string; reason: string }[] = [];
    const spans = [...input.spans];
    for (const { span, path } of link) {
      const at = spans.findIndex((s) => s.id === span);
      if (at === -1) continue;
      try {
        if (!isNote(path)) throw new ApiError("invalid", "Only an entry can be linked.");
        spans[at] = { ...spans[at]!, entry: await this.d.changer.ensureId(path) };
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        spans[at] = { ...spans[at]!, entry: null };
        unlinked.push({ span, reason: err.message });
      }
    }
    const chronicle = { ...input, spans };
    const record = draft
      ? await this.d.drafts.serverChange(draft.id, serialiseChronicle(chronicle), { op: sent.op })
      : await this.write(chronicle, "edit", sent.op);
    return { chronicle, revision: record.revision, unlinked };
  }

  /** Marks one chronicle as the main one and takes the mark off any other, each as a draft. */
  async makeMain(id: string): Promise<void> {
    const target = await this.get(id);
    if (!target) throw new ApiError("not_found", "There is no such chronicle.");
    for (const other of await this.list()) {
      const want = other.chronicle.id === id;
      if (other.chronicle.main === want) continue;
      await this.save(other.chronicle.id, { ...other.chronicle, main: want }, other.revision);
    }
  }

  /** Marks a saved chronicle for deletion, or throws away one that was never saved. */
  async remove(id: string): Promise<void> {
    const draft = this.draftOf(id);
    if (draft) await this.d.drafts.discard(draft.id);
    if (!this.published.has(id)) {
      if (!draft) throw new ApiError("not_found", "There is no such chronicle.");
      return;
    }
    const path = chroniclePath(id);
    await this.d.drafts.saveFrom({
      id: makeId(randomBytes),
      path,
      kind: "delete",
      content: "",
      baseBlob: (await this.d.git.blobHash(path)) ?? "",
      lineEnding: "lf",
    });
  }

  /** Settles a chronicle that changed here and in the library in ways that cannot be merged. */
  async resolve(id: string, keep: "mine" | "theirs"): Promise<void> {
    const draft = this.draftOf(id);
    if (!draft) throw new ApiError("not_found", "This chronicle has no unsaved change.");
    if (keep === "theirs") {
      await this.d.drafts.discard(draft.id);
      return;
    }
    await this.d.drafts.rebase(
      draft.id,
      await this.d.drafts.text(draft.id),
      (await this.d.git.blobHash(chroniclePath(id))) ?? "",
      true,
    );
  }

  /** The chronicles, drafts included, that have a span for this entry id. */
  async chroniclesFor(entryId: string): Promise<{ id: string; title: string; span: string }[]> {
    const out: { id: string; title: string; span: string }[] = [];
    for (const { chronicle } of await this.list()) {
      const span = chronicle.spans.find((s) => s.entry === entryId);
      if (span) out.push({ id: chronicle.id, title: chronicle.title, span: span.id });
    }
    return out;
  }
}
