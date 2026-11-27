import type { RouteApp } from "../projects/facade.js";
import { VaultPath } from "@frontier/schema";
import { isNote, rankNames, splitFrontmatter, stem, typeFromFolder } from "@frontier/vault";
import { z } from "zod";
import { factsOf } from "../keepGoing/derived.js";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const Query = z.object({
  q: z.string().max(200).optional(),
  appendices: z.enum(["0", "1"]).optional(),
});

export function searchRoutes(app: RouteApp, s: Services): void {
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
    const { type } = z.object({ type: z.string().max(60).optional() }).parse(request.query);
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
    if (!type) return { results };
    // For a property that links to a type (stage 34): entries of that type come first, marked.
    const schema = s.index.schema;
    const wanted = type.toLowerCase();
    const marked = results.map((hit) => {
      const mine = s.index.note(hit.path)?.fields.type ?? typeFromFolder(schema, hit.path);
      return mine?.toLowerCase() === wanted ? { ...hit, ofType: true } : hit;
    });
    return {
      results: [...marked.filter((r) => "ofType" in r), ...marked.filter((r) => !("ofType" in r))],
    };
  });
}
