import {
  hiddenWithin,
  layerTree,
  layersWithin,
  lockedWithin,
  type MapFeature,
  type MapFile,
  type MapGroup,
  type MapLayer,
  moveLayer,
  stepLayer,
} from "@frontier/schema";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  CornerDownRight,
  Eye,
  EyeOff,
  GripVertical,
  Group as GroupIcon,
  Lock,
  LockOpen,
  type LucideIcon,
  MapPin,
  Pencil,
  Pentagon,
  Plus,
  Settings2,
  Shapes,
  Spline,
  Trash2,
  Ungroup,
} from "lucide-react";
import {
  type Dispatch,
  Fragment,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  addLayer,
  applyDrop,
  type Drop,
  type Dragged,
  dropFor,
  featureKey,
  groupKey,
  FEATURE_LIMIT,
  featuresByLayer,
  heirOf,
  kindName,
  layerAndAbove,
  layerKey,
  layerRows,
  removeLayer,
  type Row,
  setLayer,
} from "../../map/layerRows.ts";
import { setGroup } from "../../map/groups.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../ui/ContextMenu.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import "./LayerTree.css";

/** The icon of each kind of feature; a kind this page does not know has a plain one. */
const KIND_ICONS: Record<string, LucideIcon> = { marker: MapPin, path: Spline, zone: Pentagon };

/** How far the pointer must move before a press on a row becomes a drag, in pixels. */
const DRAG_START = 5;

export interface LayerTreeProps {
  map: MapFile;
  editing: boolean;
  /** What is hidden now: layers and single features. */
  hidden: Set<string>;
  onHidden: Dispatch<SetStateAction<Set<string>>>;
  /** The layer new features go into. */
  activeLayer: string;
  onActive: (id: string) => void;
  onChange: (next: MapFile) => void;
  /** The feature selected on the map. */
  selected: string | null;
  /** Selects a feature on the map, and centres it. */
  onSelect: (id: string) => void;
  titleOf: (feature: MapFeature) => string;
  /** The words a group goes by: its name, its entry's title, or "Group". */
  groupTitle?: (group: MapGroup) => string;
  /** Several picked here with Shift or Ctrl/⌘: the map picks them too. */
  onPickSeveral?: (ids: string[]) => void;
  /** Groups these (Ctrl/⌘+G in the tree). */
  onGroup?: (ids: string[]) => void;
  onUngroup?: (group: string) => void;
  /** Deletes a group with its members. */
  onDeleteGroup?: (group: string) => void;
}

/** What the Layers tab passes on to the tree for groups. */
export type GroupTreeProps = Pick<
  LayerTreeProps,
  "groupTitle" | "onPickSeveral" | "onGroup" | "onUngroup" | "onDeleteGroup"
>;

/** One action of a layer's menus, shown both in its right-click menu and its "⋯" menu. */
interface Action {
  label: string;
  icon: LucideIcon;
  run: () => void;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  reason?: string;
  /** A line goes above it. */
  apart?: boolean;
}

type Open =
  | { kind: "properties"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "into"; id: string }
  | null;

/**
 * The layers as a tree, like a drawing program's layers panel: each layer with its features and
 * its sublayers, shown or hidden, locked, renamed in place, and dragged to a new place. The rows
 * are in the order they are drawn: what is lower is drawn over what is higher.
 */
export function LayerTree(props: LayerTreeProps) {
  const { map, editing, hidden, onHidden, activeLayer, onActive, onChange, selected } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  /** The features picked in the list: the selected one, and more with Shift or Ctrl. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tree = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => layerRows(map, { collapsed, showAll }), [map, collapsed, showAll]);
  const hiddenNow = useMemo(() => hiddenWithin(map.layers, hidden), [map.layers, hidden]);
  const locked = useMemo(() => lockedWithin(map.layers), [map.layers]);
  const byLayer = useMemo(() => featuresByLayer(map), [map]);
  const nameOf = (f: MapFeature) => props.titleOf(f) || kindName(f.kind as string);

  // A feature selected on the map is picked here, and its layers opened to show it.
  useEffect(() => {
    if (!selected) {
      setPicked(new Set());
      return;
    }
    setPicked((now) => (now.has(selected) ? now : new Set([selected])));
    anchor.current = selected;
    const f = map.features.find((x) => x.id === selected);
    const g = map.groups?.find((x) => x.id === selected);
    if (g) {
      // A group picked on the map: its layer opened to show its row.
      const up = layerAndAbove(map.layers, g.layer);
      setCollapsed((now) => (up.some((id) => now.has(id)) ? remove(now, up) : now));
      setFocusKey(groupKey(g.id));
      return;
    }
    if (!f) return;
    // A member: its group opened too.
    if (f.group && collapsed.has(f.group)) setCollapsed((now) => remove(now, [f.group!]));
    const above = layerAndAbove(map.layers, f.layer);
    setCollapsed((now) => (above.some((id) => now.has(id)) ? remove(now, above) : now));
    const own = byLayer.get(f.layer) ?? [];
    if (own.indexOf(f) >= FEATURE_LIMIT) setShowAll((now) => new Set(now).add(f.layer));
    setFocusKey(featureKey(selected));
  }, [selected]);
  // Once it is listed, it is scrolled into view, once.
  const toShow = useRef<string | null>(null);
  useEffect(() => {
    toShow.current = selected;
  }, [selected]);
  useEffect(() => {
    if (!toShow.current) return;
    const row = tree.current?.querySelector(`[data-key="${featureKey(toShow.current)}"]`);
    if (!row) return;
    toShow.current = null;
    row.scrollIntoView?.({ block: "nearest" });
  }, [selected, rows]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  const toggleOpen = (id: string) => setCollapsed((c) => toggle(c, id));
  const toggleHidden = (id: string) => onHidden((h) => toggle(h, id));
  const change = (next: MapFile) => {
    if (next !== map) onChange(next);
  };

  function newLayer(parent: string | null) {
    const id = newItemId();
    const made = addLayer(map, id, parent);
    onChange(made.map);
    onActive(id);
    if (parent) setCollapsed((c) => remove(c, [parent]));
    setRenaming(id);
    setFocusKey(layerKey(id));
  }

  function rename(id: string, name: string) {
    setRenaming(null);
    const layer = map.layers.find((l) => l.id === id);
    if (layer && name.trim() && name.trim() !== layer.name) {
      change(setLayer(map, id, { name: name.trim() }));
    }
    focusRow(layerKey(id));
  }

  function deleteLayer(id: string) {
    const count = byLayer.get(id)?.length ?? 0;
    if (count > 0) return setOpen({ kind: "delete", id });
    finishDelete(id, null);
  }
  function finishDelete(id: string, to: string | null) {
    const next = removeLayer(map, id, to);
    change(next);
    if (activeLayer === id || !next.layers.some((l) => l.id === activeLayer)) {
      onActive(to ?? heirOf(map.layers, id) ?? next.layers[0]!.id);
    }
  }

  const actionsFor = (layer: MapLayer): Action[] => {
    const parent = layer.parent ?? null;
    const lockedHere = layer.locked === true;
    const last = map.layers.length === 1;
    return [
      { label: "Add a sublayer", icon: Plus, run: () => newLayer(layer.id) },
      { label: "Rename", icon: Pencil, keys: "F2", run: () => setRenaming(layer.id) },
      {
        label: "Properties…",
        icon: Settings2,
        run: () => setOpen({ kind: "properties", id: layer.id }),
      },
      {
        label: "Move up",
        icon: ArrowUp,
        apart: true,
        run: () => change({ ...map, layers: stepLayer(map.layers, layer.id, -1) }),
        disabled: stepLayer(map.layers, layer.id, -1) === map.layers,
        reason: "It is first",
      },
      {
        label: "Move down",
        icon: ArrowDown,
        run: () => change({ ...map, layers: stepLayer(map.layers, layer.id, 1) }),
        disabled: stepLayer(map.layers, layer.id, 1) === map.layers,
        reason: "It is last",
      },
      {
        label: "Move into…",
        icon: CornerDownRight,
        run: () => setOpen({ kind: "into", id: layer.id }),
        disabled: intoChoices(map.layers, layer.id).length === 0,
        reason: "No other layer can hold it",
      },
      {
        label: "Move to the top level",
        icon: ArrowUpToLine,
        run: () => change({ ...map, layers: moveLayer(map.layers, layer.id, null) }),
        disabled: parent === null,
        reason: "It is at the top level",
      },
      {
        label: lockedHere ? "Unlock" : "Lock",
        icon: lockedHere ? LockOpen : Lock,
        apart: true,
        run: () => change(setLayer(map, layer.id, { locked: !lockedHere })),
      },
      {
        label: `Delete ${layer.name}`,
        icon: Trash2,
        danger: true,
        run: () => deleteLayer(layer.id),
        disabled: last,
        reason: "A map keeps at least one layer",
      },
    ];
  };

  // ---- Picking features ---------------------------------------------------------------------

  function pickFeature(id: string, how: { shift: boolean; add: boolean }) {
    const listed = rows.flatMap((r) =>
      r.type === "feature" ? [r.feature.id] : r.type === "group" ? [r.group.id] : [],
    );
    let next: Set<string>;
    if (how.shift && anchor.current && listed.includes(anchor.current)) {
      const a = listed.indexOf(anchor.current);
      const b = listed.indexOf(id);
      next = new Set(listed.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (how.add) {
      next = toggle(picked, id);
      anchor.current = id;
    } else {
      next = new Set([id]);
      anchor.current = id;
    }
    setPicked(next);
    // Several picked here are picked on the map too, to group or delete them.
    if (next.size > 1 && props.onPickSeveral) props.onPickSeveral(pickedIds(next));
    else props.onSelect(next.size === 1 ? [...next][0]! : id);
  }
  /** The picked ids in the order of the rows, a group's members left to their group. */
  const pickedIds = (set: ReadonlySet<string>) => {
    const out = rows.flatMap((r) =>
      r.type === "feature" && set.has(r.feature.id)
        ? [r.feature.id]
        : r.type === "group" && set.has(r.group.id)
          ? [r.group.id]
          : [],
    );
    const groups = new Set(out.filter((id) => map.groups?.some((g) => g.id === id)));
    return out.filter((id) => {
      const g = map.features.find((f) => f.id === id)?.group;
      return !(g && groups.has(g));
    });
  };
  const groupName = (g: MapGroup) => props.groupTitle?.(g) ?? (g.label || "Group");

  function renameGroup(id: string, name: string) {
    setRenaming(null);
    change(setGroup(map, id, { label: name.trim() || null }));
    focusRow(groupKey(id));
  }

  const groupActions = (g: MapGroup): Action[] => {
    const name = groupName(g);
    const first = map.features.find((f) => f.group === g.id);
    const off = hidden.has(g.id);
    return [
      { label: "Rename", icon: Pencil, keys: "F2", run: () => setRenaming(g.id) },
      {
        label: "Go inside",
        icon: CornerDownRight,
        run: () => first && props.onSelect(first.id),
        disabled: !first,
        reason: "It has no members",
      },
      {
        label: "Ungroup",
        icon: Ungroup,
        run: () => props.onUngroup?.(g.id),
      },
      {
        label: off ? `Show ${name}` : `Hide ${name}`,
        icon: off ? Eye : EyeOff,
        apart: true,
        run: () => toggleHidden(g.id),
      },
      {
        label: g.locked ? "Unlock" : "Lock",
        icon: g.locked ? LockOpen : Lock,
        run: () =>
          change(
            setGroup(
              map,
              g.id,
              (g.locked ? { locked: undefined } : { locked: true }) as Partial<MapGroup>,
            ),
          ),
      },
      {
        label: `Delete ${name} with its members`,
        icon: Trash2,
        danger: true,
        apart: true,
        run: () => props.onDeleteGroup?.(g.id),
      },
    ];
  };

  // ---- The keyboard ------------------------------------------------------------------------

  function focusRow(key: string) {
    setFocusKey(key);
    requestAnimationFrame(() =>
      tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus(),
    );
  }

  function onRowKey(e: KeyboardEvent<HTMLDivElement>, row: Row, at: number) {
    if (e.target !== e.currentTarget) return;
    const go = (to: Row | undefined) => {
      if (!to) return;
      e.preventDefault();
      focusRow(to.key);
    };
    const parentRow = () => {
      for (let i = at - 1; i >= 0; i--) {
        const r = rows[i]!;
        if ((r.type === "layer" || r.type === "group") && r.depth < row.depth) return r;
      }
    };
    // Ctrl/⌘+G groups what is picked here; with Shift, ungroups the group of this row.
    if (editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (e.shiftKey) {
        const g =
          row.type === "group" ? row.group.id : row.type === "feature" ? row.feature.group : null;
        if (g) props.onUngroup?.(g);
      } else {
        const own =
          row.type === "group" ? row.group.id : row.type === "feature" ? row.feature.id : null;
        const ids = pickedIds(picked.size > 1 ? picked : new Set(own ? [own] : []));
        props.onGroup?.(ids);
      }
      return;
    }
    if (row.type === "group") {
      const gid = row.group.id;
      switch (e.key) {
        case "ArrowRight":
          if (!row.open) {
            e.preventDefault();
            return toggleOpen(gid);
          }
          return go(rows[at + 1]?.depth === row.depth + 1 ? rows[at + 1] : undefined);
        case "ArrowLeft":
          if (row.open) {
            e.preventDefault();
            return toggleOpen(gid);
          }
          return go(parentRow());
        case "Enter":
        case " ":
          e.preventDefault();
          return pickFeature(gid, { shift: e.shiftKey, add: e.ctrlKey || e.metaKey });
        case "F2":
          if (editing) {
            e.preventDefault();
            setRenaming(gid);
          }
          return;
      }
    }
    switch (e.key) {
      case "ArrowDown":
        return go(rows[at + 1]);
      case "ArrowUp":
        return go(rows[at - 1]);
      case "Home":
        return go(rows[0]);
      case "End":
        return go(rows[rows.length - 1]);
      case "ArrowRight":
        if (row.type === "layer" && !row.open) {
          e.preventDefault();
          return toggleOpen(row.node.layer.id);
        }
        return go(rows[at + 1]?.depth === row.depth + 1 ? rows[at + 1] : undefined);
      case "ArrowLeft":
        if (row.type === "layer" && row.open) {
          e.preventDefault();
          return toggleOpen(row.node.layer.id);
        }
        return go(parentRow());
      case "Enter":
      case " ":
        e.preventDefault();
        if (row.type === "layer" && editing) onActive(row.node.layer.id);
        else if (row.type === "layer") toggleOpen(row.node.layer.id);
        else if (row.type === "feature")
          pickFeature(row.feature.id, { shift: e.shiftKey, add: e.ctrlKey || e.metaKey });
        else if (row.type === "more") setShowAll((s) => new Set(s).add(row.layer));
        return;
      case "F2":
        if (row.type === "layer" && editing) {
          e.preventDefault();
          setRenaming(row.node.layer.id);
        }
        return;
    }
  }

  // ---- Dragging ----------------------------------------------------------------------------

  const [drag, setDrag] = useState<{ what: Dragged; label: string; x: number; y: number } | null>(
    null,
  );
  const [drop, setDropState] = useState<{ key: string; drop: Drop } | null>(null);
  const press = useRef<{
    what: Dragged;
    label: string;
    x: number;
    y: number;
    moved: boolean;
    scroller: HTMLElement | null;
    /** The listeners on the window while the press lasts. */
    off: () => void;
  } | null>(null);
  /** A drag just ended: the click that follows it is not a click. */
  const dragged = useRef(false);
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const mapRef = useRef(map);
  mapRef.current = map;

  function startPress(e: ReactPointerEvent, row: Row, fromHandle: boolean) {
    if (!editing || e.button !== 0 || renaming || outside(e)) return;
    if (!fromHandle) {
      // On touch only the handle drags, so the list still scrolls under a finger.
      if (e.pointerType !== "mouse") return;
      if ((e.target as Element).closest("button, input, select, label")) return;
    }
    let what: Dragged;
    let label: string;
    if (row.type === "layer") {
      what = { kind: "layer", id: row.node.layer.id };
      label = row.node.layer.name;
    } else if (row.type === "feature") {
      const ids = picked.has(row.feature.id)
        ? rows.filter((r) => r.type === "feature" && picked.has(r.feature.id)).map((r) => r.key)
        : [row.key];
      what = { kind: "features", ids: ids.map((k) => k.slice(2)) };
      label = ids.length > 1 ? `${ids.length} features` : nameOf(row.feature);
    } else if (row.type === "group") {
      what = { kind: "group", id: row.group.id };
      label = groupName(row.group);
    } else return;
    if (fromHandle) e.preventDefault();
    press.current?.off();
    // The listeners read the page through refs, so the ones added now stay right.
    const move = (ev: PointerEvent) => onMove(ev);
    const up = () => onUp();
    const cancel = () => endDrag();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    press.current = {
      what,
      label,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      scroller: scrollerOf(tree.current),
      off: () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
      },
    };
  }

  function onMove(e: PointerEvent) {
    const p = press.current;
    if (!p) return;
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START) return;
      p.moved = true;
    }
    e.preventDefault();
    setDrag({ what: p.what, label: p.label, x: e.clientX, y: e.clientY });
    // Near the top or bottom of the list, it scrolls.
    const box = p.scroller?.getBoundingClientRect();
    if (p.scroller && box) {
      if (e.clientY < box.top + 28) p.scroller.scrollTop -= 12;
      else if (e.clientY > box.bottom - 28) p.scroller.scrollTop += 12;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-key]");
    const key = el && tree.current?.contains(el) ? el.dataset["key"] : undefined;
    const row = key ? rowsRef.current.find((r) => r.key === key) : undefined;
    if (!el || !row) return setDropState(null);
    const rect = el.getBoundingClientRect();
    const found = dropFor(mapRef.current, p.what, row, (e.clientY - rect.top) / rect.height);
    setDropState(found ? { key: row.key, drop: found } : null);
  }

  function endDrag() {
    press.current?.off();
    press.current = null;
    setDrag(null);
    setDropState(null);
  }
  function onUp() {
    const p = press.current;
    const target = dropRef.current;
    if (p?.moved) {
      dragged.current = true;
      window.setTimeout(() => (dragged.current = false), 0);
      if (target) {
        const next = applyDrop(mapRef.current, target.drop);
        if (next !== mapRef.current) onChangeRef.current(next);
        if (target.drop.kind === "layer" && target.drop.parent) {
          const into = target.drop.parent;
          setCollapsed((c) => remove(c, [into]));
        }
      }
    }
    endDrag();
  }
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => () => press.current?.off(), []);

  // ---- Drawing ------------------------------------------------------------------------------

  const firstKey = rows[0]?.key ?? null;
  const tabKey = focusKey && rows.some((r) => r.key === focusKey) ? focusKey : firstKey;

  const rowProps = (row: Row, at: number, label: string) => ({
    "data-key": row.key,
    role: "treeitem",
    "aria-level": row.depth + 1,
    "aria-label": label,
    tabIndex: row.key === tabKey ? 0 : -1,
    onFocus: (e: React.FocusEvent) => e.target === e.currentTarget && setFocusKey(row.key),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => onRowKey(e, row, at),
    onPointerDown: (e: ReactPointerEvent) => startPress(e, row, false),
    style: { "--depth": row.depth } as React.CSSProperties,
  });
  const dropClass = (row: Row) => (drop?.key === row.key ? ` drop-${drop.drop.show}` : "");
  const grip = (row: Row) =>
    editing && (
      <span
        className="lt-grip"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          startPress(e, row, true);
        }}
      >
        <Icon icon={GripVertical} size="sm" />
      </span>
    );

  return (
    <div className="layer-tree">
      <div className="lt-head">
        <h3 id="layers-heading">Layers</h3>
        {editing && (
          <IconButton
            label="Add a layer"
            icon={Plus}
            size="sm"
            className="plain"
            onClick={() => newLayer(null)}
          />
        )}
      </div>
      <div
        ref={tree}
        className={`lt-rows${drag ? " is-dragging" : ""}`}
        role="tree"
        aria-labelledby="layers-heading"
        aria-multiselectable="true"
      >
        {rows.map((row, at) => {
          if (row.type === "more") {
            return (
              <div
                key={row.key}
                {...rowProps(row, at, `${row.rest} more`)}
                className="lt-row lt-more"
              >
                <button
                  type="button"
                  className="quiet"
                  tabIndex={-1}
                  onClick={() => setShowAll((s) => new Set(s).add(row.layer))}
                >
                  Show {row.rest} more
                </button>
              </div>
            );
          }
          if (row.type === "feature") {
            const f = row.feature;
            const name = nameOf(f);
            const off = hidden.has(f.id);
            const within =
              !off && (hiddenNow.has(f.layer) || (f.group != null && hidden.has(f.group)));
            const isPicked = picked.has(f.id) || f.id === selected;
            return (
              <div
                key={row.key}
                {...rowProps(row, at, name)}
                aria-selected={isPicked}
                className={`lt-row lt-feature${isPicked ? " is-picked" : ""}${off || within ? " is-off" : ""}${locked.has(f.layer) ? " is-locked" : ""}${dropClass(row)}`}
                onClick={(e) => {
                  if (dragged.current || outside(e)) return;
                  if ((e.target as Element).closest("button")) return;
                  pickFeature(f.id, { shift: e.shiftKey, add: e.ctrlKey || e.metaKey });
                }}
              >
                {grip(row)}
                <Icon icon={KIND_ICONS[f.kind] ?? Shapes} size="sm" className="lt-kind" />
                <span className="lt-name" title={name}>
                  {name}
                </span>
                <IconButton
                  label={off ? `Show ${name}` : `Hide ${name}`}
                  icon={off ? EyeOff : Eye}
                  size="sm"
                  className={`plain lt-eye${off ? " is-on" : ""}`}
                  onClick={() => toggleHidden(f.id)}
                />
              </div>
            );
          }
          if (row.type === "group") {
            const g = row.group;
            const name = groupName(g);
            const off = hidden.has(g.id);
            const within = !off && hiddenNow.has(g.layer);
            const isPicked = picked.has(g.id) || g.id === selected;
            const lockedHere = g.locked === true;
            const actions = editing ? groupActions(g) : [];
            const rowEl = (
              <div
                {...rowProps(row, at, name)}
                aria-expanded={row.open}
                aria-selected={isPicked}
                className={`lt-row lt-group${isPicked ? " is-picked" : ""}${off || within ? " is-off" : ""}${lockedHere || locked.has(g.layer) ? " is-locked" : ""}${dropClass(row)}`}
                onClick={(e) => {
                  if (dragged.current || outside(e)) return;
                  if ((e.target as Element).closest("button, input")) return;
                  pickFeature(g.id, { shift: e.shiftKey, add: e.ctrlKey || e.metaKey });
                }}
                onDoubleClick={(e) => {
                  if (editing && !outside(e) && (e.target as Element).closest(".lt-name")) {
                    setRenaming(g.id);
                  }
                }}
              >
                {grip(row)}
                <IconButton
                  label={row.open ? `Collapse ${name}` : `Expand ${name}`}
                  icon={ChevronRight}
                  size="sm"
                  tabIndex={-1}
                  className={`plain lt-twist${row.open ? " is-open" : ""}`}
                  onClick={() => toggleOpen(g.id)}
                />
                <Icon icon={GroupIcon} size="sm" className="lt-kind lt-group-icon" />
                {renaming === g.id ? (
                  <RenameBox
                    name={g.label ?? ""}
                    label="Group name"
                    onDone={(n) => renameGroup(g.id, n)}
                    onCancel={() => {
                      setRenaming(null);
                      focusRow(row.key);
                    }}
                  />
                ) : (
                  <span className="lt-name" title={name}>
                    {name}
                  </span>
                )}
                <span className="lt-count" title={`${row.count} members`}>
                  {row.count}
                </span>
                {editing && (
                  <IconButton
                    label={lockedHere ? `Unlock ${name}` : `Lock ${name}`}
                    icon={lockedHere ? Lock : LockOpen}
                    size="sm"
                    className={`plain lt-lock${lockedHere ? " is-on" : ""}`}
                    aria-pressed={lockedHere}
                    onClick={() =>
                      actions.find((a) => a.icon === Lock || a.icon === LockOpen)?.run()
                    }
                  />
                )}
                <IconButton
                  label={off ? `Show ${name}` : `Hide ${name}`}
                  icon={off || within ? EyeOff : Eye}
                  size="sm"
                  className={`plain lt-eye${off ? " is-on" : ""}`}
                  onClick={() => toggleHidden(g.id)}
                />
                {editing && (
                  <Menu label={`More for ${name}`} className="plain row-more lt-menu">
                    {actions.map((a) => (
                      <MenuItemOf key={a.label} action={a} />
                    ))}
                  </Menu>
                )}
              </div>
            );
            return editing ? (
              <ContextMenu
                key={row.key}
                onCloseAutoFocus={(e) => e.preventDefault()}
                items={actions.map((a) => (
                  <ContextItemOf key={a.label} action={a} />
                ))}
              >
                {rowEl}
              </ContextMenu>
            ) : (
              <Fragment key={row.key}>{rowEl}</Fragment>
            );
          }
          const { layer, children } = row.node;
          const id = layer.id;
          const hasInside = row.count > 0 || children > 0;
          const off = hidden.has(id);
          const within = !off && hiddenNow.has(id);
          const lockedHere = layer.locked === true;
          const lockedWithin = !lockedHere && locked.has(id);
          const current = editing && id === activeLayer;
          const actions = editing ? actionsFor(layer) : [];
          const rowEl = (
            <div
              {...rowProps(row, at, layer.name)}
              aria-expanded={hasInside ? row.open : undefined}
              aria-selected={current}
              aria-current={current ? "true" : undefined}
              className={`lt-row lt-layer${current ? " is-current" : ""}${off || within ? " is-off" : ""}${dropClass(row)}`}
              onClick={(e) => {
                if (dragged.current || outside(e)) return;
                if ((e.target as Element).closest("button, input")) return;
                if (editing) onActive(id);
                else if (hasInside) toggleOpen(id);
              }}
              onDoubleClick={(e) => {
                if (editing && !outside(e) && (e.target as Element).closest(".lt-name")) {
                  setRenaming(id);
                }
              }}
            >
              {grip(row)}
              {hasInside ? (
                <IconButton
                  label={row.open ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
                  icon={ChevronRight}
                  size="sm"
                  tabIndex={-1}
                  className={`plain lt-twist${row.open ? " is-open" : ""}`}
                  onClick={() => toggleOpen(id)}
                />
              ) : (
                <span className="lt-twist-space" />
              )}
              {editing ? (
                <input
                  type="color"
                  className="lt-swatch"
                  aria-label={`Colour of ${layer.name}`}
                  title={`Colour of ${layer.name}`}
                  tabIndex={-1}
                  value={layer.color}
                  onChange={(e) => change(setLayer(map, id, { color: e.target.value }))}
                />
              ) : (
                <span className="lt-swatch" style={{ background: layer.color }} />
              )}
              {renaming === id ? (
                <RenameBox
                  name={layer.name}
                  onDone={(name) => rename(id, name)}
                  onCancel={() => {
                    setRenaming(null);
                    focusRow(row.key);
                  }}
                />
              ) : (
                <span className="lt-name" title={layer.name}>
                  {layer.name}
                  {layer.name === "Biomes" && layer.parent == null && map.layers[0]?.id === id && (
                    <em className="lt-note"> drawn under the rest</em>
                  )}
                </span>
              )}
              <span
                className="lt-count"
                title={`${row.count} ${row.count === 1 ? "feature" : "features"}`}
              >
                {row.count}
              </span>
              <IconButton
                label={off ? `Show ${layer.name}` : `Hide ${layer.name}`}
                icon={off || within ? EyeOff : Eye}
                size="sm"
                className={`plain lt-eye${off ? " is-on" : ""}`}
                onClick={() => toggleHidden(id)}
              />
              {editing && (
                <>
                  <IconButton
                    label={lockedHere ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                    icon={lockedHere || lockedWithin ? Lock : LockOpen}
                    size="sm"
                    className={`plain lt-lock${lockedHere ? " is-on" : ""}${lockedWithin ? " is-within" : ""}`}
                    aria-pressed={lockedHere}
                    onClick={() => change(setLayer(map, id, { locked: !lockedHere }))}
                  />
                  <IconButton
                    label={`Properties of ${layer.name}`}
                    icon={Settings2}
                    size="sm"
                    tabIndex={-1}
                    className="plain lt-extra"
                    onClick={() => setOpen({ kind: "properties", id })}
                  />
                  <IconButton
                    label={`Delete ${layer.name}`}
                    icon={Trash2}
                    size="sm"
                    tabIndex={-1}
                    className="plain lt-extra"
                    disabled={map.layers.length === 1}
                    disabledReason="A map keeps at least one layer"
                    onClick={() => deleteLayer(id)}
                  />
                  <Menu label={`More for ${layer.name}`} className="plain row-more lt-menu">
                    {actions.map((a) => (
                      <MenuItemOf key={a.label} action={a} />
                    ))}
                  </Menu>
                </>
              )}
            </div>
          );
          return editing ? (
            <ContextMenu
              key={row.key}
              // The focus stays where an item put it, such as in the name being typed.
              onCloseAutoFocus={(e) => e.preventDefault()}
              items={actions.map((a) => (
                <ContextItemOf key={a.label} action={a} />
              ))}
            >
              {rowEl}
            </ContextMenu>
          ) : (
            <Fragment key={row.key}>{rowEl}</Fragment>
          );
        })}
      </div>
      {drag &&
        createPortal(
          <div className="lt-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
            {drag.label}
          </div>,
          document.body,
        )}
      {open?.kind === "properties" &&
        overPage(
          <LayerProperties
            map={map}
            id={open.id}
            onClose={() => setOpen(null)}
            onSave={(next) => {
              change(next);
              setOpen(null);
            }}
          />,
        )}
      {open?.kind === "delete" &&
        overPage(
          <DeleteLayer
            map={map}
            id={open.id}
            count={byLayer.get(open.id)?.length ?? 0}
            onClose={() => setOpen(null)}
            onDelete={(to) => {
              finishDelete(open.id, to);
              setOpen(null);
            }}
          />,
        )}
      {open?.kind === "into" &&
        overPage(
          <MoveInto
            map={map}
            id={open.id}
            onClose={() => setOpen(null)}
            onMove={(parent) => {
              change({ ...map, layers: moveLayer(map.layers, open.id, parent) });
              setCollapsed((c) => remove(c, [parent]));
              setOpen(null);
            }}
          />,
        )}
    </div>
  );
}

/**
 * The event came from a menu drawn elsewhere on the page but inside the row in React, whose
 * events still pass through the row: a row does nothing with those.
 */
const outside = (e: { target: EventTarget; currentTarget: EventTarget }) =>
  !(e.currentTarget as Node).contains(e.target as Node);

/** A dialog over the whole page, outside the side bar and its styles. */
const overPage = (node: ReactNode) => createPortal(node, document.body);

const remove = (set: Set<string>, ids: string[]) => {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
};

/** The nearest box around the list that scrolls, for scrolling while dragging. */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let at = el?.parentElement ?? null; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}

function MenuItemOf({ action: a }: { action: Action }) {
  return (
    <>
      {a.apart && <MenuSeparator />}
      <MenuItem
        icon={a.icon}
        onSelect={a.run}
        {...(a.keys ? { keys: a.keys } : {})}
        danger={a.danger ?? false}
        disabled={a.disabled ?? false}
        disabledReason={a.reason}
      >
        {a.label}
      </MenuItem>
    </>
  );
}

function ContextItemOf({ action: a }: { action: Action }) {
  return (
    <>
      {a.apart && <ContextMenuSeparator />}
      <ContextMenuItem
        icon={a.icon}
        onSelect={a.run}
        {...(a.keys ? { keys: a.keys } : {})}
        danger={a.danger ?? false}
        disabled={a.disabled ?? false}
        disabledReason={a.reason}
      >
        {a.label}
      </ContextMenuItem>
    </>
  );
}

/** The name of a layer, typed in place: Enter or leaving keeps it, Escape puts it back. */
function RenameBox({
  name,
  onDone,
  onCancel,
  label = "Layer name",
}: {
  name: string;
  onDone: (name: string) => void;
  onCancel: () => void;
  label?: string;
}) {
  const [text, setText] = useState(name);
  const box = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    // After the menu that asked for it has closed, which would otherwise take the focus back.
    const wait = window.setTimeout(() => {
      box.current?.focus();
      box.current?.select();
    }, 0);
    return () => window.clearTimeout(wait);
  }, []);
  const finish = (keep: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (keep) onDone(text);
    else onCancel();
  };
  return (
    <input
      ref={box}
      type="text"
      className="lt-rename"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** The layers a layer may be moved into: not itself, not what is inside it. */
function intoChoices(layers: readonly MapLayer[], id: string) {
  const within = layersWithin(layers, id);
  const parent = layers.find((l) => l.id === id)?.parent ?? null;
  return layerTree(layers).filter(
    (n) => n.layer.id !== id && !within.has(n.layer.id) && n.layer.id !== parent,
  );
}

/** A layer's name, set in from the left by how deep it is, for a list of choices. */
const indented = (name: string, depth: number) => `${" ".repeat(depth)}${name}`;

/** A layer's settings: its name, colour, where it is, whether it opens shown, and its lock. */
function LayerProperties({
  map,
  id,
  onClose,
  onSave,
}: {
  map: MapFile;
  id: string;
  onClose: () => void;
  onSave: (next: MapFile) => void;
}) {
  const layer = map.layers.find((l) => l.id === id)!;
  const [name, setName] = useState(layer.name);
  const [color, setColor] = useState(layer.color);
  const [visible, setVisible] = useState(layer.visible);
  const [lockedHere, setLocked] = useState(layer.locked === true);
  const [parent, setParent] = useState(layer.parent ?? "");
  const within = layersWithin(map.layers, id);
  const places = layerTree(map.layers).filter((n) => n.layer.id !== id && !within.has(n.layer.id));
  return (
    <DialogFrame
      title={`Properties of ${layer.name}`}
      className="layer-properties"
      onCancel={onClose}
      onSubmit={() => {
        let next = setLayer(map, id, {
          name: name.trim() || layer.name,
          color,
          visible,
          locked: lockedHere,
        });
        if ((layer.parent ?? "") !== parent) {
          next = { ...next, layers: moveLayer(next.layers, id, parent || null) };
        }
        onSave(next);
      }}
    >
      <label className="dialog-field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="dialog-field lt-colour-field">
        <span>Colour</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <label className="dialog-field">
        <span>Inside</span>
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">Nothing: the top level</option>
          {places.map((n) => (
            <option key={n.layer.id} value={n.layer.id}>
              {indented(n.layer.name, n.depth)}
            </option>
          ))}
        </select>
      </label>
      <label className="lt-check">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
        Shown when the map opens
      </label>
      <label className="lt-check">
        <input type="checkbox" checked={lockedHere} onChange={(e) => setLocked(e.target.checked)} />
        Locked: its features cannot be picked on the map
      </label>
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Save
        </button>
      </p>
    </DialogFrame>
  );
}

/** Deleting a layer that holds features: move them to another layer, or delete them too. */
function DeleteLayer({
  map,
  id,
  count,
  onClose,
  onDelete,
}: {
  map: MapFile;
  id: string;
  count: number;
  onClose: () => void;
  onDelete: (to: string | null) => void;
}) {
  const layer = map.layers.find((l) => l.id === id)!;
  const [how, setHow] = useState<"move" | "delete">("move");
  const [to, setTo] = useState(heirOf(map.layers, id) ?? "");
  const places = layerTree(map.layers).filter((n) => n.layer.id !== id);
  const subs = map.layers.some((l) => l.parent === id);
  const features = count === 1 ? "1 feature" : `${count} features`;
  return (
    <DialogFrame
      title={`Delete ${layer.name}?`}
      body={`It holds ${features}.${subs ? " Its sublayers stay, in its place." : ""}`}
      onCancel={onClose}
      onSubmit={() => onDelete(how === "move" ? to : null)}
    >
      <fieldset className="lt-delete-choice">
        <legend className="sr-only">What happens to its features</legend>
        <label className="lt-check">
          <input type="radio" checked={how === "move"} onChange={() => setHow("move")} />
          Move them to
          <select
            aria-label="The layer they move to"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setHow("move");
            }}
          >
            {places.map((n) => (
              <option key={n.layer.id} value={n.layer.id}>
                {indented(n.layer.name, n.depth)}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-check">
          <input type="radio" checked={how === "delete"} onChange={() => setHow("delete")} />
          Delete them too
        </label>
      </fieldset>
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary danger-solid">
          Delete the layer
        </button>
      </p>
    </DialogFrame>
  );
}

/** "Move into…": the layer to put this one inside, without dragging. */
function MoveInto({
  map,
  id,
  onClose,
  onMove,
}: {
  map: MapFile;
  id: string;
  onClose: () => void;
  onMove: (parent: string) => void;
}) {
  const layer = map.layers.find((l) => l.id === id)!;
  const choices = intoChoices(map.layers, id);
  const [to, setTo] = useState(choices[0]?.layer.id ?? "");
  return (
    <DialogFrame
      title={`Move ${layer.name} into…`}
      onCancel={onClose}
      onSubmit={() => to && onMove(to)}
    >
      <label className="dialog-field">
        <span>The layer to put it in</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          {choices.map((n) => (
            <option key={n.layer.id} value={n.layer.id}>
              {indented(n.layer.name, n.depth)}
            </option>
          ))}
        </select>
      </label>
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Move
        </button>
      </p>
    </DialogFrame>
  );
}
