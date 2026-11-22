import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { StatusSnapshot } from "@frontier/schema";
import { api, editUrl } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import { Switcher } from "./Switcher.tsx";
import { Tree } from "./Tree.tsx";
import { KeySheet } from "./KeySheet.tsx";
import { NewEntry } from "./NewEntry.tsx";
import { Icon } from "./ui/Icon.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import { Menu, MenuItem, MenuLink, MenuSeparator } from "./ui/Menu.tsx";
import { useKeyListener, useShortcut } from "../keys.ts";
import {
  Activity,
  Download,
  History,
  Keyboard,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";

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
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [making, setMaking] = useState(false);
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

  // One listener for every shortcut of the app. Ctrl+K (Cmd+K) opens the switcher from anywhere,
  // even from a field; "?" opens the list of shortcuts.
  useKeyListener();
  useShortcut("app.switcher", () => setSwitching(true));
  useShortcut("app.keys", () => setSheet(true));

  // On a phone the tree is a drawer; it closes when a page opens.
  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    await api.logout().catch(() => undefined);
    onLoggedOut();
  }

  // New entries are made in the folder of the entry in view, unless the author picks another.
  const folderInView = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";

  return (
    <Refresh.Provider value={refresh}>
      <Status.Provider value={status.state === "ready" ? status.value : null}>
        <div className={`shell${open ? " drawer-open" : ""}`}>
          <header className="topbar">
            <IconButton
              className="icon-button menu"
              label={open ? "Close the folder list" : "Open the folder list"}
              icon={open ? X : MenuIcon}
              tipSide="bottom"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            />
            <Link to="/" className="wordmark small">
              Frontier
            </Link>
            <IconButton
              className="icon-button find"
              label="Go to an entry"
              icon={Search}
              shortcut="app.switcher"
              tipSide="bottom"
              onClick={() => setSwitching(true)}
            />
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
              <Link to="/ask" className="nav-secondary">
                Ask
              </Link>
              <Link to="/chronicles" className="nav-secondary">
                Chronicles
              </Link>
              <Link to="/gallery" className="nav-secondary">
                Gallery
              </Link>
              {/* The pages for looking after the library, and leaving, wait behind "⋯". */}
              <Menu label="App menu" className="app-menu">
                <MenuLink icon={Upload} to="/import">
                  Import
                </MenuLink>
                <MenuLink icon={Download} to="/export">
                  Export
                </MenuLink>
                <MenuLink icon={History} to="/versions">
                  History of the library
                </MenuLink>
                <MenuLink icon={Settings} to="/settings">
                  Settings
                </MenuLink>
                <MenuLink icon={Activity} to="/status">
                  Status
                </MenuLink>
                <MenuItem icon={Keyboard} onSelect={() => setSheet(true)}>
                  Keyboard shortcuts
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={LogOut} onSelect={() => void logout()}>
                  Log out
                </MenuItem>
              </Menu>
            </nav>
          </header>

          <aside className="sidebar" aria-label="Folders">
            <button type="button" className="new-entry" onClick={() => setMaking(true)}>
              <Icon icon={Plus} size="sm" />
              New entry
            </button>
            {tree.state === "loading" && <p className="muted pad">Loading…</p>}
            {tree.state === "failed" && <p className="error pad">{tree.error.message}</p>}
            {tree.state === "ready" && <Tree tree={tree.value} current={current} />}
            <p className="sidebar-foot">
              <Link to="/maps">Maps</Link>
              <Link to="/ask">Ask the lore</Link>
              <Link to="/chronicles">Chronicles</Link>
              <Link to="/gallery">Gallery</Link>
              <Link to="/inbox">Inbox</Link>
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
          {sheet && <KeySheet onClose={() => setSheet(false)} />}
          {making && (
            <NewEntry
              tree={tree}
              folder={folderInView}
              onRetry={refresh}
              onMake={(path) => {
                setMaking(false);
                navigate(`${editUrl(path)}?new=1`);
              }}
              onClose={() => setMaking(false)}
            />
          )}
        </div>
      </Status.Provider>
    </Refresh.Provider>
  );
}
