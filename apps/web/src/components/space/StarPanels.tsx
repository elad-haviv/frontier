import type { MapFeature, MapFile } from "@frontier/schema";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Link } from "react-router-dom";
import { entryUrl, mapUrl } from "../../api.ts";
import type { Names } from "../../map/useMapFile.ts";
import { heightText, numberText, routeLength, travelDays } from "../../map/space3d.ts";
import {
  LANES,
  type Lane,
  moveStop,
  nearestStars,
  patchFeature,
  placeOf,
  removeStop,
  type Route,
  routes,
  SIZE_NAMES,
  type Star,
  stars,
  stopsOf,
  TONES,
  toneOf,
} from "../../map/starMap.ts";
import { EntryCombobox } from "../EntryCombobox.tsx";
import { Combobox } from "../ui/Combobox.tsx";
import { mapOptions } from "../map/FeatureEditor.tsx";
import { IconButton } from "../ui/IconButton.tsx";

export type Show = { names: boolean; drops: boolean; rings: boolean };

const unitOf = (map: MapFile) => (map.space.kind === "stars" ? map.space.unit : "ly");
const speedOf = (map: MapFile) => (map.space.kind === "stars" ? map.space.speed : undefined);

/** How far a route takes, in words: "about 5 days at 1 ly a day", or nothing without a speed. */
function travelText(map: MapFile, length: number): string | null {
  const days = travelDays(length, speedOf(map));
  return days === null
    ? null
    : `about ${days} ${days === 1 ? "day" : "days"} at ${speedOf(map)} ${unitOf(map)} a day`;
}

/** The Layers tab: the legend, the layers, what to show, the map's units and every place. */
export function StarLayers({
  map,
  nameOf,
  editing,
  hidden,
  onHidden,
  show,
  onShow,
  selected,
  onSelect,
  onChange,
}: {
  map: MapFile;
  nameOf: (f: Star | Route) => string;
  editing: boolean;
  hidden: Set<string>;
  onHidden: (layer: string, hide: boolean) => void;
  show: Show;
  onShow: (show: Show) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (next: MapFile) => void;
}) {
  const all = stars(map);
  const lanes = new Set(routes(map).map((r) => r.lane ?? "jump"));
  return (
    <div className="star-panel">
      {lanes.size > 0 && (
        <section className="star-block" aria-label="Legend">
          <h3>Legend</h3>
          <ul className="star-legend">
            {(Object.keys(LANES) as Lane[])
              .filter((k) => lanes.has(k))
              .map((k) => (
                <li key={k}>
                  <svg width="36" height="8" aria-hidden="true">
                    <line
                      x1="1"
                      y1="4"
                      x2="35"
                      y2="4"
                      stroke={LANES[k].colour}
                      strokeWidth={LANES[k].width + 0.4}
                      strokeDasharray={LANES[k].dash.join(" ")}
                      strokeLinecap="round"
                    />
                  </svg>
                  {LANES[k].name}
                </li>
              ))}
          </ul>
        </section>
      )}
      <section className="star-block">
        <h3>Layers</h3>
        <ul className="star-layers">
          {map.layers.map((l) => (
            <li key={l.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!hidden.has(l.id)}
                  onChange={(e) => onHidden(l.id, !e.target.checked)}
                />
                <span className="swatch-dot" style={{ background: l.color }} aria-hidden="true" />
                {l.name}
              </label>
              {editing && (
                <select
                  aria-label={`How ${l.name} are drawn`}
                  value={l.look ?? "dot"}
                  onChange={(e) =>
                    onChange({
                      ...map,
                      layers: map.layers.map((x) =>
                        x.id === l.id ? { ...x, look: e.target.value as "dot" | "pin" } : x,
                      ),
                    })
                  }
                >
                  <option value="dot">Light dots</option>
                  <option value="pin">Pins</option>
                </select>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="star-block">
        <h3>Show</h3>
        {(
          [
            ["names", "Names"],
            ["drops", "Lines down to the plane"],
            ["rings", "Distance rings"],
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
        <h3>This map</h3>
        {map.space.kind === "stars" && editing ? (
          <>
            <label className="field">
              <span>Distances are in</span>
              <input
                type="text"
                value={map.space.unit}
                onChange={(e) =>
                  map.space.kind === "stars" &&
                  onChange({ ...map, space: { ...map.space, unit: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>Ships cover, in {map.space.unit} a day</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={map.space.speed ?? ""}
                placeholder="Not set"
                onChange={(e) => {
                  if (map.space.kind !== "stars") return;
                  const next = { ...map.space };
                  const n = Number(e.target.value);
                  if (e.target.value !== "" && n > 0) next.speed = n;
                  else delete next.speed;
                  onChange({ ...map, space: next });
                }}
              />
            </label>
          </>
        ) : (
          <p className="muted">
            Distances are in {unitOf(map)}.
            {speedOf(map) ? ` Ships cover ${speedOf(map)} ${unitOf(map)} a day.` : ""}
          </p>
        )}
      </section>
      <section className="star-block">
        <h3>Places ({all.length})</h3>
        {all.length === 0 && <p className="muted">Nothing is placed yet.</p>}
        <ul className="star-places">
          {all.map((s) => (
            <li key={s.id}>
              <button type="button" aria-current={selected === s.id} onClick={() => onSelect(s.id)}>
                <span
                  className="swatch-dot"
                  style={{ background: toneOf(map, s) }}
                  aria-hidden="true"
                />
                {nameOf(s)}
              </button>
            </li>
          ))}
          {routes(map).map((r) => (
            <li key={r.id}>
              <button type="button" aria-current={selected === r.id} onClick={() => onSelect(r.id)}>
                <span
                  className="swatch-line"
                  style={{ borderColor: LANES[r.lane ?? "jump"].colour }}
                  aria-hidden="true"
                />
                {nameOf(r)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The card of a star or route while viewing. */
export function StarCard({
  map,
  feature,
  names,
  childTitles,
  nameOf,
  onFly,
  onSelect,
}: {
  map: MapFile;
  feature: Star | Route;
  names: Names;
  childTitles: Record<string, string>;
  nameOf: (f: Star | Route) => string;
  onFly: () => void;
  onSelect: (id: string) => void;
}) {
  const unit = unitOf(map);
  if (feature.kind === "route") {
    const stops = stopsOf(map, feature);
    const length = routeLength(stops.map(placeOf));
    const travel = travelText(map, length);
    return (
      <div className="star-panel">
        <header>
          <h2>{nameOf(feature)}</h2>
          <p className="muted">{LANES[feature.lane ?? "jump"].name}</p>
        </header>
        <dl className="star-facts">
          <dt>Length</dt>
          <dd>
            {numberText(length)} {unit}
          </dd>
          {travel && (
            <>
              <dt>Travel</dt>
              <dd>{travel}</dd>
            </>
          )}
        </dl>
        <section className="star-block">
          <h3>Stops</h3>
          <ol className="star-stops">
            {stops.map((s, i) => (
              <li key={`${s.id}-${i}`}>
                <button type="button" className="plain" onClick={() => onSelect(s.id)}>
                  {nameOf(s)}
                </button>
                {i > 0 && (
                  <span className="muted">
                    {" "}
                    +{numberText(routeLength([placeOf(stops[i - 1]!), placeOf(s)]))} {unit}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }
  const near = nearestStars(map, feature, 3);
  const on = routes(map).filter((r) => r.stops.includes(feature.id));
  const entry = feature.entry ? names[feature.entry] : undefined;
  const layer = map.layers.find((l) => l.id === feature.layer);
  const here = placeOf(feature);
  return (
    <div className="star-panel">
      <header>
        <h2>{nameOf(feature)}</h2>
        {layer && <p className="muted">{layer.name}</p>}
      </header>
      <dl className="star-facts">
        <dt>Place</dt>
        <dd>
          X {numberText(here.x)} · Y {numberText(here.y)}, {heightText(here.z, unit)}
        </dd>
        {near.length > 0 && (
          <>
            <dt>Nearest</dt>
            <dd>
              {near.map((n) => (
                <span key={n.star.id} className="star-near">
                  <button type="button" className="plain" onClick={() => onSelect(n.star.id)}>
                    {nameOf(n.star)}
                  </button>{" "}
                  {numberText(n.far)} {unit}
                </span>
              ))}
            </dd>
          </>
        )}
        {on.length > 0 && (
          <>
            <dt>Routes</dt>
            <dd>
              {on.map((r) => (
                <span key={r.id} className="star-near">
                  <button type="button" className="plain" onClick={() => onSelect(r.id)}>
                    {nameOf(r)}
                  </button>
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      <p className="star-actions">
        {entry && (
          <Link className="button quiet" to={entryUrl(entry.path)}>
            Open the entry
          </Link>
        )}
        {feature.child && (
          <Link className="button primary" to={mapUrl(feature.child)}>
            Open {childTitles[feature.child] ?? "the map of this place"}
          </Link>
        )}
        <button type="button" className="quiet" onClick={onFly}>
          Centre the view here
        </button>
      </p>
    </div>
  );
}

/** The editing form of a star or a route. */
export function StarEdit({
  map,
  feature,
  names,
  otherMaps,
  nameOf,
  onChange,
  onLink,
  onRemove,
}: {
  map: MapFile;
  feature: Star | Route;
  names: Names;
  otherMaps: { id: string; title: string }[];
  nameOf: (f: Star | Route) => string;
  onChange: (next: MapFile) => void;
  onLink: (path: string | null, title: string) => void;
  onRemove: () => void;
}) {
  const unit = unitOf(map);
  const patch = (fields: Record<string, unknown>) =>
    onChange(patchFeature(map, feature.id, fields));
  const unset = (field: string) => {
    const next = { ...feature } as Record<string, unknown>;
    delete next[field];
    onChange({
      ...map,
      features: map.features.map((f) => (f.id === feature.id ? (next as MapFeature) : f)),
    });
  };
  const id = `star-${feature.id}`;
  if (feature.kind === "route") {
    const stops = stopsOf(map, feature);
    return (
      <div className="star-panel">
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={feature.label ?? ""}
            placeholder="A route"
            onChange={(e) => patch({ label: e.target.value || null })}
          />
        </label>
        <label className="field">
          <span>Kind of route</span>
          <select value={feature.lane ?? "jump"} onChange={(e) => patch({ lane: e.target.value })}>
            {(Object.keys(LANES) as Lane[]).map((k) => (
              <option key={k} value={k}>
                {LANES[k].name}
              </option>
            ))}
          </select>
        </label>
        <dl className="star-facts">
          <dt>Length</dt>
          <dd>
            {numberText(routeLength(stops.map(placeOf)))} {unit}
          </dd>
          {travelText(map, routeLength(stops.map(placeOf))) && (
            <>
              <dt>Travel</dt>
              <dd>{travelText(map, routeLength(stops.map(placeOf)))}</dd>
            </>
          )}
        </dl>
        <section className="star-block">
          <h3>Stops</h3>
          <ol className="star-stops editing">
            {feature.stops.map((sid, i) => {
              const s = stops.find((x) => x.id === sid);
              return (
                <li key={`${sid}-${i}`}>
                  <span className="name">{s ? nameOf(s) : "A star that is gone"}</span>
                  <IconButton
                    label="Earlier"
                    icon={ArrowUp}
                    size="sm"
                    disabled={i === 0}
                    onClick={() => onChange(moveStop(map, feature.id, i, -1))}
                  />
                  <IconButton
                    label="Later"
                    icon={ArrowDown}
                    size="sm"
                    disabled={i === feature.stops.length - 1}
                    onClick={() => onChange(moveStop(map, feature.id, i, 1))}
                  />
                  <IconButton
                    label="Take out of the route"
                    icon={X}
                    size="sm"
                    disabled={feature.stops.length <= 2}
                    disabledReason="A route needs two stops"
                    onClick={() => onChange(removeStop(map, feature.id, i))}
                  />
                </li>
              );
            })}
          </ol>
        </section>
        <button type="button" className="danger" onClick={onRemove}>
          Remove this route
        </button>
      </div>
    );
  }
  const number = (field: "x" | "y" | "z", label: string) => {
    const here = placeOf(feature);
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type="number"
          step="0.1"
          value={here[field]}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value === "" || !Number.isFinite(n)) return;
            if (field === "z") patch({ z: Math.round(n * 10) / 10 });
            else
              patch({
                at: [
                  field === "x" ? Math.round(n * 10) / 10 : feature.at[0],
                  field === "y" ? Math.round(n * 10) / 10 : feature.at[1],
                ],
              });
          }}
        />
      </label>
    );
  };
  const linked = feature.entry ? names[feature.entry] : undefined;
  return (
    <div className="star-panel">
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={feature.label ?? ""}
          placeholder={linked?.title ?? "A star"}
          onChange={(e) => patch({ label: e.target.value || null })}
        />
      </label>
      <div className="field">
        <span id={`${id}-entry`}>Entry</span>
        <EntryCombobox
          labelledBy={`${id}-entry`}
          value={linked?.path ?? null}
          allowNone
          onChange={(path, title) => onLink(path, title)}
        />
      </div>
      <div className="star-two">
        <label className="field">
          <span>Layer</span>
          <select value={feature.layer} onChange={(e) => patch({ layer: e.target.value })}>
            {map.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Drawn as</span>
          <select
            value={feature.look ?? ""}
            onChange={(e) => (e.target.value ? patch({ look: e.target.value }) : unset("look"))}
          >
            <option value="">As its layer</option>
            <option value="dot">Light dot</option>
            <option value="pin">Pin</option>
          </select>
        </label>
      </div>
      <div className="field">
        <span id={`${id}-tone`}>Colour</span>
        <div className="star-swatches" role="group" aria-labelledby={`${id}-tone`}>
          {TONES.map((t) => (
            <button
              key={t.hex}
              type="button"
              title={t.name}
              aria-label={t.name}
              aria-pressed={feature.tone?.toLowerCase() === t.hex}
              style={{ background: t.hex }}
              onClick={() => patch({ tone: t.hex })}
            />
          ))}
          {feature.tone && (
            <button type="button" className="plain" onClick={() => unset("tone")}>
              As its layer
            </button>
          )}
        </div>
      </div>
      <label className="field">
        <span>Size</span>
        <select value={feature.size ?? 2} onChange={(e) => patch({ size: Number(e.target.value) })}>
          {([1, 2, 3] as const).map((n) => (
            <option key={n} value={n}>
              {SIZE_NAMES[n]}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>Place, in {unit}</span>
        <div className="star-three">
          {number("x", "Across")}
          {number("y", "Along")}
          {number("z", "Height")}
        </div>
      </div>
      <div className="field">
        <span id={`${id}-child`}>A map of this place</span>
        <Combobox
          labelledBy={`${id}-child`}
          options={mapOptions(otherMaps)}
          value={feature.child ?? ""}
          onChange={(child) => patch({ child: child || null })}
          findLabel="Find a map"
          empty="No map has that name."
        />
      </div>
      <button type="button" className="danger" onClick={onRemove}>
        Remove this star
      </button>
    </div>
  );
}
