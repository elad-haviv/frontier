/**
 * Library item files: Frontier's own files in the library that hold one item per line, such as the
 * folder file. One store serves every kind in the schema's table: it reads a file (the author's
 * draft first, then the library's copy, then what a missing file reads as), saves it as a draft
 * that says where it started, and settles a clash at publish. Nothing here knows one kind from
 * another; what a kind needs beyond the table it registers with `register`.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnyLibraryFile,
  type DraftRecord,
  LIBRARY_FILES,
  makeId,
  parseLibraryFile,
  serialiseLibraryFile,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import { type DraftStore, keepOtherSide, keptOf } from "../state/drafts.js";

/** What a kind adds to the table, given by the part of the server that owns it. */
export interface LibraryFileHooks {
  /** What the file reads as while it exists neither as a draft nor in the library. */
  missing?: () => unknown;
  /** Checks a file about to be saved beyond its schema; throws ApiError to refuse it. */
  check?: (file: unknown) => void;
}

export interface LoadedLibraryFile {
  file: unknown;
  /** The draft's revision; 0 when the file has no draft. */
  revision: number;
  /** The blob of the file in the library, or "" when it is not there. */
  blob: string;
  /** Where the value came from: a draft, the library, or neither (built in memory). */
  from: "draft" | "library" | "memory";
}

export interface LibraryFileStoreDeps {
  vaultDir: string;
  drafts: DraftStore;
  /** The kinds served; the schema's whole table unless a test gives fewer. */
  kinds?: AnyLibraryFile[];
}

export class LibraryFileStore {
  private readonly kinds: AnyLibraryFile[];
  private hooks = new Map<string, LibraryFileHooks>();
  /** The library's copy of each file, read at each refresh; absent when missing or unreadable. */
  private published = new Map<string, unknown>();
  private blobs = new Map<string, string>();
  /** The last value read for each file, by what it was read from. */
  private cache = new Map<string, { stamp: string; value: LoadedLibraryFile }>();
  private refreshed = 0;
  /** Library files that cannot be read, with the reason. */
  problems: { path: string; message: string }[] = [];

  constructor(private readonly d: LibraryFileStoreDeps) {
    this.kinds = d.kinds ?? LIBRARY_FILES;
  }

  /** Adds what one kind needs beyond the table. */
  register(name: string, hooks: LibraryFileHooks): void {
    this.hooks.set(name, hooks);
  }

  /** The kind with this name, or a not-found error. */
  kind(name: string): AnyLibraryFile {
    const kind = this.kinds.find((k) => k.name === name);
    if (!kind) throw new ApiError("not_found", "There is no such library file.");
    return kind;
  }

  /** The kind a library path belongs to, among those served. */
  kindOf(path: string): AnyLibraryFile | undefined {
    return this.kinds.find((k) => k.path === path);
  }

  /** Reads every library file from the working copy. Called after each fetch. */
  refresh(): void {
    this.published.clear();
    this.blobs.clear();
    this.problems = [];
    this.refreshed++;
    for (const kind of this.kinds) {
      const full = join(this.d.vaultDir, kind.path);
      if (!existsSync(full)) continue;
      const bytes = readFileSync(full);
      // The working copy is `main`, so its bytes hash to the blob Git holds.
      this.blobs.set(
        kind.name,
        createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      );
      const text = bytes.toString("utf8");
      const parsed = parseLibraryFile(kind, text);
      if (parsed.ok) this.published.set(kind.name, parsed.file);
      else this.problems.push({ path: kind.path, message: parsed.message });
    }
  }

  /** The text of a library file as it is in the library, or null. */
  publishedText(path: string): string | null {
    if (!this.kindOf(path)) return null;
    const full = join(this.d.vaultDir, path);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  }

  private draftOf(kind: AnyLibraryFile): DraftRecord | undefined {
    const draft = this.d.drafts.byPath(kind.path);
    return draft && !draft.binary && draft.kind !== "delete" ? draft : undefined;
  }

  /** The library's copy, as read at the last refresh; undefined when there is none. */
  publishedValue(name: string): unknown {
    return this.published.get(this.kind(name).name);
  }

  /** Whether the file exists as a draft or in the library, rather than only in memory. */
  exists(name: string): boolean {
    const kind = this.kind(name);
    return this.draftOf(kind) !== undefined || this.published.has(kind.name);
  }

  /** What the file reads as while it exists nowhere. */
  missing(name: string): unknown {
    const kind = this.kind(name);
    return this.hooks.get(name)?.missing?.() ?? kind.empty();
  }

  /**
   * The file as the author sees it, without waiting: the draft, else the library's copy, else what
   * a missing file reads as. A draft that cannot be read counts as absent. Read again only when
   * the draft or the library changed.
   */
  current(name: string): LoadedLibraryFile {
    const kind = this.kind(name);
    const draft = this.draftOf(kind);
    const stamp = `${draft?.id ?? ""}:${draft?.revision ?? 0}:${this.refreshed}`;
    const known = this.cache.get(name);
    if (known && known.stamp === stamp) return known.value;
    const value = this.read(kind, draft);
    this.cache.set(name, { stamp, value });
    return value;
  }

  private read(kind: AnyLibraryFile, draft: DraftRecord | undefined): LoadedLibraryFile {
    const blob = this.blobOf(kind);
    if (draft) {
      const parsed = parseLibraryFile(kind, this.d.drafts.textNow(draft.id));
      if (parsed.ok) return { file: parsed.file, revision: draft.revision, blob, from: "draft" };
    }
    const published = this.published.get(kind.name);
    if (published !== undefined) return { file: published, revision: 0, blob, from: "library" };
    return { file: this.missing(kind.name), revision: 0, blob, from: "memory" };
  }

  /** The blob of the library's copy, as read at the last refresh; "" when there is none. */
  private blobOf(kind: AnyLibraryFile): string {
    return this.blobs.get(kind.name) ?? "";
  }

  /** Checks a file against its kind's schema and the kind's own rules. */
  private checked(kind: AnyLibraryFile, file: unknown): unknown {
    const parsed = kind.schema.safeParse(file);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
      throw new ApiError("invalid", `${issue?.message ?? "It cannot be read."}${where}`);
    }
    this.hooks.get(kind.name)?.check?.(parsed.data);
    return parsed.data;
  }

  /**
   * Saves the whole file as a draft. A save that started from older text than the draft, or from
   * a library copy that has moved on since, is refused as stale: the device merges and sends again.
   */
  async save(
    name: string,
    input: unknown,
    revision: number,
    sent: {
      baseBlob?: string | undefined;
      op?: string | undefined;
      clashes?: string[] | undefined;
    } = {},
  ): Promise<{ file: unknown; revision: number; kept?: string }> {
    const kind = this.kind(name);
    const draft = this.draftOf(kind);
    // A repeat of the last accepted send: what it stored is the answer.
    if (draft && sent.op !== undefined && draft.lastOp === sent.op) {
      const parsed = parseLibraryFile(kind, await this.d.drafts.text(draft.id));
      if (parsed.ok) {
        return {
          file: parsed.file,
          revision: draft.revision,
          ...keptOf(this.d.drafts, draft.id, sent.clashes),
        };
      }
    }
    const file = this.checked(kind, input);
    const stale = () =>
      new ApiError(
        "stale_revision",
        `The ${kind.noun} were changed from another device. The two are being merged.`,
        draft ? { id: draft.id } : {},
      );
    if (draft && revision !== draft.revision) throw stale();
    const blob = this.blobOf(kind);
    // Without a draft, a device that says where it started must have started from the library's
    // copy as it is now; one file is shared by every device, so nothing may be built on an old one.
    if (!draft && sent.baseBlob !== undefined && sent.baseBlob !== blob) throw stale();
    const text = serialiseLibraryFile(kind, file);
    // The device merged items both sides changed and kept its own: the side it replaces is kept
    // beside the draft, made first from the library's copy (or the empty file) when there is none.
    const other = sent.clashes?.length
      ? await keepOtherSide(this.d.drafts, draft, sent.clashes, async () => ({
          path: kind.path,
          text: serialiseLibraryFile(kind, this.current(name).file),
          blob,
        }))
      : draft;
    const record = await this.write(kind, other, text, blob, sent.op);
    return {
      file,
      revision: record.revision,
      ...(sent.clashes?.length ? { kept: record.id } : {}),
    };
  }

  private async write(
    kind: AnyLibraryFile,
    draft: DraftRecord | undefined,
    text: string,
    blob: string,
    op?: string,
  ): Promise<DraftRecord> {
    const record = draft
      ? await this.d.drafts.serverChange(draft.id, text, { op })
      : await this.d.drafts.saveFrom({
          id: makeId(randomBytes),
          path: kind.path,
          kind: blob === "" ? "create" : "edit",
          content: text,
          baseBlob: blob,
          lineEnding: "lf",
          op,
        });
    this.cache.delete(kind.name);
    return record;
  }

  /**
   * Changes the file from the server side, as when a folder is deleted. The change is given the
   * file as the author sees it; returning the same value writes nothing.
   */
  async change(name: string, change: (file: unknown) => unknown): Promise<void> {
    const kind = this.kind(name);
    const loaded = this.current(name);
    const next = this.checked(kind, change(loaded.file));
    const text = serialiseLibraryFile(kind, next);
    if (loaded.from !== "memory" && text === serialiseLibraryFile(kind, loaded.file)) return;
    await this.write(kind, this.draftOf(kind), text, loaded.blob);
  }

  /** Settles a file that changed here and in the library in ways that cannot be merged. */
  async resolve(name: string, keep: "mine" | "theirs"): Promise<void> {
    const kind = this.kind(name);
    const draft = this.draftOf(kind);
    if (!draft) throw new ApiError("not_found", `The ${kind.noun} have no unpublished change.`);
    if (keep === "theirs") await this.d.drafts.discard(draft.id);
    else {
      await this.d.drafts.rebase(
        draft.id,
        await this.d.drafts.text(draft.id),
        this.blobOf(kind),
        true,
      );
    }
    this.cache.delete(kind.name);
  }
}
