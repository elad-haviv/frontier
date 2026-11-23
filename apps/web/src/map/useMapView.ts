/**
 * The map's view: where it looks, the size of its frame, zooming with the wheel, and the address,
 * which keeps the view and what is shown so that a link opens the map as it was.
 */
import { centreOn, initialView, type ViewState, zoomAt } from "@frontier/geo";
import type { MapFile } from "@frontier/schema";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mapUrl } from "../api.ts";
import type { TimeState } from "./useMapTime.ts";
import { readView, writeView } from "./viewUrl.ts";

/** The layers hidden and the images shown when a map opens: from the address, or the map's own. */
export function openingShown(
  map: MapFile,
  params: URLSearchParams,
): { hidden: Set<string>; images: Set<string> } {
  const hide = params.get("hide");
  const img = params.get("img");
  const opening = map.images.filter((i) => i.visible).map((i) => i.id);
  return {
    hidden: new Set(
      hide !== null
        ? hide.split(",").filter(Boolean)
        : map.layers.filter((l) => !l.visible).map((l) => l.id),
    ),
    images: new Set(
      img !== null
        ? img.split(",").filter(Boolean)
        : opening.length
          ? opening
          : map.images.slice(0, 1).map((i) => i.id),
    ),
  };
}

/** Where a pointer is on a canvas, in its own pixels. */
export function pointOn(
  canvas: HTMLCanvasElement,
  e: { clientX: number; clientY: number },
): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

export function useMapView(
  map: MapFile | null,
  {
    params,
    setParams,
    editing,
    time,
    hidden,
    shownImages,
    onWanted,
  }: {
    params: URLSearchParams;
    setParams: (next: URLSearchParams, options: { replace: boolean }) => void;
    editing: boolean;
    time: Pick<TimeState, "timeOn" | "year" | "chronicleId" | "defaultChronicle">;
    hidden: Set<string>;
    shownImages: Set<string>;
    /** Selects the feature the address asks for. */
    onWanted: (feature: string) => void;
  },
) {
  const navigate = useNavigate();
  const { timeOn, year, chronicleId, defaultChronicle } = time;
  const [view, setView] = useState<ViewState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState | null>(null);
  viewRef.current = view;

  // The canvas follows the size of its frame.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, [map === null]);

  // The first view: from the address, or the whole map, or centred on the feature asked for.
  useEffect(() => {
    if (!map || view || size.width === 0) return;
    let state =
      readView(params.get("v"), map.space.kind === "sphere") ??
      initialView(map.space, size.width, size.height);
    const wanted = map.features.find((f) => f.id === params.get("f"));
    if (wanted && !params.get("v")) {
      state = centreOn(state, wanted.kind === "marker" ? wanted.at : wanted.points[0]!);
      onWanted(wanted.id);
    }
    setView(state);
  }, [map, view, size]);

  // The view and what is shown are kept in the address, replacing it, so Back leaves the map.
  useEffect(() => {
    if (!view || !map) return;
    const wait = window.setTimeout(() => {
      const next = new URLSearchParams();
      next.set("v", writeView(view));
      const openingHidden = map.layers.filter((l) => !l.visible).map((l) => l.id);
      if ([...hidden].sort().join() !== openingHidden.sort().join()) {
        next.set("hide", [...hidden].join(","));
      }
      const openingImages = map.images.filter((i) => i.visible).map((i) => i.id);
      if ([...shownImages].sort().join() !== openingImages.sort().join()) {
        next.set("img", [...shownImages].join(","));
      }
      if (editing) next.set("edit", "1");
      if (timeOn && year !== null) next.set("t", String(year));
      if (timeOn && chronicleId && chronicleId !== defaultChronicle) next.set("c", chronicleId);
      setParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(wait);
  }, [view, hidden, shownImages, editing, timeOn, year, chronicleId, defaultChronicle]);

  /** Opens another layer at the same place, view and moment. */
  const goLayer = (other: string) => {
    const next = new URLSearchParams();
    if (view) next.set("v", writeView(view));
    if (timeOn && year !== null) next.set("t", String(year));
    if (timeOn && chronicleId && chronicleId !== defaultChronicle) next.set("c", chronicleId);
    navigate(`${mapUrl(other)}?${next.toString()}`);
  };

  const zoom = (factor: number) =>
    view && setView(zoomAt(view, size.width, size.height, size.width / 2, size.height / 2, factor));

  return { view, setView, viewRef, size, frame, goLayer, zoom };
}

/**
 * Zooms about the pointer with the wheel. The wheel must be able to stop the page from scrolling,
 * which React's own listener cannot. `ready` changes when the canvas may have been replaced.
 */
export function useWheelZoom(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  viewRef: RefObject<ViewState | null>,
  setView: (view: ViewState) => void,
  ready: unknown[],
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = viewRef.current;
      if (!state) return;
      const p = pointOn(canvasRef.current!, e);
      setView(
        zoomAt(
          state,
          canvas.clientWidth,
          canvas.clientHeight,
          p.x,
          p.y,
          Math.exp(-e.deltaY * 0.0015),
        ),
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, ready);
}
