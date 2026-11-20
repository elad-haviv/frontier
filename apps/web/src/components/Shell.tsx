import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, editUrl } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import { Tree } from "./Tree.tsx";

const Refresh = createContext<() => void>(() => undefined);

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
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const tree = useAsync(() => api.tree(), `tree-${version}`);
  const status = useAsync(() => api.status(), `status-${version}`);
  const current = currentEntryPath(pathname);
  const waiting = status.state === "ready" ? status.value.unpublished : 0;

  // On a phone the tree is a drawer; it closes when a page opens.
  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    await api.logout().catch(() => undefined);
    onLoggedOut();
  }

  function newEntry() {
    const folder = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";
    const name = window.prompt(`Name of the new entry${folder ? ` in "${folder}"` : ""}:`)?.trim();
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
          <nav className="topnav">
            <Link to="/unpublished" className={waiting > 0 ? "has-waiting" : ""}>
              Unpublished{waiting > 0 && <span className="badge">{waiting}</span>}
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
      </div>
    </Refresh.Provider>
  );
}
