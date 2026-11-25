import {
  type LucideIcon,
  ChevronDown,
  LayoutGrid,
  Leaf,
  Magnet,
  MapPin,
  MousePointer2,
  Pentagon,
  Redo2,
  Route,
  Ruler,
  Sparkles,
  Spline,
  Type,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { type SnapTargets, TARGET_LABELS, targetsText } from "../../map/snap.ts";
import type { Tool } from "../../map/tools.ts";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";

const TOOLS: { tool: Tool; label: string; icon: LucideIcon; shortcut: string }[] = [
  { tool: "select", label: "Select", icon: MousePointer2, shortcut: "map.select" },
  { tool: "marker", label: "Marker", icon: MapPin, shortcut: "map.marker" },
  { tool: "path", label: "Path", icon: Spline, shortcut: "map.path" },
  { tool: "zone", label: "Zone", icon: Pentagon, shortcut: "map.zone" },
  { tool: "find", label: "Find areas", icon: WandSparkles, shortcut: "map.find" },
  { tool: "paths", label: "Find paths", icon: Route, shortcut: "map.paths" },
  { tool: "biomes", label: "Suggest biomes", icon: Leaf, shortcut: "map.biomes" },
  { tool: "label", label: "Label", icon: Type, shortcut: "map.label" },
  { tool: "measure", label: "Measure", icon: Ruler, shortcut: "map.measure" },
  { tool: "place", label: "Place with AI", icon: Sparkles, shortcut: "map.place" },
];

/**
 * The tools while editing, with snapping, undo and redo. A schematic map has no measuring; Place
 * with AI is there once a model is chosen; Find areas needs a picture to look at.
 */
export function MapTools({
  tool,
  schematic,
  canPlace,
  findReason,
  pathsReason,
  biomesReason = null,
  onTool,
  snap,
  onSnap,
  snapTargets,
  onSnapTargets,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  picking = false,
  onPicking,
}: {
  tool: Tool;
  schematic: boolean;
  canPlace: boolean;
  /** Why Find areas cannot be used, or null when it can. */
  findReason: string | null;
  /** Why Find paths cannot be used, or null when it can. */
  pathsReason: string | null;
  /** Why Suggest biomes cannot be used, or null when it can. */
  biomesReason?: string | null;
  onTool: (tool: Tool) => void;
  /** Points of paths and zones snap to others near them. */
  snap: boolean;
  onSnap: (on: boolean) => void;
  /** What snapping snaps to: paths, zones, markers and labels. */
  snapTargets: SnapTargets;
  onSnapTargets: (next: SnapTargets) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** "Select several": each tap on the map picks, to group or delete them (on a phone). */
  picking?: boolean;
  onPicking?: (on: boolean) => void;
}) {
  return (
    <div className="map-tools" role="toolbar" aria-label="Map tools">
      {TOOLS.filter(
        (t) => !(t.tool === "measure" && schematic) && !(t.tool === "place" && !canPlace),
      ).map((t) => (
        <IconButton
          key={t.tool}
          label={t.label}
          icon={t.icon}
          shortcut={t.shortcut}
          showLabel
          aria-pressed={tool === t.tool}
          {...(t.tool === "find" && findReason
            ? { disabled: true, disabledReason: findReason }
            : {})}
          {...(t.tool === "paths" && pathsReason
            ? { disabled: true, disabledReason: pathsReason }
            : {})}
          {...(t.tool === "biomes" && biomesReason
            ? { disabled: true, disabledReason: biomesReason }
            : {})}
          onClick={() => onTool(t.tool)}
        />
      ))}
      <span className="edit-toolbar-gap" />
      <IconButton
        label="Snapping"
        icon={Magnet}
        shortcut="map.snap"
        aria-pressed={snap}
        note={targetsText(snap, snapTargets)}
        onClick={() => onSnap(!snap)}
      />
      <Menu label="Snap to" icon={ChevronDown} className="snap-targets">
        {(Object.keys(TARGET_LABELS) as (keyof SnapTargets)[]).map((k) => (
          <MenuItem
            key={k}
            checked={snapTargets[k]}
            onSelect={() => onSnapTargets({ ...snapTargets, [k]: !snapTargets[k] })}
          >
            {snapTargets[k] ? "✓ " : ""}
            {TARGET_LABELS[k]}
          </MenuItem>
        ))}
      </Menu>
      {onPicking && (
        <IconButton
          label="Select several"
          icon={LayoutGrid}
          className="pick-several"
          aria-pressed={picking}
          onClick={() => onPicking(!picking)}
        />
      )}
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
