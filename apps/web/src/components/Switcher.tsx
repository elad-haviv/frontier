import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiFailure, entryUrl } from "../api.ts";
import { Problem } from "./ui/Problem.tsx";

interface Row {
  path: string;
  /** The line shown large: a name, or an alias. */
  name: string;
  /** The line shown small: where it is, or the words around a match. */
  detail: string;
  kind: "name" | "text";
}

const where = (path: string) => path.split("/").slice(0, -1).join(" › ");

/**
 * Jump to an entry by typing part of its name or of one of its aliases. From two letters on, it
 * also searches the text of every entry.
 */
export function Switcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [at, setAt] = useState(0);
  /** Set when the server could not be reached, so an empty list is not taken for "nothing found". */
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    let live = true;
    const wait = window.setTimeout(async () => {
      const q = query.trim();
      let lost = false;
      const none = (err: unknown) => {
        if (err instanceof ApiFailure && err.status === 0) lost = true;
        return { results: [] };
      };
      const [names, text] = await Promise.all([
        api.names(q).catch(none),
        q.length >= 2 ? api.search(q).catch(none) : Promise.resolve({ results: [] }),
      ]);
      if (!live) return;
      setUnreachable(lost);
      const byName: Row[] = names.results.slice(0, 20).map((n) => ({
        path: n.path,
        name: n.alias ?? n.title,
        detail: `${n.alias ? `${n.title} · ` : ""}${where(n.path)}`,
        kind: "name",
      }));
      const named = new Set(byName.map((r) => r.path));
      const byText: Row[] = text.results
        .filter((r) => !named.has(r.path))
        .slice(0, 20)
        .map((r) => ({ path: r.path, name: r.title, detail: r.snippet, kind: "text" }));
      setRows([...byName, ...byText]);
      setAt(0);
    }, 100);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [query, attempt]);

  useEffect(() => {
    list.current?.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function go(row: Row | undefined) {
    if (!row) return;
    onClose();
    navigate(entryUrl(row.path));
  }

  const firstText = rows.findIndex((r) => r.kind === "text");

  return (
    <div
      className="switcher"
      role="dialog"
      aria-modal="true"
      aria-label="Find an entry"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="switcher-box">
        <input
          ref={input}
          type="search"
          value={query}
          placeholder="Find an entry or search the text…"
          aria-label="Name or words to search for"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") go(rows[at]);
          }}
        />
        <ul role="listbox" ref={list}>
          {rows.map((row, i) => (
            <li key={`${row.kind}|${row.path}|${row.name}`} role="option" aria-selected={i === at}>
              {i === firstText && <p className="switcher-label">In the text</p>}
              <button
                type="button"
                className={i === at ? "is-current" : ""}
                onClick={() => go(row)}
              >
                <span className="switcher-name">{row.name}</span>
                <span className={`switcher-where${row.kind === "text" ? " is-snippet" : ""}`}>
                  {row.detail}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && !unreachable && (
            <li className="muted switcher-empty">Nothing found.</li>
          )}
          {unreachable && (
            <li className="switcher-empty">
              <Problem
                reason="Can't reach Frontier. Check the connection, then try again."
                onRetry={() => setAttempt((n) => n + 1)}
              />
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
