/**
 * The graph of the library: every entry as a node, every link between two entries as an edge,
 * and the top-level folders with their colours.
 *
 * It is built from the published link index, with the author's drafts changing only themselves,
 * so it agrees with the entry page: a delete removes its node and the edges to and from it; an edit
 * or create takes its outbound edges from its own text, resolved as the entry page resolves a
 * draft's links. No other note's links are resolved again, and pending renames are not applied.
 *
 * It is also the compact index a device keeps for reading offline: each node carries its `id` and
 * a version mark `v`, and `files` lists the library's other files, so links resolve on the device.
 */
import {
  type DraftRecord,
  FOLDER_COLOR_NAMES,
  type FolderColor,
  type FolderFile,
  type GraphNode,
  type GraphResponse,
  sortFolders,
  versionMark,
} from "@frontier/schema";
import {
  aliasesOf,
  APPENDIX_ROOT,
  bodyWords,
  isExcluded,
  isNote,
  type Resolution,
  readFields,
  stem,
  typeFromFolder,
} from "@frontier/vault";
import type { VaultIndex } from "./build.js";

export interface GraphInput {
  index: Pick<VaultIndex, "allNotes" | "analyse" | "schema"> & Partial<Pick<VaultIndex, "files">>;
  drafts: DraftRecord[];
  /** The text of each edit or create draft of a note, by path. */
  texts: Map<string, string>;
  /** From `overlay()`: the paths drafts add and remove. */
  added: string[];
  removed: string[];
  /** The folder file as the author sees it. */
  folders: FolderFile;
  /** The library files' blob hashes by path, for the version marks. */
  blobs?: Map<string, string>;
}

/** Words of a published note, worked out once for each build of the index. */
const wordCounts = new WeakMap<object, number>();
const wordsOf = (note: { text: string }): number => {
  let n = wordCounts.get(note);
  if (n === undefined) {
    n = bodyWords(note.text);
    wordCounts.set(note, n);
  }
  return n;
};

const topOf = (path: string): string | null => {
  const i = path.indexOf("/");
  return i === -1 ? null : path.slice(0, i);
};

export function buildGraph(input: GraphInput): GraphResponse {
  const { index, drafts, texts, added, removed } = input;
  const blobs = input.blobs ?? new Map<string, string>();
  const revisions = new Map(drafts.map((d) => [d.path, d.revision]));
  const schema = index.schema;
  const typeOf = (path: string, fieldType: string | null) =>
    fieldType ?? typeFromFolder(schema, path);

  // What each node is, and where its outbound links come from.
  const byPath = new Map<string, { node: GraphNode; links: { resolution: Resolution }[] }>();
  for (const note of index.allNotes()) {
    if (removed.includes(note.path)) continue;
    byPath.set(note.path, {
      node: {
        path: note.path,
        title: note.title,
        type: typeOf(note.path, note.fields.type),
        ...(note.aliases.length > 0 ? { aliases: note.aliases } : {}),
        ...(note.fields.id ? { id: note.fields.id } : {}),
        words: wordsOf(note),
        v: versionMark(blobs.get(note.path), revisions.get(note.path)),
      },
      links: note.links,
    });
  }
  for (const draft of drafts) {
    if (draft.kind === "delete" || draft.binary || !isNote(draft.path)) continue;
    // An edit of a note no longer published has nothing to change.
    if (draft.kind === "edit" && !byPath.has(draft.path)) continue;
    const text = texts.get(draft.path);
    if (text === undefined) continue;
    const aliases = aliasesOf(text);
    const fields = readFields(text);
    byPath.set(draft.path, {
      node: {
        path: draft.path,
        title: stem(draft.path),
        type: typeOf(draft.path, fields.type),
        ...(aliases.length > 0 ? { aliases } : {}),
        unpublished: true,
        ...(fields.id ? { id: fields.id } : {}),
        words: bodyWords(text),
        v: versionMark(blobs.get(draft.path), draft.revision),
      },
      links: index.analyse(draft.path, text, added, removed).links,
    });
  }

  // Sorted by code unit, the same on every machine.
  const paths = [...byPath.keys()].sort();
  const at = new Map(paths.map((p, i) => [p, i]));
  const edges: [number, number][] = [];
  paths.forEach((path, from) => {
    const seen = new Set<number>();
    for (const { resolution } of byPath.get(path)!.links) {
      if (resolution.kind !== "note") continue;
      // A link to a deleted note, or to itself, makes no edge.
      const to = at.get(resolution.path);
      if (to === undefined || to === from || seen.has(to)) continue;
      seen.add(to);
      edges.push([from, to]);
    }
  });

  return {
    nodes: paths.map((p) => byPath.get(p)!.node),
    edges,
    ...folderColours(input.folders, paths),
    files: [
      ...(index.files ?? []).filter((f) => !isNote(f) && !isExcluded(f) && !removed.includes(f)),
      // Uploaded images not yet published.
      ...added.filter((f) => !isNote(f)),
    ].sort(),
  };
}

/**
 * The top-level folders that hold a node, in the tree's order, each with its own colour or one of
 * the colours no line of the folder file uses; and the deeper folders with a colour of their own.
 */
function folderColours(
  file: FolderFile,
  paths: string[],
): Pick<GraphResponse, "folders" | "nested"> {
  const lines = new Map(file.folders.map((l) => [l.path, l]));
  const tops = new Set<string>();
  for (const p of paths) {
    const top = topOf(p);
    if (top !== null) tops.add(top);
  }
  const ordered = sortFolders(
    [...tops].map((path) => ({ name: path, order: lines.get(path)?.order })),
  );
  const used = new Set(file.folders.map((l) => l.color).filter((c) => c !== undefined));
  const free: FolderColor[] = FOLDER_COLOR_NAMES.filter((c) => !used.has(c));
  const folders = ordered.map(({ name }) => {
    const own = lines.get(name)?.color;
    if (own) return { path: name, color: own };
    // The appendices are never given a colour of their own.
    const color = name === APPENDIX_ROOT ? null : (free.shift() ?? null);
    return { path: name, color };
  });
  const nested = file.folders
    .filter((l) => l.path.includes("/") && l.color !== undefined)
    .map((l) => ({ path: l.path, color: l.color! }));
  return { folders, nested };
}
