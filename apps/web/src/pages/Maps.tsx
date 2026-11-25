import { useNeedsConnection } from "../sync/connection.ts";
import { type FormEvent, type ReactNode, useState } from "react";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiFailure, imageUrl, mapUrl } from "../api.ts";
import { MapImagePicker } from "../components/images/MapImagePicker.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { queue } from "../sync/queue.ts";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { failureOf, useAsync } from "../useAsync.ts";
import "./Maps.css";

type Kind = "sphere" | "flat" | "stars" | "system";

const STROKE = "var(--ink-soft)";
const KINDS: { id: Kind; name: string; note: string; dark: boolean; picture: ReactNode }[] = [
  {
    id: "sphere",
    name: "Globe",
    note: "An image that wraps a whole world, with projections.",
    dark: false,
    picture: (
      <svg viewBox="0 0 80 50" width="80" height="50">
        <circle cx="40" cy="25" r="18" fill="none" stroke={STROKE} strokeWidth="1.5" />
        <ellipse cx="40" cy="25" rx="8" ry="18" fill="none" stroke={STROKE} />
        <path d="M22 25h36" fill="none" stroke={STROKE} />
      </svg>
    ),
  },
  {
    id: "flat",
    name: "Flat map",
    note: "Your own image of a region or a city, or a diagram with no measuring.",
    dark: false,
    picture: (
      <svg viewBox="0 0 80 50" width="80" height="50">
        <path
          d="M14 12l17-4 18 5 17-4v29l-17 4-18-5-17 4z"
          fill="none"
          stroke={STROKE}
          strokeWidth="1.5"
        />
        <path d="M31 8v29M49 13v29" fill="none" stroke={STROKE} />
      </svg>
    ),
  },
  {
    id: "stars",
    name: "Star map",
    note: "Places in open space, joined by routes. No image needed.",
    dark: true,
    picture: (
      <svg viewBox="0 0 80 50" width="80" height="50">
        <path d="M8 40l22-12h42M20 46l22-18M52 46l-4-18" stroke="#3a3f4e" fill="none" />
        <path d="M22 18l20 6 18-12" stroke="#e3c58a" fill="none" strokeWidth="1.3" />
        <circle cx="22" cy="18" r="3" fill="#f2d28a" />
        <circle cx="42" cy="24" r="2.4" fill="#d9694a" />
        <circle cx="60" cy="12" r="3.4" fill="#dfe6ee" />
        <path d="M22 18v14M60 12v18" stroke="#ebe4d6" strokeOpacity=".35" fill="none" />
      </svg>
    ),
  },
  {
    id: "system",
    name: "System model",
    note: "A star and what circles it, moving as the years pass.",
    dark: true,
    picture: (
      <svg viewBox="0 0 80 50" width="80" height="50">
        <ellipse cx="40" cy="25" rx="14" ry="7" fill="none" stroke="#ebe4d6" strokeOpacity=".3" />
        <ellipse cx="40" cy="25" rx="30" ry="15" fill="none" stroke="#ebe4d6" strokeOpacity=".3" />
        <circle cx="40" cy="25" r="5" fill="#f2d28a" />
        <circle cx="53" cy="28" r="2.2" fill="#6d9fcf" />
        <circle cx="14" cy="18" r="3.5" fill="#d9b38c" />
      </svg>
    ),
  },
];

const STATE: Record<string, string> = {
  new: "not published yet",
  unpublished: "unpublished changes",
};

/** The list of maps, and the form that makes a new one from an image of the vault. */
export function MapsPage() {
  const maps = useAsync(() => api.maps(), "maps");
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [title, setTitle] = useState("");
  const offline = useNeedsConnection();
  const [kind, setKind] = useState<Kind>("flat");
  const [schematic, setSchematic] = useState(false);
  const [unit, setUnit] = useState<"ly" | "pc">("ly");
  const [image, setImage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const noImage = kind === "stars" || kind === "system";
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

  return (
    <article className="entry wide maps">
      <header className="entry-head">
        <h1>Maps</h1>
        <p className="muted lede">
          A map is drawn over an image of yours, or, for a star map, in open space. Its markers,
          paths and zones point at entries.
        </p>
      </header>

      {maps.state === "loading" && <p className="muted">Loading…</p>}
      {maps.reloading && <Progress />}
      {failureOf(maps) && <Problem reason={failureOf(maps)!.message} onRetry={maps.retry} />}
      {maps.state === "ready" && (
        <>
          {maps.value.maps.length === 0 && (
            <p className="empty">No maps yet. Make the first below.</p>
          )}
          <ul className="map-list">
            {maps.value.maps.map((m) => {
              const below = maps.value.maps.filter((x) => x.under === m.id).length;
              const above = maps.value.maps.find((x) => x.id === m.under);
              return (
                <li key={m.id}>
                  <Link to={mapUrl(m.id)}>{m.title}</Link>
                  <span className="muted">
                    {m.space.kind === "sphere"
                      ? "globe"
                      : m.space.kind === "stars"
                        ? "star map"
                        : m.space.kind === "system"
                          ? "system model"
                          : m.space.schematic
                            ? "schematic map"
                            : "flat map"}{" "}
                    · {m.features} {m.features === 1 ? "feature" : "features"}
                    {above ? ` · lies under ${above.title}` : ""}
                    {below > 0 ? ` · ${below} ${below === 1 ? "layer" : "layers"} below` : ""}
                    {STATE[m.state] ? ` · ${STATE[m.state]}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {maps.value.problems.map((p) => (
            <p key={p.path} className="banner" role="alert">
              {p.path} is not shown as a map. {p.message}
            </p>
          ))}
        </>
      )}

      <form className="settings-block new-map settings" onSubmit={create}>
        <h2>New map</h2>
        <label className="field">
          <span>Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset className="kinds-field">
          <legend>Kind</legend>
          <div className="kinds">
            {KINDS.map((k) => (
              <label key={k.id} className="kind">
                <input
                  type="radio"
                  name="map-kind"
                  value={k.id}
                  checked={kind === k.id}
                  onChange={() => setKind(k.id)}
                />
                <span className={`pic${k.dark ? " dark" : ""}`} aria-hidden="true">
                  {k.picture}
                </span>
                <b>
                  {k.name}
                  {k.dark && <span className="new-tag">New</span>}
                </b>
                <small>{k.note}</small>
              </label>
            ))}
          </div>
        </fieldset>
        {kind === "flat" && (
          <label className="check">
            <input
              type="checkbox"
              checked={schematic}
              onChange={(e) => setSchematic(e.target.checked)}
            />{" "}
            Schematic: a diagram, with no measuring
          </label>
        )}
        {kind === "stars" && (
          <label className="field">
            <span>Distances are in</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as "ly" | "pc")}>
              <option value="ly">Light-years</option>
              <option value="pc">Parsecs</option>
            </select>
          </label>
        )}
        {(kind === "stars" || kind === "system") && (
          <p className="muted">
            {kind === "stars"
              ? "A star map needs no image. Its places have three numbers: across, along and height above a flat plane."
              : "A system model needs no image. It begins with its star; add the worlds that circle it."}
          </p>
        )}
        {kind !== "stars" && kind !== "system" && (
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
        <p className="change-actions">
          <ActionButton
            type="submit"
            className="primary"
            disabled={busy || !title.trim() || (kind !== "stars" && kind !== "system" && !image)}
          >
            Make the map
          </ActionButton>
        </p>
      </form>
    </article>
  );
}
