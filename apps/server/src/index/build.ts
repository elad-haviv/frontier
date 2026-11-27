/**
 * The in-memory index of the published vault, built by reading the working copy.
 * Nothing here is saved to disk; it is rebuilt at start and after every fetch.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { TypesFile } from "@frontier/schema";
import { join } from "node:path";
import {
  aliasesOf,
  BUILT_IN_SCHEMA,
  BUILT_IN_SCHEMA_TEXT,
  createResolver,
  detectLineEnding,
  extractHeadings,
  type Fields,
  findLinks,
  type Heading,
  isEditable,
  isExcluded,
  isImage,
  isInAppendix,
  isNearFolderNote,
  isNote,
  type LineEnding,
  type Link,
  normaliseLineEndings,
  parseSchema,
  readFields,
  readRelations,
  type Resolution,
  type Resolver,
  type Schema,
  stem,
} from "@frontier/vault";

export interface IndexedLink {
  link: Link;
  resolution: Resolution;
}

export interface IndexedNote {
  path: string;
  title: string;
  aliases: string[];
  /** The text with line endings normalised. */
  text: string;
  lineEnding: LineEnding;
  headings: Heading[];
  links: IndexedLink[];
  fields: Fields;
}

export interface Backlink {
  path: string;
  title: string;
  line: number;
}

/** Every file under a folder, relative to it, with "/" separators. ".git" is skipped. */
export function walk(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, rel)).sort()) {
    if (name === ".git") continue;
    const path = rel === "" ? name : `${rel}/${name}`;
    if (statSync(join(root, path)).isDirectory()) out.push(...walk(root, path));
    else out.push(path);
  }
  return out;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

const SCHEMA_FILE = ".frontier/schema.yaml";

export class VaultIndex {
  /** The commit the index was built from. */
  commit: string | null = null;
  /** Rises on every build, so what is worked out from the index knows when to be worked out again. */
  generation = 0;
  files: string[] = [];
  private notes = new Map<string, IndexedNote>();
  private backlinkMap = new Map<string, Backlink[]>();
  private resolver: Resolver = createResolver([]);
  /** The types and `what` names of the vault's own schema file, or the built-in ones. */
  fileSchema: Schema = BUILT_IN_SCHEMA;
  /**
   * The types file as the author sees it (stage 35), or null before the type store is there. Set
   * by the type store; read each time, so a draft of the types file counts at once.
   */
  typesFile: () => TypesFile | null = () => null;
  /**
   * The types and `what` names in use: the types file's, which starts from the schema file's.
   * A type keeps the folders the schema file listed for it, for a library with no folder file.
   */
  get baseSchema(): Schema {
    const file = this.typesFile();
    if (file === null) return this.fileSchema;
    const types: Schema["types"] = {};
    for (const t of file.types) {
      types[t.name] = { folders: this.fileSchema.types[t.name]?.folders ?? [] };
    }
    const what: Schema["what"] = {};
    for (const w of file.what) {
      what[w.name] = { ...(w.begins ? { begins: true } : {}), ...(w.ends ? { ends: true } : {}) };
    }
    return { version: 1, types, what };
  }
  /**
   * The folder file's types by folder path, or null while there is no folder file. Set by the
   * folder store; read each time the schema is read, so a draft of the folder file counts at once.
   */
  folderTypes: () => Map<string, string> | null = () => null;
  schemaText = BUILT_IN_SCHEMA_TEXT;
  schemaBuiltIn = true;
  /** Why the vault's schema file is not used, when it exists and cannot be. */
  schemaProblem: string | null = null;
  private ids = new Map<string, string[]>();

  constructor(private readonly root: string) {}

  /** Reads the whole working copy. At 500 notes this takes well under a second. */
  build(commit: string): void {
    const files = walk(this.root);
    const resolver = createResolver(files);
    const notes = new Map<string, IndexedNote>();
    const backlinks = new Map<string, Backlink[]>();
    const ids = new Map<string, string[]>();
    this.readSchema();

    for (const path of files) {
      if (!isNote(path)) continue;
      const raw = readFileSync(join(this.root, path), "utf8");
      const text = normaliseLineEndings(raw);
      const headings = extractHeadings(text);
      // A note's title is its file name, as in Obsidian. Notes often use first-level headings for sections.
      const title = stem(path);
      const links = findLinks(text).map((link) => ({
        link,
        resolution: resolver.resolve(link, path),
      }));
      const fields = readFields(text);
      // Relations that cannot be read are listed with the other fields that cannot be (stage 30).
      fields.problems.push(...readRelations(text).problems);
      notes.set(path, {
        path,
        title,
        aliases: aliasesOf(text),
        text,
        lineEnding: detectLineEnding(raw),
        headings,
        links,
        fields,
      });
      if (fields.id) ids.set(fields.id, [...(ids.get(fields.id) ?? []), path]);
    }

    for (const note of notes.values()) {
      for (const { link, resolution } of note.links) {
        if (resolution.kind !== "note" || resolution.path === note.path) continue;
        const list = backlinks.get(resolution.path) ?? [];
        list.push({ path: note.path, title: note.title, line: lineOf(note.text, link.start) });
        backlinks.set(resolution.path, list);
      }
    }

    this.files = files;
    this.resolver = resolver;
    this.notes = notes;
    this.backlinkMap = backlinks;
    this.ids = ids;
    this.commit = commit;
    this.generation++;
  }

  /**
   * The schema in use: the schema file's types, with their `folders` lists taken from the folder
   * file once one exists. Every reader of folder types (`typeFromFolder`) goes through here.
   */
  get schema(): Schema {
    const types = this.folderTypes();
    const base = this.baseSchema;
    if (types === null) return base;
    const out: Schema["types"] = {};
    for (const name of Object.keys(base.types)) out[name] = { folders: [] };
    for (const [path, type] of types) {
      // A type the schema no longer has still gives its folder that type.
      (out[type] ??= { folders: [] }).folders.push(path);
    }
    return { ...base, types: out };
  }

  /** Said on the status page while the schema's folder lists are kept but no longer read. */
  get schemaNote(): string | null {
    if (this.schemaBuiltIn || this.folderTypes() === null) return null;
    const listed = Object.values(this.fileSchema.types).some((t) => t.folders.length > 0);
    return listed
      ? `The folder lists in ${SCHEMA_FILE} are no longer read: folder types now come from .frontier/folders.json.`
      : null;
  }

  private readSchema(): void {
    this.fileSchema = BUILT_IN_SCHEMA;
    this.schemaText = BUILT_IN_SCHEMA_TEXT;
    this.schemaBuiltIn = true;
    this.schemaProblem = null;
    const file = join(this.root, SCHEMA_FILE);
    if (!existsSync(file)) return;
    try {
      const text = readFileSync(file, "utf8");
      const schema = parseSchema(text);
      if (schema.version !== 1)
        throw new Error(`It has version ${schema.version}; Frontier reads version 1.`);
      this.fileSchema = schema;
      this.schemaText = text;
      this.schemaBuiltIn = false;
    } catch (err) {
      this.schemaProblem = `${SCHEMA_FILE} cannot be used, so the built-in schema is in use. ${
        err instanceof Error ? err.message : ""
      }`.trim();
    }
  }

  hasId(id: string): boolean {
    return this.ids.has(id);
  }

  /** The path of the entry with this id, or undefined when none or more than one carries it. */
  byId(id: string): string | undefined {
    const paths = this.ids.get(id);
    return paths?.length === 1 ? paths[0] : undefined;
  }

  /**
   * Headings and resolved links for a text that is not the published one, such as a draft.
   * `added` and `removed` adjust the file list the links are resolved against.
   */
  analyse(path: string, text: string, added: string[] = [], removed: string[] = []) {
    const resolver =
      added.length === 0 && removed.length === 0
        ? this.resolver
        : createResolver([...this.files.filter((f) => !removed.includes(f)), ...added]);
    return {
      headings: extractHeadings(text),
      links: findLinks(text).map((link) => ({ link, resolution: resolver.resolve(link, path) })),
    };
  }

  note(path: string): IndexedNote | undefined {
    return this.notes.get(path);
  }

  allNotes(): IndexedNote[] {
    return [...this.notes.values()];
  }

  /** The files as a set, for `hasFile`; made again when `files` is another list than the one it was made from. */
  private fileSet: { of: string[]; set: Set<string> } | null = null;

  hasFile(path: string): boolean {
    if (this.fileSet?.of !== this.files)
      this.fileSet = { of: this.files, set: new Set(this.files) };
    return this.fileSet.set.has(path);
  }

  backlinks(path: string): Backlink[] {
    return this.backlinkMap.get(path) ?? [];
  }

  /** Whether an existing file may be edited: not append-only, not excluded, and no mixed line endings. */
  readOnly(path: string): boolean {
    if (!isEditable(path)) return true;
    return this.notes.get(path)?.lineEnding === "mixed";
  }

  /** What `attention` found, kept for the build it was worked out from: it is asked for on every status event. */
  private attentionAt: {
    generation: number;
    found: ReturnType<VaultIndex["findAttention"]>;
  } | null = null;

  attention() {
    if (this.attentionAt?.generation !== this.generation) {
      this.attentionAt = { generation: this.generation, found: this.findAttention() };
    }
    return this.attentionAt.found;
  }

  private findAttention() {
    const notes = this.allNotes();
    const ambiguousLinks: { path: string; raw: string; candidates: string[] }[] = [];
    const brokenAppendixLinks: { path: string; raw: string }[] = [];
    for (const note of notes) {
      for (const { link, resolution } of note.links) {
        if (resolution.kind === "ambiguous") {
          ambiguousLinks.push({
            path: note.path,
            raw: link.raw,
            candidates: resolution.candidates,
          });
        } else if (resolution.kind === "unresolved" && isInAppendix(note.path)) {
          brokenAppendixLinks.push({ path: note.path, raw: link.raw });
        }
      }
    }
    return {
      ambiguousLinks,
      duplicateImages: this.resolver.duplicateImageNames(),
      mixedEndings: notes.filter((n) => n.lineEnding === "mixed").map((n) => n.path),
      brokenAppendixLinks,
      nearFolderNotes: notes.filter((n) => isNearFolderNote(n.path)).map((n) => n.path),
      unreadableFields: notes
        .filter((n) => n.fields.problems.length > 0)
        .map((n) => ({ path: n.path, problems: n.fields.problems })),
      duplicateIds: [...this.ids]
        .filter(([, paths]) => paths.length > 1)
        .map(([id, paths]) => ({ id, paths })),
    };
  }
}

/** How a resolution is reported to the browser. */
export function linkKindOf(
  r: Resolution,
): "resolved" | "unresolved" | "ambiguous" | "outside" | "image" {
  if (r.kind === "note") return "resolved";
  if (r.kind === "file") return isImage(r.path) ? "image" : "resolved";
  return r.kind;
}

export { isExcluded };
