import type { FastifyInstance } from "fastify";
import {
  type EntryResponse,
  type TreeFolder,
  type TreeResponse,
  VaultPath,
} from "@frontier/schema";
import { dirname } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { linkKindOf } from "../index/build.js";
import type { Services } from "../app.js";

const EntryQuery = z.object({ path: VaultPath });

export function entryRoutes(app: FastifyInstance, s: Services): void {
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
    for (const note of s.index.allNotes()) {
      folder(dirname(note.path)).notes.push({
        path: note.path,
        title: note.title,
        state: "published",
      });
    }
    return { folders: root.folders, notes: root.notes };
  });

  app.get("/api/entries", async (request): Promise<EntryResponse> => {
    const { path } = EntryQuery.parse(request.query);
    const note = s.index.note(path);
    if (!note) throw new ApiError("not_found", `There is no note at "${path}".`);
    return {
      path: note.path,
      text: note.text,
      lineEnding: note.lineEnding,
      readOnly: s.index.readOnly(note.path),
      state: "published",
      links: note.links.map(({ link, resolution }) => ({
        raw: link.raw,
        from: link.start,
        to: link.end,
        kind: linkKindOf(resolution),
        ...(resolution.kind === "note" || resolution.kind === "file"
          ? { target: resolution.path }
          : {}),
        ...(resolution.kind === "ambiguous" ? { candidates: resolution.candidates } : {}),
      })),
      backlinks: s.index.backlinks(note.path),
      headings: note.headings,
      draft: null,
    };
  });
}
