/**
 * Finds an entry on the graph by its name, an alias or its path. Its own small cmdk field rather
 * than the shared Combobox: names repeat across folders, aliases are searched, and "/" focuses it
 * from outside. cmdk filters on an item's value and keywords, not its text, so the value is the
 * path and the keywords are the title, the aliases and the path.
 */
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { type KeyboardEvent, type Ref, useMemo, useState } from "react";
import { Icon } from "../components/ui/Icon.tsx";
import type { GraphModel, Shown } from "./model.ts";
import "./FindField.css";

export function FindField({
  model,
  shown,
  inputRef,
  onChoose,
  onLeave,
}: {
  model: GraphModel;
  shown: Shown;
  inputRef: Ref<HTMLInputElement>;
  /** An entry was chosen. */
  onChoose: (i: number) => void;
  /** Escape in the field with its list closed: the focus goes back to the graph. */
  onLeave: () => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  // Names that occur more than once also show their folder.
  const repeated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of shown.nodes) {
      const t = model.nodes[i]!.title.toLowerCase();
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    return seen;
  }, [model, shown]);

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (open) setOpen(false);
    else onLeave();
  }

  return (
    <Command className="graph-find" label="Find an entry in the graph" loop onKeyDown={onKey}>
      <span className="graph-find-field">
        <Icon icon={Search} size="sm" />
        <Command.Input
          ref={inputRef}
          className="graph-find-input"
          placeholder="Find an entry"
          value={text}
          onValueChange={(v) => {
            setText(v);
            setOpen(v.trim() !== "");
          }}
          onFocus={() => setOpen(text.trim() !== "")}
          onBlur={() => setOpen(false)}
        />
      </span>
      {open && (
        // A press on the list keeps the focus in the field, so the list stays until chosen.
        <Command.List className="graph-find-list" onMouseDown={(e) => e.preventDefault()}>
          <Command.Empty className="graph-find-empty">
            No entry on the graph has that name.
          </Command.Empty>
          {shown.nodes.map((i) => {
            const node = model.nodes[i]!;
            const twice = (repeated.get(node.title.toLowerCase()) ?? 0) > 1;
            return (
              <Command.Item
                key={node.path}
                value={node.path}
                keywords={[node.title, ...(node.aliases ?? []), node.path]}
                className="graph-find-item"
                onSelect={() => {
                  setText("");
                  setOpen(false);
                  onChoose(i);
                }}
              >
                <span>{node.title}</span>
                {twice && <span className="graph-find-folder">{node.folder || "Top level"}</span>}
              </Command.Item>
            );
          })}
        </Command.List>
      )}
    </Command>
  );
}
