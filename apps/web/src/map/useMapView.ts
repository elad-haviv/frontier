/**
 * The map's view: where it looks, the size of its frame, zooming with the wheel, and the address,
 * which keeps the view and what is shown so that a link opens the map as it was.
 */
import { centreOn, initialView, type Position, type ViewState, zoomAt } from "@frontier/geo";
import { type MapFeature, type MapFile, planarSpace } from "@frontier/schema";
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
    placeOf,
  }: {
    params: URLSearchParams;
    setParams: (next: URLSearchParams, options: { replace: boolean }) => void;
    editing: boolean;
    time: Pick<TimeState, "timeOn" | "year" | "chronicleId" | "defaultChronicle" | "seen">;
    hidden: Set<string>;
    shownImages: Set<string>;
    /** Selects the feature the address asks for. */
    onWanted: (feature: string) => void;
    /** Where a feature is at the year shown: its marker, or the first point of its shape. */
    placeOf: (feature: MapFeature) => Position;
  },
) {
  const navigate = useNavigate();
  const { timeOn, year, chronicleId, defaultChronicle } = time;
  const [view, setView] = useState<ViewState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState | null>(null);
  viewRef.current = view;
  const placeRef = useRef(placeOf);
  placeRef.current = placeOf;
  /** The first view, centred on the feature the address asked for, until the year is known. */
  const centred = useRef<{ feature: MapFeature; state: ViewState } | null>(null);

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
      initialView(planarSpace(map.space), size.width, size.height);
    const wanted = map.features.find((f) => f.id === params.get("f"));
    if (wanted && !params.get("v")) {
      state = centreOn(state, placeOf(wanted));
      onWanted(wanted.id);
      if (params.get("t") !== null) centred.current = { feature: wanted, state };
    }
    setView(state);
  }, [map, view, size]);

  // With a year in the address, the feature is centred again on the shape in force at that year
  // once the chronicle is read, unless the view has been moved since.
  useEffect(() => {
    const first = centred.current;
    if (!time.seen || !first) return;
    centred.current = null;
    if (viewRef.current === first.state)
      setView(centreOn(first.state, placeRef.current(first.feature)));
  }, [time.seen]);

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

  /**
   * A link to a feature at this place: the map's address with `f`, and the year and chronicle
   * when time is on, but no view, so that the map opens centred on the feature.
   */
  const placeLink = (feature: string) => {
    const next = new URLSearchParams({ f: feature });
    if (timeOn && year !== null) next.set("t", String(year));
    if (timeOn && chronicleId && chronicleId !== defaultChronicle) next.set("c", chronicleId);
    return `${window.location.origin}${window.location.pathname}?${next.toString()}`;
  };

  /** A link to the map as it is seen now: the address, with its view, but not editing. */
  const viewLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    url.searchParams.delete("f");
    if (view) url.searchParams.set("v", writeView(view));
    return url.toString();
  };

  const zoom = (factor: number) =>
    view && setView(zoomAt(view, size.width, size.height, size.width / 2, size.height / 2, factor));

  return { view, setView, viewRef, size, frame, goLayer, zoom, placeLink, viewLink };
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
