import { extentProblem, type MapFile, wholeExtent } from "@frontier/schema";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { useDialogs } from "../Dialogs.tsx";

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
  onHidden,
  onShownImages,
  onActive,
  onChange,
  timeLine,
  setup,
}: {
  /** The map's own settings while editing: what it lies under, and whether it is schematic. */
  setup?: ReactNode;
  /** How the features stand to the chosen chronicle, while the map is seen in time. */
  timeLine?: string | null;
  map: MapFile;
  hidden: Set<string>;
  shownImages: Set<string>;
  editing: boolean;
  activeLayer: string;
  /** Changes which layers are hidden and which images are shown. */
  onHidden: Dispatch<SetStateAction<Set<string>>>;
  onShownImages: Dispatch<SetStateAction<Set<string>>>;
  onActive: (id: string) => void;
  onChange: (next: MapFile) => void;
}) {
  const toggle = (set: Set<string>, item: string) => {
    const next = new Set(set);
    if (!next.delete(item)) next.add(item);
    return next;
  };
  const onToggleLayer = (layer: string) => onHidden((h) => toggle(h, layer));
  const onToggleImage = (image: string) => onShownImages((s) => toggle(s, image));
  /** Adds the vault's image at this path to the map, and shows it. */
  const onAddImage = (path: string) => {
    const image = {
      id: newItemId(),
      // Named after its file, without the folders and the ending.
      name: path.replace(/^.*\//, "").replace(/\.[^.]+$/, ""),
      path,
      extent: wholeExtent(map.space),
      visible: true,
    };
    onChange({ ...map, images: [...map.images, image] });
    onShownImages((shown) => new Set(shown).add(image.id));
  };
  const onKeepAsOpening = () =>
    onChange({
      ...map,
      layers: map.layers.map((l) => ({ ...l, visible: !hidden.has(l.id) })),
      images: map.images.map((i) => ({ ...i, visible: shownImages.has(i.id) })),
    });
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
      {timeLine && <p className="muted time-line">{timeLine}</p>}
      {editing && setup}
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
