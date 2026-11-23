import {
  type LucideIcon,
  MapPin,
  MousePointer2,
  Pentagon,
  Redo2,
  Ruler,
  Spline,
  Undo2,
} from "lucide-react";
import type { Tool } from "../../map/tools.ts";
import { IconButton } from "../ui/IconButton.tsx";

const TOOLS: { tool: Tool; label: string; icon: LucideIcon }[] = [
  { tool: "select", label: "Select", icon: MousePointer2 },
  { tool: "marker", label: "Marker", icon: MapPin },
  { tool: "path", label: "Path", icon: Spline },
  { tool: "zone", label: "Zone", icon: Pentagon },
  { tool: "measure", label: "Measure", icon: Ruler },
];

/** The tools while editing, with undo and redo. A schematic map has no measuring. */
export function MapTools({
  tool,
  schematic,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  schematic: boolean;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="map-tools" role="toolbar" aria-label="Map tools">
      {TOOLS.filter((t) => !(t.tool === "measure" && schematic)).map((t) => (
        <IconButton
          key={t.tool}
          label={t.label}
          icon={t.icon}
          showLabel
          aria-pressed={tool === t.tool}
          onClick={() => onTool(t.tool)}
        />
      ))}
      <span className="edit-toolbar-gap" />
      <IconButton
        label="Undo"
        icon={Undo2}
        disabled={!canUndo}
        disabledReason="Nothing to undo yet"
        onClick={onUndo}
      />
      <IconButton
        label="Redo"
        icon={Redo2}
        disabled={!canRedo}
        disabledReason="Nothing to redo"
        onClick={onRedo}
      />
    </div>
  );
}
