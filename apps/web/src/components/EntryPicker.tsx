import { useEffect, useState } from "react";
import { api } from "../api.ts";

/** Finds an entry by name, as the quick switcher does. */
export function EntryPicker({ onPick }: { onPick: (path: string, title: string) => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<{ path: string; title: string; alias?: string }[]>([]);
  useEffect(() => {
    if (query.trim() === "") {
      setRows([]);
      return;
    }
    let live = true;
    const wait = window.setTimeout(() => {
      api.names(query.trim()).then(
        (r) => live && setRows(r.results.slice(0, 6)),
        () => undefined,
      );
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [query]);
  return (
    <div className="entry-picker">
      <input
        type="search"
        aria-label="Find an entry"
        placeholder="Find an entry by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li key={r.path + (r.alias ?? "")}>
              <button
                type="button"
                className="plain"
                onClick={() => {
                  onPick(r.path, r.title);
                  setQuery("");
                }}
              >
                {r.alias ? `${r.alias} (${r.title})` : r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
