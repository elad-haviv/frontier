import type { TreeResponse } from "@frontier/schema";
import {
  CircleDot,
  GitCompareArrows,
  Images,
  Inbox,
  type LucideIcon,
  Map as MapIcon,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  ScrollText,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
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

/** The main places, in a fixed order. */
export const PLACES: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/maps", label: "Maps", icon: MapIcon },
  { to: "/chronicles", label: "Chronicles", icon: ScrollText },
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

/** The folder list, or why it could not be read. */
export function TreeSection({
  tree,
  current,
  onRetry,
}: {
  tree: Async<TreeResponse>;
  current: string;
  onRetry: () => void;
}) {
  return (
    <section className="left-tree" aria-label="Library">
      <h2 className="left-heading">Library</h2>
      {tree.state === "loading" && <p className="muted pad">Loading…</p>}
      {tree.state === "failed" && <Problem reason={tree.error.message} onRetry={onRetry} />}
      {tree.state === "ready" && <Tree tree={tree.value} current={current} />}
    </section>
  );
}

/**
 * The left side bar: search, New entry, the library's folders, the main places, and a footer
 * with the connection, what waits, and the app menu. In the phone's drawer the places come
 * before the folders, so they are found without scrolling past every folder.
 */
export function LeftBar({
  tree,
  current,
  onRetryTree,
  onSearch,
  onNewEntry,
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
      </div>
      <div className="left-scroll">
        {drawer && places}
        <TreeSection tree={tree} current={current} onRetry={onRetryTree} />
        {!drawer && places}
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
