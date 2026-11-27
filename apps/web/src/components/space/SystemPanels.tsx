import type { MapFile } from "@frontier/schema";
import { Plus } from "lucide-react";
import { Link } from "../../nav.tsx";
import { entryUrl, mapUrl } from "../../api.ts";
import {
  apart,
  type Body,
  type BodyType,
  daysWords,
  isLocal,
  isStar,
  looseMoon,
  nextClosest,
  period,
  PRESETS,
  type Scale,
} from "../../map/orbits.ts";
import { patchFeature } from "../../map/starMap.ts";
import {
  type BodyFeature,
  patchBody,
  planetsOf,
  setCircuit,
  setHome,
} from "../../map/systemMap.ts";
import type { Names } from "../../map/useMapFile.ts";
import { EntryCombobox } from "../EntryCombobox.tsx";
import { mapOptions } from "../map/FeatureEditor.tsx";
import { Combobox } from "../ui/Combobox.tsx";
import type { Look } from "./drawSystem.ts";

export type SystemShow = { names: boolean; orbits: boolean; zone: boolean };

const num = (v: number, digits = 2) => v.toFixed(digits);

/** What a kind of body is called. */
export const kindWord = (b: Body) => (b.type === "star" ? "Star" : PRESETS[b.type].label);

/** Who a body circles, in words. */
function circles(b: Body, bodies: Body[], looks: Map<string, Look>): string {
  const pair = bodies.some((x) => x.type === "companion");
  if (isStar(b)) return pair ? "its partner star" : "nothing";
  if (b.parent && isLocal(b, bodies)) return looks.get(b.parent)?.name ?? "a planet";
  return pair
    ? "both stars"
    : (looks.get(bodies.find((x) => x.type === "star")?.id ?? "")?.name ?? "the star");
}

/** The tab of objects: the system as an outline, what to show, and how distances are drawn. */
export function SystemObjects({
  bodies,
  looks,
  editing,
  selected,
  onSelect,
  show,
  onShow,
  scale,
  onScale,
  onAdd,
  home,
}: {
  bodies: Body[];
  looks: Map<string, Look>;
  editing: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  show: SystemShow;
  onShow: (show: SystemShow) => void;
  scale: Scale;
  onScale: (scale: Scale) => void;
  onAdd: () => void;
  home: Body | undefined;
}) {
  const rows: { b: Body; depth: number }[] = [];
  for (const b of bodies.filter(isStar)) rows.push({ b, depth: 0 });
  const orbiting = bodies
    .filter((b) => !isStar(b) && !isLocal(b, bodies))
    .sort((a, b) => a.a - b.a);
  for (const b of orbiting) {
    rows.push({ b, depth: 1 });
    for (const m of bodies
      .filter((x) => x.parent === b.id && isLocal(x, bodies))
      .sort((p, q) => p.a - q.a)) {
      rows.push({ b: m, depth: 2 });
    }
  }
  return (
    <div className="star-panel">
      <section className="star-block">
        <h3>Objects</h3>
        <ul className="star-places system-outline">
          {rows.map(({ b, depth }) => (
            <li key={b.id}>
              <button
                type="button"
                aria-current={selected === b.id}
                style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }}
                onClick={() => onSelect(b.id)}
              >
                <span
                  className={`swatch-dot${b.type === "station" ? " square" : ""}`}
                  style={{ background: looks.get(b.id)?.colour }}
                  aria-hidden="true"
                />
                {looks.get(b.id)?.name}
                <span className="kind">{kindWord(b)}</span>
              </button>
            </li>
          ))}
        </ul>
        {editing && (
          <p>
            <button type="button" className="quiet" onClick={onAdd}>
              <Plus size={16} aria-hidden="true" /> Add object
            </button>
          </p>
        )}
      </section>
      <section className="star-block">
        <h3>Show</h3>
        {(
          [
            ["names", "Names"],
            ["orbits", "Orbits"],
            ["zone", "The mild zone, where water stays liquid"],
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
        <h3>Distances</h3>
        <label className="field">
          <span>How distances are drawn</span>
          <select value={scale} onChange={(e) => onScale(e.target.value as Scale)}>
            <option value="schematic">Closer together, easy to read</option>
            <option value="true">True distances</option>
          </select>
        </label>
        <p className="muted">Sizes are never to scale.</p>
      </section>
      <section className="star-block">
        <h3>Time</h3>
        <p className="muted">
          Time counts from day 0.{" "}
          {home
            ? `One year is one circuit of ${looks.get(home.id)?.name}: ${Math.round(period(home, bodies))} days.`
            : "One year is 365 days until a home world is chosen."}
        </p>
      </section>
    </div>
  );
}

/** The card of a body while viewing: what a writer asks about it. */
export function SystemCard({
  bodies,
  feature,
  looks,
  names,
  childTitles,
  day,
  onFollow,
}: {
  bodies: Body[];
  feature: BodyFeature;
  looks: Map<string, Look>;
  names: Names;
  childTitles: Record<string, string>;
  day: number;
  onFollow: () => void;
}) {
  const b = bodies.find((x) => x.id === feature.id);
  if (!b) return null;
  const rows: [string, string][] = [["Circles", circles(b, bodies, looks)]];
  const pair = bodies.find((x) => x.type === "companion");
  if (isStar(b)) {
    if (pair) {
      rows.push(["Apart", `${num(pair.a)} AU`]);
      rows.push(["One circuit", daysWords(period(pair, bodies), bodies)]);
    }
  } else {
    if (b.type === "belt") rows.push(["Spans", `${num(b.inner, 1)} to ${num(b.outer, 1)} AU`]);
    else
      rows.push([
        "Distance",
        isLocal(b, bodies) ? `${Math.round(b.a)} thousand km` : `${num(b.a)} AU`,
      ]);
    rows.push([
      isLocal(b, bodies) ? "One circuit" : "Its year",
      daysWords(period(b, bodies), bodies),
    ]);
    if (b.e > 0.03)
      rows.push([
        "Orbit",
        b.e > 0.5 ? "very stretched" : b.e > 0.15 ? "stretched" : "slightly stretched",
      ]);
    const home = bodies.find((x) => x.home);
    const me = isLocal(b, bodies) ? bodies.find((x) => x.id === b.parent)! : b;
    if (home && me.id !== home.id && b.type !== "belt") {
      rows.push([
        `From ${looks.get(home.id)?.name} now`,
        `${num(apart(me, home, day, bodies))} AU`,
      ]);
      const n = nextClosest(me, home, day, bodies);
      if (n) rows.push(["Next closest", `in ${daysWords(n.days, bodies)}, at ${num(n.au)} AU`]);
    }
  }
  const entry = feature.entry ? names[feature.entry] : undefined;
  return (
    <div className="star-panel">
      <header>
        <h2>{looks.get(b.id)?.name}</h2>
        <p className="muted">{kindWord(b)}</p>
      </header>
      <dl className="star-facts">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="star-actions">
        {entry && <Link to={entryUrl(entry.path)}>Open the entry</Link>}
        {feature.child && (
          <Link to={mapUrl(feature.child)}>
            Open {childTitles[feature.child] ?? "the map of this place"}
          </Link>
        )}
        {b.type !== "belt" && (
          <button type="button" className="quiet" onClick={onFollow}>
            Follow it
          </button>
        )}
      </p>
    </div>
  );
}

const SWATCHES = [
  "#b08a6a",
  "#c0745a",
  "#6d9fcf",
  "#7fb3a6",
  "#d9b38c",
  "#9fcbd6",
  "#c9c5bb",
  "#dfe6ee",
];

/** The editing form of a body. Distance and the length of its circuit are the same fact: set either. */
export function SystemEdit({
  map,
  bodies,
  feature,
  looks,
  names,
  otherMaps,
  day,
  onChange,
  onLink,
  onRemove,
}: {
  map: MapFile;
  bodies: Body[];
  feature: BodyFeature;
  looks: Map<string, Look>;
  names: Names;
  otherMaps: { id: string; title: string }[];
  day: number;
  onChange: (next: MapFile) => void;
  onLink: (path: string | null, title: string) => void;
  onRemove: () => void;
}) {
  const b = bodies.find((x) => x.id === feature.id);
  if (!b) return null;
  const id = `body-${b.id}`;
  const pair = bodies.find((x) => x.type === "companion");
  const local = isLocal(b, bodies);
  const linked = feature.entry ? names[feature.entry] : undefined;
  const feat = (fields: Record<string, unknown>) => onChange(patchFeature(map, b.id, fields));
  const body = (fields: Partial<Body>, keep = true) =>
    onChange(patchBody(map, b.id, fields, keep ? day : undefined));
  const kinds = (Object.keys(PRESETS) as BodyType[]).filter(
    (k) =>
      k !== "star" &&
      k !== "companion" &&
      PRESETS[k].local === local &&
      (k === "belt") === (b.type === "belt"),
  );
  const planets = planetsOf(bodies).filter((p) => p.id !== b.id);
  const loose = local ? looseMoon(b, bodies) : null;
  const linkedFields = (
    <>
      <div className="field">
        <span id={`${id}-entry`}>Entry</span>
        <EntryCombobox
          labelledBy={`${id}-entry`}
          value={linked?.path ?? null}
          allowNone
          onChange={(path, title) => onLink(path, title)}
        />
      </div>
      <div className="field">
        <span id={`${id}-child`}>A map of this place</span>
        <Combobox
          labelledBy={`${id}-child`}
          options={mapOptions(otherMaps)}
          value={feature.child ?? ""}
          onChange={(child) => feat({ child: child || null })}
          findLabel="Find a map"
          empty="No map has that name."
        />
      </div>
    </>
  );
  const nameField = (
    <label className="field">
      <span>Name</span>
      <input
        type="text"
        value={feature.label ?? ""}
        placeholder={looks.get(b.id)?.name}
        onChange={(e) => feat({ label: e.target.value || null })}
      />
    </label>
  );
  if (isStar(b)) {
    return (
      <div className="star-panel">
        {nameField}
        <p className="muted">
          {pair
            ? "The two stars circle each other, around the + between them."
            : "The star at the centre. Add a second star to make a pair."}
        </p>
        {b.type === "star" && (
          <label className="field">
            <span>Mass, in suns</span>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={b.mass}
              onChange={(e) =>
                Number(e.target.value) > 0 && body({ mass: Number(e.target.value) }, false)
              }
            />
          </label>
        )}
        {pair && b.type === "companion" && (
          <>
            <div className="star-two">
              <label className="field">
                <span>Apart, in AU</span>
                <input
                  type="number"
                  min="0.05"
                  step="0.01"
                  value={pair.a}
                  onChange={(e) =>
                    Number(e.target.value) > 0 && body({ a: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>One circuit, days</span>
                <input
                  type="number"
                  value={Math.round(period(pair, bodies))}
                  disabled
                  aria-label="One circuit, in days"
                />
              </label>
            </div>
            <label className="field">
              <span>Weight of the second star</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={Math.min(b.mass, 1)}
                onChange={(e) => body({ mass: Number(e.target.value) }, false)}
              />
              <span className="ends">
                <span>Much lighter</span>
                <span>Equal</span>
              </span>
            </label>
          </>
        )}
        {linkedFields}
        {b.type === "companion" && (
          <button type="button" className="danger" onClick={onRemove}>
            Remove the second star
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="star-panel">
      {nameField}
      <div className="star-two">
        <label className="field">
          <span>Kind</span>
          <select
            value={b.type}
            onChange={(e) => feat({ body: { ...feature.body, type: e.target.value } })}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {PRESETS[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Circles</span>
          <select
            value={b.parent ?? ""}
            disabled={!local}
            onChange={(e) => body({ parent: e.target.value }, false)}
          >
            {local ? (
              planets.map((p) => (
                <option key={p.id} value={p.id}>
                  {looks.get(p.id)?.name}
                </option>
              ))
            ) : (
              <option>{circles(b, bodies, looks)}</option>
            )}
          </select>
        </label>
      </div>
      {b.type === "belt" ? (
        <div className="star-two">
          <label className="field">
            <span>From, in AU</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={num(b.inner, 1)}
              onChange={(e) =>
                Number(e.target.value) > 0 &&
                body(
                  { inner: Number(e.target.value), a: (Number(e.target.value) + b.outer) / 2 },
                  false,
                )
              }
            />
          </label>
          <label className="field">
            <span>To, in AU</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={num(b.outer, 1)}
              onChange={(e) =>
                Number(e.target.value) > 0 &&
                body(
                  { outer: Number(e.target.value), a: (b.inner + Number(e.target.value)) / 2 },
                  false,
                )
              }
            />
          </label>
        </div>
      ) : (
        <>
          <div className="star-two">
            <label className="field">
              <span>Distance, {local ? "thousand km" : "AU"}</span>
              <input
                type="number"
                min="0.05"
                step={local ? 10 : 0.01}
                value={b.a}
                onChange={(e) => Number(e.target.value) > 0 && body({ a: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>{local ? "One circuit" : "Its year"}, in days</span>
              <input
                type="number"
                min="1"
                aria-label={local ? "One circuit, in days" : "Its year, in days"}
                value={Math.round(period(b, bodies) * 10) / 10}
                onChange={(e) =>
                  Number(e.target.value) > 0 &&
                  onChange(setCircuit(map, b.id, Number(e.target.value), day))
                }
              />
            </label>
          </div>
          <p className="muted">Set either one. The other follows, as it does in nature.</p>
          <label className="field">
            <span>Shape of the orbit</span>
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.01"
              value={b.e}
              onChange={(e) => body({ e: Number(e.target.value) })}
            />
            <span className="ends">
              <span>Round</span>
              <span>Stretched</span>
            </span>
          </label>
        </>
      )}
      {loose && (
        <p className="soft-warn">
          {loose.replace("the planet", looks.get(b.parent ?? "")?.name ?? "the planet")}
        </p>
      )}
      <div className="field">
        <span id={`${id}-tone`}>Colour</span>
        <div className="star-swatches" role="group" aria-labelledby={`${id}-tone`}>
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={feature.tone?.toLowerCase() === c}
              style={{ background: c }}
              onClick={() => feat({ tone: c })}
            />
          ))}
        </div>
      </div>
      {b.type !== "belt" && (
        <details>
          <summary>More</summary>
          <div className="star-panel">
            <label className="field">
              <span>Turn the orbit</span>
              <input
                type="range"
                min="0"
                max="6.283"
                step="0.01"
                value={((b.peri % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)}
                onChange={(e) => body({ peri: Number(e.target.value) }, false)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={b.retro}
                onChange={(e) => body({ retro: e.target.checked })}
              />{" "}
              Goes round the other way
            </label>
            {!local && b.type !== "comet" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={b.home}
                  onChange={(e) => onChange(setHome(map, e.target.checked ? b.id : null))}
                />{" "}
                The home world: its circuit is the year
              </label>
            )}
          </div>
        </details>
      )}
      {linkedFields}
      <button type="button" className="danger" onClick={onRemove}>
        Remove this object
      </button>
    </div>
  );
}

/** The kinds that can be added, as a list to pick from. */
export function AddPicker({
  kinds,
  hasPair: pair,
  onPick,
}: {
  kinds: BodyType[];
  hasPair: boolean;
  onPick: (kind: BodyType) => void;
}) {
  return (
    <div className="system-picker" role="menu" aria-label="Add an object">
      <h4>Add an object</h4>
      {kinds
        .filter((k) => !(k === "companion" && pair))
        .map((k) => (
          <button key={k} type="button" role="menuitem" onClick={() => onPick(k)}>
            <span
              className={`swatch-dot${k === "station" ? " square" : ""}`}
              style={{ background: PRESETS[k].colour }}
              aria-hidden="true"
            />
            <span>
              {PRESETS[k].label}
              <small>{PRESETS[k].note}</small>
            </span>
          </button>
        ))}
    </div>
  );
}
