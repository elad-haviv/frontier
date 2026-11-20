import type { Link } from "./links.js";
import {
  basename,
  dirname,
  extension,
  isExcluded,
  isImage,
  isInAppendix,
  isNote,
  normalisePath,
  resolveSegmentsStrict,
  stem,
  stripMd,
} from "./paths.js";

export type Resolution =
  /** The link points at one note. */
  | { kind: "note"; path: string; heading: string | null }
  /** The link points at one file that is not a note, such as an image. */
  | { kind: "file"; path: string }
  /** Nothing in the vault matches. For a wikilink this is an entry not yet written. */
  | { kind: "unresolved" }
  /** Several files match and Frontier does not guess. The author picks. */
  | { kind: "ambiguous"; candidates: string[] }
  /** The link names a file inside an excluded folder, or a path outside the vault. */
  | { kind: "outside"; path: string | null };

export interface Resolver {
  resolve(link: Link, fromPath: string): Resolution;
  /** Notes that share a file name with another note, ignoring letter case. */
  duplicateNoteNames(): string[][];
  /** Images that share a file name with another image, ignoring letter case. */
  duplicateImageNames(): string[][];
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Builds a resolver over every file path in the vault.
 *
 * The rule, in order:
 *  1. A link with a path resolves to that path. A trailing ".md" and letter case are ignored. A path
 *     may be written from the vault root or as the last folders of the path, as Obsidian allows.
 *  2. A bare name is matched against note file names, ignoring case and surrounding spaces.
 *     One match: it resolves there.
 *  3. Several matches, exactly one of them outside "99 Appendices": that one. This is Frontier's one
 *     stated difference from Obsidian.
 *  4. Several matches otherwise: ambiguous.
 *
 * Aliases are never link targets.
 */
export function createResolver(allPaths: Iterable<string>): Resolver {
  const notesByStem = new Map<string, string[]>();
  const notesByPath = new Map<string, string[]>();
  const filesByName = new Map<string, string[]>();
  const filesByPath = new Map<string, string[]>();
  const noteList: string[] = [];

  for (const raw of allPaths) {
    const path = normalisePath(raw);
    pushTo(filesByPath, path.toLowerCase(), path);
    if (isExcluded(path)) continue;
    pushTo(filesByName, basename(path).toLowerCase(), path);
    if (isNote(path)) {
      noteList.push(path);
      pushTo(notesByStem, stem(path).toLowerCase(), path);
      pushTo(notesByPath, stripMd(path).toLowerCase(), path);
    }
  }

  function pick(candidates: string[], heading: string | null): Resolution {
    if (candidates.length === 1) return { kind: "note", path: candidates[0]!, heading };
    const outside = candidates.filter((c) => !isInAppendix(c));
    if (outside.length === 1) return { kind: "note", path: outside[0]!, heading };
    return { kind: "ambiguous", candidates: [...candidates].sort() };
  }

  function fileResult(matches: string[]): Resolution {
    if (matches.length > 1) return { kind: "ambiguous", candidates: [...matches].sort() };
    const path = matches[0]!;
    if (isExcluded(path)) return { kind: "outside", path };
    if (isNote(path)) return { kind: "note", path, heading: null };
    return { kind: "file", path };
  }

  function resolveWiki(target: string, heading: string | null, fromPath: string): Resolution {
    const name = target.trim();
    if (name === "") return { kind: "note", path: normalisePath(fromPath), heading };
    const key = stripMd(normalisePath(name)).toLowerCase();

    if (key.includes("/")) {
      const exact = notesByPath.get(key);
      if (exact) return pick(exact, heading);
      const suffix = "/" + key;
      const tail = noteList.filter((p) => stripMd(p).toLowerCase().endsWith(suffix));
      if (tail.length > 0) return pick(tail, heading);
      const literal = filesByPath.get(normalisePath(name).toLowerCase());
      if (literal) return fileResult(literal);
      const first = normalisePath(name).split("/")[0] ?? "";
      if (isExcluded(first)) return { kind: "outside", path: null };
      return { kind: "unresolved" };
    }

    const notes = notesByStem.get(key);
    if (notes) return pick(notes, heading);
    // Not a note name: perhaps a file given by its full name, such as an embedded image.
    const files = filesByName.get(name.toLowerCase());
    if (files) return fileResult(files);
    return { kind: "unresolved" };
  }

  function resolveMarkdown(target: string, heading: string | null, fromPath: string): Resolution {
    const base = target.startsWith("/") ? "" : dirname(normalisePath(fromPath));
    const joined = resolveSegmentsStrict(
      (base === "" ? "" : base + "/") + target.replace(/^\/+/, ""),
    );
    if (joined === null) return { kind: "outside", path: null };
    const key = joined.toLowerCase();
    const matches =
      filesByPath.get(key) ?? (extension(joined) === "" ? filesByPath.get(key + ".md") : undefined);
    if (!matches) {
      const first = joined.split("/")[0] ?? "";
      return isExcluded(first) ? { kind: "outside", path: null } : { kind: "unresolved" };
    }
    const result = fileResult(matches);
    return result.kind === "note" ? { ...result, heading } : result;
  }

  function groups(map: Map<string, string[]>, keep: (p: string) => boolean): string[][] {
    const out: string[][] = [];
    for (const list of map.values()) {
      const kept = list.filter(keep);
      if (kept.length > 1) out.push([...kept].sort());
    }
    return out.sort((a, b) => a[0]!.localeCompare(b[0]!));
  }

  return {
    resolve(link, fromPath) {
      return link.kind === "wikilink"
        ? resolveWiki(link.target, link.heading, fromPath)
        : resolveMarkdown(link.target, link.heading, fromPath);
    },
    duplicateNoteNames: () => groups(notesByStem, () => true),
    duplicateImageNames: () => groups(filesByName, isImage),
  };
}
