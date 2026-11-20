/**
 * Path rules for the vault. All paths are relative to the vault root and use "/" as separator.
 */

/** Folders that are never indexed or edited. */
export const EXCLUDED_FOLDERS = [".git", ".obsidian", ".claude", ".gemini", ".frontier"] as const;

/** Everything under this folder is append-only: new files may be added, existing ones never change. */
export const APPENDIX_ROOT = "99 Appendices";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

export function normalisePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function extension(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** File name without its last extension. */
export function stem(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}

export function stripMd(path: string): string {
  return /\.md$/i.test(path) ? path.slice(0, -3) : path;
}

export function joinPath(...parts: string[]): string {
  return resolveSegments(parts.filter((p) => p !== "").join("/"));
}

/** Resolves "." and ".." segments. Returns null when the path climbs above the vault root. */
export function resolveSegmentsStrict(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join("/");
}

function resolveSegments(path: string): string {
  return resolveSegmentsStrict(path) ?? "";
}

export function isExcluded(path: string): boolean {
  const first = normalisePath(path).split("/")[0] ?? "";
  return (EXCLUDED_FOLDERS as readonly string[]).includes(first);
}

/** A note is a Markdown file outside the excluded folders. */
export function isNote(path: string): boolean {
  return extension(path) === "md" && !isExcluded(path);
}

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extension(path));
}

export function isInAppendix(path: string): boolean {
  const p = normalisePath(path);
  return p === APPENDIX_ROOT || p.startsWith(APPENDIX_ROOT + "/");
}

/**
 * Whether an existing file at this path may be edited, renamed or deleted.
 * New files may always be created, including under the appendix folder.
 */
export function isEditable(path: string): boolean {
  return !isExcluded(path) && !isInAppendix(path);
}

/** The top-level folder of a note, used as its entry type. Empty for notes at the vault root. */
export function entryType(path: string): string {
  const p = normalisePath(path);
  const i = p.indexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** A folder note is a note whose file name equals the name of the folder that contains it. */
export function isFolderNote(path: string): boolean {
  if (extension(path) !== "md") return false;
  const folder = basename(dirname(path));
  return folder !== "" && stem(path) === folder;
}

function wordsOf(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w !== "" && w !== "the");
}

/**
 * A note that looks like a folder note under a slightly different name, such as
 * "Orphans/The Orphans.md" or "Ru'una/Ru'una (Moon).md". These are ordinary notes; the app lists
 * them once so the author can decide whether to rename them.
 */
export function isNearFolderNote(path: string): boolean {
  if (extension(path) !== "md" || isFolderNote(path)) return false;
  const folder = basename(dirname(path));
  if (folder === "") return false;
  const a = wordsOf(stem(path)).join(" ");
  const b = wordsOf(folder).join(" ");
  if (a === "" || b === "") return false;
  if (a === b) return true;
  // One edit apart, for a spelling slip such as "Ataemmia/Ataemia.md".
  return withinOneEdit(a, b);
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/**
 * Picks a file name for a new image that collides with no existing file name in the vault.
 * Names are compared ignoring letter case. "Camp.png" becomes "Camp 2.png", then "Camp 3.png".
 */
export function nextFreeName(wanted: string, existingNames: Iterable<string>): string {
  const taken = new Set<string>();
  for (const n of existingNames) taken.add(basename(n).toLowerCase());
  if (!taken.has(wanted.toLowerCase())) return wanted;
  const ext = extension(wanted);
  const base = ext === "" ? wanted : wanted.slice(0, wanted.length - ext.length - 1);
  const suffix = ext === "" ? "" : wanted.slice(wanted.length - ext.length - 1);
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
