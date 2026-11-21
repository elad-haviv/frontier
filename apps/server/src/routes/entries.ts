import type { FastifyInstance } from "fastify";
import {
  type EntryResponse,
  type SchemaResponse,
  type TreeFolder,
  type TreeResponse,
  VaultPath,
} from "@frontier/schema";
import { dirname, isImage, isNote, readFields, stem, typeFromFolder } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { type IndexedLink, linkKindOf } from "../index/build.js";
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

export function entryRoutes(app: FastifyInstance, s: Services): void {
  /** Paths that drafts add to, or take away from, what is published. */
  const overlay = () => {
    const drafts = s.drafts.list();
    return {
      added: drafts
        // Notes and uploaded images, so links and embeds resolve; a map is neither.
        .filter((d) => d.kind === "create" && (d.binary || isNote(d.path)) && !s.index.note(d.path))
        .map((d) => d.path),
      removed: drafts.filter((d) => d.kind === "delete").map((d) => d.path),
    };
  };

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

  app.get("/api/schema", async (): Promise<SchemaResponse> => ({
    text: s.index.schemaText,
    builtIn: s.index.schemaBuiltIn,
    problem: s.index.schemaProblem,
    types: Object.keys(s.index.schema.types),
    what: Object.keys(s.index.schema.what),
  }));

  /** The author's view: what is published, with his drafts on top. */
  app.get("/api/tree", async (): Promise<TreeResponse> => {
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
    const { added, removed } = overlay();
    for (const note of s.index.allNotes()) {
      if (removed.includes(note.path)) continue;
      folder(dirname(note.path)).notes.push({
        path: note.path,
        title: note.title,
        state: s.drafts.byPath(note.path)
          ? "unpublished"
          : s.quarantine.waiting(note.path)
            ? "quarantined"
            : "published",
      });
    }
    for (const path of added) {
      // An uploaded image is not an entry and has no place in the tree.
      if (!isNote(path)) continue;
      folder(dirname(path)).notes.push({ path, title: stem(path), state: "unpublished" });
    }
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
    if (draft && draft.kind !== "delete" && !draft.binary) {
      const text = await s.drafts.text(draft.id);
      const { added, removed } = overlay();
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
      };
    }

    const waiting = s.quarantine.waiting(note!.path);
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
    };
  });

  /**
   * The image an embed in a note points at, resolved as the reader resolves it, including images
   * uploaded but not yet published. The editor uses it to show the image in place of the embed.
   */
  app.get("/api/images/find", async (request): Promise<{ path: string | null }> => {
    const { name, from } = FindQuery.parse(request.query);
    const { added, removed } = overlay();
    const r = s.index.analyse(from, `![[${name}]]`, added, removed).links[0]?.resolution;
    return { path: r?.kind === "file" && isImage(r.path) ? r.path : null };
  });
}
