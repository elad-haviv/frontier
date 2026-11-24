import {
  GROUP_LOOK,
  type MapFeature,
  type MapFile,
  type MapGroup,
  type MapStyle,
} from "@frontier/schema";
import { ChevronLeft, Group as GroupIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { groupTitle, membersOf, nameColour } from "../../map/groups.ts";
import { kindName } from "../../map/layerRows.ts";
import { styleState } from "../../map/mapStyles.ts";
import type { Names } from "../../map/useMapFile.ts";
import { shortcutText } from "../../keys.ts";
import { EntryCombobox } from "../EntryCombobox.tsx";
import { Combobox } from "../ui/Combobox.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Tip } from "../ui/Tip.tsx";
import { mapOptions, styleOptions } from "./FeatureEditor.tsx";
import "./GroupPanel.css";

/** What the group's tab can do to the map; the page makes each change one step to undo. */
export interface GroupActions {
  /** Sets parts of the group; a key given as undefined goes back to its default. */
  set: (change: { [K in keyof MapGroup]?: MapGroup[K] | undefined }) => void;
  link: (path: string | null, title: string) => void;
  /** Gives every zone of the group a style, or none. */
  styleZones: (style: string | null) => void;
  moveTo: (layer: string) => void;
  open: (member: string) => void;
  takeOut: (member: string) => void;
  ungroup: () => void;
  remove: () => void;
  close: () => void;
}

/**
 * The selected group while editing (the Edit group tab): its name and entry, its name on the map
 * and how it looks, the style of its zones, its layer, members, map of the place, span and lock.
 */
export function GroupEditor({
  group,
  map,
  names,
  pendingEntry,
  pendingPath,
  titleOf,
  styles,
  otherMaps,
  shownNow,
  spans,
  focusName,
  act,
}: {
  group: MapGroup;
  map: MapFile;
  names: Names;
  pendingEntry: string | null;
  pendingPath: string | null;
  titleOf: (f: MapFeature) => string;
  styles: MapStyle[];
  otherMaps: { id: string; title: string }[];
  /** Whether its name is written at this zoom, as the map was last drawn. */
  shownNow: boolean;
  /** The spans of the chronicle the map is seen through, to say when the group exists. */
  spans: { id: string; name: string }[] | null;
  /** Just made: the name field takes the focus, ready to type. */
  focusName: boolean;
  act: GroupActions;
}) {
  const ids = useId();
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusName) nameBox.current?.focus();
  }, [focusName, group.id]);
  const members = membersOf(map, group.id);
  const zones = members.filter((f) => f.kind === "zone");
  const zoneStyles = new Set(
    zones.map((z) =>
      styleState(z, styles) === "found" ? ((z as { style?: string }).style ?? "") : "",
    ),
  );
  const linked = group.entry ? names[group.entry]?.title : pendingEntry;
  const entryPath = group.entry ? (names[group.entry]?.path ?? null) : pendingPath;
  const hasWords = !!(group.label?.trim() || linked);
  const writes = group.write !== false;
  const size = group.size ?? GROUP_LOOK.size;
  const spacing = group.spacing ?? GROUP_LOOK.spacing;
  const rotate = group.rotate ?? GROUP_LOOK.rotate;
  return (
    <aside
      className="feature-card feature-editor group-editor"
      aria-label="Edit the selected group"
    >
      <button type="button" className="plain card-close" aria-label="Close" onClick={act.close}>
        ✕
      </button>
      <label className="field">
        <span>Name {linked && <em className="muted">instead of the entry's name</em>}</span>
        <input
          ref={nameBox}
          type="text"
          aria-label="Group name"
          value={group.label ?? ""}
          placeholder="Group"
          onChange={(e) => act.set({ label: e.target.value || null })}
        />
      </label>
      <div className="field">
        <span id={`${ids}-entry`}>Entry</span>
        <EntryCombobox
          labelledBy={`${ids}-entry`}
          value={entryPath}
          allowNone
          onChange={(path, title) => act.link(path, title)}
        />
      </div>

      <fieldset className="group-name-on-map">
        <legend>Name on the map</legend>
        <label className="lt-check">
          <input
            type="checkbox"
            checked={writes}
            onChange={(e) => act.set({ write: e.target.checked ? undefined : false })}
          />
          Write the name on the map
        </label>
        {writes && !hasWords && (
          <p className="muted group-note">Give the group a name or an entry to write it.</p>
        )}
        {writes && hasWords && (
          <p className="muted group-note" data-shown={shownNow}>
            {shownNow ? "Shown at this zoom." : "Hidden at this zoom: zoom in."}
          </p>
        )}
        {writes && (
          <>
            <div className="field">
              <span id={`${ids}-place`}>Placement</span>
              <span className="map-curve" role="group" aria-labelledby={`${ids}-place`}>
                <button
                  type="button"
                  className={!group.at ? "is-on" : ""}
                  aria-pressed={!group.at}
                  onClick={() => act.set({ at: undefined })}
                >
                  Automatic
                </button>
                <Tip label="Drag the name on the map to place it yourself">
                  <button
                    type="button"
                    className={group.at ? "is-on" : ""}
                    aria-pressed={!!group.at}
                    aria-disabled={!group.at || undefined}
                  >
                    Where I put it
                  </button>
                </Tip>
              </span>
              <em className="muted group-note">
                {group.at
                  ? "Where you dragged it; it moves with the group."
                  : "In the middle of the largest piece. Drag the name on the map to place it yourself."}
              </em>
            </div>
            <div className="label-look">
              <label className="field">
                <span>Size</span>
                <input
                  type="number"
                  min={6}
                  max={160}
                  value={size}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n >= 6 && n <= 160) {
                      act.set({ size: n === GROUP_LOOK.size ? undefined : n });
                    }
                  }}
                />
              </label>
              <div className="field">
                <span>Colour</span>
                <span className="group-colour">
                  <button
                    type="button"
                    className={`quiet${group.color ? "" : " is-on"}`}
                    aria-pressed={!group.color}
                    onClick={() => act.set({ color: undefined })}
                  >
                    From the zones
                  </button>
                  <input
                    type="color"
                    aria-label="Name colour"
                    value={nameColour(map, group, styles)}
                    onChange={(e) => act.set({ color: e.target.value })}
                  />
                </span>
              </div>
            </div>
            <label className="field">
              <span>
                Turn <em className="muted">{rotate}°</em>
              </span>
              <input
                type="range"
                min={-180}
                max={180}
                step={5}
                value={rotate}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  act.set({ rotate: n === GROUP_LOOK.rotate ? undefined : n });
                }}
              />
            </label>
            <label className="field">
              <span>
                Letter spacing <em className="muted">{spacing.toFixed(2)} em</em>
              </span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={spacing}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  act.set({ spacing: n === GROUP_LOOK.spacing ? undefined : n });
                }}
              />
            </label>
          </>
        )}
      </fieldset>

      {zones.length > 0 && (
        <div className="field feature-style">
          <span id={`${ids}-style`}>
            Zone style{" "}
            <em className="muted">
              for its {zones.length === 1 ? "zone" : `${zones.length} zones`}
              {zoneStyles.size > 1 ? ": mixed" : ""}
            </em>
          </span>
          <Combobox
            labelledBy={`${ids}-style`}
            options={styleOptions(styles, "zone")}
            value={zoneStyles.size === 1 ? [...zoneStyles][0]! : ""}
            onChange={(style) => act.styleZones(style || null)}
            findLabel="Find a style"
            empty="No style has that name."
          />
        </div>
      )}
      <label className="field">
        <span>
          Layer <em className="muted">the group and all its members</em>
        </span>
        <select value={group.layer} onChange={(e) => act.moveTo(e.target.value)}>
          {map.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>
          Members <em className="muted">double-click one on the map to go inside</em>
        </span>
        <ul className="group-members" aria-label="Members">
          {members.map((f) => {
            const name = titleOf(f) || kindName(f.kind);
            return (
              <li key={f.id}>
                <button type="button" className="plain" onClick={() => act.open(f.id)}>
                  {name}
                </button>
                <IconButton
                  label={`Take ${name} out of the group`}
                  icon={X}
                  size="sm"
                  className="plain"
                  onClick={() => act.takeOut(f.id)}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <div className="field">
        <span id={`${ids}-child`}>A map of this place</span>
        <Combobox
          labelledBy={`${ids}-child`}
          options={mapOptions(otherMaps)}
          value={group.child ?? ""}
          onChange={(child) => act.set({ child: child || null })}
          findLabel="Find a map"
          empty="No map has that name."
        />
      </div>
      {spans ? (
        <label className="field">
          <span>When it exists</span>
          <select
            value={group.span ?? ""}
            onChange={(e) => act.set({ span: e.target.value || null })}
          >
            <option value="">As its entry says, or always</option>
            {spans.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="muted feature-time">Turn time on to say when this group exists.</p>
      )}
      <label className="lt-check">
        <input
          type="checkbox"
          checked={group.locked === true}
          onChange={(e) => act.set({ locked: e.target.checked || undefined })}
        />
        Locked: its members cannot be picked on the map
      </label>
      <p className="change-actions">
        <Tip label="Ungroup" keys={shortcutText("map.ungroup")}>
          <button type="button" className="quiet" onClick={act.ungroup}>
            Ungroup
          </button>
        </Tip>
        <button type="button" className="plain danger" onClick={act.remove}>
          Delete all {members.length}
        </button>
      </p>
    </aside>
  );
}

/** The selected group while viewing (the Selected tab): its name, entry and members. */
export function GroupCard({
  group,
  map,
  names,
  children,
  titleOf,
  onOpenEntry,
  onOpenChild,
  onEdit,
  onClose,
}: {
  group: MapGroup;
  map: MapFile;
  names: Names;
  children: Record<string, string>;
  titleOf: (f: MapFeature) => string;
  onOpenEntry: (path: string) => void;
  onOpenChild: (id: string) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const entry = group.entry ? names[group.entry] : undefined;
  const members = membersOf(map, group.id);
  return (
    <aside className="feature-card group-card" aria-label="The selected group">
      <button type="button" className="plain card-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      <h3>
        <Icon icon={GroupIcon} size="sm" /> {groupTitle(group, (id) => names[id]?.title)}
      </h3>
      <p className="muted">A group of {members.length}</p>
      {entry && (
        <p>
          <button type="button" className="quiet" onClick={() => onOpenEntry(entry.path)}>
            Open the entry
          </button>
        </p>
      )}
      {group.child && group.child in children && (
        <p>
          <button type="button" className="quiet" onClick={() => onOpenChild(group.child!)}>
            Open the map of {children[group.child]}
          </button>
        </p>
      )}
      <ul className="group-members" aria-label="Members">
        {members.map((f) => {
          const own = f.entry ? names[f.entry] : undefined;
          return (
            <li key={f.id}>
              <span>{titleOf(f) || kindName(f.kind)}</span>
              {own && (
                <button type="button" className="plain" onClick={() => onOpenEntry(own.path)}>
                  Open
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="change-actions">
        <button type="button" className="quiet" onClick={onEdit}>
          Edit this group
        </button>
      </p>
    </aside>
  );
}

/** The top of a member's Edit feature tab: back to its group, its group, and taking it out. */
export function MemberFields({
  map,
  feature,
  names,
  onBack,
  onGroup,
  onNewGroup,
}: {
  map: MapFile;
  feature: MapFeature;
  names: Names;
  onBack: (group: string) => void;
  /** Puts it in a group of its layer, or in none. */
  onGroup: (group: string | null) => void;
  /** Starts picking several, with this one picked, to group it with others. */
  onNewGroup: () => void;
}) {
  const ids = useId();
  const title = (g: MapGroup) => groupTitle(g, (id) => names[id]?.title);
  const group = map.groups?.find((g) => g.id === feature.group);
  const choices = (map.groups ?? []).filter((g) => g.layer === feature.layer);
  return (
    <div className="group-member">
      {group && (
        <nav className="group-crumb" aria-label="Group">
          <Tip label={`Back to ${title(group)}`} keys={shortcutText("map.cancel")}>
            <button type="button" className="plain" onClick={() => onBack(group.id)}>
              <Icon icon={ChevronLeft} size="sm" /> {title(group)}
            </button>
          </Tip>
        </nav>
      )}
      <label className="field">
        <span id={`${ids}-group`}>Group</span>
        <select
          aria-labelledby={`${ids}-group`}
          value={group?.id ?? ""}
          onChange={(e) => {
            if (e.target.value === "+") onNewGroup();
            else onGroup(e.target.value || null);
          }}
        >
          <option value="">None</option>
          {choices.map((g) => (
            <option key={g.id} value={g.id}>
              {title(g)}
            </option>
          ))}
          <option value="+">Group with…</option>
        </select>
      </label>
      {group && (
        <p className="group-note muted">
          Moving it to another layer takes it out of {title(group)}.{" "}
          <button type="button" className="plain" onClick={() => onGroup(null)}>
            Take out of {title(group)}
          </button>
        </p>
      )}
    </div>
  );
}

/** Several picked, in the side bar: the list, Group or Add to, and Delete. */
export function SeveralPanel({
  items,
  map,
  label,
  groupReason,
  addTo,
  moveNote,
  onGroup,
  onDelete,
  onClear,
}: {
  items: string[];
  map: MapFile;
  label: (id: string) => string;
  groupReason: string | null;
  /** The name of the group among them, which the rest would join. */
  addTo: string | null;
  /** Which of them grouping moves into another layer, in words, or null. */
  moveNote: string | null;
  onGroup: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const layerName = (id: string) => {
    const layer =
      map.groups?.find((g) => g.id === id)?.layer ?? map.features.find((f) => f.id === id)?.layer;
    return map.layers.find((l) => l.id === layer)?.name ?? "";
  };
  return (
    <aside className="feature-card several-panel" aria-label="Several picked">
      <button type="button" className="plain card-close" aria-label="Close" onClick={onClear}>
        ✕
      </button>
      <ul className="group-members">
        {items.map((id) => (
          <li key={id}>
            <span>{label(id)}</span>
            <em className="muted">{layerName(id)}</em>
          </li>
        ))}
      </ul>
      {moveNote && <p className="muted group-note">{moveNote}</p>}
      <p className="change-actions">
        <Tip
          label={addTo ? `Add to ${addTo}` : "Group"}
          keys={shortcutText("map.group")}
          {...(groupReason ? { note: groupReason } : {})}
        >
          <button
            type="button"
            className="primary"
            aria-disabled={groupReason ? true : undefined}
            onClick={() => !groupReason && onGroup()}
          >
            {addTo ? `Add to ${addTo}` : "Group"}
          </button>
        </Tip>
        <button type="button" className="plain danger" onClick={onDelete}>
          Delete {items.length}
        </button>
      </p>
    </aside>
  );
}

/** The strip over the map while picking several: how many, Cancel, and Group. */
export function PickStrip({
  count,
  canGroup,
  addTo,
  onCancel,
  onGroup,
}: {
  count: number;
  canGroup: boolean;
  addTo: string | null;
  onCancel: () => void;
  onGroup: () => void;
}): ReactNode {
  return (
    <div className="pick-strip" role="status">
      <span>
        <strong>{count}</strong> picked{count < 2 ? " · tap more" : ""}
      </span>
      <button type="button" className="quiet" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="primary"
        aria-disabled={canGroup ? undefined : true}
        onClick={() => canGroup && onGroup()}
      >
        <Icon icon={GroupIcon} size="sm" /> {addTo ? `Add to ${addTo}` : "Group"}
      </button>
    </div>
  );
}
