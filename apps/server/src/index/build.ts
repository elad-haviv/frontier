/**
 * The in-memory index of the published vault, built by reading the working copy.
 * Nothing here is saved to disk; it is rebuilt at start and after every fetch.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  aliasesOf,
  createResolver,
  detectLineEnding,
  extractHeadings,
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
  type Resolution,
  type Resolver,
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

export class VaultIndex {
  /** The commit the index was built from. */
  commit: string | null = null;
  files: string[] = [];
  private notes = new Map<string, IndexedNote>();
  private backlinkMap = new Map<string, Backlink[]>();
  private resolver: Resolver = createResolver([]);

  constructor(private readonly root: string) {}

  /** Reads the whole working copy. At 500 notes this takes well under a second. */
  build(commit: string): void {
    const files = walk(this.root);
    const resolver = createResolver(files);
    const notes = new Map<string, IndexedNote>();
    const backlinks = new Map<string, Backlink[]>();

    for (const path of files) {
      if (!isNote(path)) continue;
      const raw = readFileSync(join(this.root, path), "utf8");
      const text = normaliseLineEndings(raw);
      const headings = extractHeadings(text);
      const title = headings.find((h) => h.level === 1)?.text || stem(path);
      const links = findLinks(text).map((link) => ({
        link,
        resolution: resolver.resolve(link, path),
      }));
      notes.set(path, {
        path,
        title,
        aliases: aliasesOf(text),
        text,
        lineEnding: detectLineEnding(raw),
        headings,
        links,
      });
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
    this.commit = commit;
  }

  note(path: string): IndexedNote | undefined {
    return this.notes.get(path);
  }

  allNotes(): IndexedNote[] {
    return [...this.notes.values()];
  }

  hasFile(path: string): boolean {
    return this.files.includes(path);
  }

  backlinks(path: string): Backlink[] {
    return this.backlinkMap.get(path) ?? [];
  }

  /** Whether an existing file may be edited: not append-only, not excluded, and no mixed line endings. */
  readOnly(path: string): boolean {
    if (!isEditable(path)) return true;
    return this.notes.get(path)?.lineEnding === "mixed";
  }

  attention() {
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
