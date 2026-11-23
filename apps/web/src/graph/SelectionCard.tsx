import { X } from "lucide-react";
import { IconButton } from "../components/ui/IconButton.tsx";
import type { ModelNode } from "./model.ts";
import "./SelectionCard.css";

/** The selected entry, at the foot of the canvas: its name, its folder, and Open. */
export function SelectionCard({
  node,
  colour,
  onOpen,
  onClear,
}: {
  node: ModelNode;
  /** Its folder's colour; null for the faint ink. */
  colour: string | null;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <section className="graph-card" aria-label="Selected entry">
      <div className="graph-card-text">
        <h2 className="graph-card-name">{node.title}</h2>
        <p className="graph-card-folder">
          <span
            className="graph-swatch"
            aria-hidden="true"
            style={colour ? { background: colour } : undefined}
          />
          {node.folder || "Top level"}
          {node.unpublished && <span className="graph-card-state">Unpublished</span>}
        </p>
      </div>
      <button type="button" className="primary graph-card-open" onClick={onOpen}>
        Open
      </button>
      <IconButton
        label="Clear the selection"
        icon={X}
        size="sm"
        shortcut="graph.clear"
        onClick={onClear}
      />
    </section>
  );
}
