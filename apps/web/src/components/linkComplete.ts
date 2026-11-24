import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { api } from "../api.ts";

interface Name {
  path: string;
  title: string;
  alias?: string;
  shared?: boolean;
}

let cache: { at: number; names: Name[] } | null = null;

/** Every entry name and alias. Read again after 30 seconds, so new entries show up. */
async function names(): Promise<Name[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.names;
  const { results } = await api.names();
  cache = { at: Date.now(), names: results };
  return results;
}

/** What is written between the brackets for a choice. */
export function linkText(n: Name): string {
  // Two notes with one name: the link is written with its path, so it cannot be ambiguous.
  const target = n.shared ? n.path.replace(/\.md$/i, "") : n.title;
  return n.alias ? `${target}|${n.alias}` : target;
}

/**
 * What a link to the entry at `path` is written with: its name, or its path when another entry
 * shares the name. The rule renames use too.
 */
export async function linkTarget(path: string, title: string): Promise<string> {
  const all = await names().catch(() => [] as Name[]);
  const row = all.find((n) => n.path === path && !n.alias);
  return row ? linkText(row) : title;
}

/**
 * Offers entry names after "[[". Choosing one writes the link; an alias is written as
 * "[[Entry|Alias]]", the way Obsidian writes it.
 */
export async function completeLinks(context: CompletionContext): Promise<CompletionResult | null> {
  const before = context.matchBefore(/\[\[[^\]\n|#]*$/);
  if (!before) return null;
  const typed = before.text.slice(2).toLowerCase();
  let all: Name[];
  try {
    all = await names();
  } catch {
    return null;
  }
  const closes = context.state.sliceDoc(context.pos, context.pos + 2) === "]]";
  const options: Completion[] = all
    .filter((n) => (n.alias ?? n.title).toLowerCase().includes(typed))
    .slice(0, 60)
    .map((n) => ({
      label: n.alias ?? n.title,
      detail: n.alias ? `→ ${n.title}` : (n.path.split("/").slice(0, -1).pop() ?? ""),
      apply: (view, _completion, from, to) => {
        const insert = `${linkText(n)}${closes ? "" : "]]"}`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length + (closes ? 2 : 0) },
        });
      },
      boost: (n.alias ?? n.title).toLowerCase().startsWith(typed) ? 1 : 0,
    }));
  return { from: before.from + 2, options, filter: false };
}
