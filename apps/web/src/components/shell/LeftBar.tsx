import type { TreeResponse } from "@frontier/schema";
import {
  CircleDot,
  Dices,
  FilePlus2,
  FolderPlus,
  GitCompareArrows,
  House,
  Images,
  Inbox,
  type LucideIcon,
  Map as MapIcon,
  MessagesSquare,
  PanelLeftClose,
  Pin,
  Plus,
  ScrollText,
  Search,
  Waypoints,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { entryUrl } from "../../api.ts";
import { usePins } from "../../keepGoing/pins.ts";
import { useConnection } from "../../sync/connection.ts";
import type { Async } from "../../useAsync.ts";
import { ConnectionMark } from "../ConnectionMark.tsx";
import { Tree } from "../Tree.tsx";
import { Unsent } from "../Unsent.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Problem } from "../ui/Problem.tsx";
import { Tip } from "../ui/Tip.tsx";
import { AppMenu } from "./AppMenu.tsx";
import "./LeftBar.css";
import "./KeepGoing.css";

/** The main places, in a fixed order. */
export const PLACES: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/maps", label: "Maps", icon: MapIcon },
  { to: "/chronicles", label: "Chronicles", icon: ScrollText },
  { to: "/graph", label: "Graph", icon: Waypoints },
  { to: "/gallery", label: "Gallery", icon: Images },
  { to: "/ask", label: "Ask", icon: MessagesSquare },
];

/** The counts the side bar keeps, read from the server's status. */
export function useCounts() {
  const { snapshot: status } = useConnection();
  const own = status?.library === "own";
  return {
    waitingLabel: own ? "Unsaved" : "Unpublished",
    waiting: status?.unpublished ?? 0,
    inbox: status ? status.inbox.branches + status.inbox.operations + status.inbox.quarantined : 0,
    compare: status?.attention.keptCopies ?? 0,
  };
}

/**
 * One place in the side bar: an icon, its name and, when something waits there, a count. In the
 * rail only the icon and the count show; the name is in the tooltip and is still read out.
 */
export function SideLink({
  to,
  icon,
  label,
  badge = 0,
  rail = false,
  className,
  title,
  end = false,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  rail?: boolean;
  className?: string;
  title?: string;
  end?: boolean;
}) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={`side-link${badge > 0 ? " has-count" : ""}${className ? ` ${className}` : ""}`}
      {...(title && !rail ? { title } : {})}
    >
      <Icon icon={icon} />
      <span className={rail ? "sr-only" : "side-link-label"}>{label}</span>
      {badge > 0 && <span className="badge">{badge}</span>}
    </NavLink>
  );
  if (!rail) return link;
  return (
    <Tip label={title ? `${label}: ${title}` : label} side="right">
      {link}
    </Tip>
  );
}

/** What waits for the author, each in a place of its own so nothing moves when a count appears. */
export function WaitingLinks({ rail = false }: { rail?: boolean }) {
  const counts = useCounts();
  return (
    <>
      <SideLink
        to="/unpublished"
        icon={CircleDot}
        label={counts.waitingLabel}
        badge={counts.waiting}
        rail={rail}
      />
      <SideLink to="/inbox" icon={Inbox} label="Inbox" badge={counts.inbox} rail={rail} />
      {counts.compare > 0 && (
        <SideLink
          to="/status"
          icon={GitCompareArrows}
          label="Compare"
          badge={counts.compare}
          rail={rail}
          className="is-alert"
          title="Texts from other devices, kept beside a draft for you to compare"
        />
      )}
    </>
  );
}

/** "Working on": the pinned entries, above the folders. */
function PinnedList() {
  const pins = usePins();
  return (
    <section className="left-pins" aria-label="Working on">
      <h2 className="left-heading">Working on</h2>
      {pins.length === 0 ? (
        <p className="left-pins-empty muted">Nothing pinned.</p>
      ) : (
        <ul>
          {pins.map((p) => (
            <li key={p.path}>
              <NavLink to={entryUrl(p.path)} className="left-pin" title={p.path}>
                <Icon icon={Pin} size="sm" />
                <span>{p.title}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The folder list, or why it could not be read. */
export function TreeSection({
  tree,
  current,
  onRetry,
  onNewEntryIn,
}: {
  tree: Async<TreeResponse>;
  current: string;
  onRetry: () => void;
  onNewEntryIn: (folder: string) => void;
}) {
  const [asked, setAsked] = useState(0);
  return (
    <section className="left-tree" aria-label="Library">
      <div className="left-heading-row">
        <h2 className="left-heading">Library</h2>
        {tree.state === "ready" && (
          <span className="left-heading-actions">
            {/* A new entry at the top of the library, whatever entry is in view. */}
            <IconButton
              label="New entry"
              icon={FilePlus2}
              size="sm"
              tipSide="right"
              className="left-new-entry"
              onClick={() => onNewEntryIn("")}
            />
            <IconButton
              label="New folder"
              icon={FolderPlus}
              size="sm"
              tipSide="right"
              className="left-new-folder"
              onClick={() => setAsked((n) => n + 1)}
            />
          </span>
        )}
      </div>
      {tree.state === "loading" && <p className="muted pad">Loading…</p>}
      {tree.state === "failed" && <Problem reason={tree.error.message} onRetry={onRetry} />}
      {tree.state === "ready" && (
        <Tree
          tree={tree.value}
          current={current}
          onNewEntry={onNewEntryIn}
          onChanged={onRetry}
          newFolderAsked={asked}
        />
      )}
    </section>
  );
}

/**
 * The left side bar: search, New entry, the main places, the library's folders, and a footer
 * with the connection, what waits, and the app menu. The places come before the folders, so they
 * are found without scrolling past every folder; the folders scroll in the room left.
 */
export function LeftBar({
  tree,
  current,
  onRetryTree,
  onSearch,
  onNewEntry,
  onNewEntryIn,
  onRandom,
  onKeys,
  onLogout,
  onCollapse,
  drawer = false,
  top,
}: {
  tree: Async<TreeResponse>;
  current: string;
  onRetryTree: () => void;
  onSearch: () => void;
  onNewEntry: () => void;
  /** Opens the new-entry dialog in a given folder, from the tree. */
  onNewEntryIn: (folder: string) => void;
  /** Opens a random entry. */
  onRandom: () => void;
  onKeys: () => void;
  onLogout: () => void;
  /** Folds the bar to its rail; absent in the drawer. */
  onCollapse?: () => void;
  drawer?: boolean;
  /** A control for the top of the bar, such as the drawer's Close. */
  top?: ReactNode;
}) {
  const places = (
    <nav className="left-places" aria-label="Places">
      <SideLink to="/" end icon={House} label="Home" />
      {PLACES.map((p) => (
        <SideLink key={p.to} to={p.to} icon={p.icon} label={p.label} />
      ))}
    </nav>
  );
  return (
    <div className={`left-bar${drawer ? " is-drawer" : ""}`}>
      <div className="left-head">
        <Link to="/" className="wordmark small">
          Frontier
        </Link>
        {onCollapse && (
          <IconButton
            label="Fold the side bar"
            icon={PanelLeftClose}
            shortcut="app.sidebar"
            tipSide="right"
            className="left-fold"
            onClick={onCollapse}
          />
        )}
        {top}
      </div>
      <div className="left-actions">
        {!drawer && (
          <IconButton
            label="Search"
            icon={Search}
            showLabel
            shortcut="app.switcher"
            tipSide="right"
            className="find left-search"
            onClick={onSearch}
          />
        )}
        <button type="button" className="new-entry" onClick={onNewEntry}>
          <Icon icon={Plus} size="sm" />
          New entry
        </button>
        <IconButton
          label="Random entry"
          icon={Dices}
          showLabel
          shortcut="app.random"
          tipSide="right"
          className="left-random"
          onClick={onRandom}
        />
      </div>
      {/* The places stay in reach at the top; the folders fill the rest and scroll on their own. */}
      {places}
      <div className="left-scroll">
        <PinnedList />
        <TreeSection
          tree={tree}
          current={current}
          onRetry={onRetryTree}
          onNewEntryIn={onNewEntryIn}
        />
      </div>
      <div className="left-foot">
        <nav className="left-waiting" aria-label="Waiting for you">
          <WaitingLinks />
        </nav>
        <div className="left-status">
          <ConnectionMark words tipSide="top" />
          <Unsent />
          <span className="left-status-gap" />
          <AppMenu onKeys={onKeys} onLogout={onLogout} />
        </div>
      </div>
    </div>
  );
}
