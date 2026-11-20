import { findLinks, type Link } from "./links.js";
import {
  basename,
  dirname,
  extension,
  isEditable,
  isFolderNote,
  isNote,
  normalisePath,
  stem,
  stripMd,
} from "./paths.js";
import { createResolver } from "./resolve.js";

export class RenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenameError";
  }
}

export interface RenamePlan {
  /** Every file that moves, including the notes and other files inside a renamed folder. */
  moves: { from: string; to: string }[];
  /** Notes whose text changes because a link in them is rewritten. The path is the note's old path. */
  edits: { path: string; text: string }[];
  /** Links in append-only files that pointed at a moved file. They are left as written. */
  leftAsWritten: { path: string; raw: string }[];
}

function relativePath(fromDir: string, to: string): string {
  const a = fromDir === "" ? [] : fromDir.split("/");
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array<string>(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

function encodeDestination(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg === ".." ? seg : encodeURIComponent(seg)))
    .join("/");
}

/**
 * Plans a rename or move of a note, a file or a folder.
 *
 * @param from       the current path of the note, file or folder
 * @param to         its new path
 * @param allPaths   every file path in the vault
 * @param readNote   returns the current text of a note
 *
 * Only the characters of a link's target are rewritten. Files that may not be edited (everything
 * under "99 Appendices") are never changed; their affected links are returned in `leftAsWritten`.
 */
export function planRename(
  from: string,
  to: string,
  allPaths: Iterable<string>,
  readNote: (path: string) => string,
): RenamePlan {
  const src = normalisePath(from).replace(/\/+$/, "");
  const dst = normalisePath(to).replace(/\/+$/, "");
  const paths = [...allPaths].map(normalisePath);
  const existing = new Map(paths.map((p) => [p.toLowerCase(), p]));

  if (src === dst) throw new RenameError("The new path is the same as the old one.");
  if (dst === "" || src === "") throw new RenameError("A path is missing.");

  const moves = new Map<string, string>();
  if (existing.has(src.toLowerCase())) {
    moves.set(existing.get(src.toLowerCase())!, dst);
  } else {
    const prefix = src + "/";
    const inside = paths.filter((p) => p.startsWith(prefix));
    if (inside.length === 0) throw new RenameError(`Nothing exists at "${src}".`);
    const oldName = basename(src);
    const newName = basename(dst);
    for (const p of inside) {
      let rest = p.slice(prefix.length);
      // A folder note follows its folder's name.
      if (oldName !== newName && rest === oldName + ".md") rest = newName + ".md";
      moves.set(p, dst + "/" + rest);
    }
  }

  for (const [oldPath, newPath] of moves) {
    if (!isEditable(oldPath)) {
      throw new RenameError(
        `"${oldPath}" is in an append-only or excluded folder and cannot be moved.`,
      );
    }
    const clash = existing.get(newPath.toLowerCase());
    if (clash !== undefined && !moves.has(clash)) {
      throw new RenameError(`"${newPath}" already exists.`);
    }
    if (extension(oldPath) !== extension(newPath)) {
      throw new RenameError("A rename may not change a file's extension.");
    }
  }

  const before = createResolver(paths);
  const afterPaths = paths.map((p) => moves.get(p) ?? p);
  const stemCount = new Map<string, number>();
  for (const p of afterPaths) {
    if (!isNote(p)) continue;
    const k = stem(p).toLowerCase();
    stemCount.set(k, (stemCount.get(k) ?? 0) + 1);
  }
  const nameCount = new Map<string, number>();
  for (const p of afterPaths) {
    const k = basename(p).toLowerCase();
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }

  const edits: RenamePlan["edits"] = [];
  const leftAsWritten: RenamePlan["leftAsWritten"] = [];

  for (const notePath of paths) {
    if (!isNote(notePath)) continue;
    const text = readNote(notePath);
    const links = findLinks(text);
    if (links.length === 0) continue;
    const noteAfter = moves.get(notePath) ?? notePath;
    const replacements: { start: number; end: number; value: string }[] = [];

    for (const link of links) {
      const res = before.resolve(link, notePath);
      if (res.kind !== "note" && res.kind !== "file") continue;
      const targetAfter = moves.get(res.path) ?? res.path;
      const value = rewriteTarget(link, res.path, targetAfter, notePath, noteAfter);
      if (value === null || value === text.slice(link.targetStart, link.targetEnd)) continue;
      if (!isEditable(notePath)) {
        leftAsWritten.push({ path: notePath, raw: link.raw });
        continue;
      }
      replacements.push({ start: link.targetStart, end: link.targetEnd, value });
    }

    if (replacements.length === 0) continue;
    let out = "";
    let pos = 0;
    for (const r of replacements) {
      out += text.slice(pos, r.start) + r.value;
      pos = r.end;
    }
    edits.push({ path: notePath, text: out + text.slice(pos) });
  }

  function rewriteTarget(
    link: Link,
    targetBefore: string,
    targetAfter: string,
    noteBefore: string,
    noteAfter: string,
  ): string | null {
    if (link.kind === "mdlink") {
      // A relative address changes when either end moves.
      if (targetBefore === targetAfter && noteBefore === noteAfter) return null;
      const absolute = link.target.startsWith("/");
      const rel = absolute ? "/" + targetAfter : relativePath(dirname(noteAfter), targetAfter);
      const keepMd = /\.md$/i.test(link.target) || !isNote(targetAfter);
      const shown = keepMd ? rel : stripMd(rel);
      return link.angle ? shown : encodeDestination(shown);
    }
    if (targetBefore === targetAfter) return null;
    if (link.target.trim() === "") return null; // same-note heading link
    const written = link.target.trim();
    const hadMd = /\.md$/i.test(written);
    const note = isNote(targetAfter);
    const full = note && !hadMd ? stripMd(targetAfter) : targetAfter;
    if (written.includes("/")) return full;
    const unique = note
      ? (stemCount.get(stem(targetAfter).toLowerCase()) ?? 0) <= 1
      : (nameCount.get(basename(targetAfter).toLowerCase()) ?? 0) <= 1;
    if (!unique) return full;
    return note && !hadMd ? stem(targetAfter) : basename(targetAfter);
  }

  return {
    moves: [...moves]
      .map(([f, t]) => ({ from: f, to: t }))
      .sort((a, b) => a.from.localeCompare(b.from)),
    edits,
    leftAsWritten,
  };
}

/** Whether renaming this folder also renames a folder note inside it. */
export function folderNoteOf(folder: string, allPaths: Iterable<string>): string | null {
  const wanted = normalisePath(folder).replace(/\/+$/, "");
  const candidate = `${wanted}/${basename(wanted)}.md`;
  for (const p of allPaths) {
    const n = normalisePath(p);
    if (n === candidate && isFolderNote(n)) return n;
  }
  return null;
}
