import { measure, type Space } from "@frontier/geo";
import { isLined, type MapFeature, type MapFile, type MapStyle } from "@frontier/schema";
import { type ReactNode, useId, useState } from "react";
import { imageUrl } from "../../api.ts";
import { isCurved, outlineOf } from "../../map/handles.ts";
import { lengthText } from "../../map/lengthText.ts";
import { styleState, stylesFor } from "../../map/mapStyles.ts";
import type { MarkerSets, Names } from "../../map/useMapFile.ts";
import { iconLabel } from "../../map/viewUrl.ts";
import { shortcutText } from "../../keys.ts";
import { EntryCombobox } from "../EntryCombobox.tsx";
import { LabelFields } from "./LabelFields.tsx";
import { Combobox, type ComboboxOption } from "../ui/Combobox.tsx";
import { Tip } from "../ui/Tip.tsx";

/**
 * The choices of a map combobox: "None" (as `none`) first, then the maps, each label made unique,
 * since the list is narrowed by its labels.
 */
export function mapOptions(maps: { id: string; title: string }[], none = "None"): ComboboxOption[] {
  const seen = new Map<string, number>();
  return [
    { value: "", label: none },
    ...maps.map((m) => {
      const n = (seen.get(m.title) ?? 0) + 1;
      seen.set(m.title, n);
      return { value: m.id, label: n === 1 ? m.title : `${m.title} (${n})` };
    }),
  ];
}

/** The choices of a style combobox: "None" first, then the styles of one kind, labels unique. */
export function styleOptions(styles: MapStyle[], kind: MapStyle["for"]): ComboboxOption[] {
  const seen = new Map<string, number>();
  return [
    { value: "", label: "None" },
    ...stylesFor(styles, kind).map((s) => {
      const n = (seen.get(s.name) ?? 0) + 1;
      seen.set(s.name, n);
      return { value: s.id, label: n === 1 ? s.name : `${s.name} (${n})` };
    }),
  ];
}

/** The form for the selected feature while editing. */
export function FeatureEditor({
  feature,
  map,
  names,
  pendingEntry,
  pendingPath = null,
  drawn = feature,
  sets,
  otherMaps,
  vertex,
  onChange,
  onLink,
  onCreateEntry,
  generate,
  onCurve,
  onDelete,
  onRemoveVertex,
  canMove,
  onMove,
  onClose,
  corners,
  time,
  extra,
  styles = [],
  onStyle,
  onEditStyles,
}: {
  /** The library's path and zone styles. */
  styles?: MapStyle[];
  /** Gives the path or zone a style, or none. */
  onStyle?: (style: string | null) => void;
  /** Opens the Styles tab. */
  onEditStyles?: () => void;
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
  /** The path of that entry. */
  pendingPath?: string | null;
  /** The shape on screen, which the path's length is measured along. */
  drawn?: MapFeature;
  sets: MarkerSets;
  otherMaps: { id: string; title: string }[];
  vertex: number | null;
  onChange: (next: MapFeature) => void;
  onLink: (path: string | null, title: string) => void;
  /** Makes an entry from a name typed in the entry list that no entry has, and links it. */
  onCreateEntry?: (name: string) => void;
  /** Generate with AI: a name and description for the feature. */
  generate?: ReactNode;
  /** Draws the path or zone curved or straight. */
  onCurve: (curved: boolean) => void;
  onDelete: () => void;
  onRemoveVertex: () => void;
  /** Whether there is a feature of its kind in its layer to pass, forward and back. */
  canMove: { forward: boolean; back: boolean };
  /** Moves the feature a step forward (1, drawn above the next) or back (-1). */
  onMove: (by: 1 | -1) => void;
  onClose: () => void;
}) {
  const linked = feature.entry ? names[feature.entry]?.title : pendingEntry;
  const entryPath = feature.entry ? (names[feature.entry]?.path ?? null) : pendingPath;
  const ids = useId();
  const space = map.space as Space;
  const length =
    drawn.kind === "path" && !(map.space.kind === "flat" && map.space.schematic === true)
      ? lengthText(measure(space, outlineOf(space, drawn).line), space.kind === "sphere")
      : null;
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
      <div className="field">
        <span id={`${ids}-entry`}>Entry</span>
        <EntryCombobox
          labelledBy={`${ids}-entry`}
          value={entryPath}
          allowNone
          onChange={(path, title) => onLink(path, title)}
          {...(onCreateEntry ? { onCreate: onCreateEntry } : {})}
        />
      </div>
      {feature.kind === "label" ? (
        <LabelFields label={feature} onChange={onChange} />
      ) : (
        <label className="field">
          <span>Label {linked && <em className="muted">instead of the entry's name</em>}</span>
          <input
            type="text"
            value={feature.label ?? ""}
            onChange={(e) => onChange({ ...feature, label: e.target.value || null } as MapFeature)}
          />
        </label>
      )}
      {generate}
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
      <div className="field">
        <span id={`${ids}-child`}>A map of this place</span>
        <Combobox
          labelledBy={`${ids}-child`}
          options={mapOptions(otherMaps)}
          value={feature.child ?? ""}
          onChange={(child) => onChange({ ...feature, child: child || null })}
          findLabel="Find a map"
          empty="No map has that name."
        />
      </div>
      {isLined(feature) && (
        <div className="field">
          <span id={`${ids}-curve`}>
            Line <em className="muted">for all of this feature's shapes</em>
          </span>
          <span className="map-curve" role="group" aria-labelledby={`${ids}-curve`}>
            {([false, true] as const).map((on) => (
              <Tip
                key={String(on)}
                label={on ? "Curved" : "Straight"}
                keys={shortcutText("map.curve")}
              >
                <button
                  type="button"
                  className={isCurved(feature) === on ? "is-on" : ""}
                  aria-pressed={isCurved(feature) === on}
                  onClick={() => onCurve(on)}
                >
                  {on ? "Curved" : "Straight"}
                </button>
              </Tip>
            ))}
          </span>
        </div>
      )}
      {isLined(feature) && (
        <div className="field feature-style">
          <span id={`${ids}-style`}>{feature.kind === "path" ? "Path style" : "Zone style"}</span>
          {styleState(feature, styles) === "deleted" && (
            <em className="muted style-deleted">Style: deleted</em>
          )}
          <span className="feature-style-row">
            <Combobox
              labelledBy={`${ids}-style`}
              options={styleOptions(styles, feature.kind)}
              value={styleState(feature, styles) === "found" ? (feature.style ?? "") : ""}
              onChange={(style) => onStyle?.(style || null)}
              findLabel="Find a style"
              empty="No style has that name."
            />
            {onEditStyles && (
              <button type="button" className="quiet" onClick={onEditStyles}>
                Edit styles…
              </button>
            )}
          </span>
        </div>
      )}
      {length && (
        <p className="field feature-length">
          <span>Length</span> <span>{length}</span>
        </p>
      )}
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
            <Tip label="A plain dot">
              <button
                type="button"
                aria-label="A plain dot"
                aria-pressed={feature.icon === null}
                className={feature.icon === null ? "is-picked" : ""}
                onClick={() => onChange({ ...feature, icon: null })}
              >
                ●
              </button>
            </Tip>
            {icons.map((icon) => {
              const picked = feature.icon?.set === set && feature.icon.name === icon.name;
              return (
                <Tip key={icon.path} label={iconLabel(icon.name)}>
                  <button
                    type="button"
                    aria-label={iconLabel(icon.name)}
                    aria-pressed={picked}
                    className={picked ? "is-picked" : ""}
                    onClick={() => onChange({ ...feature, icon: { set, name: icon.name } })}
                  >
                    <img src={imageUrl(icon.path)} alt="" loading="lazy" width={24} height={24} />
                  </button>
                </Tip>
              );
            })}
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
        {isLined(feature) && vertex !== null && (
          <Tip
            label="Remove this point"
            keys={shortcutText("map.delete")}
            {...((corners ?? feature.points.length) > minimum
              ? {}
              : { note: `A ${feature.kind} needs at least ${minimum} points` })}
          >
            <button
              type="button"
              className="quiet"
              aria-disabled={(corners ?? feature.points.length) <= minimum || undefined}
              onClick={() => (corners ?? feature.points.length) > minimum && onRemoveVertex()}
            >
              Remove this point
            </button>
          </Tip>
        )}
        <button type="button" className="plain danger" onClick={onDelete}>
          Delete
        </button>
      </p>
    </aside>
  );
}
