import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { StatusSnapshot } from "@frontier/schema";
import { api, editUrl } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import { Switcher } from "./Switcher.tsx";
import { Tree } from "./Tree.tsx";
import { useDialogs } from "./Dialogs.tsx";

const Refresh = createContext<() => void>(() => undefined);
const Status = createContext<StatusSnapshot | null>(null);

/**
 * The words for keeping changes. In a library of Frontier's own a change is saved as a version;
 * where the library is shared through GitHub it is published there.
 */
export function useWords() {
  const own = useContext(Status)?.library === "own";
  return {
    own,
    waiting: own ? "Unsaved" : "Unpublished",
    title: own ? "Unsaved changes" : "Unpublished changes",
    act: own ? "Save a version" : "Publish",
    acting: own ? "Saving…" : "Publishing…",
    review: own ? "Review and save" : "Review and publish",
  };
}

/** The latest status the shell fetched, or null before the first answer. */
export const useStatus = () => useContext(Status);

/** Call after a draft or publish changed something, so the tree and the counts are read again. */
export const useRefresh = () => useContext(Refresh);

export function currentEntryPath(pathname: string): string {
  const prefix = pathname.startsWith("/e/")
    ? "/e/"
    : pathname.startsWith("/edit/")
      ? "/edit/"
      : null;
  if (prefix === null) return "";
  return pathname
    .slice(prefix.length)
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}

export function Shell({ children, onLoggedOut }: { children: ReactNode; onLoggedOut: () => void }) {
  const dialogs = useDialogs();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [switching, setSwitching] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const tree = useAsync(() => api.tree(), `tree-${version}`);
  const status = useAsync(() => api.status(), `status-${version}`);
  const current = currentEntryPath(pathname);
  const own = status.state === "ready" && status.value.library === "own";
  const words = { waiting: own ? "Unsaved" : "Unpublished" };
  const waiting = status.state === "ready" ? status.value.unpublished : 0;
  const proposals =
    status.state === "ready"
      ? status.value.inbox.branches + status.value.inbox.operations + status.value.inbox.quarantined
      : 0;

  // Ctrl+K or Cmd+K opens the switcher from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitching(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // On a phone the tree is a drawer; it closes when a page opens.
  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    await api.logout().catch(() => undefined);
    onLoggedOut();
  }

  async function newEntry() {
    const folder = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";
    const name = (
      await dialogs.prompt({
        title: "New entry",
        ...(folder ? { body: `It will be made in "${folder}".` } : {}),
        label: "Name",
        action: "Make the entry",
      })
    )?.trim();
    if (!name) return;
    const safe = name
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\.md$/i, "")
      .trim();
    if (!safe) return;
    navigate(`${editUrl(`${folder ? folder + "/" : ""}${safe}.md`)}?new=1`);
  }

  return (
    <Refresh.Provider value={refresh}>
      <Status.Provider value={status.state === "ready" ? status.value : null}>
        <div className={`shell${open ? " drawer-open" : ""}`}>
          <header className="topbar">
            <button
              type="button"
              className="icon-button menu"
              aria-label={open ? "Close the folder list" : "Open the folder list"}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <span aria-hidden="true">{open ? "✕" : "☰"}</span>
            </button>
            <Link to="/" className="wordmark small">
              Frontier
            </Link>
            <button
              type="button"
              className="icon-button find"
              aria-label="Go to an entry"
              title="Go to an entry (Ctrl+K)"
              onClick={() => setSwitching(true)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <circle
                  cx="10.5"
                  cy="10.5"
                  r="6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M15.5 15.5 21 21"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <nav className="topnav">
              {proposals > 0 && (
                <Link to="/inbox" className="has-waiting">
                  Inbox<span className="badge">{proposals}</span>
                </Link>
              )}
              <Link to="/unpublished" className={waiting > 0 ? "has-waiting" : ""}>
                {words.waiting}
                {waiting > 0 && <span className="badge">{waiting}</span>}
              </Link>
              {proposals === 0 && (
                <Link to="/inbox" className="nav-secondary">
                  Inbox
                </Link>
              )}
              <Link to="/maps" className="nav-secondary">
                Maps
              </Link>
              <Link to="/chronicles" className="nav-secondary">
                Chronicles
              </Link>
              <Link to="/gallery" className="nav-secondary">
                Gallery
              </Link>
              <Link to="/import" className="nav-secondary">
                Import
              </Link>
              <Link to="/settings" className="nav-secondary">
                Settings
              </Link>
              <Link to="/status" className="nav-secondary">
                Status
              </Link>
              <button type="button" className="plain nav-secondary" onClick={logout}>
                Log out
              </button>
            </nav>
          </header>

          <aside className="sidebar" aria-label="Folders">
            <button type="button" className="new-entry" onClick={newEntry}>
              + New entry
            </button>
            {tree.state === "loading" && <p className="muted pad">Loading…</p>}
            {tree.state === "failed" && <p className="error pad">{tree.error.message}</p>}
            {tree.state === "ready" && <Tree tree={tree.value} current={current} />}
            <p className="sidebar-foot">
              <Link to="/maps">Maps</Link>
              <Link to="/chronicles">Chronicles</Link>
              <Link to="/gallery">Gallery</Link>
              <Link to="/import">Import</Link>
              <Link to="/versions">Versions</Link>
              <Link to="/inbox">Inbox</Link>
              <Link to="/settings">Settings</Link>
              <Link to="/status">Status</Link>
              <button type="button" className="plain" onClick={logout}>
                Log out
              </button>
            </p>
          </aside>
          {open && (
            <button
              type="button"
              className="scrim"
              aria-label="Close the folder list"
              onClick={() => setOpen(false)}
            />
          )}

          <main className="content">{children}</main>
          {switching && <Switcher onClose={() => setSwitching(false)} />}
        </div>
      </Status.Provider>
    </Refresh.Provider>
  );
}
