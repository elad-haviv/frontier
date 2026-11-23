/**
 * Entries by name or alias, as the quick switcher and link completion list them. The server's
 * `/api/switcher` calls it, and so does the device when it answers that route offline, so both
 * order names the same way.
 */
import { isInAppendix } from "./paths.js";

export interface NameSource {
  path: string;
  title: string;
  aliases: readonly string[];
}

export interface RankedName {
  path: string;
  title: string;
  alias?: string;
  /** True when another note shares this file name, so a link must be written with its path. */
  shared?: boolean;
}

/**
 * The names and aliases holding `query` (every one when it is empty), names starting with it
 * first, then shorter ones. Appendix notes are left out unless `appendices`. At most 50 results,
 * or 5000 with no query.
 */
export function rankNames(
  notes: readonly NameSource[],
  query: string,
  appendices = false,
): RankedName[] {
  const wanted = query.trim().toLowerCase();
  const shown = notes.filter((n) => appendices || !isInAppendix(n.path));

  const counts = new Map<string, number>();
  for (const n of shown) {
    counts.set(n.title.toLowerCase(), (counts.get(n.title.toLowerCase()) ?? 0) + 1);
  }

  const results: RankedName[] = [];
  for (const n of shown) {
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
  const rank = (r: RankedName) => {
    const name = (r.alias ?? r.title).toLowerCase();
    return (name.startsWith(wanted) ? 0 : 1) * 1000 + name.length;
  };
  results.sort(
    (a, b) => rank(a) - rank(b) || (a.alias ?? a.title).localeCompare(b.alias ?? b.title),
  );
  return results.slice(0, wanted === "" ? 5000 : 50);
}
