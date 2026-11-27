import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  type FolderFile,
  type FolderLine,
  FOLDERS,
  renameInFolders,
  type TreeResponse,
} from "@frontier/schema";
import { checkEntryName } from "@frontier/vault";
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FolderInput,
  FolderPlus,
  type LucideIcon,
  Palette,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";
import {
  type ComponentType,
  createContext,
  Fragment,
  useContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type CursorProps,
  type MoveHandler,
  type NodeApi,
  type NodeRendererProps,
  type RowRendererProps,
  Tree as Arborist,
  type TreeApi,
} from "react-arborist";
import { Link, useNavigate } from "../nav.tsx";
import { api, ApiFailure, entryUrl } from "../api.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { useLibraryFile } from "../sync/libraryFile.ts";
import { queue } from "../sync/queue.ts";
import { useAsync } from "../useAsync.ts";
import { useDialogs } from "./Dialogs.tsx";
import { FolderSettings, type FolderStyle } from "./FolderSettings.tsx";
import { useCanWrite } from "./projectContext.ts";
import { MoveTo } from "./MoveTo.tsx";
import { stubsIn } from "../keepGoing/homeModel.ts";
import { useOpenFolders, useRevealDone, useRevealRequest } from "./shell/panels.tsx";
import { folderIcon } from "./tree/folderIcons.ts";
import {
  entriesUnder,
  findFolder,
  holdsNotes,
  libraryPath,
  nameOf,
  parentOf,
  placeAt,
  renamesOf,
  type Row,
  rowsOf,
  withFolderFile,
} from "./tree/model.ts";
import { Icon } from "./ui/Icon.tsx";
import { useToast } from "./ui/Toast.tsx";
import "./FolderSettings.css";
import "./Tree.css";
import { projectWork } from "../projectWork.ts";
import { othersAt, useOthersLookup } from "../people/live.ts";
import { joinNames } from "../people/model.ts";
import "../people/People.css";

const SAVE_FIRST = "Save a version first";
const WAIT = "Wait until your changes are sent";

/** True where the main pointer is a finger: no dragging, taller rows, "⋯" always shown. */
function useTouch(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
  );
}

interface Action {
  label: string;
  icon: LucideIcon;
  run: () => void;
  danger?: boolean;
  /** Why it cannot be chosen now; absent when it can. */
  reason?: string | null | undefined;
  /** Drawn after a line, apart from the others. */
  apart?: boolean;
}

/** The same actions, drawn as the items of a "⋯" menu or of a context menu. */
function MenuItems({
  actions,
  Item,
  Separator,
}: {
  actions: Action[];
  Item: typeof Dropdown.Item | typeof ContextMenuPrimitive.Item;
  Separator: ComponentType<{ className?: string }>;
}) {
  return (
    <>
      {actions.map((a) => (
        <Fragment key={a.label}>
          {a.apart && <Separator className="ui-menu-separator" />}
          <Item
            className={`ui-menu-item${a.danger ? " is-danger" : ""}`}
            disabled={!!a.reason}
            onSelect={a.run}
          >
            <Icon icon={a.icon} size="sm" />
            <span>{a.label}</span>
            {a.reason && <span className="ui-menu-note">{a.reason}</span>}
          </Item>
        </Fragment>
      ))}
    </>
  );
}

/** The line between rows that shows where a dragged folder would land. */
function DropLine({ top, left }: CursorProps) {
  return <div className="tree-drop-line" style={{ top: top - 1, left }} />;
}

/** Each row is named by its name alone, so it reads well and can be found by it. */
function RowFrame({ node, attrs, innerRef, children }: RowRendererProps<Row>) {
  return (
    <div
      {...attrs}
      ref={innerRef}
      aria-label={node.data.name}
      onFocus={(e) => e.stopPropagation()}
      onClick={node.handleClick}
    >
      {children}
    </div>
  );
}

/**
 * The library's folders and entries. Folders can be added, nested, moved, reordered, renamed,
 * styled and deleted: by dragging, by the "+" and "⋯" beside each name, or by a right-click (a
 * long press on touch). Arrow keys move through it, F2 renames, Enter opens.
 */
export function Tree({
  tree,
  current,
  onNewEntry,
  onChanged,
  newFolderAsked = 0,
  replaceNav = false,
  onOpenCurrent,
  focusCurrent = false,
  onFocusTaken,
}: {
  tree: TreeResponse;
  /** The entry in view, by its path in the library. */
  current: string;
  /** Takes the focus as it is drawn: the row of the entry in view, else the first row. */
  focusCurrent?: boolean;
  /** Called once the focus was given, so the ask is spent and a later mount does not repeat it. */
  onFocusTaken?: () => void;
  /** Opens the new-entry dialog in a folder. */
  onNewEntry: (folder: string) => void;
  /** Reads the tree again after a change the server made. */
  onChanged: () => void;
  /** Rises each time the author asks for a new folder at the top of the library. */
  newFolderAsked?: number;
  /** Opening an entry replaces the page in the history, as the phone's library panel needs. */
  replaceNav?: boolean;
  /**
   * Asked for when the entry already in view is opened again, instead of a navigation to the same
   * address: the phone's library panel closes the drawer.
   */
  onOpenCurrent?: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const dialogs = useDialogs();
  const offline = useNeedsConnection();
  const touch = useTouch();
  // A reader browses the folders: nothing in the tree changes them (stage 27c).
  const canWrite = useCanWrite();
  const folders = useLibraryFile(FOLDERS);
  const file = folders.value;
  const types = useAsync(() => api.schema(), "schema");
  const arborist = useRef<TreeApi<Row> | undefined>(undefined);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const [rows, setRowCount] = useState(0);

  // The server's tree is read again after each change it makes; this device's copy follows.
  const { client } = folders;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else void client.reload();
  }, [tree, client]);

  const shown = useMemo(() => withFolderFile(tree, file), [tree, file]);
  const data = useMemo(() => rowsOf(shown), [shown]);
  const renames = useMemo(() => renamesOf(tree), [tree]);
  const rowHeight = touch ? 40 : 30;

  const refuse = useCallback((message: string) => toast({ message }), [toast]);

  /** A change to the folder file, kept by the save queue. */
  const changeFile = useCallback(
    async (fn: (file: FolderFile) => FolderFile) => {
      try {
        await client.change(fn);
      } catch (err) {
        refuse(err instanceof ApiFailure ? err.message : "The folders could not be changed.");
      }
    },
    [client, refuse],
  );

  /** Sets fields of one line, adding the line when the folder has none. */
  const setLine = useCallback(
    (path: string, change: Partial<FolderLine>) =>
      changeFile((f) => {
        const at = libraryPath(path, renames);
        const known = f.folders.some((l) => l.path === at);
        const lines = known
          ? f.folders.map((l) => (l.path === at ? { ...l, ...change } : l))
          : [...f.folders, { path: at, ...change }];
        // A field set to nothing is left out of the line.
        return {
          ...f,
          folders: lines.map(
            (l) =>
              Object.fromEntries(
                Object.entries(l).filter(([, v]) => v !== undefined),
              ) as FolderLine,
          ),
        };
      }),
    [changeFile, renames],
  );

  /** Gives each folder its order key, by shown path. */
  const withOrders = (f: FolderFile, orders: Map<string, string>): FolderFile => {
    const keys = new Map([...orders].map(([p, o]) => [libraryPath(p, renames), o]));
    const lines = f.folders.map((l) => (keys.has(l.path) ? { ...l, order: keys.get(l.path)! } : l));
    for (const [path, order] of keys) {
      if (!lines.some((l) => l.path === path)) lines.push({ path, order });
    }
    return { ...f, folders: lines };
  };

  /** Records still on this device for entries under a folder. */
  const unsentUnder = (path: string) =>
    queue.current().some((r) => r.key.startsWith(`entry:${path}/`));

  /** Whether a folder, or one above it, has a rename waiting to be saved. */
  const pending = (row: Row) => !!row.folder?.moved || !!row.inMoved;

  // ---- Moving and renaming ---------------------------------------------------------------

  /**
   * Moves or renames a folder to `to` and gives it, and perhaps its new siblings, an order. A
   * folder with entries becomes a rename intent on the server, made at once, with Undo; an
   * empty folder is only its lines in the folder file.
   */
  const relocate = useCallback(
    async (row: Row, to: string, orders: Map<string, string> = new Map()) => {
      const folder = row.folder!;
      const from = folder.path;
      // The project the folder is in: the Undo below is offered for a while, and the person may
      // have moved to another project by then.
      const work = projectWork();
      if (pending(row)) return refuse(`${SAVE_FIRST}: this folder is being moved.`);
      if (to === from) {
        if (orders.size > 0) await changeFile((f) => withOrders(f, orders));
        return;
      }
      if (to.startsWith(from + "/")) return refuse("A folder cannot go inside itself.");
      if (findFolder(shown, to)) return refuse(`There is a folder "${nameOf(to)}" there already.`);
      const before = file;
      // The moved folder's order is kept on its line where it is now; saving the move moves it.
      const keyed = new Map([...orders].map(([p, o]) => [p === to ? from : p, o]));
      if (!holdsNotes(folder)) {
        const libFrom = libraryPath(from, renames);
        const libTo = libraryPath(to, renames);
        await changeFile((f) => {
          const known = f.folders.some((l) => l.path === libFrom);
          const kept = known ? f : { ...f, folders: [...f.folders, { path: libFrom }] };
          return withOrders(renameInFolders(kept, libFrom, libTo), new Map([...orders]));
        });
        toast({
          message: `Moved the folder ${nameOf(from)}.`,
          action: { label: "Undo", run: () => void (before && changeFile(() => before)) },
        });
        return;
      }
      if (offline) return refuse(`${offline}: a folder with entries moves on the server.`);
      if (unsentUnder(from)) return refuse(`${WAIT}, then move the folder.`);
      let made: { id: string; affected: string[] };
      try {
        made = await work.api.rename(from, to);
      } catch (err) {
        return refuse(err instanceof ApiFailure ? err.message : "The folder could not be moved.");
      }
      if (keyed.size > 0) await changeFile((f) => withOrders(f, keyed));
      onChanged();
      const n = entriesUnder(folder);
      const links = made.affected.length;
      toast({
        message:
          `Moved ${n} ${n === 1 ? "entry" : "entries"}` +
          (links > 0
            ? `; links in ${links} other ${links === 1 ? "entry" : "entries"} will be updated when you save a version`
            : "; it is saved with the next version"),
        action: {
          label: "Undo",
          run: () =>
            void (async () => {
              try {
                await work.api.cancelRename(made.id);
                if (keyed.size > 0 && before) await changeFile(() => before);
              } catch (err) {
                refuse(err instanceof ApiFailure ? err.message : "The move could not be undone.");
              }
              onChanged();
            })(),
        },
      });
    },
    [shown, file, renames, offline, changeFile, onChanged, refuse, toast],
  );

  /** Moves an entry into another folder, as a rename intent. */
  const moveNote = useCallback(
    async (row: Row, folder: string) => {
      const note = row.note!;
      const work = projectWork();
      const to = `${folder ? folder + "/" : ""}${nameOf(note.path)}`;
      if (to === note.path) return;
      if (offline) return refuse(`${offline}: moving an entry needs the server.`);
      if (queue.current().some((r) => r.key === `entry:${note.moved ?? note.path}`)) {
        return refuse(`${WAIT}, then move the entry.`);
      }
      try {
        const made = await work.api.rename(note.path, to);
        onChanged();
        const links = made.affected.length;
        toast({
          message: `Moved ${row.name}; links in ${links} other ${links === 1 ? "entry" : "entries"} will be updated when you save a version`,
          action: {
            label: "Undo",
            run: () => void work.api.cancelRename(made.id).then(onChanged, onChanged),
          },
        });
      } catch (err) {
        refuse(err instanceof ApiFailure ? err.message : "The entry could not be moved.");
      }
    },
    [offline, onChanged, refuse, toast],
  );

  /** A drop: the folder goes to the new parent, at the place it was dropped. */
  const onMove: MoveHandler<Row> = ({ dragNodes, parentNode, index }) => {
    const row = dragNodes[0]?.data;
    if (!row) return;
    const parent = parentNode && !parentNode.isRoot ? parentNode.data.path : "";
    if (row.kind === "note") return void moveNote(row, parent);
    const siblings = (parentNode?.children ?? []).filter(
      (n) => n.data.kind === "folder" && n.id !== row.id,
    );
    const before = (parentNode?.children ?? [])
      .slice(0, index)
      .filter((n) => n.data.kind === "folder" && n.id !== row.id).length;
    const to = `${parent ? parent + "/" : ""}${row.name}`;
    const orders = placeAt(
      siblings.map((n) => ({ path: n.data.path, order: n.data.folder?.order })),
      before,
      to,
    );
    void relocate(row, to, orders);
  };

  const rename = useCallback(
    async (row: Row, name: string) => {
      // A folder's name follows the rules of an entry's; a field left empty changes nothing.
      if (name.trim() === "") return;
      const checked = checkEntryName(name);
      if (!checked.ok) return refuse(checked.problem);
      const clean = checked.name;
      if (clean === row.name) return;
      const parent = parentOf(row.path);
      await relocate(row, `${parent ? parent + "/" : ""}${clean}`);
    },
    [relocate],
  );

  // ---- The other actions -----------------------------------------------------------------

  async function newFolder(parent: string) {
    const name = await dialogs.prompt({
      title: parent ? `New folder in ${nameOf(parent)}` : "New folder",
      label: "Name",
      action: "Make the folder",
    });
    if (!name?.trim()) return;
    const checked = checkEntryName(name);
    if (!checked.ok) return refuse(checked.problem);
    const clean = checked.name;
    const path = `${parent ? parent + "/" : ""}${clean}`;
    if (findFolder(shown, path)) return refuse(`There is a folder "${clean}" there already.`);
    await setLine(path, {});
    if (parent) arborist.current?.open(`f:${parent}`);
  }

  async function remove(row: Row) {
    const folder = row.folder!;
    const work = projectWork();
    if (pending(row)) return refuse(`${SAVE_FIRST}: this folder is being moved.`);
    if (offline) return refuse(`${offline}: deleting a folder needs the server.`);
    if (unsentUnder(folder.path)) return refuse(`${WAIT}, then delete the folder.`);
    // A new line still on this device goes first, so the server knows the folder.
    if (queue.current().some((r) => r.key === FOLDERS.name)) await client.flush();
    try {
      const counts = await work.api.deleteFolder(folder.path, true);
      const n = counts.entries;
      const entries = `${n} ${n === 1 ? "entry" : "entries"}`;
      const sub = counts.folders;
      const ok = await dialogs.confirm({
        title:
          sub > 0
            ? `Delete ${sub} ${sub === 1 ? "folder" : "folders"} and ${entries}?`
            : n > 0
              ? `Delete ${row.name} and its ${entries}?`
              : `Delete the empty folder ${row.name}?`,
        body:
          n > 0
            ? "They are marked for deletion and go when you save a version. Discard in the list of unsaved changes takes them back until then."
            : "Nothing is in it.",
        action: "Delete",
        danger: true,
      });
      if (!ok) return;
      await work.api.deleteFolder(folder.path);
      await client.reload();
      onChanged();
    } catch (err) {
      refuse(err instanceof ApiFailure ? err.message : "The folder could not be deleted.");
    }
  }

  async function applyType(row: Row) {
    if (offline) return refuse(`${offline}.`);
    try {
      const { made } = await api.applyType(row.path);
      onChanged();
      toast({
        message:
          made === 0
            ? "Every entry here has a type already."
            : `Set the type on ${made} ${made === 1 ? "entry" : "entries"}, as unsaved changes.`,
      });
    } catch (err) {
      refuse(err instanceof ApiFailure ? err.message : "The type could not be set.");
    }
  }

  const asked = useRef(newFolderAsked);
  useEffect(() => {
    if (newFolderAsked === asked.current) return;
    asked.current = newFolderAsked;
    if (canWrite) void newFolder("");
  }, [newFolderAsked]);

  const actionsFor = (row: Row): Action[] => {
    const folder = row.folder!;
    const wait = pending(row) ? SAVE_FIRST : null;
    return [
      { label: "New entry here", icon: Plus, run: () => onNewEntry(row.path) },
      {
        label: "New subfolder",
        icon: FolderPlus,
        run: () => void newFolder(row.path),
        reason: wait,
      },
      {
        label: "Rename",
        icon: Pencil,
        run: () => setTimeout(() => void arborist.current?.edit(row.id)),
        reason: wait ?? (holdsNotes(folder) ? offline : null),
      },
      {
        label: "Icon, colour and type…",
        icon: Palette,
        run: () => setSettingsFor(row.path),
        reason: wait,
      },
      {
        label: "Move to…",
        icon: FolderInput,
        run: () => setMoving(row),
        reason: wait ?? (holdsNotes(folder) ? offline : null),
      },
      ...(folder.type && holdsNotes(folder)
        ? [
            {
              label: `Set type "${folder.type}" on the entries here without one`,
              icon: Tags,
              run: () => void applyType(row),
              reason: offline,
            },
          ]
        : []),
      {
        label: "Delete…",
        icon: Trash2,
        run: () => void remove(row),
        danger: true,
        apart: true,
        reason: wait ?? offline,
      },
    ];
  };

  // ---- Keys ------------------------------------------------------------------------------

  /** Enter opens, F2 renames, the menu key (or Shift+F10) opens the row's menu. */
  function onKeyDownCapture(e: KeyboardEvent<HTMLDivElement>) {
    const t = arborist.current;
    const node = t?.focusedNode;
    if (!t || !node || t.isEditing || (e.target as HTMLElement).closest("input")) return;
    const row = node.data;
    // F2 and the menu key change things; a reader's tree has neither.
    if (!canWrite && (e.key === "F2" || e.key === "ContextMenu" || e.key === "F10")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const target =
        row.kind === "note"
          ? (row.note!.moved ?? row.note!.path)
          : row.own
            ? (row.own.moved ?? row.own.path)
            : null;
      if (target === null) node.toggle();
      else if (target === current && onOpenCurrent) onOpenCurrent();
      else navigate(entryUrl(target), replaceNav ? { replace: true } : {});
    } else if (e.key === "F2" && row.kind === "folder") {
      e.preventDefault();
      e.stopPropagation();
      if (pending(row)) refuse(`${SAVE_FIRST}: this folder is being moved.`);
      else void node.edit();
    } else if (
      row.kind === "folder" &&
      (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))
    ) {
      e.preventDefault();
      e.stopPropagation();
      setMenuFor(row.path);
    }
  }

  // ---- Open folders and the height of the list ---------------------------------------------

  // The folders open as the author last left them, kept in the shell so that the phone's panel,
  // which is drawn anew each time it opens, shows them again; the top folders on a first visit.
  const memory = useOpenFolders();
  const initialOpen = useMemo(() => {
    if (memory?.openFolders) return memory.openFolders;
    const open: Record<string, boolean> = {};
    for (const f of tree.folders) open[`f:${f.path}`] = true;
    return open;
    // Only the first tree decides what starts open.
  }, []);

  const recount = useCallback(() => {
    requestAnimationFrame(() => setRowCount(arborist.current?.visibleNodes.length ?? 0));
  }, []);
  useLayoutEffect(recount, [data, recount]);
  const toggled = useCallback(() => {
    if (memory && arborist.current) memory.openFolders = { ...arborist.current.openState };
    recount();
  }, [memory, recount]);

  // The folders holding the entry in view open, and its row is marked.
  useEffect(() => {
    const t = arborist.current;
    if (!t || !current) return;
    const id = `n:${current}`;
    const node = t.get(id);
    const folderId = node ? null : `f:${current.slice(0, current.lastIndexOf("/"))}`;
    if (node) t.openParents(id);
    else if (folderId && t.get(folderId)) t.openParents(folderId);
    recount();
  }, [current, data, recount]);

  // The library pane, opened by the author, gives the tree the focus: on the row of the entry in
  // view once it is drawn, else on the first row.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = arborist.current;
    if (!t || !focusCurrent) return;
    let tries = 0;
    let frame = 0;
    const take = () => {
      const rows = [...(box.current?.querySelectorAll<HTMLElement>(".tree-row[data-path]") ?? [])];
      // The entry's row comes a moment after the folders above it open; without one, the first.
      const row =
        rows.find((r) => r.querySelector(".tree-note.active, .tree-folder.active")) ??
        (tries >= 10 || !current ? rows[0] : null);
      if (!row) {
        if (++tries < 30) frame = requestAnimationFrame(take);
        return;
      }
      const node = t.visibleNodes.find((n) => n.data.path === row.dataset.path);
      if (node) t.focus(node.id);
      row.closest<HTMLElement>("[role=treeitem]")?.focus();
      onFocusTaken?.();
    };
    frame = requestAnimationFrame(take);
    return () => cancelAnimationFrame(frame);
    // Only the opening gives the focus, not each move to another entry.
  }, [focusCurrent]);

  // A page asked to see a folder: it opens, with the folders above it, and comes into view
  // with the focus on it, once its row is drawn.
  const reveal = useRevealRequest();
  const revealDone = useRevealDone();
  useEffect(() => {
    const t = arborist.current;
    if (!t || !reveal) return;
    revealDone();
    const id = `f:${reveal.path}`;
    if (!t.get(id)) return;
    t.openParents(id);
    t.open(id);
    recount();
    let tries = 0;
    const show = () => {
      const row = document.querySelector<HTMLElement>(
        `.tree-row[data-path="${CSS.escape(reveal.path)}"]`,
      );
      if (!row && ++tries < 20) return void requestAnimationFrame(show);
      row?.scrollIntoView({ block: "center" });
      t.focus(id);
      row?.closest<HTMLElement>("[role=treeitem]")?.focus();
    };
    requestAnimationFrame(show);
  }, [reveal, revealDone, recount]);

  // Someone else's unsaved changes to an entry (stage 27d): a dot, from the stream, never text.
  const othersLookup = useOthersLookup();
  /** How each row is drawn now; rows read it through a context, so they are never remounted. */
  const draw = (props: NodeRendererProps<Row>) => {
    const { node } = props;
    const note = node.data.kind === "note" ? node.data.note : node.data.own;
    return (
      <RowBody
        node={node}
        style={props.style}
        dragHandle={props.dragHandle}
        current={current}
        touch={touch}
        replace={replaceNav}
        onOpenCurrent={onOpenCurrent}
        menuOpen={menuFor === node.data.path}
        onMenu={(open) => setMenuFor(open ? node.data.path : null)}
        actions={canWrite && node.data.kind === "folder" ? actionsFor(node.data) : []}
        canWrite={canWrite}
        others={note ? othersAt(othersLookup, note.path, note.othersUnsaved) : null}
        onNewEntry={onNewEntry}
        onRename={(name) => void rename(node.data, name)}
      />
    );
  };

  const settingsRow = settingsFor === null ? null : findFolder(shown, settingsFor);
  const anchor = useRef<Element | null>(null);
  anchor.current =
    settingsFor === null
      ? null
      : (document.querySelector(`.tree-row[data-path="${CSS.escape(settingsFor)}"]`) ?? null);

  return (
    <Draw.Provider value={draw}>
      <div ref={box} className="tree" onKeyDownCapture={onKeyDownCapture}>
        <Arborist<Row>
          ref={arborist}
          data={data}
          idAccessor="id"
          childrenAccessor={(r) => r.children ?? null}
          openByDefault={false}
          initialOpenState={initialOpen}
          {...(current ? { selection: `n:${current}` } : {})}
          rowHeight={rowHeight}
          height={Math.max(rows, 1) * rowHeight + 4}
          width="100%"
          indent={14}
          overscanCount={50}
          disableMultiSelection
          disableEdit={(r) => !canWrite || r.kind !== "folder" || pending(r)}
          disableDrag={(r) => !canWrite || touch || (r.kind === "folder" && pending(r))}
          disableDrop={({ parentNode }) =>
            !canWrite || (!parentNode.isRoot && parentNode.data.kind !== "folder")
          }
          onMove={onMove}
          onRename={({ node, name }) => void rename(node.data, name)}
          onToggle={toggled}
          renderRow={RowFrame}
          renderCursor={DropLine}
          aria-label="Folders and entries"
          className="tree-list"
          rowClassName="tree-item"
        >
          {TreeRow}
        </Arborist>
        {settingsFor !== null && settingsRow && (
          <FolderSettings
            name={nameOf(settingsFor)}
            value={lineOf(file, libraryPath(settingsFor, renames))}
            types={types.state === "ready" ? types.value.types : []}
            inherited={inheritedType(shown, settingsFor)}
            open
            onOpenChange={(open) => !open && setSettingsFor(null)}
            onChange={(change) => void setLine(settingsFor, change)}
            anchor={anchor}
          />
        )}
        {moving && (
          <MoveTo
            tree={shown}
            row={moving}
            onClose={() => setMoving(null)}
            onMove={(parent) => {
              setMoving(null);
              if (moving.kind === "note") return void moveNote(moving, parent);
              void relocate(moving, `${parent ? parent + "/" : ""}${moving.name}`);
            }}
          />
        )}
      </div>
    </Draw.Provider>
  );
}

const Draw = createContext<(props: NodeRendererProps<Row>) => ReactNode>(() => null);

/** One row of the tree, drawn by the tree's current way of drawing rows. */
function TreeRow(props: NodeRendererProps<Row>) {
  return <>{useContext(Draw)(props)}</>;
}

/** A folder's own line in the folder file: its icon, colour and type. */
function lineOf(file: FolderFile | null, path: string): FolderStyle {
  const line = file?.folders.find((l) => l.path === path);
  return { icon: line?.icon, color: line?.color, type: line?.type };
}

/** The type a folder would have from the nearest folder above it that gives one. */
function inheritedType(tree: TreeResponse, path: string): string | undefined {
  for (let p = parentOf(path); p !== ""; p = parentOf(p)) {
    const type = findFolder(tree, p)?.type;
    if (type) return type;
  }
  return undefined;
}

/** One row: the twist, the icon, the name (or the rename field), its marks and its buttons. */
function RowBody({
  node,
  style,
  dragHandle,
  current,
  touch,
  replace,
  onOpenCurrent,
  menuOpen,
  onMenu,
  actions,
  canWrite,
  others,
  onNewEntry,
  onRename,
}: {
  node: NodeApi<Row>;
  style: React.CSSProperties;
  dragHandle?: ((el: HTMLDivElement | null) => void) | undefined;
  current: string;
  touch: boolean;
  replace: boolean;
  onOpenCurrent: (() => void) | undefined;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  actions: Action[];
  /** Whether the person may change the folders: a reader has no buttons and no menu on a row. */
  canWrite: boolean;
  /** Who else has unsaved changes to this entry: names, true when only a flag says so, or null. */
  others: { name: string }[] | true | null;
  onNewEntry: (folder: string) => void;
  onRename: (name: string) => void;
}) {
  const row = node.data;
  const folder = row.folder;

  // A closed folder opens when something is held over it for a moment.
  useEffect(() => {
    if (!node.willReceiveDrop || node.isOpen || !folder) return;
    const timer = setTimeout(() => node.open(), 600);
    return () => clearTimeout(timer);
  }, [node, node.willReceiveDrop, node.isOpen, folder]);

  const marks: ReactNode[] = [];
  if (folder?.moved)
    marks.push(
      <span key="moved" className="tree-mark">
        moved
      </span>,
    );
  else if (folder?.empty)
    marks.push(
      <span key="empty" className="tree-mark">
        empty
      </span>,
    );
  // A top folder says how many of its entries are stubs (stage 25), from the words the tree has.
  if (folder && node.level === 0 && !folder.moved) {
    const { entries, stubs } = stubsIn(folder);
    if (stubs > 0) {
      marks.push(
        <span
          key="stubs"
          className="tree-mark is-stubs"
          title={`${stubs} of ${entries} ${entries === 1 ? "entry is a stub" : "entries are stubs"}`}
        >
          {stubs} {stubs === 1 ? "stub" : "stubs"}
        </span>,
      );
    }
  }
  if (others) {
    const who = others === true ? "Someone else" : joinNames(others.map((o) => o.name));
    const label = `${who} ${others !== true && others.length > 1 ? "have" : "has"} unsaved changes to this entry`;
    marks.push(
      <span key="others" className="tree-others" role="img" aria-label={label} title={label} />,
    );
  }
  const draft = row.note?.state === "unpublished" || !!row.note?.moved || !!folder?.unpublished;

  const name = node.isEditing ? (
    <input
      className="tree-rename"
      data-own-escape=""
      aria-label={`New name for ${row.name}`}
      defaultValue={row.name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => node.reset()}
      onKeyDown={(e) => {
        if (e.key === "Escape") node.reset();
        if (e.key === "Enter") {
          const value = e.currentTarget.value;
          node.reset();
          onRename(value);
        }
      }}
    />
  ) : row.kind === "note" ? (
    <Link
      to={entryUrl(row.note!.moved ?? row.note!.path)}
      {...(replace ? { replace: true } : {})}
      onClick={(e) => {
        if (onOpenCurrent && current === (row.note!.moved ?? row.note!.path)) {
          e.preventDefault();
          onOpenCurrent();
        }
      }}
      tabIndex={-1}
      className={`tree-note${draft ? " is-draft" : ""}${row.note!.state === "quarantined" ? " is-quarantined" : ""}${current === (row.note!.moved ?? row.note!.path) ? " active" : ""}`}
    >
      {row.name}
    </Link>
  ) : row.own ? (
    <Link
      to={entryUrl(row.own.moved ?? row.own.path)}
      {...(replace ? { replace: true } : {})}
      tabIndex={-1}
      className={`tree-folder${draft ? " is-draft" : ""}${current === (row.own.moved ?? row.own.path) ? " active" : ""}`}
      onClick={(e) => {
        node.open();
        if (onOpenCurrent && current === (row.own!.moved ?? row.own!.path)) {
          e.preventDefault();
          onOpenCurrent();
        }
      }}
    >
      {row.name}
    </Link>
  ) : (
    <span className={`tree-folder${draft ? " is-draft" : ""}`} onClick={() => node.toggle()}>
      {row.name}
    </span>
  );

  const body = (
    <div
      ref={dragHandle}
      style={style}
      className={`tree-row${node.willReceiveDrop ? " is-target" : ""}${node.isDragging ? " is-dragging" : ""}${node.isFocused ? " is-focused" : ""}${touch ? " is-touch" : ""}`}
      data-path={row.path}
      onDoubleClick={(e) => {
        if (row.kind !== "folder" || !node.isEditable) return;
        e.preventDefault();
        void node.edit();
      }}
    >
      {folder ? (
        <span className="twist" aria-hidden="true" onClick={() => node.toggle()}>
          <Icon icon={node.isOpen ? ChevronDown : ChevronRight} size="sm" />
        </span>
      ) : (
        <span className="twist" aria-hidden="true" />
      )}
      {folder && (
        <span className={`tree-icon${folder.color ? ` folder-tint-${folder.color}` : ""}`}>
          <Icon icon={folderIcon(folder.icon)} size="sm" />
        </span>
      )}
      {name}
      {marks}
      {folder && canWrite && !node.isEditing && (
        <span className="tree-actions">
          <button
            type="button"
            className="tree-action"
            tabIndex={-1}
            aria-label={`New entry in ${row.name}`}
            title="New entry here"
            onClick={(e) => {
              e.stopPropagation();
              onNewEntry(row.path);
            }}
          >
            <Icon icon={Plus} size="sm" />
          </button>
          <Dropdown.Root open={menuOpen} onOpenChange={onMenu}>
            <Dropdown.Trigger asChild>
              <button
                type="button"
                className="tree-action"
                tabIndex={-1}
                aria-label={`More for ${row.name}`}
                title="More"
                onClick={(e) => e.stopPropagation()}
              >
                <Icon icon={Ellipsis} size="sm" />
              </button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content
                className="ui-menu"
                align="start"
                sideOffset={4}
                collisionPadding={8}
                aria-label={`${row.name}: actions`}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <MenuItems actions={actions} Item={Dropdown.Item} Separator={Dropdown.Separator} />
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </span>
      )}
    </div>
  );

  const withSettings = body;

  if (!folder || !canWrite) return withSettings;
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{withSettings}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="ui-menu ui-context-menu"
          collisionPadding={8}
          aria-label={`${row.name}: actions`}
        >
          <MenuItems
            actions={actions}
            Item={ContextMenuPrimitive.Item}
            Separator={ContextMenuPrimitive.Separator}
          />
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
