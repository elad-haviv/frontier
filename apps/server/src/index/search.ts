/**
 * Full-text search over the published vault. The search index is built from the vault index and
 * rebuilt whenever that was built from a new commit.
 */
import MiniSearch from "minisearch";
import { isInAppendix, splitFrontmatter } from "@frontier/vault";
import type { VaultIndex } from "./build.js";

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  draftOnly: boolean;
}

interface Doc {
  id: string;
  title: string;
  aliases: string;
  headings: string;
  body: string;
}

const SNIPPET = 160;

export class SearchIndex {
  private mini: MiniSearch<Doc> | null = null;
  private builtFrom: string | null = null;

  constructor(private readonly index: VaultIndex) {}

  private ensure(): MiniSearch<Doc> {
    if (this.mini && this.builtFrom === this.index.commit) return this.mini;
    const mini = new MiniSearch<Doc>({
      fields: ["title", "aliases", "headings", "body"],
      storeFields: ["title"],
      searchOptions: {
        boost: { title: 3, aliases: 3, headings: 2, body: 1 },
        prefix: true,
        fuzzy: 0.15,
        combineWith: "AND",
      },
    });
    mini.addAll(
      this.index.allNotes().map((n) => ({
        id: n.path,
        title: n.title,
        aliases: n.aliases.join(" "),
        headings: n.headings.map((h) => h.text).join(" "),
        body: splitFrontmatter(n.text).body,
      })),
    );
    this.mini = mini;
    this.builtFrom = this.index.commit;
    return mini;
  }

  /** Notes that contain every word of the query. Appendix notes are left out unless asked for. */
  search(query: string, includeAppendices = false, limit = 30): SearchHit[] {
    const q = query.trim();
    if (q === "") return [];
    const hits = this.ensure()
      .search(q)
      .filter((h) => includeAppendices || !isInAppendix(String(h.id)))
      .slice(0, limit);
    return hits.map((h) => {
      const note = this.index.note(String(h.id))!;
      return {
        path: note.path,
        title: note.title,
        snippet: snippet(splitFrontmatter(note.text).body, h.terms),
        draftOnly: false,
      };
    });
  }
}

/** About 160 characters of the text around the first place a matched word appears. */
export function snippet(body: string, terms: string[]): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  let start = Math.max(0, at - 50);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  let end = Math.min(flat.length, start + SNIPPET);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > at) end = space;
  }
  return `${start > 0 ? "… " : ""}${flat.slice(start, end)}${end < flat.length ? " …" : ""}`;
}
