import { byName } from "@frontier/schema";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { GraphModel, Shown } from "./model.ts";
import "./EntriesPanel.css";

/**
 * The keyboard's and the screen reader's way through the graph: the shown entries in name order.
 * Up and Down move, Enter selects and centres, a second Enter opens.
 */
export function EntriesPanel({
  model,
  shown,
  selected,
  onSelect,
  onOpen,
}: {
  model: GraphModel;
  shown: Shown;
  selected: number | null;
  onSelect: (i: number) => void;
  onOpen: (i: number) => void;
}) {
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const order = useMemo(
    () =>
      [...shown.nodes].sort(
        (a, b) =>
          byName(model.nodes[a]!.title, model.nodes[b]!.title) ||
          byName(model.nodes[a]!.path, model.nodes[b]!.path),
      ),
    [model, shown],
  );
  const [active, setActive] = useState<number | null>(selected);
  useEffect(() => {
    if (selected !== null) setActive(selected);
  }, [selected]);
  const current = active !== null && shown.has[active] ? active : (order[0] ?? null);

  // The entry the list is at stays in view.
  useEffect(() => {
    list.current
      ?.querySelector(`[data-entry="${current}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  function onKey(e: KeyboardEvent) {
    if (current === null) return;
    const at = order.indexOf(current);
    const to =
      e.key === "ArrowDown"
        ? Math.min(order.length - 1, at + 1)
        : e.key === "ArrowUp"
          ? Math.max(0, at - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? order.length - 1
              : null;
    if (to !== null) {
      e.preventDefault();
      setActive(order[to]!);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current === selected) onOpen(current);
      else onSelect(current);
    }
  }

  if (order.length === 0) return <p className="muted graph-entries-none">No entries are shown.</p>;
  return (
    <div className="graph-entries">
      <p className="graph-entries-count muted">
        {order.length} {order.length === 1 ? "entry" : "entries"}, as on the graph
      </p>
      <ul
        ref={list}
        className="graph-entries-list"
        role="listbox"
        aria-label="Entries on the graph"
        tabIndex={0}
        aria-activedescendant={current !== null ? `${id}-${current}` : undefined}
        onKeyDown={onKey}
      >
        {order.map((i) => {
          const node = model.nodes[i]!;
          return (
            <li
              key={node.path}
              id={`${id}-${i}`}
              data-entry={i}
              role="option"
              aria-selected={i === selected}
              className={`graph-entry${i === current ? " is-active" : ""}`}
              onClick={() => {
                setActive(i);
                onSelect(i);
              }}
              onDoubleClick={() => onOpen(i)}
            >
              <span className="graph-entry-name">{node.title}</span>
              <span className="graph-entry-folder">
                {node.folder || "Top level"}
                {node.unpublished && " · unpublished"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
