import type { MapFeature, MapFile } from "@frontier/schema";
import { Link } from "react-router-dom";
import { entryUrl, mapUrl } from "../../api.ts";
import { type Link as PassageLink, leadsFrom, neighbour, type Place } from "../../map/stack.ts";
import type { Names } from "../../map/useMapFile.ts";
import { EntryCombobox } from "../EntryCombobox.tsx";
import { keyOf } from "./drawStack.ts";

export type StackShow = { names: boolean; passages: boolean; plumb: boolean };

/** The tab of layers: the stack top to bottom, the spacing, what to show, and every place. */
export function StackLayers({
  order,
  maps,
  active,
  onActive,
  hidden,
  onHidden,
  spread,
  onSpread,
  show,
  onShow,
  places,
  nameOf,
  selected,
  onSelect,
}: {
  order: string[];
  maps: Record<string, MapFile>;
  active: number;
  onActive: (layer: number) => void;
  hidden: Set<string>;
  onHidden: (id: string, hide: boolean) => void;
  spread: number;
  onSpread: (spread: number) => void;
  show: StackShow;
  onShow: (show: StackShow) => void;
  places: Place[];
  nameOf: (f: MapFeature) => string;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="star-panel">
      <section className="star-block">
        <h3>Layers of this world, top to bottom</h3>
        <ul className="star-layers stack-layers">
          {order.map((id, i) => (
            <li key={id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!hidden.has(id)}
                  onChange={(e) => onHidden(id, !e.target.checked)}
                  aria-label={`Show ${maps[id]?.title}`}
                />
              </label>
              <button
                type="button"
                className="plain stack-layer"
                aria-current={active === i}
                onClick={() => onActive(i)}
              >
                <span
                  className="swatch-dot"
                  style={{ background: maps[id]?.layers[0]?.color }}
                  aria-hidden="true"
                />
                {maps[id]?.title}
              </button>
            </li>
          ))}
        </ul>
        <p className="muted">
          New places go on the layer picked here. Click a layer on the map to pick it.
        </p>
      </section>
      <label className="field">
        <span>Space between the layers</span>
        <input
          type="range"
          min="1.5"
          max="9"
          step="0.1"
          value={spread}
          onChange={(e) => onSpread(Number(e.target.value))}
        />
        <span className="ends">
          <span>Close</span>
          <span>Far apart</span>
        </span>
      </label>
      <section className="star-block">
        <h3>Show</h3>
        {(
          [
            ["names", "Names"],
            ["passages", "Passages between layers"],
            ["plumb", "A line straight down under the pointer"],
          ] as const
        ).map(([k, label]) => (
          <label className="check" key={k}>
            <input
              type="checkbox"
              checked={show[k]}
              onChange={(e) => onShow({ ...show, [k]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </section>
      <section className="star-block">
        <h3>Places ({places.length})</h3>
        {places.length === 0 && <p className="muted">Nothing is placed yet.</p>}
        <ul className="star-places">
          {places.map((p) => (
            <li key={keyOf(p)}>
              <button
                type="button"
                aria-current={selected === keyOf(p)}
                onClick={() => onSelect(keyOf(p))}
              >
                <span className="swatch-dot" style={{ background: "#c2410c" }} aria-hidden="true" />
                {nameOf(p.feature)}
                <span className="kind">{maps[p.map]?.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted">
        This is a view of maps you already have: a globe and the globes set to lie under it. Nothing
        is stored twice.
      </p>
    </div>
  );
}

/** A place's card: its layer, what is straight above and below, and where its passages lead. */
export function StackCard({
  place,
  places,
  links,
  maps,
  names,
  nameOf,
  editing,
  onSelect,
  onUnlink,
  onFieldChange,
  onLink,
  onRemove,
}: {
  place: Place;
  places: Place[];
  links: PassageLink[];
  maps: Record<string, MapFile>;
  names: Names;
  nameOf: (f: MapFeature) => string;
  editing: boolean;
  onSelect: (key: string) => void;
  onUnlink: (other: Place) => void;
  onFieldChange: (fields: Record<string, unknown>) => void;
  onLink: (path: string | null, title: string) => void;
  onRemove: () => void;
}) {
  const f = place.feature;
  const up = neighbour(place, places, -1);
  const down = neighbour(place, places, 1);
  const leads = leadsFrom(place, links);
  const layer = maps[place.map];
  const entry = f.entry ? names[f.entry] : undefined;
  const word = (p: Place | null, other: number) =>
    p
      ? `${nameOf(p.feature)}, on ${maps[p.map]?.title}`
      : other < 0
        ? "nothing marked"
        : "nothing marked";
  const facts = (
    <dl className="star-facts">
      {place.layer > 0 && (
        <>
          <dt>Straight above</dt>
          <dd>
            {up ? (
              <button type="button" className="plain" onClick={() => onSelect(keyOf(up))}>
                {word(up, -1)}
              </button>
            ) : (
              "nothing marked"
            )}
          </dd>
        </>
      )}
      {place.layer < Object.keys(maps).length - 1 && (
        <>
          <dt>Straight below</dt>
          <dd>
            {down ? (
              <button type="button" className="plain" onClick={() => onSelect(keyOf(down))}>
                {word(down, 1)}
              </button>
            ) : (
              "nothing marked"
            )}
          </dd>
        </>
      )}
      <dt>Passages</dt>
      <dd>
        {leads.length === 0 && "none"}
        {leads.map((o) => (
          <span key={keyOf(o)} className="star-near">
            {o.layer > place.layer ? "Down" : "Up"} to{" "}
            <button type="button" className="plain" onClick={() => onSelect(keyOf(o))}>
              {nameOf(o.feature)}
            </button>
            , on {maps[o.map]?.title}
            {editing && (
              <>
                {" "}
                <button
                  type="button"
                  className="plain"
                  aria-label={`Take away the passage to ${nameOf(o.feature)}`}
                  onClick={() => onUnlink(o)}
                >
                  ✕
                </button>
              </>
            )}
          </span>
        ))}
      </dd>
    </dl>
  );
  if (!editing) {
    return (
      <div className="star-panel">
        <header>
          <h2>{nameOf(f)}</h2>
          <p className="muted">{layer?.title}</p>
        </header>
        {facts}
        <p className="star-actions">
          {entry && <Link to={entryUrl(entry.path)}>Open the entry</Link>}
          <Link to={mapUrl(place.map)}>Open {layer?.title}</Link>
        </p>
      </div>
    );
  }
  const linked = f.entry ? names[f.entry] : undefined;
  return (
    <div className="star-panel">
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={f.label ?? ""}
          placeholder={linked?.title ?? "A place"}
          onChange={(e) => onFieldChange({ label: e.target.value || null })}
        />
      </label>
      <div className="field">
        <span id="stack-entry">Entry</span>
        <EntryCombobox
          labelledBy="stack-entry"
          value={linked?.path ?? null}
          allowNone
          onChange={(path, title) => onLink(path, title)}
        />
      </div>
      <p className="muted">
        On {layer?.title}. To move it to another layer, place it there; its icon and map of this
        place are set on that layer's own map.
      </p>
      {facts}
      <button type="button" className="danger" onClick={onRemove}>
        Remove this place
      </button>
    </div>
  );
}
