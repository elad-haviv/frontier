import type { TreeResponse } from "@frontier/schema";
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Dices,
  FilePlus2,
  Folder,
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
import { type ReactNode, type Ref, type TouchEvent, useEffect, useRef, useState } from "react";
import { NavLink } from "../../nav.tsx";
import { entryUrl } from "../../api.ts";
import { usePins } from "../../keepGoing/pins.ts";
import { useConnection } from "../../sync/connection.ts";
import type { Async } from "../../useAsync.ts";
import { ConnectionMark } from "../ConnectionMark.tsx";
import { Tree } from "../Tree.tsx";
import { entriesIn } from "../tree/model.ts";
import { Unsent } from "../Unsent.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Problem } from "../ui/Problem.tsx";
import { Tip } from "../ui/Tip.tsx";
import { PersonRow } from "./PersonRow.tsx";
import { ProjectMenu } from "./ProjectMenu.tsx";
import { useProject } from "../projectContext.ts";
import { isSwipeBack, type Point } from "./swipe.ts";
import "./LeftBar.css";
import "./DrawerLibrary.css";
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
    // Each person has their own unsaved changes in a project (stage 27b).
    waitingLabel: own ? "Your unsaved changes" : "Your unpublished changes",
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
      <TreeBody
        tree={tree}
        current={current}
        onRetry={onRetry}
        onNewEntryIn={onNewEntryIn}
        asked={asked}
      />
    </section>
  );
}

/** The folders, or why they cannot be shown yet. */
function TreeBody({
  tree,
  current,
  onRetry,
  onNewEntryIn,
  asked,
  replaceNav = false,
  onOpenCurrent,
}: {
  tree: Async<TreeResponse>;
  current: string;
  onRetry: () => void;
  onNewEntryIn: (folder: string) => void;
  asked: number;
  replaceNav?: boolean;
  onOpenCurrent?: () => void;
}) {
  if (tree.state === "loading") return <p className="muted pad">Loading…</p>;
  if (tree.state === "failed") return <Problem reason={tree.error.message} onRetry={onRetry} />;
  return (
    <Tree
      tree={tree.value}
      current={current}
      onNewEntry={onNewEntryIn}
      onChanged={onRetry}
      newFolderAsked={asked}
      replaceNav={replaceNav}
      {...(onOpenCurrent ? { onOpenCurrent } : {})}
    />
  );
}

/** Stays true for `ms` after `on` turns false, so a panel keeps its content while it slides out. */
function useLingering(on: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(on);
  useEffect(() => {
    if (on) return setLingering(true);
    const timer = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on || lingering;
}

/**
 * The phone's library: a panel that slides over the drawer's menu and gives the folders the
 * whole height. Its top bar has the way back to the menu and the new entry and new folder
 * buttons. The folders scroll inside the panel, and the entry in view is brought into sight when
 * it opens. A swipe right from its left edge goes back, as the browser's Back and Escape do.
 */
function LibraryPanel({
  open,
  tree,
  current,
  onBack,
  onRetry,
  onNewEntryIn,
  onClose,
  backRef,
}: {
  open: boolean;
  tree: Async<TreeResponse>;
  current: string;
  onBack: () => void;
  onRetry: () => void;
  onNewEntryIn: (folder: string) => void;
  /** Closes the whole drawer: what opening the entry already in view does. */
  onClose: () => void;
  backRef: Ref<HTMLButtonElement>;
}) {
  const [asked, setAsked] = useState(0);
  const drawn = useLingering(open, 250);
  const body = useRef<HTMLDivElement>(null);
  const swipe = useRef<Point | null>(null);
  const empty =
    tree.state === "ready" && entriesIn(tree.value) === 0 && tree.value.folders.length === 0;

  // On opening, the entry in view comes into sight, once the tree has drawn its row.
  const ready = tree.state === "ready";
  useEffect(() => {
    if (!open || !ready) return;
    let tries = 0;
    let frame = 0;
    const show = () => {
      const row = body.current?.querySelector<HTMLElement>(
        ".tree-note.active, .tree-folder.active",
      );
      if (row) row.scrollIntoView({ block: "center" });
      else if (++tries < 30) frame = requestAnimationFrame(show);
    };
    frame = requestAnimationFrame(show);
    return () => cancelAnimationFrame(frame);
  }, [open, ready]);

  /** A touch's place, from the panel's left edge and top. */
  const at = (e: TouchEvent<HTMLElement>, t: { clientX: number; clientY: number }): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: t.clientX - box.left, y: t.clientY - box.top };
  };
  return (
    <section
      className="drawer-pane is-library"
      aria-label="Library"
      aria-hidden={!open}
      inert={!open}
      onTouchStart={(e) => {
        const t = e.touches[0];
        swipe.current = e.touches.length === 1 && t ? at(e, t) : null;
      }}
      onTouchEnd={(e) => {
        const from = swipe.current;
        const t = e.changedTouches[0];
        swipe.current = null;
        if (from && t && isSwipeBack(from, at(e, t))) onBack();
      }}
      onTouchCancel={() => (swipe.current = null)}
    >
      <div className="library-head">
        <button ref={backRef} type="button" className="library-back" onClick={onBack}>
          <Icon icon={ChevronLeft} />
          Menu
        </button>
        <h2 className="library-title">Library</h2>
        {ready && !empty && (
          <IconButton
            label="New entry"
            icon={FilePlus2}
            tipSide="bottom"
            className="left-new-entry"
            onClick={() => onNewEntryIn("")}
          />
        )}
        {ready && !empty && (
          <IconButton
            label="New folder"
            icon={FolderPlus}
            tipSide="bottom"
            className="left-new-folder"
            onClick={() => setAsked((n) => n + 1)}
          />
        )}
      </div>
      <div ref={body} className="library-body">
        {drawn &&
          (empty ? (
            <div className="library-empty">
              <p>No entries yet.</p>
              <button type="button" className="new-entry" onClick={() => onNewEntryIn("")}>
                <Icon icon={Plus} size="sm" />
                New entry
              </button>
            </div>
          ) : (
            <TreeBody
              tree={tree}
              current={current}
              onRetry={onRetry}
              onNewEntryIn={onNewEntryIn}
              asked={asked}
              replaceNav
              onOpenCurrent={onClose}
            />
          ))}
      </div>
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
  library = false,
  onLibrary,
  onClose,
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
  /** In the drawer: whether the library panel is over the menu. */
  library?: boolean;
  /** In the drawer: opens or closes the library panel. */
  onLibrary?: (open: boolean) => void;
  /** In the drawer: closes it. */
  onClose?: () => void;
  /** A control for the top of the bar, such as the drawer's Close. */
  top?: ReactNode;
}) {
  const project = useProject();
  const libraryRow = useRef<HTMLButtonElement>(null);
  const libraryBack = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(library);
  // The focus goes to the panel's Back button as it opens, and back to the Library row as it
  // closes. A drawer that opens on the panel is left to the focus trap, which takes the first
  // control and remembers what had the focus before, to give it back.
  useEffect(() => {
    if (library && !wasOpen.current) libraryBack.current?.focus();
    else if (!library && wasOpen.current) libraryRow.current?.focus();
    wasOpen.current = library;
  }, [library]);
  const notes = tree.state === "ready" ? entriesIn(tree.value) : null;
  const places = (
    <nav className="left-places" aria-label="Places">
      <SideLink to="/" end icon={House} label="Home" />
      {PLACES.map((p) => (
        <SideLink key={p.to} to={p.to} icon={p.icon} label={p.label} />
      ))}
      {drawer && (
        /* On a phone the library is a place of its own: a panel over the menu. */
        <button
          ref={libraryRow}
          type="button"
          className="side-link library-row"
          aria-label={
            notes === null ? "Library" : `Library, ${notes} ${notes === 1 ? "entry" : "entries"}`
          }
          onClick={() => onLibrary?.(true)}
        >
          <Icon icon={Folder} />
          <span className="side-link-label">Library</span>
          {notes !== null && <span className="library-count">{notes}</span>}
          <Icon icon={ChevronRight} size="sm" />
        </button>
      )}
    </nav>
  );
  const bar = (
    <div className={`left-bar${drawer ? " is-drawer" : ""}`}>
      <div className="left-head">
        <ProjectMenu />
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
            label={`Search ${project.name}`}
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
        {!drawer && (
          <TreeSection
            tree={tree}
            current={current}
            onRetry={onRetryTree}
            onNewEntryIn={onNewEntryIn}
          />
        )}
      </div>
      <div className="left-foot">
        <nav className="left-waiting" aria-label="Waiting for you">
          <WaitingLinks />
        </nav>
        <div className="left-status">
          <ConnectionMark words tipSide="top" />
          <Unsent />
        </div>
        <PersonRow onKeys={onKeys} onLogout={onLogout} />
      </div>
    </div>
  );
  if (!drawer) return bar;
  // The drawer holds two panes side by side: the menu, and the library sliding in over it.
  return (
    <div className={`drawer-panes${library ? " on-library" : ""}`}>
      <div className="drawer-pane is-menu" inert={library}>
        {bar}
      </div>
      <LibraryPanel
        open={library}
        tree={tree}
        current={current}
        onBack={() => onLibrary?.(false)}
        onRetry={onRetryTree}
        onNewEntryIn={onNewEntryIn}
        onClose={() => onClose?.()}
        backRef={libraryBack}
      />
    </div>
  );
}
