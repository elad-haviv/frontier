import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import { Tree } from "./Tree.tsx";

export function currentEntryPath(pathname: string): string {
  if (!pathname.startsWith("/e/")) return "";
  return pathname
    .slice(3)
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
  const [open, setOpen] = useState(false);
  const tree = useAsync(() => api.tree(), "tree");
  const current = currentEntryPath(pathname);

  // On a phone the tree is a drawer; it closes when a page opens.
  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    await api.logout().catch(() => undefined);
    onLoggedOut();
  }

  return (
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
        <span
          className="preview-tag"
          title="Reading only. Editing and publishing are not built yet."
        >
          read-only preview
        </span>
        <nav className="topnav">
          <Link to="/status">Status</Link>
          <button type="button" className="plain" onClick={logout}>
            Log out
          </button>
        </nav>
      </header>

      <aside className="sidebar" aria-label="Folders">
        {tree.state === "loading" && <p className="muted pad">Loading…</p>}
        {tree.state === "failed" && <p className="error pad">{tree.error.message}</p>}
        {tree.state === "ready" && <Tree tree={tree.value} current={current} />}
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
  );
}
