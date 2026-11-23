/**
 * Draws the map: its images with WebGL, and its features on the canvas above, which also tells
 * where each feature landed so that a tap can find it.
 */
import { makeView, type Position, type Shape, type ViewState } from "@frontier/geo";
import type { MapFeature, MapFile } from "@frontier/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { imageUrl, mapImageUrl } from "../api.ts";
import { drawOverlay, type OverlayInput } from "./overlay.ts";
import { MapRenderer, MapsNeedWebGL } from "./renderer.ts";
import type { Tool } from "./tools.ts";
import type { MarkerSets, Names } from "./useMapFile.ts";

export function useMapDraw(
  map: MapFile | null,
  input: {
    /** The features as drawn now, with the shape on screen. */
    shownMap: MapFile | null;
    presence: NonNullable<OverlayInput["presence"]>;
    view: ViewState | null;
    size: { width: number; height: number };
    hidden: Set<string>;
    shownImages: Set<string>;
    selected: string | null;
    vertex: number | null;
    sketch: Position[];
    tool: Tool;
    editing: boolean;
    names: Names;
    pendingNames: Record<string, string>;
    sets: MarkerSets;
  },
) {
  const { shownMap, presence, view, size, hidden, shownImages, selected, vertex } = input;
  const { sketch, tool, editing, names, pendingNames, sets } = input;
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const topCanvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  /** Where each feature landed on the screen at the last draw. */
  const shapes = useRef<Shape[]>([]);
  /** While a finger pans, the images are drawn at a lower resolution. */
  const coarse = useRef(false);
  const icons = useRef(new Map<string, HTMLImageElement>());
  const [iconsLoaded, setIconsLoaded] = useState(0);

  const titleOf = useCallback(
    (f: MapFeature) =>
      f.label ?? (f.entry ? names[f.entry]?.title : undefined) ?? pendingNames[f.id] ?? "",
    [names, pendingNames],
  );

  const iconFor = useCallback(
    (f: MapFeature) => {
      if (f.kind !== "marker" || !f.icon) return null;
      const path = sets
        .find((s) => s.name === f.icon!.set)
        ?.icons.find((i) => i.name === f.icon!.name)?.path;
      if (!path) return null;
      const known = icons.current.get(path);
      if (known) return known.complete && known.naturalWidth > 0 ? known : null;
      const image = new Image();
      image.onload = () => setIconsLoaded((n) => n + 1);
      image.src = imageUrl(path);
      icons.current.set(path, image);
      return null;
    },
    [sets],
  );

  const [glError, setGlError] = useState<string | null>(null);
  const [redraw, setRedraw] = useState(0);
  useEffect(() => {
    if (!map || !view || size.width === 0 || !glCanvas.current || !topCanvas.current) return;
    if (!renderer.current) {
      try {
        renderer.current = new MapRenderer(glCanvas.current, () => setRedraw((n) => n + 1));
      } catch (err) {
        setGlError(err instanceof MapsNeedWebGL ? err.message : "The map could not be drawn.");
        return;
      }
    }
    const r = renderer.current;
    const wanted = window.innerWidth < 700 || r.maxTexture < 4096 ? 2560 : 4096;
    const drawn = map.images.filter((i) => shownImages.has(i.id));
    for (const image of drawn) r.load(image.id, mapImageUrl(image.path, wanted));
    const handle = requestAnimationFrame(() => {
      r.draw(map.space, view, drawn, size.width, size.height, coarse.current);
      const canvas = topCanvas.current!;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(size.width * ratio))
        canvas.width = Math.round(size.width * ratio);
      if (canvas.height !== Math.round(size.height * ratio))
        canvas.height = Math.round(size.height * ratio);
      shapes.current = drawOverlay(canvas.getContext("2d")!, {
        map: shownMap ?? map,
        presence,
        view: makeView(view, size.width, size.height),
        hidden,
        selected,
        selectedVertex: vertex,
        iconFor,
        titleOf,
        sketch:
          tool === "path" || tool === "zone" || tool === "measure"
            ? { kind: tool, points: sketch }
            : null,
        editing,
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [
    map,
    shownMap,
    presence,
    view,
    size,
    hidden,
    shownImages,
    selected,
    vertex,
    sketch,
    tool,
    editing,
    redraw,
    iconsLoaded,
    titleOf,
    iconFor,
  ]);

  return {
    glCanvas,
    topCanvas,
    shapes,
    coarse,
    glError,
    titleOf,
    iconFor,
    /** What a saved picture draws over its images. */
    overlay: { hidden, presence, iconFor, titleOf },
    /** Draws again, as after a pan with a finger, at the full resolution. */
    redrawNow: () => setRedraw((n) => n + 1),
  };
}
