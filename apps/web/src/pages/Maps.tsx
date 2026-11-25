import { useNeedsConnection } from "../sync/connection.ts";
import { type FormEvent, useState } from "react";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiFailure, imageUrl, mapUrl } from "../api.ts";
import { MapImagePicker } from "../components/images/MapImagePicker.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { queue } from "../sync/queue.ts";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { failureOf, useAsync } from "../useAsync.ts";

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
  const [kind, setKind] = useState<"sphere" | "flat" | "schematic" | "stars" | "system">("flat");
  const [image, setImage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createMap(
        title.trim(),
        kind === "sphere"
          ? "sphere"
          : kind === "stars"
            ? "stars"
            : kind === "system"
              ? "system"
              : "flat",
        kind === "stars" || kind === "system" ? undefined : image,
      );
      if (kind === "schematic") {
        // A schematic map is a flat map with measuring off.
        const made = await api.map(id);
        if (made.map.space.kind === "flat") {
          // Saved like any change, so it is kept on this device until the server has it.
          await queue.put(
            `map:${id}`,
            { ...made.map, space: { ...made.map.space, schematic: true } },
            { draftId: "", revision: made.revision, baseBlob: made.blob, base: made.map, delay: 0 },
          );
          await queue.sendNow(`map:${id}`);
        }
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
        <label className="field">
          <span>Kind</span>
          <select
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as "sphere" | "flat" | "schematic" | "stars" | "system")
            }
          >
            <option value="flat">Flat map: a region, a city</option>
            <option value="schematic">Schematic: a diagram, with no measuring</option>
            <option value="sphere">Globe: an image that wraps a whole world</option>
            <option value="stars">Star map: stars in space, with routes between them</option>
            <option value="system">System model: a star with its planets and moons, moving</option>
          </select>
        </label>
        {kind === "stars" && (
          <p className="muted">
            A star map needs no image. Its places have three numbers: across, along and height above
            a flat plane.
          </p>
        )}
        {kind === "system" && (
          <p className="muted">
            A system model needs no image. It begins with its star; add the worlds that circle it.
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
