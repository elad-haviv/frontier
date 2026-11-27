/**
 * Types (stage 34): the types file as a library item file, the counts the settings page shows,
 * and the renames that reach into entries.
 *
 * While no types file exists, it reads as one built in memory from the schema file's names (or the
 * built-in ones), with "person" and "deity" chattable as they always were. The first change
 * writes it; from then on the types file alone says which types and date names there are.
 */
import {
  type FolderFile,
  FOLDERS,
  renameDateIn,
  renameTypeIn,
  type RenameTypesRequest,
  type SchemaResponse,
  TYPES,
  type TypesFile,
  typeNamed,
  typesFromNames,
} from "@frontier/schema";
import {
  isNote,
  readFields,
  readFrontmatter,
  renameFrontmatterKey,
  setTime,
  setType,
  typeFromFolder,
} from "@frontier/vault";
import type { EntryChanger } from "../entries/change.js";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import type { LibraryFileStore } from "../library/files.js";
import type { DraftStore } from "../state/drafts.js";

export interface TypeStoreDeps {
  index: VaultIndex;
  drafts: DraftStore;
  files: LibraryFileStore;
  changer: EntryChanger;
}

const lower = (s: string) => s.toLowerCase();
const same = (a: string, b: string) => lower(a) === lower(b);

export class TypeStore {
  constructor(private readonly d: TypeStoreDeps) {
    d.files.register(TYPES.name, {
      missing: () => {
        const schema = d.index.fileSchema;
        return typesFromNames(
          Object.keys(schema.types),
          Object.entries(schema.what).map(([name, w]) => ({ name, ...w })),
        );
      },
    });
    // The index reads its types and date names from here, so every reader of the schema sees them.
    d.index.typesFile = () => this.file();
  }

  /** The types file as the author sees it. */
  file(): TypesFile {
    return this.d.files.current(TYPES.name).file as TypesFile;
  }

  /** Every entry as the author sees it: published, minus deletes, plus new drafts. */
  private entries(): string[] {
    const paths = new Set(this.d.index.allNotes().map((n) => n.path));
    for (const draft of this.d.drafts.list()) {
      if (draft.kind === "delete") paths.delete(draft.path);
      else if (isNote(draft.path)) paths.add(draft.path);
    }
    return [...paths].sort();
  }

  /**
   * How often each type and each date name is used, and the words entries carry that are on
   * neither list. Counted over the published entries: a number for the settings page, not a check.
   */
  usage(): Pick<SchemaResponse, "counts" | "strays"> {
    const schema = this.d.index.schema;
    const types: Record<string, number> = {};
    const what: Record<string, number> = {};
    const strayTypes = new Map<string, number>();
    const strayWhat = new Map<string, number>();
    const typeNames = new Map(Object.keys(schema.types).map((n) => [lower(n), n]));
    let untyped = 0;
    for (const note of this.d.index.allNotes()) {
      const type = note.fields.type ?? typeFromFolder(schema, note.path);
      if (type === null) untyped++;
      else {
        const known = typeNames.get(lower(type));
        if (known) types[known] = (types[known] ?? 0) + 1;
        else strayTypes.set(type, (strayTypes.get(type) ?? 0) + 1);
      }
      for (const item of note.fields.time) {
        if (item.what in schema.what) what[item.what] = (what[item.what] ?? 0) + 1;
        else strayWhat.set(item.what, (strayWhat.get(item.what) ?? 0) + 1);
      }
    }
    const list = (m: Map<string, number>) => [...m].map(([name, entries]) => ({ name, entries }));
    return {
      counts: { types, what, untyped },
      strays: { types: list(strayTypes), what: list(strayWhat) },
    };
  }

  /**
   * Renames a type, one of a type's properties, or a date name, in the types file and in every
   * entry that writes the word, so nothing is left pointing at the old one. With `dryRun`, only
   * counts. Entries that cannot be changed now (read-only, or waiting to be compared) are counted
   * as skipped and keep the old word.
   */
  async rename(
    request: RenameTypesRequest,
  ): Promise<{ entries: number; folders: number; skipped: number }> {
    const file = this.file();
    const to = request.to.trim();
    const { from, dryRun } = request;
    if (to === from) return { entries: 0, folders: 0, skipped: 0 };
    let change: (text: string, path: string) => string;
    let nextFile: TypesFile;
    let folders = 0;

    if (request.what === "type") {
      if (!typeNamed(file, from)) throw new ApiError("not_found", `There is no type “${from}”.`);
      if (file.types.some((t) => same(t.name, to) && !same(t.name, from))) {
        throw new ApiError("invalid", `There is already a type called “${to}”.`);
      }
      nextFile = renameTypeIn(file, from, to);
      change = (text) => {
        const type = readFields(text).type;
        return type !== null && same(type, from) ? setType(text, to) : text;
      };
      const folderFile = this.d.files.current(FOLDERS.name).file as FolderFile;
      folders = folderFile.folders.filter((l) => l.type !== undefined && same(l.type, from)).length;
    } else if (request.what === "prop") {
      const type = typeNamed(file, request.type ?? null);
      if (!type) throw new ApiError("not_found", `There is no type “${request.type ?? ""}”.`);
      if (!type.props.some((p) => same(p.key, from))) {
        throw new ApiError("not_found", `“${type.name}” has no property “${from}”.`);
      }
      if (type.props.some((p) => same(p.key, to) && !same(p.key, from))) {
        throw new ApiError("invalid", `“${type.name}” already has a property called “${to}”.`);
      }
      nextFile = {
        ...file,
        types: file.types.map((t) =>
          t === type
            ? { ...t, props: t.props.map((p) => (same(p.key, from) ? { ...p, key: to } : p)) }
            : t,
        ),
      };
      const schema = this.d.index.schema;
      change = (text, path) => {
        const mine = readFields(text).type ?? typeFromFolder(schema, path);
        if (mine === null || !same(mine, type.name)) return text;
        const data = readFrontmatter(text).data ?? {};
        const key = Object.keys(data).find((k) => same(k, from));
        // An entry that already has the new name keeps both; its own word is not overwritten.
        if (!key || Object.keys(data).some((k) => same(k, to))) return text;
        return renameFrontmatterKey(text, key, to);
      };
    } else {
      if (!file.what.some((w) => w.name === from)) {
        throw new ApiError("not_found", `There is no date called “${from}”.`);
      }
      if (file.what.some((w) => same(w.name, to) && w.name !== from)) {
        throw new ApiError("invalid", `There is already a date called “${to}”.`);
      }
      nextFile = renameDateIn(file, from, to);
      change = (text) => {
        const time = readFields(text).time;
        if (!time.some((t) => t.what === from)) return text;
        return setTime(
          text,
          time.map((t) => (t.what === from ? { ...t, what: to } : t)),
        );
      };
    }
    // Refused before anything is written, when the new name cannot be a name.
    const checked = TYPES.schema.safeParse(nextFile);
    if (!checked.success) {
      throw new ApiError(
        "invalid",
        checked.error.issues[0]?.message ?? "That name cannot be used.",
      );
    }

    let entries = 0;
    let skipped = 0;
    for (const path of this.entries()) {
      const text = await this.d.changer.text(path);
      if (text === null) continue;
      let next: string;
      try {
        next = change(text, path);
      } catch {
        // Properties that cannot be read are left as they are.
        continue;
      }
      if (next === text) continue;
      if (dryRun) {
        entries++;
        continue;
      }
      if (this.d.index.readOnly(path)) {
        skipped++;
        continue;
      }
      try {
        if (await this.d.changer.apply(path, (now) => change(now, path))) entries++;
      } catch {
        skipped++;
      }
    }
    if (dryRun) return { entries, folders, skipped };

    // The types file first, so the folder file's new word is one the types know.
    await this.d.files.change(TYPES.name, () => nextFile);
    if (request.what === "type") {
      await this.d.files.change(FOLDERS.name, (f) => {
        const folderFile = f as FolderFile;
        if (!folderFile.folders.some((l) => l.type !== undefined && same(l.type, from))) {
          return undefined;
        }
        return {
          ...folderFile,
          folders: folderFile.folders.map((l) =>
            l.type !== undefined && same(l.type, from) ? { ...l, type: to } : l,
          ),
        };
      });
    }
    return { entries, folders, skipped };
  }
}
