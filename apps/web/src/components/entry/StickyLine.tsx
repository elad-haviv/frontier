import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { entryUrl } from "../../api.ts";
import { shortcutText } from "../../keys.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tip } from "../ui/Tip.tsx";
import "./StickyLine.css";

/**
 * The bar at the top of an entry, on a desktop. It stays at the top of the page: on the left the
 * folder, and once the title has scrolled away the entry and the heading reached; on the right
 * the entry's actions. The folder opens the side bar's tree there; the entry's name goes back to
 * the top. Each part shortens to "…" when they do not all fit. Between the two, "‹ Last: Name"
 * goes back to the entry viewed before this one. On a phone the slim top line says
 * where the reader is and holds the actions instead (see the entry page).
 */
export function StickyLine({
  shown,
  folder,
  name,
  heading,
  onFolder,
  onTop,
  last,
  actions,
}: {
  /** Whether the title has scrolled away, so the entry's name and heading join the folder. */
  shown: boolean;
  /** The entry's folder as stored, such as "03 Places/Harbor"; "" at the top of the library. */
  folder: string;
  name: string;
  /** The heading the reader has reached, or null above the first. */
  heading: string | null;
  /** Opens the side bar's tree at a folder. */
  onFolder: (folder: string) => void;
  onTop: () => void;
  /** The entry viewed before this one, for the "‹ Last: Name" chip; null when there is none. */
  last?: { path: string; title: string } | null;
  /** The entry's actions. */
  actions: ReactNode;
}) {
  const parts = folder ? folder.split("/") : [];
  const folderName = parts.pop() ?? "";
  return (
    <div className="sticky-holder">
      <div className={`sticky-line${shown ? " is-shown" : ""}`}>
        <nav className="sticky-crumbs" aria-label="Where you are">
          {/* The folders above the entry's own, each opening the tree there. */}
          {parts.map((part, i) => (
            <span key={i} className="sticky-parent">
              <button
                type="button"
                className="sticky-crumb sticky-folder-up"
                title={`Show ${parts.slice(0, i + 1).join("/")} in the side bar`}
                onClick={() => onFolder(parts.slice(0, i + 1).join("/"))}
              >
                {part}
              </button>
              <span className="sticky-sep" aria-hidden="true">
                ›
              </span>
            </span>
          ))}
          {folder && (
            <>
              <button
                type="button"
                className="sticky-crumb sticky-folder"
                title={`Show ${folder} in the side bar`}
                onClick={() => onFolder(folder)}
              >
                {folderName}
              </button>
              {shown && (
                <span className="sticky-sep" aria-hidden="true">
                  ›
                </span>
              )}
            </>
          )}
          {shown && (
            <button
              type="button"
              className="sticky-crumb sticky-name"
              title="Back to the top"
              onClick={onTop}
            >
              {name}
            </button>
          )}
          {shown && heading && (
            <>
              <span className="sticky-sep" aria-hidden="true">
                ›
              </span>
              <span className="sticky-crumb sticky-heading" aria-current="location">
                {heading}
              </span>
            </>
          )}
        </nav>
        {last && (
          <Tip
            label="Back to the last entry viewed"
            keys={shortcutText("entry.back")}
            side="bottom"
          >
            <Link className="sticky-last" to={entryUrl(last.path)}>
              <Icon icon={ChevronLeft} size="sm" />
              <span className="sticky-last-text">Last: {last.title}</span>
            </Link>
          </Tip>
        )}
        {actions}
      </div>
    </div>
  );
}
