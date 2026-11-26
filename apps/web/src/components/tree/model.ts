/**
 * What the folder tree shows, worked out from the server's tree and this device's copy of the
 * folder file. The server's tree already holds the folder file as the server has it; laying this
 * device's copy over it shows a change at once, before the save queue has sent it.
 */
import {
  type FolderFile,
  type FolderLine,
  movedFolderPath,
  orderBetween,
  sortFolders,
  type TreeFolder,
  type TreeResponse,
} from "@frontier/schema";

export type TreeNote = TreeResponse["notes"][number];

/** One row of the tree: a folder or an entry. */
export interface Row {
  /** "f:" and the folder's path as shown, or "n:" and the entry's path in the library. */
  id: string;
  name: string;
  kind: "folder" | "note";
  /** Where it is shown: after renames waiting to be saved. */
  path: string;
  folder?: TreeFolder;
  note?: TreeNote;
  /** A folder's own note, which opens from the folder's name. */
  own?: TreeNote;
  /** True for a folder inside a folder that a rename moves. */
  inMoved?: boolean;
  children?: Row[];
}

export const nameOf = (path: string): string => path.split("/").pop() ?? path;
export const parentOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Every folder of the tree, depth first, in the tree's order. */
export function eachFolder(tree: { folders: TreeFolder[] }, out: TreeFolder[] = []): TreeFolder[] {
  for (const f of sortFolders(tree.folders.map((x) => ({ ...x, name: nameOf(x.path) })))) {
    out.push(f);
    eachFolder(f, out);
  }
  return out;
}

/** The folder with this path as shown, if any. */
export function findFolder(tree: { folders: TreeFolder[] }, path: string): TreeFolder | undefined {
  for (const f of tree.folders) {
    if (f.path === path) return f;
    if (path.startsWith(f.path + "/")) return findFolder(f, path);
  }
  return undefined;
}

/** The renames the tree shows waiting, from where a folder is in the library to where it goes. */
export function renamesOf(tree: { folders: TreeFolder[] }): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const walk = (folders: TreeFolder[]) => {
    for (const f of folders) {
      if (f.moved !== undefined) out.push({ from: f.moved, to: f.path });
      walk(f.folders);
    }
  };
  walk(tree.folders);
  return out;
}

/** A line's path as the tree shows it, after the renames waiting. */
export function shownPath(path: string, renames: { from: string; to: string }[]): string {
  for (const r of renames) {
    const moved = movedFolderPath(path, r.from, r.to);
    if (moved !== null) return moved;
  }
  return path;
}

/** A shown path back to the path its line is kept under. */
export function libraryPath(path: string, renames: { from: string; to: string }[]): string {
  for (const r of renames) {
    const back = movedFolderPath(path, r.to, r.from);
    if (back !== null) return back;
  }
  return path;
}

/** Whether a folder holds an entry, itself or in a folder under it. */
export function holdsNotes(f: TreeFolder): boolean {
  return f.notes.length > 0 || f.folders.some(holdsNotes);
}

/**
 * The server's tree with this device's copy of the folder file laid over it: new lines appear as
 * empty folders, changed lines show their icon, colour and order, and an empty folder whose line
 * is gone disappears.
 */
export function withFolderFile(tree: TreeResponse, file: FolderFile | null): TreeResponse {
  if (!file) return tree;
  const renames = renamesOf(tree);
  const lines = new Map<string, FolderLine>();
  for (const line of file.folders) lines.set(shownPath(line.path, renames), line);
  const copy = (f: TreeFolder): TreeFolder => ({ ...f, folders: f.folders.map(copy) });
  const root: TreeFolder = { path: "", folders: tree.folders.map(copy), notes: tree.notes };
  const index = new Map<string, TreeFolder>();
  const walk = (f: TreeFolder) => {
    index.set(f.path, f);
    f.folders.forEach(walk);
  };
  walk(root);
  const ensure = (path: string): TreeFolder => {
    const known = index.get(path);
    if (known) return known;
    const made: TreeFolder = { path, folders: [], notes: [], empty: true, unpublished: true };
    index.set(path, made);
    ensure(parentOf(path)).folders.push(made);
    return made;
  };
  for (const [path, line] of lines) {
    const f = ensure(path);
    const changed =
      f.icon !== line.icon ||
      f.color !== line.color ||
      f.order !== line.order ||
      (line.type !== undefined && f.type !== line.type);
    if (changed) f.unpublished = true;
    f.icon = line.icon;
    f.color = line.color;
    f.order = line.order;
    if (line.type !== undefined) f.type = line.type;
  }
  // An empty folder is kept only by its line: one whose line went goes with it.
  const prune = (f: TreeFolder): boolean => {
    f.folders = f.folders.filter(prune);
    const keep = holdsNotes(f) || f.folders.length > 0 || lines.has(f.path) || f.path === "";
    return keep || f.moved !== undefined;
  };
  prune(root);
  return { folders: root.folders, notes: root.notes };
}

/** The rows of the tree: folders by order and then name, then entries by name. */
export function rowsOf(
  folder: { folders: TreeFolder[]; notes: TreeNote[] },
  inMoved = false,
): Row[] {
  const folders = sortFolders(folder.folders.map((f) => ({ ...f, name: nameOf(f.path) })));
  const rows: Row[] = folders.map((f) => {
    const name = f.name;
    // A note named after its folder is the folder's own page; it opens from the folder's name.
    const own = f.notes.find((n) => nameOf(n.path).toLowerCase() === `${name.toLowerCase()}.md`);
    const moved = inMoved || f.moved !== undefined;
    return {
      id: `f:${f.path}`,
      name,
      kind: "folder",
      path: f.path,
      folder: f,
      ...(own ? { own } : {}),
      ...(inMoved ? { inMoved: true } : {}),
      children: rowsOf({ folders: f.folders, notes: f.notes.filter((n) => n !== own) }, moved),
    };
  });
  const notes = [...folder.notes].sort((a, b) => byName(a.path, b.path));
  for (const n of notes) {
    rows.push({
      id: `n:${n.moved ?? n.path}`,
      name: nameOf(n.path).replace(/\.md$/i, ""),
      kind: "note",
      path: n.path,
      note: n,
    });
  }
  return rows;
}

/** The entries under a folder, its own note included. */
export function entriesUnder(f: TreeFolder): number {
  return f.notes.length + f.folders.reduce((n, c) => n + entriesUnder(c), 0);
}

/** The entries in the whole library: the top level's and every folder's. */
export function entriesIn(tree: TreeResponse): number {
  return tree.notes.length + tree.folders.reduce((n, f) => n + entriesUnder(f), 0);
}

/** The folders under a folder, itself not counted. */
export function foldersUnder(f: TreeFolder): number {
  return f.folders.reduce((n, c) => n + 1 + foldersUnder(c), 0);
}

/**
 * The order keys that put `moving` at `index` among `siblings` (shown in the tree's order, without
 * `moving`). Usually one key, for the folder moved. When it lands among folders that have no key,
 * those before it are given keys too, so the order shown is the order kept.
 */
export function placeAt(
  siblings: { path: string; order?: string | undefined }[],
  index: number,
  moving: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const before = siblings.slice(0, index);
  let last: string | null = null;
  for (const s of before) {
    if (s.order !== undefined && (last === null || s.order > last)) last = s.order;
    else {
      last = orderBetween(last, null);
      out.set(s.path, last);
    }
  }
  const next = siblings[index];
  const after =
    next?.order !== undefined && (last === null || next.order > last) ? next.order : null;
  out.set(moving, orderBetween(last, after));
  return out;
}
