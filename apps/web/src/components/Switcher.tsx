import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, entryUrl } from "../api.ts";

interface Name {
  path: string;
  title: string;
  alias?: string;
}

/** Jump to any entry by typing part of its name or of one of its aliases. */
export function Switcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Name[]>([]);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    let live = true;
    const wait = window.setTimeout(() => {
      api.names(query).then(
        (r) => {
          if (!live) return;
          setResults(r.results.slice(0, 30));
          setAt(0);
        },
        () => live && setResults([]),
      );
    }, 80);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [query]);

  function go(n: Name | undefined) {
    if (!n) return;
    onClose();
    navigate(entryUrl(n.path));
  }

  return (
    <div
      className="switcher"
      role="dialog"
      aria-modal="true"
      aria-label="Go to an entry"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="switcher-box">
        <input
          ref={input}
          type="search"
          value={query}
          placeholder="Go to an entry…"
          aria-label="Entry name"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") go(results[at]);
          }}
        />
        <ul role="listbox">
          {results.map((n, i) => (
            <li key={`${n.path}|${n.alias ?? ""}`} role="option" aria-selected={i === at}>
              <button type="button" className={i === at ? "is-current" : ""} onClick={() => go(n)}>
                <span className="switcher-name">{n.alias ?? n.title}</span>
                <span className="switcher-where">
                  {n.alias ? `${n.title} · ` : ""}
                  {n.path.split("/").slice(0, -1).join(" › ")}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="muted switcher-empty">No entry has that name.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
