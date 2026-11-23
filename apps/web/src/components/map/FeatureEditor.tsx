import type { MapFeature, MapFile } from "@frontier/schema";
import { type ReactNode, useState } from "react";
import { imageUrl } from "../../api.ts";
import type { MarkerSets, Names } from "../../map/useMapFile.ts";
import { iconLabel } from "../../map/viewUrl.ts";
import { EntryPicker } from "../EntryPicker.tsx";

/** The form for the selected feature while editing. */
export function FeatureEditor({
  feature,
  map,
  names,
  pendingEntry,
  sets,
  otherMaps,
  vertex,
  onChange,
  onLink,
  onDelete,
  onRemoveVertex,
  canMove,
  onMove,
  onClose,
  corners,
  time,
  extra,
}: {
  /** More parts of the editor, such as how a world revolves. */
  extra?: ReactNode;
  /** How many points the shape on screen has, when it is not the feature's first shape. */
  corners?: number;
  /** The part that says when the feature exists and lists its shapes. */
  time?: ReactNode;
  feature: MapFeature;
  map: MapFile;
  names: Names;
  /** The title of an entry that was just linked and is waiting for the save. */
  pendingEntry: string | null;
  sets: MarkerSets;
  otherMaps: { id: string; title: string }[];
  vertex: number | null;
  onChange: (next: MapFeature) => void;
  onLink: (path: string | null, title: string) => void;
  onDelete: () => void;
  onRemoveVertex: () => void;
  /** Whether there is a feature of its kind in its layer to pass, forward and back. */
  canMove: { forward: boolean; back: boolean };
  /** Moves the feature a step forward (1, drawn above the next) or back (-1). */
  onMove: (by: 1 | -1) => void;
  onClose: () => void;
}) {
  const linked = feature.entry ? names[feature.entry]?.title : pendingEntry;
  const usable = sets.filter((s) => map.markerSets.includes(s.name));
  const [set, setSet] = useState(
    (feature.kind === "marker" && feature.icon?.set) || usable[0]?.name || "",
  );
  const icons = usable.find((s) => s.name === set)?.icons ?? [];
  const minimum = feature.kind === "path" ? 2 : 3;

  return (
    <aside className="feature-card feature-editor" aria-label="Edit the selected feature">
      <button type="button" className="plain card-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      <label className="field">
        <span>Entry</span>
        {linked ? (
          <span className="linked">
            {linked}{" "}
            <button type="button" className="plain danger" onClick={() => onLink(null, "")}>
              Unlink
            </button>
          </span>
        ) : (
          <EntryPicker onPick={onLink} />
        )}
      </label>
      <label className="field">
        <span>Label {linked && <em className="muted">instead of the entry's name</em>}</span>
        <input
          type="text"
          value={feature.label ?? ""}
          onChange={(e) => onChange({ ...feature, label: e.target.value || null })}
        />
      </label>
      <label className="field">
        <span>Layer</span>
        <select
          value={feature.layer}
          onChange={(e) => onChange({ ...feature, layer: e.target.value })}
        >
          {map.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>A map of this place</span>
        <select
          value={feature.child ?? ""}
          onChange={(e) => onChange({ ...feature, child: e.target.value || null })}
        >
          <option value="">None</option>
          {otherMaps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </label>
      {feature.kind === "marker" && usable.length > 0 && (
        <div className="field">
          <span>Icon</span>
          {usable.length > 1 && (
            <select aria-label="Marker set" value={set} onChange={(e) => setSet(e.target.value)}>
              {usable.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <div className="icon-grid">
            <button
              type="button"
              className={feature.icon === null ? "is-picked" : ""}
              title="A plain dot"
              onClick={() => onChange({ ...feature, icon: null })}
            >
              ●
            </button>
            {icons.map((icon) => (
              <button
                key={icon.path}
                type="button"
                title={iconLabel(icon.name)}
                aria-label={iconLabel(icon.name)}
                className={
                  feature.icon?.set === set && feature.icon.name === icon.name ? "is-picked" : ""
                }
                onClick={() => onChange({ ...feature, icon: { set, name: icon.name } })}
              >
                <img src={imageUrl(icon.path)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <span>
          Order <em className="muted">among the {feature.kind}s of its layer</em>
        </span>
        <span className="order-buttons">
          <button
            type="button"
            className="quiet"
            disabled={!canMove.forward}
            onClick={() => onMove(1)}
          >
            Bring forward
          </button>
          <button
            type="button"
            className="quiet"
            disabled={!canMove.back}
            onClick={() => onMove(-1)}
          >
            Send back
          </button>
        </span>
      </div>
      {time}
      {extra}
      <p className="change-actions">
        {feature.kind !== "marker" &&
          vertex !== null &&
          (corners ?? feature.points.length) > minimum && (
            <button type="button" className="quiet" onClick={onRemoveVertex}>
              Remove this point
            </button>
          )}
        <button type="button" className="plain danger" onClick={onDelete}>
          Delete
        </button>
      </p>
    </aside>
  );
}
