import { PROJECTIONS, type ProjectionId, switchView, type ViewState } from "@frontier/geo";
import type { MapFile } from "@frontier/schema";
import { ChevronLeft, Trash2 } from "lucide-react";
import type { OtherMap } from "../../map/layersBeneath.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { PageAction } from "../shell/panels.tsx";
import { IconLink } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { SaveStatus, type useSaveState } from "../ui/SaveStatus.tsx";

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
}) {
  // Deleting the map goes straight to the server, so it waits for a connection.
  const offline = useNeedsConnection();
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
        )}
        {view?.kind === "projected" && (
          <button
            type="button"
            className="quiet"
            aria-pressed={turning}
            onClick={() => onTurning(!turning)}
          >
            Turn
          </button>
        )}
        {above && (
          <button
            type="button"
            className="quiet"
            title={`Up to ${above.title}`}
            onClick={() => onLayer(above.id)}
          >
            ▲ Up
          </button>
        )}
        {below.length === 1 && (
          <button
            type="button"
            className="quiet"
            title={`Down to ${below[0]!.title}`}
            onClick={() => onLayer(below[0]!.id)}
          >
            ▼ Down
          </button>
        )}
        {below.length > 1 && (
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
        )}
        {!editing && (
          <select
            className="map-down"
            aria-label="Save a picture"
            value=""
            onChange={(e) => e.target.value && onPicture(Number(e.target.value))}
          >
            <option value="">Picture</option>
            <option value="1">Save at screen size</option>
            <option value="2">Save at twice the size</option>
            <option value="4">Save at four times the size</option>
          </select>
        )}
        {canExplore && !editing && (
          <button type="button" className="quiet" aria-pressed={exploring} onClick={onExplore}>
            Explore
          </button>
        )}
        {hasTime && (
          <button type="button" className="quiet" aria-pressed={timeOn} onClick={onTime}>
            Time
          </button>
        )}
        <button type="button" className="quiet" aria-pressed={layersOpen} onClick={onLayers}>
          Layers
        </button>
      </span>
      {/* Done and "⋯" stay on the first line on a phone, so the way out is always on screen. */}
      <span className="map-main">
        <PageAction>
          <button type="button" className={editing ? "primary" : "quiet"} onClick={onEdit}>
            {editing ? "Done" : "Edit"}
          </button>
        </PageAction>
        <Menu label="More actions" className="map-more">
          <MenuItem
            icon={Trash2}
            danger
            disabled={offline !== undefined}
            disabledReason={offline}
            onSelect={onRemove}
          >
            Delete map
          </MenuItem>
        </Menu>
      </span>
    </div>
  );
}
