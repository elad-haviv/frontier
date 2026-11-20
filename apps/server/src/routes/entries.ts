import type { FastifyInstance } from "fastify";
import {
  type EntryResponse,
  type TreeFolder,
  type TreeResponse,
  VaultPath,
} from "@frontier/schema";
import { dirname, stem } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { type IndexedLink, linkKindOf } from "../index/build.js";
import type { Services } from "../app.js";

const EntryQuery = z.object({ path: VaultPath });

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
      added: drafts.filter((d) => d.kind === "create" && !s.index.note(d.path)).map((d) => d.path),
      removed: drafts.filter((d) => d.kind === "delete").map((d) => d.path),
    };
  };

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
        state: s.drafts.byPath(note.path) ? "unpublished" : "published",
      });
    }
    for (const path of added) {
      folder(dirname(path)).notes.push({ path, title: stem(path), state: "unpublished" });
    }
    return { folders: root.folders, notes: root.notes };
  });

  app.get("/api/entries", async (request): Promise<EntryResponse> => {
    const { path } = EntryQuery.parse(request.query);
    const note = s.index.note(path);
    const draft = s.drafts.byPath(path);
    if (!note && (!draft || draft.kind === "delete")) {
      throw new ApiError("not_found", `There is no note at "${path}".`);
    }

    const info = draft ? { id: draft.id, revision: draft.revision, kind: draft.kind } : null;
    if (draft && draft.kind !== "delete") {
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
      };
    }

    return {
      path: note!.path,
      text: note!.text,
      lineEnding: note!.lineEnding,
      readOnly: s.index.readOnly(note!.path),
      state: draft ? "unpublished" : "published",
      links: shown(note!.links),
      backlinks: s.index.backlinks(note!.path),
      headings: note!.headings,
      draft: info,
    };
  });
}
