import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, entryUrl, imageUrl } from "../api.ts";
import { LightboxProvider, useLightbox } from "../components/Lightbox.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { failureOf, useAsync } from "../useAsync.ts";

type Show = "used" | "unused" | "icons" | "all";

interface Picture {
  path: string;
  icon: boolean;
  usedBy: { path: string; title: string }[];
}

const nameOf = (path: string) => path.split("/").pop() ?? path;
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/") || "(top folder)";
const MOST_LINKS = 3;

function Tile({ picture }: { picture: Picture }) {
  const open = useLightbox();
  const src = imageUrl(picture.path, 320);
  return (
    <li className="gallery-tile">
      <button type="button" onClick={() => open(src)} aria-label={`Open ${nameOf(picture.path)}`}>
        <img src={src} alt={nameOf(picture.path)} loading="lazy" />
      </button>
      <p className="gallery-name" title={picture.path}>
        {nameOf(picture.path)}
      </p>
      {picture.usedBy.length > 0 && (
        <p className="gallery-used muted">
          In{" "}
          {picture.usedBy.slice(0, MOST_LINKS).map((e, i) => (
            <span key={e.path}>
              {i > 0 && ", "}
              <Link to={entryUrl(e.path)}>{e.title}</Link>
            </span>
          ))}
          {picture.usedBy.length > MOST_LINKS && ` and ${picture.usedBy.length - MOST_LINKS} more`}
        </p>
      )}
    </li>
  );
}

/** Every image of the library, by folder, each with the entries that use it. */
export function GalleryPage() {
  const gallery = useAsync(() => api.gallery(), "gallery");
  const [show, setShow] = useState<Show>("used");
  const [find, setFind] = useState("");

  const images = gallery.state === "ready" ? gallery.value.images : [];
  const counts = useMemo(
    () => ({
      used: images.filter((p) => p.usedBy.length > 0).length,
      unused: images.filter((p) => p.usedBy.length === 0 && !p.icon).length,
      icons: images.filter((p) => p.icon).length,
      all: images.length,
    }),
    [images],
  );
  const groups = useMemo(() => {
    const words = find.trim().toLowerCase();
    const shown = images.filter((p) => {
      if (show === "used" && p.usedBy.length === 0) return false;
      if (show === "unused" && (p.usedBy.length > 0 || p.icon)) return false;
      if (show === "icons" && !p.icon) return false;
      if (!words) return true;
      return (
        p.path.toLowerCase().includes(words) ||
        p.usedBy.some((e) => e.title.toLowerCase().includes(words))
      );
    });
    const byFolder = new Map<string, Picture[]>();
    for (const p of shown) {
      const folder = folderOf(p.path);
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), p]);
    }
    return [...byFolder.entries()];
  }, [images, show, find]);

  const tabs: [Show, string][] = [
    ["used", `In entries (${counts.used})`],
    ["unused", `Not used (${counts.unused})`],
    ["icons", `Icons (${counts.icons})`],
    ["all", `All (${counts.all})`],
  ];

  return (
    <article className="entry wide gallery">
      <header className="entry-head">
        <h1>Gallery</h1>
        <p className="muted lede">The images of the library, by folder.</p>
      </header>

      {gallery.state === "loading" && <p className="muted">Loading…</p>}
      {gallery.reloading && <Progress />}
      {failureOf(gallery) && (
        <Problem reason={failureOf(gallery)!.message} onRetry={gallery.retry} />
      )}
      {gallery.state === "ready" && (
        <>
          <div className="gallery-tools">
            <div className="ch-tabs" role="tablist" aria-label="Which images">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={show === key}
                  className={show === key ? "is-on" : ""}
                  onClick={() => setShow(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              aria-label="Find an image by its name or its entry"
              placeholder="Find by name or entry"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          </div>

          {groups.length === 0 && <p className="empty">No images here.</p>}
          <LightboxProvider scope=".gallery">
            {groups.map(([folder, pictures]) => (
              <section key={folder}>
                <h2>
                  {folder} <span className="muted">{pictures.length}</span>
                </h2>
                <ul className="gallery-grid">
                  {pictures.map((p) => (
                    <Tile key={p.path} picture={p} />
                  ))}
                </ul>
              </section>
            ))}
          </LightboxProvider>
        </>
      )}
    </article>
  );
}
