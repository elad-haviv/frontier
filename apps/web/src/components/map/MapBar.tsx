import { PROJECTIONS, type ProjectionId, switchView, type ViewState } from "@frontier/geo";
import type { MapFile } from "@frontier/schema";
import {
  ChevronLeft,
  Clock,
  ImageDown,
  Layers,
  Layers3,
  Link2,
  Rotate3d,
  Telescope,
  Trash2,
  Mountain,
} from "lucide-react";
import { shortcutText } from "../../keys.ts";
import type { OtherMap } from "../../map/layersBeneath.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { PageAction } from "../shell/panels.tsx";
import { useCanWrite } from "../projectContext.ts";
import { IconButton, IconLink } from "../ui/IconButton.tsx";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { SaveStatus, type useSaveState } from "../ui/SaveStatus.tsx";
import { Tip } from "../ui/Tip.tsx";

/** The sizes a picture of the map is saved at, as times the size of the screen. */
const PICTURES = [
  { scale: 1, label: "Save a picture at screen size" },
  { scale: 2, label: "Save a picture at twice the size" },
  { scale: 4, label: "Save a picture at four times the size" },
];

/** The map's bar: its title, the view, layers above and below, and Edit or Done. */
export function MapBar({
  map,
  editing,
  saving,
  view,
  size,
  onView,
  turning,
  onTurning,
  onStopFocus,
  above,
  below,
  onLayer,
  onPicture,
  onCopyView,
  canExplore,
  exploring,
  onExplore,
  hasTime,
  timeOn,
  onTime,
  layersOpen,
  onLayers,
  onEdit,
  onChange,
  onRemove,
  onTerrain,
}: {
  map: MapFile;
  editing: boolean;
  saving: ReturnType<typeof useSaveState>;
  view: ViewState | null;
  size: { width: number; height: number };
  onView: (view: ViewState) => void;
  turning: boolean;
  onTurning: (turning: boolean) => void;
  onStopFocus: () => void;
  /** The map this one lies under, and those that lie under it. */
  above: OtherMap | undefined;
  below: OtherMap[];
  onLayer: (id: string) => void;
  /** Saves a picture at this many times the size of the screen. */
  onPicture: (scale: number) => void;
  /** Copies a link to the map as it is seen now. */
  onCopyView: () => void;
  canExplore: boolean;
  exploring: boolean;
  onExplore: () => void;
  hasTime: boolean;
  timeOn: boolean;
  onTime: () => void;
  layersOpen: boolean;
  onLayers: () => void;
  onEdit: () => void;
  onChange: (next: MapFile) => void;
  onRemove: () => void;
  /** Opens the Terrain dialog; left out where the map cannot have terrain (a globe, for now). */
  onTerrain?: (() => void) | undefined;
}) {
  // Deleting the map goes straight to the server, so it waits for a connection.
  const offline = useNeedsConnection();
  // Editing, deleting and exploring (asking the AI) are writers' (stage 31c).
  const canWrite = useCanWrite();
  const sphere = map.space.kind === "sphere";
  return (
    <div className="map-bar">
      <IconLink to="/maps" className="map-back" label="All maps" icon={ChevronLeft} />
      {editing ? (
        <input
          className="map-title"
          aria-label="Title of the map"
          value={map.title}
          onChange={(e) => e.target.value && onChange({ ...map, title: e.target.value })}
        />
      ) : (
        <h1 className="map-title">{map.title}</h1>
      )}
      {editing && <SaveStatus state={saving.state} />}
      <span className="map-actions">
        {sphere && view && (
          <Tip label="View: the globe, laid flat, or a projection">
            <select
              className="map-down"
              aria-label="View"
              value={view.kind === "projected" ? view.projection : view.kind}
              onChange={(e) => {
                const to = e.target.value as "globe" | "plate" | ProjectionId;
                onView(switchView(view, to, size.width, size.height));
                if (to === "globe" || to === "plate") {
                  onTurning(false);
                  onStopFocus();
                }
              }}
            >
              <option value="globe">Globe</option>
              <option value="plate">Flat</option>
              {PROJECTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Tip>
        )}
        {view?.kind === "projected" && (
          <IconButton
            label="Turn"
            icon={Rotate3d}
            showLabel
            className="quiet"
            aria-pressed={turning}
            onClick={() => onTurning(!turning)}
          />
        )}
        {above && (
          <Tip label={`Up to ${above.title}`}>
            <button type="button" className="quiet" onClick={() => onLayer(above.id)}>
              ▲ Up
            </button>
          </Tip>
        )}
        {below.length === 1 && (
          <Tip label={`Down to ${below[0]!.title}`}>
            <button type="button" className="quiet" onClick={() => onLayer(below[0]!.id)}>
              ▼ Down
            </button>
          </Tip>
        )}
        {below.length > 1 && (
          <Tip label="Down to a layer below">
            <select
              className="map-down"
              aria-label="Down to a layer below"
              value=""
              onChange={(e) => e.target.value && onLayer(e.target.value)}
            >
              <option value="">▼ Down</option>
              {below.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </Tip>
        )}
        {(above || below.length > 0) && (
          <IconLink
            to={`/stack/${map.id}`}
            label="Layers stacked"
            icon={Layers3}
            showLabel
            className="quiet"
          />
        )}
        {canExplore && canWrite && !editing && (
          <IconButton
            label="Explore"
            icon={Telescope}
            shortcut="map.explore"
            showLabel
            className="quiet"
            aria-pressed={exploring}
            onClick={onExplore}
          />
        )}
        {hasTime && (
          <IconButton
            label="Time"
            icon={Clock}
            shortcut="map.time"
            showLabel
            className="quiet"
            aria-pressed={timeOn}
            onClick={onTime}
          />
        )}
        <IconButton
          label="Layers"
          icon={Layers}
          shortcut="map.layers"
          showLabel
          className="quiet"
          aria-pressed={layersOpen}
          onClick={onLayers}
        />
      </span>
      {/* Done and "⋯" stay on the first line on a phone, so the way out is always on screen. */}
      <span className="map-main">
        {canWrite && (
          <PageAction>
            <Tip
              label={editing ? "Done editing" : "Edit the map"}
              keys={shortcutText(editing ? "map.done" : "map.edit")}
            >
              <button type="button" className={editing ? "primary" : "quiet"} onClick={onEdit}>
                {editing ? "Done" : "Edit"}
              </button>
            </Tip>
          </PageAction>
        )}
        <Menu label="More actions" className="map-more">
          {!editing &&
            PICTURES.map((p) => (
              <MenuItem key={p.scale} icon={ImageDown} onSelect={() => onPicture(p.scale)}>
                {p.label}
              </MenuItem>
            ))}
          <MenuItem icon={Link2} onSelect={onCopyView}>
            Copy a link to this view
          </MenuItem>
          {editing && onTerrain && (
            <MenuItem icon={Mountain} onSelect={onTerrain}>
              Terrain…
            </MenuItem>
          )}
          {canWrite && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={Trash2}
                danger
                disabled={offline !== undefined}
                disabledReason={offline}
                onSelect={onRemove}
              >
                Delete map
              </MenuItem>
            </>
          )}
        </Menu>
      </span>
    </div>
  );
}
