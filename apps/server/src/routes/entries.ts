import type { RouteApp } from "../projects/facade.js";
import {
  type EntryResponse,
  type FolderFile,
  type SchemaResponse,
  type TreeFolder,
  type TreeResponse,
  VaultPath,
} from "@frontier/schema";
import { dirname, isImage, isNote, readFields, stem, typeFromFolder } from "@frontier/vault";
import { z } from "zod";
import { factsOf } from "../keepGoing/derived.js";
import { overlay } from "../entries/overlay.js";
import { ApiError } from "../errors.js";
import { type IndexedLink, linkKindOf } from "../index/build.js";
import { movedPath } from "../publish/publish.js";
import type { Services } from "../app.js";

const EntryQuery = z
  .object({ path: VaultPath.optional(), id: z.string().optional() })
  .refine((q) => (q.path === undefined) !== (q.id === undefined), "Give a path or an id.");

const FindQuery = z.object({
  /** What an embed points at, as written: "![[name.png]]" sends "name.png". */
  name: z
    .string()
    .min(1)
    .max(1000)
    .regex(/^[^[\]\n|]+$/),
  /** The note the embed is in, which decides between images of the same name. */
  from: VaultPath,
});

function shown(links: IndexedLink[]): EntryResponse["links"] {
  return links.map(({ link, resolution }) => ({
    raw: link.raw,
    from: link.start,
    to: link.end,
    kind: linkKindOf(resolution),
    ...(resolution.kind === "note" || resolution.kind === "file"
      ? { target: resolution.path }
      : {}),
    ...(resolution.kind === "ambiguous" ? { candidates: resolution.candidates } : {}),
  }));
}

export function entryRoutes(app: RouteApp, s: Services): void {
  /** The structured fields of a text, with the links inside each date resolved. */
  const fieldsOf = (path: string, text: string): Pick<EntryResponse, "id" | "fields"> => {
    const fields = readFields(text);
    const schema = s.index.schema;
    const fromFolder = typeFromFolder(schema, path);
    const type = fields.type ?? fromFolder;
    return {
      id: fields.id,
      fields: {
        type,
        typeFrom: fields.type ? "field" : fromFolder ? "folder" : "none",
        typeKnown: type === null || type in schema.types,
        time: fields.time.map((item) => ({
          what: item.what,
          when: item.when,
          known: item.what in schema.what,
          links: shown(s.index.analyse(path, item.when).links).map((l) => ({
            raw: l.raw,
            kind: l.kind,
            ...(l.target ? { target: l.target } : {}),
          })),
        })),
        problems: fields.problems,
        proposed: s.proposals.pendingFor(path),
      },
    };
  };

  const mapsOf = async (path: string) => {
    const id = await s.maps.entryId(path);
    return id ? s.maps.mapsFor(id) : [];
  };
  const chroniclesOf = async (path: string) => {
    const id = await s.maps.entryId(path);
    return id ? s.chronicles.chroniclesFor(id) : [];
  };

  app.get("/api/schema", async (): Promise<SchemaResponse> => ({
    text: s.index.schemaText,
    builtIn: s.index.schemaBuiltIn,
    problem: s.index.schemaProblem,
    types: Object.keys(s.index.schema.types),
    what: Object.keys(s.index.schema.what),
  }));

  /**
   * The author's view: what is published, with his drafts on top, his renames applied (a moved
   * entry keeps its old path as its link until a version is saved), and the folder file's lines:
   * empty folders, icons, colours, order and type.
   */
  app.get("/api/tree", async (request): Promise<TreeResponse> => {
    // What waits in quarantine is the writers' business; a reader sees published entries only.
    const reader = request.project?.role === "reader";
    const root: TreeFolder = { path: "", folders: [], notes: [] };
    const folders = new Map<string, TreeFolder>([["", root]]);
    const folder = (path: string): TreeFolder => {
      const known = folders.get(path);
      if (known) return known;
      const made: TreeFolder = { path, folders: [], notes: [] };
      folders.set(path, made);
      folder(dirname(path)).folders.push(made);
      return made;
    };
    const renames = s.drafts.listRenames();
    const after = (path: string) => renames.reduce((p, r) => movedPath(p, r.from, r.to) ?? p, path);
    // The entries other people have unsaved changes to get a dot (writers and owners; never text).
    const others = reader ? new Map() : s.drafts.othersUnsaved();
    const place = (note: TreeResponse["notes"][number]) => {
      const shown = after(note.path);
      // The entry is listed where it is going; its link opens it where it still is.
      const marked = others.has(note.path) ? { ...note, othersUnsaved: true } : note;
      const entry = shown === note.path ? marked : { ...marked, path: shown, moved: note.path };
      folder(dirname(shown)).notes.push(entry);
    };
    const { added, removed } = overlay(s);
    for (const note of s.index.allNotes()) {
      if (removed.includes(note.path)) continue;
      place({
        path: note.path,
        title: note.title,
        words: factsOf(note).words,
        state: s.drafts.byPath(note.path)
          ? "unpublished"
          : !reader && s.quarantine.waiting(note.path)
            ? "quarantined"
            : "published",
      });
    }
    for (const path of added) {
      // An uploaded image is not an entry and has no place in the tree.
      if (!isNote(path)) continue;
      place({ path, title: stem(path), state: "unpublished" });
    }
    // A folder that a rename moves shows where it goes, marked, with the rename's id for Undo.
    for (const r of renames) {
      const moved = folders.get(after(r.to));
      if (moved && !isNote(r.from)) {
        moved.moved = r.from;
        moved.renameId = r.id;
        moved.unpublished = true;
      }
    }
    // The folder file's lines: a folder that holds nothing yet, or no longer, is kept as a line.
    const lines = s.folders.linesAfterRenames();
    const written = s.libraryFiles.exists("folders");
    const library = new Map(
      ((s.libraryFiles.publishedValue("folders") as FolderFile | undefined)?.folders ?? []).map(
        (l) => [l.path, JSON.stringify(l)],
      ),
    );
    const own = s.folders.file().folders;
    lines.forEach((line, i) => {
      const f = written ? folder(line.path) : folders.get(line.path);
      if (!f) return;
      // A line that is new or changed since the last version saved is unpublished.
      if (written && library.get(own[i]!.path) !== JSON.stringify(own[i])) f.unpublished = true;
      if (line.icon) f.icon = line.icon;
      if (line.color) f.color = line.color;
      if (line.order) f.order = line.order;
    });
    const schema = s.index.schema;
    const mark = (f: TreeFolder): boolean => {
      let holds = f.notes.length > 0;
      for (const child of f.folders) holds = mark(child) || holds;
      if (f.path !== "") {
        const type = typeFromFolder(schema, `${f.path}/-`);
        if (type) f.type = type;
        if (!holds) f.empty = true;
      }
      return holds;
    };
    mark(root);
    return { folders: root.folders, notes: root.notes };
  });

  app.get("/api/entries", async (request): Promise<EntryResponse> => {
    const query = EntryQuery.parse(request.query);
    const path = query.path ?? (await s.maps.entryPath(query.id!));
    if (path === undefined || path === null) {
      throw new ApiError("not_found", `No single entry has the id "${query.id}".`);
    }
    const note = s.index.note(path);
    const draft = s.drafts.byPath(path);
    if (!note && (!draft || draft.kind === "delete")) {
      throw new ApiError("not_found", `There is no note at "${path}".`);
    }

    const info = draft ? { id: draft.id, revision: draft.revision, kind: draft.kind } : null;
    // Who else has unsaved changes to this entry, never what (a reader sees none), and who saved
    // the last version.
    const reader = request.project?.role === "reader";
    const othersUnsaved = reader ? [] : (s.drafts.othersUnsaved().get(path) ?? []);
    const last = note ? await s.git.lastChange(path).catch(() => null) : null;
    const lastVersion = last
      ? {
          commit: last.commit,
          at: last.at,
          by: await s.authors.resolve(last.author),
        }
      : null;
    // The one rename waiting for this entry, if any; a folder's rename is the folder's own.
    const intent = s.drafts.listRenames().find((r) => r.from === path);
    const rename = intent ? { id: intent.id, to: intent.to } : null;
    // The library file's blob, which a save sends back to say which text it started from.
    const blob = note ? ((await s.git.blobHash(path)) ?? "") : "";
    if (draft && draft.kind !== "delete" && !draft.binary) {
      const text = await s.drafts.text(draft.id);
      const { added, removed } = overlay(s);
      const { headings, links } = s.index.analyse(path, text, added, removed);
      return {
        path,
        text,
        lineEnding: draft.lineEnding,
        readOnly: false,
        state: "unpublished",
        links: shown(links),
        backlinks: s.index.backlinks(path),
        headings,
        draft: info,
        ...fieldsOf(path, text),
        maps: await mapsOf(path),
        chronicles: await chroniclesOf(path),
        blob,
        rename,
        othersUnsaved,
        lastVersion,
      };
    }

    const waiting = reader ? undefined : s.quarantine.waiting(note!.path);
    return {
      path: note!.path,
      text: note!.text,
      lineEnding: note!.lineEnding,
      readOnly: s.index.readOnly(note!.path),
      state: draft ? "unpublished" : waiting ? "quarantined" : "published",
      ...(waiting
        ? { quarantine: { commit: waiting.commit, pushedBy: waiting.pushedBy, at: waiting.at } }
        : {}),
      links: shown(note!.links),
      backlinks: s.index.backlinks(note!.path),
      headings: note!.headings,
      draft: info,
      ...fieldsOf(note!.path, note!.text),
      maps: await mapsOf(note!.path),
      chronicles: await chroniclesOf(note!.path),
      blob,
      rename,
      othersUnsaved,
      lastVersion,
    };
  });

  /**
   * The image an embed in a note points at, resolved as the reader resolves it, including images
   * uploaded but not yet published. The editor uses it to show the image in place of the embed.
   */
  app.get("/api/images/find", async (request): Promise<{ path: string | null }> => {
    const { name, from } = FindQuery.parse(request.query);
    const { added, removed } = overlay(s);
    const r = s.index.analyse(from, `![[${name}]]`, added, removed).links[0]?.resolution;
    return { path: r?.kind === "file" && isImage(r.path) ? r.path : null };
  });
}
