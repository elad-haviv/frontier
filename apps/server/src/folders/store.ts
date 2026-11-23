/**
 * Folders: the folder file as the first library item file, and what acts on a whole folder at
 * once (delete, apply-type).
 *
 * While no folder file exists, it reads as one built in memory from the schema's `folders` lists,
 * so the first folder change writes those types into it. From then on the folder file alone says
 * which type a folder gives, and the index lays its types over the schema's lists.
 */
import { randomBytes } from "node:crypto";
import { FolderFile, type FolderLine, FOLDERS, makeId, movedFolderPath } from "@frontier/schema";
import {
  dirname,
  isImage,
  isInAppendix,
  isNote,
  readFields,
  setFrontmatterKey,
  type Schema,
  typeFromFolder,
} from "@frontier/vault";
import type { EntryChanger } from "../entries/change.js";
import { ApiError } from "../errors.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import type { LibraryFileStore } from "../library/files.js";
import type { DraftStore } from "../state/drafts.js";

export interface FolderStoreDeps {
  index: VaultIndex;
  git: GitGateway;
  drafts: DraftStore;
  files: LibraryFileStore;
  changer: EntryChanger;
}

const under = (path: string, folder: string) => path.startsWith(folder + "/");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The folder file built from a schema's `folders` lists: one line per listed folder that exists,
 * so a folder the schema names but the library lacks does not appear as an empty folder.
 */
export function foldersFromSchema(schema: Schema, exists: (path: string) => boolean): FolderFile {
  const lines = new Map<string, FolderLine>();
  for (const [type, { folders }] of Object.entries(schema.types)) {
    for (const raw of folders) {
      const path = raw.replace(/\/+$/, "");
      const line = { path, type };
      // A folder the schema names twice keeps its first type; a path no line may have is left out.
      if (
        !lines.has(path) &&
        exists(path) &&
        FolderFile.safeParse({ version: 1, folders: [line] }).success
      ) {
        lines.set(path, line);
      }
    }
  }
  return { version: 1, folders: [...lines.values()] };
}

export class FolderStore {
  constructor(private readonly d: FolderStoreDeps) {
    d.files.register(FOLDERS.name, {
      missing: () =>
        foldersFromSchema(d.index.baseSchema, (path) => {
          const lower = path.toLowerCase() + "/";
          return d.index.files.some((f) => f.toLowerCase().startsWith(lower));
        }),
      check: (file) => this.check(file as FolderFile),
    });
    // The index reads folder types from here, so every reader of the schema sees them.
    d.index.folderTypes = () => this.types();
  }

  /** The folder file as the author sees it. */
  file(): FolderFile {
    return this.d.files.current(FOLDERS.name).file as FolderFile;
  }

  /**
   * The types the folder file gives, by folder path; null while no folder file exists, so the
   * schema's own lists are used.
   */
  types(): Map<string, string> | null {
    if (!this.d.files.exists(FOLDERS.name)) return null;
    const out = new Map<string, string>();
    for (const line of this.file().folders) if (line.type) out.set(line.path, line.type);
    return out;
  }

  /** A type must be one the schema knows. */
  private check(file: FolderFile): void {
    const known = this.d.index.baseSchema.types;
    for (const line of file.folders) {
      if (line.type !== undefined && !(line.type in known)) {
        throw new ApiError("invalid", `"${line.type}" is not a type in the schema.`);
      }
    }
  }

  /** Every entry under a folder as the author sees it: published, minus deletes, plus new drafts. */
  private entriesUnder(folder: string): string[] {
    const paths = new Set(this.d.index.allNotes().map((n) => n.path));
    for (const draft of this.d.drafts.list()) {
      if (draft.kind === "delete") paths.delete(draft.path);
      else if (isNote(draft.path)) paths.add(draft.path);
    }
    return [...paths].filter((p) => under(p, folder)).sort();
  }

  /**
   * Marks a folder and everything under it for deletion: a delete draft for each entry and the
   * removal of the folder file's lines, in one call. Refused, with the reason, while anything under
   * it has an unpublished change, is an image or another file that is not an entry, is
   * append-only, or mixes line endings. With `dryRun`, only checks and counts.
   */
  async remove(folder: string, dryRun = false): Promise<{ entries: number; folders: number }> {
    if (isInAppendix(folder) || isInAppendix(folder + "/x")) {
      throw new ApiError("append_only", "Files under 99 Appendices are append-only.");
    }
    const changed = this.d.drafts.list().filter((d) => d.path === folder || under(d.path, folder));
    const moving = this.d.drafts
      .listRenames()
      .filter((r) => [r.from, r.to].some((p) => p === folder || under(p, folder)));
    if (changed.length + moving.length > 0) {
      const n = changed.length + moving.length;
      throw new ApiError(
        "has_drafts",
        `${plural(n, "entry here has", "entries here have")} unpublished changes. ` +
          "Save a version or discard them first.",
      );
    }
    const files = this.d.index.files.filter((f) => under(f, folder));
    const others = files.filter((f) => !isNote(f));
    if (others.length > 0) {
      const images = others.filter(isImage).length;
      throw new ApiError(
        "has_images",
        images > 0
          ? `${plural(images, "image is", "images are")} kept here. Move ${images === 1 ? "it" : "them"} out first.`
          : `${plural(others.length, "file", "files")} here ${others.length === 1 ? "is" : "are"} not an entry. Move ${others.length === 1 ? "it" : "them"} out first.`,
      );
    }
    const mixed = files.filter((f) => this.d.index.note(f)?.lineEnding === "mixed");
    if (mixed.length > 0) {
      throw new ApiError(
        "read_only_file",
        `"${mixed[0]}" mixes two kinds of line endings, so it cannot be deleted here.`,
      );
    }
    const lines = this.file().folders.filter((l) => l.path === folder || under(l.path, folder));
    if (files.length === 0 && lines.length === 0) {
      throw new ApiError("not_found", `There is no folder "${folder}".`);
    }
    const subfolders = new Set<string>(lines.map((l) => l.path));
    for (const f of files) {
      for (let d = dirname(f); d !== folder && under(d, folder); d = dirname(d)) subfolders.add(d);
    }
    subfolders.delete(folder);
    const counts = { entries: files.length, folders: subfolders.size };
    if (dryRun) return counts;

    for (const path of files) {
      await this.d.drafts.saveFrom({
        id: makeId(randomBytes),
        path,
        kind: "delete",
        content: "",
        baseBlob: (await this.d.git.blobHash(path)) ?? "",
        lineEnding: "lf",
      });
    }
    if (lines.length > 0) {
      await this.d.files.change(FOLDERS.name, (file) => ({
        ...(file as FolderFile),
        folders: (file as FolderFile).folders.filter(
          (l) => l.path !== folder && !under(l.path, folder),
        ),
      }));
    }
    return counts;
  }

  /** Writes the folder's type into each entry under it that has no type of its own. */
  async applyType(folder: string): Promise<{ made: number }> {
    const type = typeFromFolder(this.d.index.schema, `${folder}/-`);
    if (!type) throw new ApiError("invalid", "This folder gives no type.");
    let made = 0;
    for (const path of this.entriesUnder(folder)) {
      if (this.d.index.readOnly(path)) continue;
      const text = await this.d.changer.text(path);
      if (text === null || readFields(text).type !== null) continue;
      if (await this.d.changer.apply(path, (t) => setFrontmatterKey(t, "type", type))) made++;
    }
    return { made };
  }

  /** The folder file's line for a path as the tree shows it, after the renames waiting. */
  linesAfterRenames(): FolderLine[] {
    const renames = this.d.drafts.listRenames();
    return this.file().folders.map((line) => {
      let path = line.path;
      for (const r of renames) path = movedFolderPath(path, r.from, r.to) ?? path;
      return path === line.path ? line : { ...line, path };
    });
  }
}
