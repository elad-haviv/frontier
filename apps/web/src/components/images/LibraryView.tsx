import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { entryUrl, type GalleryImage, imageUrl } from "../../api.ts";
import { useLightbox } from "../Lightbox.tsx";
import { Icon } from "../ui/Icon.tsx";
import "./LibraryView.css";

type Show = "used" | "unused" | "icons" | "all";

const nameOf = (path: string) => path.split("/").pop() ?? path;
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
const TOP = "(top folder)";
const MOST_LINKS = 3;

/** Used by entries first, then the rest, each by name. */
function inOrder(images: GalleryImage[]): GalleryImage[] {
  return [...images].sort(
    (x, y) =>
      Number(y.usedBy.length > 0) - Number(x.usedBy.length > 0) ||
      nameOf(x.path).localeCompare(nameOf(y.path), undefined, { numeric: true }),
  );
}

function Tile({
  image,
  mode,
  chosen,
  onToggle,
}: {
  image: GalleryImage;
  mode: "browse" | "pick";
  chosen: boolean;
  onToggle?: ((path: string) => void) | undefined;
}) {
  const open = useLightbox();
  const src = imageUrl(image.path, 320);
  const name = nameOf(image.path);
  return (
    <li className={`gallery-tile${chosen ? " is-chosen" : ""}`}>
      {mode === "browse" ? (
        <button type="button" onClick={() => open(src)} aria-label={`Open ${name}`}>
          <img src={src} alt={name} loading="lazy" decoding="async" />
        </button>
      ) : (
        <button
          type="button"
          aria-pressed={chosen}
          aria-label={`Choose ${name}`}
          onClick={() => onToggle?.(image.path)}
        >
          <img src={src} alt={name} loading="lazy" decoding="async" />
          {chosen && (
            <span className="library-check">
              <Icon icon={Check} size="sm" />
            </span>
          )}
        </button>
      )}
      <p className="gallery-name" title={image.path}>
        {name}
      </p>
      {image.unpublished && <p className="library-mark">Unpublished</p>}
      {mode === "browse" && image.usedBy.length > 0 && (
        <p className="gallery-used muted">
          In{" "}
          {image.usedBy.slice(0, MOST_LINKS).map((e, i) => (
            <span key={e.path}>
              {i > 0 && ", "}
              <Link to={entryUrl(e.path)}>{e.title}</Link>
            </span>
          ))}
          {image.usedBy.length > MOST_LINKS && ` and ${image.usedBy.length - MOST_LINKS} more`}
        </p>
      )}
    </li>
  );
}

/**
 * The library's images: folders down the side, a field that finds an image by its name or by an
 * entry that uses it, and a grid of thumbnails, those used by entries first. The Gallery browses
 * it, with filters and the entries each image is in; the image dialog picks from it.
 */
export function LibraryView({
  images,
  mode,
  chosen,
  onToggle,
}: {
  images: GalleryImage[];
  mode: "browse" | "pick";
  chosen?: ReadonlySet<string>;
  onToggle?: (path: string) => void;
}) {
  const [show, setShow] = useState<Show>(mode === "browse" ? "used" : "all");
  const [find, setFind] = useState("");
  const [folder, setFolder] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      used: images.filter((p) => p.usedBy.length > 0).length,
      unused: images.filter((p) => p.usedBy.length === 0 && !p.icon).length,
      icons: images.filter((p) => p.icon).length,
      all: images.length,
    }),
    [images],
  );
  const folders = useMemo(() => {
    const byFolder = new Map<string, number>();
    for (const p of images)
      byFolder.set(folderOf(p.path), (byFolder.get(folderOf(p.path)) ?? 0) + 1);
    return [...byFolder.entries()].sort(([x], [y]) =>
      x.localeCompare(y, undefined, { numeric: true }),
    );
  }, [images]);
  const shown = useMemo(() => {
    const words = find.trim().toLowerCase();
    return inOrder(
      images.filter((p) => {
        if (show === "used" && p.usedBy.length === 0) return false;
        if (show === "unused" && (p.usedBy.length > 0 || p.icon)) return false;
        if (show === "icons" && !p.icon) return false;
        if (folder !== null && folderOf(p.path) !== folder) return false;
        if (!words) return true;
        return (
          nameOf(p.path).toLowerCase().includes(words) ||
          p.usedBy.some((e) => e.title.toLowerCase().includes(words))
        );
      }),
    );
  }, [images, show, find, folder]);

  const tabs: [Show, string][] = [
    ["used", `In entries (${counts.used})`],
    ["unused", `Not used (${counts.unused})`],
    ["icons", `Icons (${counts.icons})`],
    ["all", `All (${counts.all})`],
  ];

  return (
    <div className={`library library-${mode}`}>
      <div className="gallery-tools">
        {mode === "browse" && (
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
        )}
        <input
          type="search"
          aria-label="Find an image by its name or its entry"
          placeholder="Find by name or entry"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          // Enter finds; it does not send the dialog this sits in.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
      </div>
      <div className="library-body">
        <nav className="library-folders" aria-label="Folders">
          <button type="button" aria-pressed={folder === null} onClick={() => setFolder(null)}>
            All folders <span className="muted">{images.length}</span>
          </button>
          {folders.map(([name, n]) => (
            <button
              key={name}
              type="button"
              aria-pressed={folder === name}
              title={name || TOP}
              onClick={() => setFolder(name)}
            >
              {nameOf(name) || TOP} <span className="muted">{n}</span>
            </button>
          ))}
        </nav>
        <div className="library-grid-area">
          {shown.length === 0 ? (
            <p className="empty">No images here.</p>
          ) : (
            <ul className="gallery-grid">
              {shown.map((p) => (
                <Tile
                  key={p.path}
                  image={p}
                  mode={mode}
                  chosen={chosen?.has(p.path) ?? false}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
