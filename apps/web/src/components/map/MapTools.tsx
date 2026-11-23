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

const TOOLS: { tool: Tool; label: string; icon: LucideIcon; shortcut: string }[] = [
  { tool: "select", label: "Select", icon: MousePointer2, shortcut: "map.select" },
  { tool: "marker", label: "Marker", icon: MapPin, shortcut: "map.marker" },
  { tool: "path", label: "Path", icon: Spline, shortcut: "map.path" },
  { tool: "zone", label: "Zone", icon: Pentagon, shortcut: "map.zone" },
  { tool: "measure", label: "Measure", icon: Ruler, shortcut: "map.measure" },
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
          shortcut={t.shortcut}
          showLabel
          aria-pressed={tool === t.tool}
          onClick={() => onTool(t.tool)}
        />
      ))}
      <span className="edit-toolbar-gap" />
      <IconButton
        label="Undo"
        icon={Undo2}
        shortcut="map.undo"
        disabled={!canUndo}
        disabledReason="Nothing to undo yet"
        onClick={onUndo}
      />
      <IconButton
        label="Redo"
        icon={Redo2}
        shortcut="map.redo"
        disabled={!canRedo}
        disabledReason="Nothing to redo"
        onClick={onRedo}
      />
    </div>
  );
}
