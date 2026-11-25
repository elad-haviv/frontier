import { isLined, type MapFeature, type MapFile, type MapStyle } from "@frontier/schema";
import {
  GitBranch,
  ArrowDownToLine,
  ArrowUpToLine,
  BookOpen,
  Layers,
  Link2,
  Map as MapIcon,
  Palette,
  MapPin,
  Pencil,
  Pentagon,
  Plus,
  Slash,
  Spline,
  Telescope,
  Trash2,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { shortcutText } from "../../keys.ts";
import type { MenuTarget } from "../../map/gesture.ts";
import { styleOf, stylesFor } from "../../map/mapStyles.ts";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
} from "../ui/ContextMenu.tsx";

/** What the map's right-click menu acts on, and the actions it offers. */
export interface MapMenu {
  target: MenuTarget;
  editing: boolean;
  /** The feature right-clicked, or whose corner was. */
  feature: MapFeature | null;
  map: MapFile;
  /** The feature's entry, when it has one that is known. */
  entryPath: string | null;
  /** Whether the feature's map of this place exists. */
  childFound: boolean;
  /** Why the right-clicked corner cannot be removed, or null when it can. */
  removeReason: string | null;
  /** Whether the feature can be brought forward or sent back among its kind in its layer. */
  canMove: { forward: boolean; back: boolean };
  /** Discovery is on, so a place can be explored. */
  canExplore: boolean;
  openEntry: (path: string) => void;
  openChild: (feature: MapFeature) => void;
  copyPlace: (feature: MapFeature) => void;
  editFeature: (feature: MapFeature) => void;
  copyView: () => void;
  explore: () => void;
  showInBar: (feature: MapFeature) => void;
  moveToLayer: (feature: MapFeature, layer: string) => void;
  reorder: (feature: MapFeature, by: 1 | -1) => void;
  remove: (feature: MapFeature) => void;
  removePoint: (feature: MapFeature, vertex: number) => void;
  insertPoint: (feature: MapFeature, segment: number, at: [number, number]) => void;
  /** Draws a path or zone curved or straight: all of its shapes. */
  setCurve: (feature: MapFeature, curved: boolean) => void;
  /** The library's path and zone styles. */
  styles: MapStyle[];
  /** Gives a path or zone a style, or none. */
  setStyle: (feature: MapFeature, style: string | null) => void;
  addMarker: () => void;
  startPath: () => void;
  startZone: () => void;
  /** Starts a new path on this one, where it was right-clicked: a branch, joined at its start. */
  branch: (feature: MapFeature) => void;
}

/** The items for what was right-clicked: a feature, a corner of the selected one, or nothing. */
function Items({ menu }: { menu: MapMenu }) {
  const { target, editing, feature } = menu;
  if (target.kind === "corner" && feature) {
    return (
      <ContextMenuItem
        icon={X}
        keys={shortcutText("map.delete")}
        disabled={menu.removeReason !== null}
        disabledReason={menu.removeReason ?? undefined}
        onSelect={() => menu.removePoint(feature, target.vertex)}
      >
        Remove this point
      </ContextMenuItem>
    );
  }
  if (target.kind === "insert" && feature) {
    return (
      <ContextMenuItem
        icon={Plus}
        onSelect={() => menu.insertPoint(feature, target.segment, target.at)}
      >
        Add a point here
      </ContextMenuItem>
    );
  }
  if (target.kind === "feature" && feature && !editing) {
    return (
      <>
        <ContextMenuItem
          icon={BookOpen}
          disabled={menu.entryPath === null}
          disabledReason={feature.entry ? "Its entry could not be found" : "It has no entry"}
          onSelect={() => menu.entryPath && menu.openEntry(menu.entryPath)}
        >
          Open the entry
        </ContextMenuItem>
        <ContextMenuItem
          icon={MapIcon}
          disabled={!feature.child || !menu.childFound}
          disabledReason={feature.child ? "Its map is missing" : "It has no map of its place"}
          onSelect={() => menu.openChild(feature)}
        >
          Open the map of this place
        </ContextMenuItem>
        <ContextMenuItem icon={Link2} onSelect={() => menu.copyPlace(feature)}>
          Copy a link to this place
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={Pencil}
          keys={shortcutText("map.edit")}
          onSelect={() => menu.editFeature(feature)}
        >
          Edit this feature
        </ContextMenuItem>
      </>
    );
  }
  if (target.kind === "feature" && feature) {
    return (
      <>
        <ContextMenuItem icon={Pencil} onSelect={() => menu.showInBar(feature)}>
          Edit in the side bar
        </ContextMenuItem>
        {isLined(feature) && (
          <ContextMenuItem
            icon={(feature as { curve?: string }).curve === "smooth" ? Slash : Spline}
            keys={shortcutText("map.curve")}
            onSelect={() =>
              menu.setCurve(feature, (feature as { curve?: string }).curve !== "smooth")
            }
          >
            {(feature as { curve?: string }).curve === "smooth"
              ? "Make it straight"
              : "Make it curved"}
          </ContextMenuItem>
        )}
        {feature.kind === "path" && (
          <ContextMenuItem icon={GitBranch} onSelect={() => menu.branch(feature)}>
            Branch a path from here
          </ContextMenuItem>
        )}
        {isLined(feature) && (
          <ContextMenuSub
            label={feature.kind === "path" ? "Path style" : "Zone style"}
            icon={Palette}
          >
            {[null, ...stylesFor(menu.styles, feature.kind)].map((style) => {
              const current = styleOf(feature, menu.styles)?.id ?? null;
              const id = style?.id ?? null;
              return (
                <ContextMenuItem
                  key={id ?? "none"}
                  disabled={id === current}
                  disabledReason={id ? "It has this style" : "It has no style"}
                  onSelect={() => menu.setStyle(feature, id)}
                >
                  {style?.name ?? "None"}
                </ContextMenuItem>
              );
            })}
          </ContextMenuSub>
        )}
        <ContextMenuSub label="Move to layer" icon={Layers}>
          {menu.map.layers.map((layer) => (
            <ContextMenuItem
              key={layer.id}
              disabled={layer.id === feature.layer}
              disabledReason="It is in this layer"
              onSelect={() => menu.moveToLayer(feature, layer.id)}
            >
              {layer.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSub>
        <ContextMenuItem
          icon={ArrowUpToLine}
          disabled={!menu.canMove.forward}
          disabledReason="It is already in front of its kind in its layer"
          onSelect={() => menu.reorder(feature, 1)}
        >
          Bring forward
        </ContextMenuItem>
        <ContextMenuItem
          icon={ArrowDownToLine}
          disabled={!menu.canMove.back}
          disabledReason="It is already behind its kind in its layer"
          onSelect={() => menu.reorder(feature, -1)}
        >
          Send back
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={Trash2}
          danger
          keys={shortcutText("map.delete")}
          onSelect={() => menu.remove(feature)}
        >
          Delete
        </ContextMenuItem>
      </>
    );
  }
  if (editing) {
    return (
      <>
        <ContextMenuItem icon={MapPin} onSelect={menu.addMarker}>
          Add a marker here
        </ContextMenuItem>
        <ContextMenuItem icon={Spline} onSelect={menu.startPath}>
          Start a path here
        </ContextMenuItem>
        <ContextMenuItem icon={Pentagon} onSelect={menu.startZone}>
          Start a zone here
        </ContextMenuItem>
      </>
    );
  }
  return (
    <>
      <ContextMenuItem icon={Link2} onSelect={menu.copyView}>
        Copy a link to this view
      </ContextMenuItem>
      {menu.canExplore && (
        <ContextMenuItem icon={Telescope} onSelect={menu.explore}>
          Explore here
        </ContextMenuItem>
      )}
    </>
  );
}

/**
 * The map's right-click menu around its canvas. The page holds whether it is open and what it
 * acts on; `disabled` leaves the right-click to the browser (Shift held) and gives touch no menu.
 */
export function MapContextMenu({
  menu,
  open,
  disabled,
  onOpenChange,
  onClosed,
  children,
}: {
  menu: MapMenu | null;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  /** The menu has closed: the focus goes back to the map. */
  onClosed: () => void;
  children: ReactElement;
}) {
  return (
    <ContextMenu
      open={open}
      disabled={disabled}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        onClosed();
      }}
      className="map-context-menu"
      items={menu ? <Items menu={menu} /> : null}
    >
      {children}
    </ContextMenu>
  );
}
