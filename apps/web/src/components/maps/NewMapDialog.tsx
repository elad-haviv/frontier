import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiFailure, imageUrl, mapUrl } from "../../api.ts";
import { type Kind, KIND_WORD, KINDS } from "../../map/mapsList.ts";
import { queue } from "../../sync/queue.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { MapImagePicker } from "../images/MapImagePicker.tsx";
import { useRefresh } from "../Shell.tsx";
import { ActionButton } from "../ui/ActionButton.tsx";
import { isDark, KIND_PICTURES } from "./KindPictures.tsx";

const NOTES: Record<Kind, string> = {
  sphere: "An image that wraps a whole world, with projections.",
  flat: "Your own image of a region or a city, or a diagram with no measuring.",
  stars: "Places in open space, joined by routes. No image needed.",
  system: "A star and what circles it, moving as the years pass.",
};

/**
 * The New map dialog: the four kinds as cards with a small drawing each, a title, and what the kind
 * needs (an image, whether it is a diagram, the unit of a star map). The two kinds that need no
 * image are drawn on dark, as their canvases are.
 */
export function NewMapDialog({
  initialKind = "flat",
  onClose,
}: {
  initialKind?: Kind;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const offline = useNeedsConnection();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>(initialKind);
  const [schematic, setSchematic] = useState(false);
  const [unit, setUnit] = useState<"ly" | "pc">("ly");
  const [image, setImage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const noImage = kind === "stars" || kind === "system";
  const ready = title.trim() !== "" && (noImage || image !== "");

  async function create() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createMap(title.trim(), kind, noImage ? undefined : image);
      // What the map starts with that creating it does not set is kept like any change: on this
      // device until the server has it.
      const wanted =
        kind === "flat" && schematic
          ? "schematic"
          : kind === "stars" && unit !== "ly"
            ? "unit"
            : null;
      if (wanted) {
        const made = await api.map(id);
        let space = made.map.space;
        // A schematic map is a flat map with measuring off.
        if (wanted === "schematic" && space.kind === "flat") space = { ...space, schematic: true };
        if (wanted === "unit" && space.kind === "stars") space = { ...space, unit };
        await queue.put(
          `map:${id}`,
          { ...made.map, space },
          { draftId: "", revision: made.revision, baseBlob: made.blob, base: made.map, delay: 0 },
        );
        await queue.sendNow(`map:${id}`);
      }
      refresh();
      navigate(mapUrl(id) + "?edit=1");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The map could not be made.");
      setBusy(false);
    }
  }

  let options: ReactNode = null;
  if (kind === "flat") {
    options = (
      <label className="check">
        <input
          type="checkbox"
          checked={schematic}
          onChange={(e) => setSchematic(e.target.checked)}
        />{" "}
        Schematic: a diagram, with no measuring
      </label>
    );
  } else if (kind === "stars") {
    options = (
      <label className="field">
        <span>Distances are in</span>
        <select value={unit} onChange={(e) => setUnit(e.target.value as "ly" | "pc")}>
          <option value="ly">Light-years</option>
          <option value="pc">Parsecs</option>
        </select>
      </label>
    );
  }

  return (
    <DialogFrame
      title="New map"
      onCancel={onClose}
      onSubmit={() => void create()}
      className="new-map new-map-dialog"
    >
      <label className="field">
        <span>Title</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset className="kinds-field">
        <legend>Kind</legend>
        <div className="kinds">
          {KINDS.map((k) => (
            <label key={k} className="kind">
              <input
                type="radio"
                name="map-kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              <span className={`pic${isDark(k) ? " dark" : ""}`} aria-hidden="true">
                {KIND_PICTURES[k]}
              </span>
              <b>
                {KIND_WORD[k]}
                {isDark(k) && <span className="new-tag">New</span>}
              </b>
              <small>{NOTES[k]}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {options}
      {noImage ? (
        <p className="muted">
          {kind === "stars"
            ? "A star map needs no image. Its places have three numbers: across, along and height above a flat plane."
            : "A system model needs no image. It begins with its star; add the worlds that circle it."}
        </p>
      ) : (
        <div className="field">
          <span>Image</span>
          <span className="chosen-image">
            {image && <img src={imageUrl(image, 320)} alt="" />}
            {image && <span className="chosen-image-name">{image.split("/").pop()}</span>}
            {/* Choosing works offline from images already here; the dialog says which need a connection. */}
            <button
              type="button"
              onClick={() => setPicking(true)}
              title={offline && "Uploads need a connection"}
            >
              {image ? "Choose another image…" : "Choose an image…"}
            </button>
          </span>
        </div>
      )}
      {picking && (
        <MapImagePicker
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setPicking(false);
            setImage(path);
            // An image uploaded in the dialog is a new unpublished change.
            refresh();
          }}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <ActionButton type="submit" className="primary" disabled={busy || !ready}>
          Make the map
        </ActionButton>
      </p>
    </DialogFrame>
  );
}
