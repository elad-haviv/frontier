import type { FastifyInstance } from "fastify";
import { VaultPath } from "@frontier/schema";
import { isInAppendix, splitFrontmatter, stem } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const Query = z.object({
  q: z.string().max(200).optional(),
  appendices: z.enum(["0", "1"]).optional(),
});

interface Name {
  path: string;
  title: string;
  alias?: string;
  /** True when another note shares this file name, so a link must be written with its path. */
  shared?: boolean;
}

export function searchRoutes(app: FastifyInstance, s: Services): void {
  /** Full-text search over the published vault. */
  app.get("/api/search", async (request) => {
    const { q, appendices } = Query.parse(request.query);
    return { results: s.search.search(q ?? "", appendices === "1") };
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
    const wanted = (q ?? "").trim().toLowerCase();
    const drafts = s.drafts.list();
    const removed = new Set(drafts.filter((d) => d.kind === "delete").map((d) => d.path));
    const notes = [
      ...s.index
        .allNotes()
        .filter((n) => !removed.has(n.path))
        .map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })),
      ...drafts
        .filter((d) => d.kind === "create" && !s.index.note(d.path))
        .map((d) => ({ path: d.path, title: stem(d.path), aliases: [] as string[] })),
    ].filter((n) => appendices === "1" || !isInAppendix(n.path));

    const counts = new Map<string, number>();
    for (const n of notes)
      counts.set(n.title.toLowerCase(), (counts.get(n.title.toLowerCase()) ?? 0) + 1);

    const results: Name[] = [];
    for (const n of notes) {
      const shared = (counts.get(n.title.toLowerCase()) ?? 0) > 1;
      if (wanted === "" || n.title.toLowerCase().includes(wanted)) {
        results.push({ path: n.path, title: n.title, ...(shared ? { shared } : {}) });
      }
      for (const alias of n.aliases) {
        if (wanted === "" || alias.toLowerCase().includes(wanted)) {
          results.push({ path: n.path, title: n.title, alias, ...(shared ? { shared } : {}) });
        }
      }
    }
    // Names that start with the query come first, then shorter names.
    const rank = (r: Name) => {
      const name = (r.alias ?? r.title).toLowerCase();
      return (name.startsWith(wanted) ? 0 : 1) * 1000 + name.length;
    };
    results.sort(
      (a, b) => rank(a) - rank(b) || (a.alias ?? a.title).localeCompare(b.alias ?? b.title),
    );
    return { results: results.slice(0, wanted === "" ? 5000 : 50) };
  });
}
