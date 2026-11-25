import type { MapFeature } from "@frontier/schema";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PreviewCard, usePreviewText } from "../HoverPreview.tsx";
import "./MapHover.css";

/** What the mouse is over on the map, as the page tells it. */
export interface Hovered {
  /** A feature, or a corner or a "+" of the selected one. */
  kind: "feature" | "corner" | "insert";
  feature: MapFeature;
  /** Its name as the map shows it; empty when it has none. */
  title: string;
  /** Where the tooltip points: the marker, or where the pointer met the path or zone. */
  at: { x: number; y: number };
  /** The vault path of its entry, when it has one that is known. */
  entryPath: string | null;
  /** The title of the map of this place, when it has one. */
  childTitle: string | null;
  /** A biome zone's biome and what it does to travel and rivers. */
  biome?: string | null;
}

/** How long the pointer stays on a feature before its entry's preview takes the tooltip's place. */
export const PREVIEW_DELAY = 350;

const UNNAMED = {
  marker: "Unnamed marker",
  path: "Unnamed path",
  zone: "Unnamed zone",
  label: "Label",
  route: "Route",
};

/** A box placed beside a point, kept inside the frame. */
function placed(
  at: { x: number; y: number },
  box: { width: number; height: number },
  frame: { width: number; height: number },
) {
  const gap = 14;
  const x = at.x + gap + box.width <= frame.width - 8 ? at.x + gap : at.x - gap - box.width;
  const y = at.y + gap + box.height <= frame.height - 8 ? at.y + gap : at.y - gap - box.height;
  return {
    left: Math.max(8, Math.min(x, frame.width - 8 - box.width)),
    top: Math.max(8, Math.min(y, frame.height - 8 - box.height)),
  };
}

/**
 * The name of what the mouse is over, shown at once, and in viewing, after a short pause over a
 * feature linked to an entry, a card with the entry's opening in its place. Neither catches the
 * pointer: every press and move still reaches the map.
 */
export function MapHover({
  hovered,
  editing,
  frame,
}: {
  hovered: Hovered | null;
  editing: boolean;
  frame: { width: number; height: number };
}) {
  const key = hovered ? `${hovered.kind}:${hovered.feature.id}` : "";
  const [waited, setWaited] = useState("");
  const wanted = !editing && hovered?.kind === "feature" ? hovered.entryPath : null;
  useEffect(() => {
    setWaited("");
    if (!wanted) return;
    const timer = window.setTimeout(() => setWaited(key), PREVIEW_DELAY);
    return () => window.clearTimeout(timer);
  }, [key, wanted]);
  const text = usePreviewText(wanted && waited === key ? wanted : null);

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const card = wanted !== null && text !== null && waited === key;
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [key, card, hovered?.title]);

  if (!hovered) return null;
  const style = placed(hovered.at, size, frame);
  if (card) {
    return (
      <div ref={box} className="map-hover-card" style={style}>
        <PreviewCard path={wanted} text={text} style={{}} className="map-preview">
          {hovered.childTitle && (
            <p className="map-preview-child">Map of this place: {hovered.childTitle}</p>
          )}
        </PreviewCard>
      </div>
    );
  }
  const words =
    hovered.kind === "corner"
      ? "Drag to move · Delete to remove"
      : hovered.kind === "insert"
        ? "Add a point"
        : hovered.title || UNNAMED[hovered.feature.kind];
  return (
    <div ref={box} className="map-tooltip" role="tooltip" style={style}>
      {words}
      {hovered.kind === "feature" && hovered.biome && (
        <span className="map-tooltip-biome">{hovered.biome}</span>
      )}
    </div>
  );
}
