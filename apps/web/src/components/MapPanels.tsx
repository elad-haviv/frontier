import type { Length } from "@frontier/geo";
import { extentProblem, type MapFeature, type MapFile, wholeExtent } from "@frontier/schema";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, entryUrl, imageUrl, mapUrl } from "../api.ts";
import { iconLabel, newItemId } from "../map/viewUrl.ts";
import { useDialogs } from "./Dialogs.tsx";

export type Names = Record<string, { path: string; title: string }>;
export type MarkerSets = { name: string; icons: { name: string; path: string }[] }[];

const number = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

/** A measured length in words: an angle and a share of the way round, or a distance. */
export function lengthText(length: Length, sphere: boolean): string {
  const parts: string[] = [];
  if (length.distance !== null) parts.push(`${number(length.distance)} ${length.unit}`);
  if (sphere) {
    parts.push(`${number(length.raw, 2)}°`);
    parts.push(`${number((length.fraction ?? 0) * 100, 2)}% of the way round`);
  } else if (length.distance === null) {
    parts.push(`${number(length.raw, 0)} map units`);
  }
  return parts.join(" · ");
}

/** What a tap on a feature shows while reading: its name, the start of its entry, where it leads. */
export function FeatureCard({
  feature,
  title,
  names,
  children,
  onClose,
}: {
  feature: MapFeature;
  title: string;
  names: Names;
  children: Record<string, string>;
  onClose: () => void;
}) {
  const entry = feature.entry ? names[feature.entry] : undefined;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!entry) return;
    let live = true;
    api.preview(entry.path).then(
      (p) => live && setText(p.text.replace(/^#.*\n+/, "").slice(0, 320)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [entry?.path]);

  return (
    <aside className="feature-card" aria-label="Selected place">
      <button type="button" className="plain card-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      <h2>{title || "Unnamed"}</h2>
      {text && <p className="card-text">{text}</p>}
      {feature.entry && !entry && <p className="muted">Its entry could not be found.</p>}
      <p className="change-actions">
        {entry && <Link to={entryUrl(entry.path)}>Open the entry</Link>}
        {feature.child &&
          (children[feature.child] ? (
            <Link to={mapUrl(feature.child)}>Open the map of this place</Link>
          ) : (
            <span className="muted">Its map is missing.</span>
          ))}
      </p>
    </aside>
  );
}

/** Finds an entry by name, as the quick switcher does. */
export function EntryPicker({ onPick }: { onPick: (path: string, title: string) => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<{ path: string; title: string; alias?: string }[]>([]);
  useEffect(() => {
    if (query.trim() === "") {
      setRows([]);
      return;
    }
    let live = true;
    const wait = window.setTimeout(() => {
      api.names(query.trim()).then(
        (r) => live && setRows(r.results.slice(0, 6)),
        () => undefined,
      );
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [query]);
  return (
    <div className="entry-picker">
      <input
        type="search"
        aria-label="Find an entry"
        placeholder="Find an entry by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li key={r.path + (r.alias ?? "")}>
              <button
                type="button"
                className="plain"
                onClick={() => {
                  onPick(r.path, r.title);
                  setQuery("");
                }}
              >
                {r.alias ? `${r.alias} (${r.title})` : r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
}: {
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
      <p className="change-actions">
        {feature.kind !== "marker" && vertex !== null && feature.points.length > minimum && (
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

const EXTENT_LABELS = {
  sphere: ["West", "South", "East", "North"],
  flat: ["Left", "Top", "Right", "Bottom"],
} as const;

/** Where an image sits in the map's space: four numbers, taken when they make an extent. */
function ExtentForm({
  map,
  image,
  onChange,
}: {
  map: MapFile;
  image: MapFile["images"][number];
  onChange: (extent: MapFile["images"][number]["extent"]) => void;
}) {
  const [text, setText] = useState(() => image.extent.map(String));
  const [problem, setProblem] = useState<string | null>(null);
  // Undo, or a change from another device, shows in the boxes; typing in them does not reset them.
  const stored = image.extent.join(",");
  useEffect(() => {
    setText((now) => (now.map(Number).join(",") === stored ? now : stored.split(",")));
    setProblem(null);
  }, [stored]);

  function edit(at: number, value: string) {
    const next = text.map((t, i) => (i === at ? value : t));
    setText(next);
    const numbers = next.map((t) => (t.trim() === "" ? Number.NaN : Number(t)));
    const wrong = extentProblem(map.space, numbers);
    setProblem(wrong);
    if (!wrong && numbers.join(",") !== stored) {
      onChange(numbers as MapFile["images"][number]["extent"]);
    }
  }

  const whole = wholeExtent(map.space);
  return (
    <div className="extent-form" role="group" aria-label={`Where ${image.name} sits`}>
      {EXTENT_LABELS[map.space.kind].map((label, i) => (
        <label key={label}>
          <span>{label}</span>
          <input type="text" value={text[i] ?? ""} onChange={(e) => edit(i, e.target.value)} />
        </label>
      ))}
      <button
        type="button"
        className="quiet"
        disabled={stored === whole.join(",")}
        onClick={() => onChange(whole)}
      >
        {map.space.kind === "sphere" ? "The whole globe" : "The whole map"}
      </button>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Images and layers: what is shown, and while editing, what there is. */
export function LayerPanel({
  map,
  hidden,
  shownImages,
  editing,
  activeLayer,
  onToggleLayer,
  onToggleImage,
  onActive,
  onChange,
  onKeepAsOpening,
  onAddImage,
}: {
  map: MapFile;
  hidden: Set<string>;
  shownImages: Set<string>;
  editing: boolean;
  activeLayer: string;
  onToggleLayer: (id: string) => void;
  onToggleImage: (id: string) => void;
  onActive: (id: string) => void;
  onChange: (next: MapFile) => void;
  onKeepAsOpening: () => void;
  /** Adds the vault's image at this path to the map, and shows it. */
  onAddImage: (path: string) => void;
}) {
  const dialogs = useDialogs();
  const [placing, setPlacing] = useState<string | null>(null);
  const [vaultImages, setVaultImages] = useState<string[]>([]);
  useEffect(() => {
    if (!editing) return;
    let live = true;
    api.mapImages().then(
      (r) => live && setVaultImages(r.images),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [editing]);
  const setImage = (id: string, change: Partial<MapFile["images"][number]>) =>
    onChange({ ...map, images: map.images.map((i) => (i.id === id ? { ...i, ...change } : i)) });

  async function removeImage(id: string) {
    const image = map.images.find((i) => i.id === id);
    if (!image) return;
    const ok = await dialogs.confirm({
      title: `Take "${image.name}" off the map?`,
      body: "The image stays in the library; only this map stops showing it.",
      action: "Take it off",
      danger: true,
    });
    if (ok) onChange({ ...map, images: map.images.filter((i) => i.id !== id) });
  }

  function moveImage(id: string, by: number) {
    const at = map.images.findIndex((i) => i.id === id);
    const to = at + by;
    if (to < 0 || to >= map.images.length) return;
    const images = [...map.images];
    [images[at], images[to]] = [images[to]!, images[at]!];
    onChange({ ...map, images });
  }
  const setLayer = (id: string, change: Partial<MapFile["layers"][number]>) =>
    onChange({ ...map, layers: map.layers.map((l) => (l.id === id ? { ...l, ...change } : l)) });

  async function removeLayer(id: string) {
    const at = map.layers.findIndex((l) => l.id === id);
    const target = map.layers[at === 0 ? 1 : at - 1];
    if (!target) return;
    const count = map.features.filter((f) => f.layer === id).length;
    if (count > 0) {
      const ok = await dialogs.confirm({
        title: "Delete this layer?",
        body: `Its ${count} features move to "${target.name}".`,
        action: "Delete the layer",
        danger: true,
      });
      if (!ok) return;
    }
    onChange({
      ...map,
      layers: map.layers.filter((l) => l.id !== id),
      features: map.features.map((f) => (f.layer === id ? { ...f, layer: target.id } : f)),
    });
    if (activeLayer === id) onActive(target.id);
  }

  function move(id: string, by: number) {
    const at = map.layers.findIndex((l) => l.id === id);
    const to = at + by;
    if (to < 0 || to >= map.layers.length) return;
    const layers = [...map.layers];
    [layers[at], layers[to]] = [layers[to]!, layers[at]!];
    onChange({ ...map, layers });
  }

  return (
    <aside className="layer-panel" aria-label="Images and layers">
      {(editing || map.images.length > 1) && (
        <>
          <h3>Images</h3>
          <ul>
            {map.images.map((image, i) => (
              <li key={image.id} className={editing ? "image-row" : ""}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Show ${image.name}`}
                    checked={shownImages.has(image.id)}
                    onChange={() => onToggleImage(image.id)}
                  />
                  {!editing && image.name}
                </label>
                {editing && (
                  <>
                    <input
                      type="text"
                      aria-label="Image name"
                      value={image.name}
                      onChange={(e) => setImage(image.id, { name: e.target.value })}
                    />
                    <button
                      type="button"
                      className="plain"
                      aria-label={`Place ${image.name}`}
                      aria-expanded={placing === image.id}
                      title="Where the image sits on the map"
                      onClick={() => setPlacing(placing === image.id ? null : image.id)}
                    >
                      ⌖
                    </button>
                    <button
                      type="button"
                      className="plain"
                      aria-label={`Move ${image.name} up`}
                      title="Drawn earlier, under the ones below"
                      disabled={i === 0}
                      onClick={() => moveImage(image.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="plain"
                      aria-label={`Move ${image.name} down`}
                      title="Drawn later, over the ones above"
                      disabled={i === map.images.length - 1}
                      onClick={() => moveImage(image.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="plain danger"
                      aria-label={`Take ${image.name} off the map`}
                      disabled={map.images.length === 1}
                      onClick={() => removeImage(image.id)}
                    >
                      ✕
                    </button>
                    {placing === image.id && (
                      <ExtentForm
                        map={map}
                        image={image}
                        onChange={(extent) => setImage(image.id, { extent })}
                      />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {editing && (
            <select
              className="add-image"
              aria-label="Add an image"
              value=""
              onChange={(e) => e.target.value && onAddImage(e.target.value)}
            >
              <option value="">+ Add an image…</option>
              {vaultImages.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <h3>Layers</h3>
      <ul>
        {map.layers.map((layer, i) => (
          <li key={layer.id} className={editing && layer.id === activeLayer ? "is-active" : ""}>
            <label>
              <input
                type="checkbox"
                aria-label={`Show ${layer.name}`}
                checked={!hidden.has(layer.id)}
                onChange={() => onToggleLayer(layer.id)}
              />
              {!editing && (
                <>
                  <span className="swatch" style={{ background: layer.color }} /> {layer.name}
                </>
              )}
            </label>
            {editing && (
              <>
                <input
                  type="color"
                  aria-label={`Colour of ${layer.name}`}
                  value={layer.color}
                  onChange={(e) => setLayer(layer.id, { color: e.target.value })}
                />
                <input
                  type="text"
                  aria-label="Layer name"
                  value={layer.name}
                  onFocus={() => onActive(layer.id)}
                  onChange={(e) => setLayer(layer.id, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="plain"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => move(layer.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="plain"
                  aria-label="Move down"
                  disabled={i === map.layers.length - 1}
                  onClick={() => move(layer.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="plain danger"
                  aria-label={`Delete ${layer.name}`}
                  disabled={map.layers.length === 1}
                  onClick={() => removeLayer(layer.id)}
                >
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <p className="change-actions">
          <button
            type="button"
            className="quiet"
            onClick={() => {
              const id = newItemId();
              onChange({
                ...map,
                layers: [...map.layers, { id, name: "New layer", visible: true, color: "#2f5d8a" }],
              });
              onActive(id);
            }}
          >
            + Add a layer
          </button>
          <button type="button" className="quiet" onClick={onKeepAsOpening}>
            Open the map like this
          </button>
        </p>
      )}
    </aside>
  );
}
