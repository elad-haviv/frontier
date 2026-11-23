import { FoldHorizontal, TableOfContents, UnfoldHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../ui/IconButton.tsx";
import "./StickyLine.css";

/**
 * Where the reader is in a long entry, on a desktop: once the title has scrolled away, a line
 * stays at the top of the page with the folder, the entry and the heading reached, then the
 * outline, full width, and the entry's own actions. The folder opens the side bar's tree there;
 * the entry's name goes back to the top. Each part shortens to "…" when they do not all fit.
 * On a phone the slim top line says the same instead (see the entry page).
 */
export function StickyLine({
  shown,
  folder,
  name,
  heading,
  wide,
  onFolder,
  onTop,
  onOutline,
  onWide,
  actions,
}: {
  /** Whether the title has scrolled away; the line is there all the time, out of sight. */
  shown: boolean;
  /** The entry's folder as stored, such as "03 Places/Harbor"; "" at the top of the library. */
  folder: string;
  name: string;
  /** The heading the reader has reached, or null above the first. */
  heading: string | null;
  wide: boolean;
  onFolder: () => void;
  onTop: () => void;
  /** Opens the Outline tab; absent when the entry has no headings. */
  onOutline?: (() => void) | undefined;
  onWide: () => void;
  /** Edit and "⋯", as beside the title. */
  actions?: ReactNode;
}) {
  const folderName = folder.split("/").pop() ?? folder;
  return (
    <div className="sticky-holder" inert={!shown}>
      <div className={`sticky-line${shown ? " is-shown" : ""}`}>
        <nav className="sticky-crumbs" aria-label="Where you are">
          {folder && (
            <>
              <button
                type="button"
                className="sticky-crumb sticky-folder"
                title={`Show ${folder} in the side bar`}
                onClick={onFolder}
              >
                {folderName}
              </button>
              <span className="sticky-sep" aria-hidden="true">
                ›
              </span>
            </>
          )}
          <button
            type="button"
            className="sticky-crumb sticky-name"
            title="Back to the top"
            onClick={onTop}
          >
            {name}
          </button>
          {heading && (
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
        <span className="sticky-actions">
          {onOutline && (
            <IconButton label="Outline" icon={TableOfContents} size="sm" onClick={onOutline} />
          )}
          <IconButton
            label="Full width"
            icon={wide ? FoldHorizontal : UnfoldHorizontal}
            size="sm"
            aria-pressed={wide}
            onClick={onWide}
          />
          {actions}
        </span>
      </div>
    </div>
  );
}
