import { extentProblem, type MapFeature, type MapFile, wholeExtent } from "@frontier/schema";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, LocateFixed, Trash2 } from "lucide-react";
import { newItemId } from "../../map/viewUrl.ts";
import { MapImagePicker } from "../images/MapImagePicker.tsx";
import { useRefresh } from "../Shell.tsx";
import { useDialogs } from "../Dialogs.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { type GroupTreeProps, LayerTree } from "./LayerTree.tsx";

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
  legend,
  selected,
  onSelect,
  titleOf,
  ...groupProps
}: {
  /** The feature selected on the map, shown picked in the layers. */
  selected: string | null;
  /** Selects a feature from the layers, and centres the map on it. */
  onSelect: (id: string) => void;
  titleOf: (feature: MapFeature) => string;
  /** The legend of the styles drawn now, at the top. */
  legend?: ReactNode;
  /** The map's own settings while editing: what it lies under, and whether it is schematic. */
  setup?: ReactNode;
  /** How the features stand to the chosen chronicle, while the map is seen in time. */
  timeLine?: string | null;
  map: MapFile;
  hidden: Set<string>;
  shownImages: Set<string>;
  editing: boolean;
  activeLayer: string;
  /** Changes which layers and features are hidden, and which images are shown. */
  onHidden: Dispatch<SetStateAction<Set<string>>>;
  onShownImages: Dispatch<SetStateAction<Set<string>>>;
  onActive: (id: string) => void;
  onChange: (next: MapFile) => void;
} & GroupTreeProps) {
  const toggle = (set: Set<string>, item: string) => {
    const next = new Set(set);
    if (!next.delete(item)) next.add(item);
    return next;
  };
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
  const refresh = useRefresh();
  const [placing, setPlacing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
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
  return (
    <aside className="layer-panel" aria-label="Images and layers">
      {legend}
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
                    <IconButton
                      label={`Place ${image.name}`}
                      icon={LocateFixed}
                      size="sm"
                      className="plain"
                      aria-expanded={placing === image.id}
                      onClick={() => setPlacing(placing === image.id ? null : image.id)}
                    />
                    <IconButton
                      label={`Move ${image.name} up`}
                      icon={ArrowUp}
                      size="sm"
                      className="plain"
                      disabled={i === 0}
                      disabledReason="It is drawn first, under the others"
                      onClick={() => moveImage(image.id, -1)}
                    />
                    <IconButton
                      label={`Move ${image.name} down`}
                      icon={ArrowDown}
                      size="sm"
                      className="plain"
                      disabled={i === map.images.length - 1}
                      disabledReason="It is drawn last, over the others"
                      onClick={() => moveImage(image.id, 1)}
                    />
                    <Menu label={`More for ${image.name}`} className="plain row-more">
                      <MenuItem
                        icon={Trash2}
                        danger
                        disabled={map.images.length === 1}
                        disabledReason="A map keeps at least one image"
                        onSelect={() => void removeImage(image.id)}
                      >
                        {`Take ${image.name} off the map`}
                      </MenuItem>
                    </Menu>
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
            <button type="button" className="quiet add-image" onClick={() => setPicking(true)}>
              <Icon icon={ImagePlus} size="sm" /> Add an image…
            </button>
          )}
          {picking && (
            <MapImagePicker
              onClose={() => setPicking(false)}
              onPick={(path) => {
                setPicking(false);
                // An image added in the dialog is a new unpublished upload.
                refresh();
                onAddImage(path);
              }}
            />
          )}
        </>
      )}
      <LayerTree
        map={map}
        editing={editing}
        hidden={hidden}
        onHidden={onHidden}
        activeLayer={activeLayer}
        onActive={onActive}
        onChange={onChange}
        selected={selected}
        onSelect={onSelect}
        titleOf={titleOf}
        {...groupProps}
      />
      {editing && (
        <p className="change-actions">
          <button type="button" className="quiet" onClick={onKeepAsOpening}>
            Open the map like this
          </button>
        </p>
      )}
    </aside>
  );
}
