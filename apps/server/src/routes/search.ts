import type { FastifyInstance } from "fastify";
import { VaultPath } from "@frontier/schema";
import { isNote, rankNames, splitFrontmatter, stem } from "@frontier/vault";
import { z } from "zod";
import { factsOf } from "../keepGoing/derived.js";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const Query = z.object({
  q: z.string().max(200).optional(),
  appendices: z.enum(["0", "1"]).optional(),
});

export function searchRoutes(app: FastifyInstance, s: Services): void {
  /** Full-text search over the published vault. */
  app.get("/api/search", async (request) => {
    const { q, appendices } = Query.parse(request.query);
    const results = s.search.search(q ?? "", appendices === "1").map((hit) => {
      const note = s.index.note(hit.path);
      return note ? { ...hit, words: factsOf(note).words } : hit;
    });
    return { results };
  });

  /** The opening of an entry, for the preview shown when a link is hovered. */
  app.get("/api/preview", async (request) => {
    const { path } = z.object({ path: VaultPath }).parse(request.query);
    const note = s.index.note(path);
    if (!note) throw new ApiError("not_found", `There is no note at "${path}".`);
    const body = splitFrontmatter(note.text).body.trim();
    const cut = body.length > 600 ? body.slice(0, body.lastIndexOf(" ", 600)) + " …" : body;
    return { path, text: cut };
  });

  /**
   * Entries by name or alias, for the quick switcher and for link autocomplete.
   * With no query it returns every name. Appendix notes are left out unless asked for.
   */
  app.get("/api/switcher", async (request) => {
    const { q, appendices } = Query.parse(request.query);
    const drafts = s.drafts.list();
    const removed = new Set(drafts.filter((d) => d.kind === "delete").map((d) => d.path));
    const notes = [
      ...s.index
        .allNotes()
        .filter((n) => !removed.has(n.path))
        .map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })),
      ...drafts
        .filter((d) => d.kind === "create" && isNote(d.path) && !s.index.note(d.path))
        .map((d) => ({ path: d.path, title: stem(d.path), aliases: [] as string[] })),
    ];
    // The same ranking the device uses offline, from its compact index.
    const results = rankNames(notes, q ?? "", appendices === "1").map((hit) => {
      const note = s.index.note(hit.path);
      return note ? { ...hit, words: factsOf(note).words } : hit;
    });
    return { results };
  });
}
