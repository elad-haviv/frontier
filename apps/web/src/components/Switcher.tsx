import { isStub } from "@frontier/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "../nav.tsx";
import { ApiFailure, entryUrl } from "../api.ts";
import { lastEntry, useRecents } from "../keepGoing/recents.ts";
import { useRandom } from "../keepGoing/useRandom.ts";
import { useConnection } from "../sync/connection.ts";
import { currentEntryPath } from "./shell/entryPath.ts";
import { Problem } from "./ui/Problem.tsx";
import "./Switcher.css";
import { projectWork } from "../projectWork.ts";

interface Row {
  path: string;
  /** The line shown large: a name, or an alias. */
  name: string;
  /** The line shown small: where it is, or the words around a match. */
  detail: string;
  /**
   * Where the row comes from: a name or the text of an entry (a search), or what the box shows
   * while empty: the way back, the dice, and the entries read or edited lately.
   */
  kind: "name" | "text" | "back" | "random" | "recent";
  /** A small word after the name: "stub", or how a recent entry was last used. */
  tag?: string;
}

const where = (path: string) => path.split("/").slice(0, -1).join(" › ");

/**
 * Jump to an entry by typing part of its name or of one of its aliases. From two letters on, it
 * also searches the text of every entry. Opened empty it offers the way back to the last entry, a
 * random entry, and the entries read or edited lately.
 */
export function Switcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const snapshot = useRecents();
  const roll = useRandom();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Row[]>([]);
  const [at, setAt] = useState(0);
  /** Set when the server could not be reached, so an empty list is not taken for "nothing found". */
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Offline, names come from the device's index; the text of entries needs the server.
  const offline = useConnection().state !== "online";
  const searching = query.trim() !== "";

  useEffect(() => input.current?.focus(), []);

  // What the box shows before anything is typed. The recents are the device's own, so it works
  // with no connection.
  const idle = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    const back = lastEntry(snapshot, currentEntryPath(pathname) || null);
    if (back) {
      rows.push({
        path: back.path,
        name: `Back to last: ${back.title}`,
        detail: where(back.path),
        kind: "back",
      });
    }
    rows.push({ path: "", name: "Random entry", detail: "Open any entry", kind: "random" });
    for (const r of snapshot.recents.slice(0, 8)) {
      rows.push({
        path: r.path,
        name: r.title,
        detail: where(r.path),
        kind: "recent",
        tag: r.kind,
      });
    }
    return rows;
  }, [snapshot, pathname]);

  useEffect(() => {
    if (!searching) {
      setFound([]);
      setUnreachable(false);
      setAt(0);
      return;
    }
    let live = true;
    // Both reads go to the project the switcher is in, whichever is open when the timer ends.
    const work = projectWork();
    const wait = window.setTimeout(async () => {
      const q = query.trim();
      let lost = false;
      const none = (err: unknown) => {
        if (err instanceof ApiFailure && err.status === 0) lost = true;
        return { results: [] };
      };
      const names = await work.api.names(q).catch(none);
      const text =
        q.length >= 2 && !offline
          ? await work.api.search(q).catch(() => ({ results: [] }))
          : { results: [] };
      if (!live) return;
      setUnreachable(lost);
      const stub = (words: number | undefined) =>
        words !== undefined && isStub(words) ? "stub" : null;
      const byName: Row[] = names.results.slice(0, 20).map((n) => ({
        path: n.path,
        name: n.alias ?? n.title,
        detail: `${n.alias ? `${n.title} · ` : ""}${where(n.path)}`,
        kind: "name",
        ...(stub(n.words) ? { tag: "stub" } : {}),
      }));
      const named = new Set(byName.map((r) => r.path));
      const byText: Row[] = text.results
        .filter((r) => !named.has(r.path))
        .slice(0, 20)
        .map((r) => ({
          path: r.path,
          name: r.title,
          detail: r.snippet,
          kind: "text",
          ...(stub(r.words) ? { tag: "stub" } : {}),
        }));
      setFound([...byName, ...byText]);
      setAt(0);
    }, 100);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [query, searching, attempt, offline]);

  const rows = searching ? found : idle;

  useEffect(() => {
    list.current?.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function go(row: Row | undefined) {
    if (!row) return;
    onClose();
    if (row.kind === "random") void roll();
    else navigate(entryUrl(row.path));
  }

  const firstText = rows.findIndex((r) => r.kind === "text");
  const firstRecent = rows.findIndex((r) => r.kind === "recent");

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
              {i === firstRecent && <p className="switcher-label">Recent</p>}
              <button
                type="button"
                className={i === at ? "is-current" : ""}
                onClick={() => go(row)}
              >
                <span className="switcher-name">
                  {row.name}
                  {row.tag && <span className="switcher-tag">{row.tag}</span>}
                </span>
                <span className={`switcher-where${row.kind === "text" ? " is-snippet" : ""}`}>
                  {row.detail}
                </span>
              </button>
            </li>
          ))}
          {searching && rows.length === 0 && !unreachable && (
            <li className="muted switcher-empty">Nothing found.</li>
          )}
          {offline && !unreachable && (
            <li className="muted switcher-empty">Full-text search needs a connection.</li>
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
