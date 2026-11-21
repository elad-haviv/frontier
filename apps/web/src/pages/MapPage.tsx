import {
  centreOn,
  initialView,
  makeView,
  measure,
  panBy,
  type Position,
  scaleFrom,
  type Shape,
  shapeAt,
  switchGlobeView,
  vertexAt,
  type ViewState,
  zoomAt,
} from "@frontier/geo";
import {
  type MapFeature,
  type MapFile,
  mergeMaps,
  reorderFeature,
  wholeExtent,
} from "@frontier/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiFailure, imageUrl, mapImageUrl } from "../api.ts";
import {
  FeatureCard,
  FeatureEditor,
  LayerPanel,
  lengthText,
  type MarkerSets,
  type Names,
} from "../components/MapPanels.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { drawOverlay } from "../map/overlay.ts";
import { MapRenderer, MapsNeedWebGL } from "../map/renderer.ts";
import { newItemId, readView, writeView } from "../map/viewUrl.ts";
import { useDialogs } from "../components/Dialogs.tsx";

type Tool = "select" | "marker" | "path" | "zone" | "measure";
type SaveState = "saved" | "saving" | "unsaved" | "offline" | "failed";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved as a draft",
  saving: "Saving…",
  unsaved: "Unsaved",
  offline: "Offline: will save when back",
  failed: "Could not save",
};
const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select" },
  { tool: "marker", label: "Marker" },
  { tool: "path", label: "Path" },
  { tool: "zone", label: "Zone" },
  { tool: "measure", label: "Measure" },
];

export function MapPage() {
  const dialogs = useDialogs();
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useRefresh();

  const [map, setMap] = useState<MapFile | null>(null);
  const [names, setNames] = useState<Names>({});
  const [children, setChildren] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shownImages, setShownImages] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [vertex, setVertex] = useState<number | null>(null);
  const [sketch, setSketch] = useState<Position[]>([]);
  const [activeLayer, setActiveLayer] = useState("");
  const [panel, setPanel] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [sets, setSets] = useState<MarkerSets>([]);
  const [otherMaps, setOtherMaps] = useState<{ id: string; title: string }[]>([]);
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({});
  const [iconsLoaded, setIconsLoaded] = useState(0);
  const [history, setHistory] = useState<{ past: MapFile[]; future: MapFile[] }>({
    past: [],
    future: [],
  });

  const frame = useRef<HTMLDivElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const topCanvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  const shapes = useRef<Shape[]>([]);
  const mapRef = useRef<MapFile | null>(null);
  const viewRef = useRef<ViewState | null>(null);
  const confirmed = useRef<MapFile | null>(null);
  const revision = useRef(0);
  const links = useRef<{ feature: string; path: string; title: string }[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef(false);
  const again = useRef(false);
  const icons = useRef(new Map<string, HTMLImageElement>());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    drag: { feature: string; vertex: number | null } | null;
    pinch: number | null;
    touch: boolean;
  } | null>(null);
  const coarse = useRef(false);
  mapRef.current = map;
  viewRef.current = view;

  // ---- Loading ---------------------------------------------------------------------------------

  useEffect(() => {
    let live = true;
    setMap(null);
    setError(null);
    setSelected(null);
    setHistory({ past: [], future: [] });
    api.map(id).then(
      (loaded) => {
        if (!live) return;
        confirmed.current = loaded.map;
        revision.current = loaded.revision;
        setMap(loaded.map);
        setNames(loaded.entries);
        setChildren(loaded.children);
        setActiveLayer(loaded.map.layers[0]!.id);
        const hide = params.get("hide");
        setHidden(
          new Set(
            hide !== null
              ? hide.split(",").filter(Boolean)
              : loaded.map.layers.filter((l) => !l.visible).map((l) => l.id),
          ),
        );
        const img = params.get("img");
        const opening = loaded.map.images.filter((i) => i.visible).map((i) => i.id);
        setShownImages(
          new Set(
            img !== null
              ? img.split(",").filter(Boolean)
              : opening.length
                ? opening
                : loaded.map.images.slice(0, 1).map((i) => i.id),
          ),
        );
      },
      (err: unknown) =>
        live && setError(err instanceof ApiFailure ? err.message : "The map could not be opened."),
    );
    api.markerSets().then(
      (r) => live && setSets(r.sets),
      () => undefined,
    );
    api.maps().then(
      (r) => live && setOtherMaps(r.maps.filter((m) => m.id !== id)),
      () => undefined,
    );
    return () => {
      live = false;
      window.clearTimeout(timer.current);
    };
    // The address is read once, when the map opens.
  }, [id]);

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
      setSelected(wanted.id);
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
      setParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(wait);
  }, [view, hidden, shownImages, editing]);

  // ---- Drawing ---------------------------------------------------------------------------------

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
        map,
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

  // ---- Changing and saving ---------------------------------------------------------------------

  const save = useCallback(async () => {
    const mine = mapRef.current;
    if (!mine) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    setSaveState("saving");
    const sent = links.current.splice(0);
    try {
      const res = await api.saveMap(
        id,
        mine,
        revision.current,
        sent.map(({ feature, path }) => ({ feature, path })),
      );
      revision.current = res.revision;
      confirmed.current = res.map;
      if (sent.length > 0) {
        // The server gave the linked features their entry ids; nothing else is taken from it.
        const ids = new Map(res.map.features.map((f) => [f.id, f.entry]));
        const added: Names = {};
        for (const l of sent) {
          const entry = ids.get(l.feature);
          if (entry) added[entry] = { path: l.path, title: l.title };
        }
        setNames((n) => ({ ...n, ...added }));
        setMap((now) =>
          now
            ? {
                ...now,
                features: now.features.map((f) =>
                  sent.some((l) => l.feature === f.id) ? { ...f, entry: ids.get(f.id) ?? null } : f,
                ),
              }
            : now,
        );
        if (res.unlinked.length > 0) setNotice(`Not linked: ${res.unlinked[0]!.reason}`);
      }
      setSaveState(mapRef.current === mine ? "saved" : "unsaved");
      refresh();
    } catch (err) {
      links.current.unshift(...sent);
      const failure = err instanceof ApiFailure ? err : null;
      if (failure?.code === "offline") {
        setSaveState("offline");
        timer.current = window.setTimeout(() => void save(), 5000);
      } else if (failure?.code === "stale_revision" && confirmed.current) {
        // Another device changed the map: merge its version with this one, item by item.
        try {
          const theirs = await api.map(id);
          const merged = mergeMaps(confirmed.current, mine, theirs.map);
          confirmed.current = theirs.map;
          revision.current = theirs.revision;
          setNames((n) => ({ ...theirs.entries, ...n }));
          setMap(merged.map);
          setNotice(
            merged.clashes.length === 0
              ? "Changes from another device were merged in."
              : `Changes from another device were merged in. ${merged.clashes.length} thing${
                  merged.clashes.length === 1 ? " was" : "s were"
                } changed in both places; yours were kept.`,
          );
          again.current = true;
        } catch {
          setSaveState("failed");
        }
      } else {
        setSaveState("failed");
        setNotice(failure?.message ?? "Something went wrong while saving.");
      }
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        window.setTimeout(() => void save(), 0);
      }
    }
  }, [id, refresh]);

  const schedule = useCallback(() => {
    setSaveState((s) => (s === "saving" ? s : "unsaved"));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 1000);
  }, [save]);

  /** Applies a change. `remember` is false for the steps of one drag, which undo as a whole. */
  const change = useCallback(
    (next: MapFile, remember = true) => {
      const before = mapRef.current;
      if (!before) return;
      if (remember) setHistory((h) => ({ past: [...h.past.slice(-99), before], future: [] }));
      setMap(next);
      schedule();
    },
    [schedule],
  );

  const setFeature = useCallback(
    (next: MapFeature, remember = true) => {
      const now = mapRef.current;
      if (now)
        change(
          { ...now, features: now.features.map((f) => (f.id === next.id ? next : f)) },
          remember,
        );
    },
    [change],
  );

  function undo() {
    setHistory((h) => {
      const before = h.past[h.past.length - 1];
      if (!before || !mapRef.current) return h;
      const now = mapRef.current;
      setMap(before);
      schedule();
      return { past: h.past.slice(0, -1), future: [now, ...h.future] };
    });
  }
  function redo() {
    setHistory((h) => {
      const next = h.future[0];
      if (!next || !mapRef.current) return h;
      const now = mapRef.current;
      setMap(next);
      schedule();
      return { past: [...h.past, now], future: h.future.slice(1) };
    });
  }

  function finishSketch() {
    if (!map) return;
    const kind = tool === "zone" ? "zone" : "path";
    if (sketch.length >= (kind === "zone" ? 3 : 2)) {
      const feature = {
        id: newItemId(),
        kind,
        layer: activeLayer,
        points: sketch,
        entry: null,
        label: null,
        child: null,
      } as MapFeature;
      change({ ...map, features: [...map.features, feature] });
      setSelected(feature.id);
    }
    setSketch([]);
    setTool("select");
  }

  // ---- Pointers --------------------------------------------------------------------------------

  const at = (e: { clientX: number; clientY: number }) => {
    const box = topCanvas.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  function tap(x: number, y: number) {
    const state = viewRef.current;
    const now = mapRef.current;
    if (!state || !now) return;
    const v = makeView(state, size.width, size.height);
    const position = v.unproject(x, y);

    if (editing && tool === "marker") {
      if (!position) return;
      const feature: MapFeature = {
        id: newItemId(),
        kind: "marker",
        layer: activeLayer,
        at: position,
        entry: null,
        label: null,
        icon: null,
        child: null,
      };
      change({ ...now, features: [...now.features, feature] });
      setSelected(feature.id);
      setTool("select");
      return;
    }
    if (editing && (tool === "path" || tool === "zone" || tool === "measure")) {
      if (!position) return;
      const last = sketch[sketch.length - 1];
      const lastOnScreen = last ? v.project(last) : null;
      const onLast =
        lastOnScreen !== null && Math.hypot(lastOnScreen[0] - x, lastOnScreen[1] - y) < 16;
      if (onLast && tool !== "measure") finishSketch();
      else if (!onLast) setSketch([...sketch, position]);
      return;
    }

    // Reading, or the select tool: a corner of the selected shape first, then any feature.
    const chosen = now.features.find((f) => f.id === selected);
    if (editing && chosen && chosen.kind !== "marker") {
      const corners = chosen.points.map((p) => v.projectClamped(p).point);
      const corner = vertexAt(corners, [x, y]);
      if (corner !== null) {
        setVertex(corner);
        return;
      }
    }
    const hit = shapeAt(shapes.current, [x, y]);
    setSelected(hit);
    setVertex(null);
    if (hit) setPanel(false);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = at(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (gesture.current) {
        gesture.current.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        gesture.current.moved = true;
        gesture.current.drag = null;
      }
      return;
    }
    // While editing with the select tool, a press on the selected marker or corner drags it.
    let drag: { feature: string; vertex: number | null } | null = null;
    const now = mapRef.current;
    const state = viewRef.current;
    if (editing && tool === "select" && selected && now && state) {
      const v = makeView(state, size.width, size.height);
      const chosen = now.features.find((f) => f.id === selected);
      if (chosen?.kind === "marker") {
        const s = v.project(chosen.at);
        if (s && Math.hypot(s[0] - p.x, s[1] - p.y) < 24)
          drag = { feature: chosen.id, vertex: null };
      } else if (chosen) {
        const corner = vertexAt(
          chosen.points.map((q) => v.projectClamped(q).point),
          [p.x, p.y],
        );
        if (corner !== null) drag = { feature: chosen.id, vertex: corner };
      }
    }
    gesture.current = {
      startX: p.x,
      startY: p.y,
      moved: false,
      drag,
      pinch: null,
      touch: e.pointerType === "touch",
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const before = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!before || !g) return;
    const p = at(e);
    pointers.current.set(e.pointerId, p);
    const state = viewRef.current;
    if (!state) return;

    if (pointers.current.size === 2 && g.pinch !== null) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (distance > 0 && g.pinch > 0) {
        setView(
          zoomAt(
            state,
            size.width,
            size.height,
            (a!.x + b!.x) / 2,
            (a!.y + b!.y) / 2,
            distance / g.pinch,
          ),
        );
        g.pinch = distance;
      }
      return;
    }
    if (!g.moved) {
      if (Math.hypot(p.x - g.startX, p.y - g.startY) < (g.touch ? 10 : 6)) {
        // Not a drag yet: keep measuring from where the press began, so none of it is lost.
        pointers.current.set(e.pointerId, before);
        return;
      }
      g.moved = true;
      // One drag is one step to undo.
      if (g.drag && mapRef.current) {
        const start = mapRef.current;
        setHistory((h) => ({ past: [...h.past.slice(-99), start], future: [] }));
      }
    }
    if (g.drag) {
      const position = makeView(state, size.width, size.height).unproject(p.x, p.y);
      const feature = mapRef.current?.features.find((f) => f.id === g.drag!.feature);
      if (!position || !feature) return;
      if (feature.kind === "marker") setFeature({ ...feature, at: position }, false);
      else {
        const points = feature.points.map((q, i) => (i === g.drag!.vertex ? position : q));
        setFeature({ ...feature, points } as MapFeature, false);
      }
      return;
    }
    coarse.current = g.touch;
    setView(panBy(state, p.x - before.x, p.y - before.y));
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      if (g) g.pinch = null;
      return;
    }
    gesture.current = null;
    if (coarse.current) {
      coarse.current = false;
      setRedraw((n) => n + 1);
    }
    if (g && p && !g.moved) tap(p.x, p.y);
  }

  // The wheel must be able to stop the page from scrolling, which React's own listener cannot.
  useEffect(() => {
    const canvas = topCanvas.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = viewRef.current;
      if (!state) return;
      const p = at(e);
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
  }, [map === null, glError]);

  // ---- The page --------------------------------------------------------------------------------

  const feature = useMemo(
    () => map?.features.find((f) => f.id === selected) ?? null,
    [map, selected],
  );
  const measured = useMemo(
    () => (map && tool === "measure" && sketch.length > 1 ? measure(map.space, sketch) : null),
    [map, tool, sketch],
  );

  if (error) {
    return (
      <div className="center">
        <p className="error">{error}</p>
        <Link to="/maps">All maps</Link>
      </div>
    );
  }
  if (!map) return <p className="center muted">Opening the map…</p>;
  if (glError) return <p className="center error">{glError}</p>;

  const zoom = (factor: number) =>
    view && setView(zoomAt(view, size.width, size.height, size.width / 2, size.height / 2, factor));
  const sphere = map.space.kind === "sphere";

  async function setSize2() {
    if (!map) return;
    if (map.space.kind === "sphere") {
      const answer = await dialogs.prompt({
        title: "The size of this world",
        body: "Give the radius to see distances as well as angles. Leave it empty when it is not known.",
        label: `Radius in ${map.space.unit}`,
        initial: map.space.radius === null ? "" : String(map.space.radius),
        inputMode: "decimal",
        action: "Set the radius",
      });
      if (answer === null) return;
      const radius = answer.trim() === "" ? null : Number(answer);
      if (radius !== null && !(radius > 0)) return;
      change({ ...map, space: { ...map.space, radius } });
    } else if (measured) {
      const answer = await dialogs.prompt({
        title: "Set the scale from this line",
        body: "Say how long the line you measured really is. Distances on this map follow from it.",
        label: `Length in ${map.space.unit}`,
        inputMode: "decimal",
        action: "Set the scale",
      });
      const scale = answer ? scaleFrom(sketch, Number(answer)) : null;
      if (scale) change({ ...map, space: { ...map.space, scale } });
    }
  }

  async function remove() {
    const ok = await dialogs.confirm({
      title: `Delete the map "${map!.title}"?`,
      body: "It is removed from the library when you save a version.",
      action: "Delete the map",
      danger: true,
    });
    if (!ok) return;
    window.clearTimeout(timer.current);
    await api.deleteMap(id).catch(() => undefined);
    refresh();
    navigate("/maps");
  }

  return (
    <div className="map-page">
      <div className="map-bar">
        <Link to="/maps" className="map-back" aria-label="All maps">
          ‹
        </Link>
        {editing ? (
          <input
            className="map-title"
            aria-label="Title of the map"
            value={map.title}
            onChange={(e) => e.target.value && change({ ...map, title: e.target.value })}
          />
        ) : (
          <h1 className="map-title">{map.title}</h1>
        )}
        {editing && (
          <span className={`save-state save-${saveState}`} role="status">
            {SAVE_LABEL[saveState]}
          </span>
        )}
        <span className="map-actions">
          {sphere && view && (
            <button
              type="button"
              className="quiet"
              onClick={() =>
                setView(switchGlobeView(view, view.kind === "globe" ? "plate" : "globe"))
              }
            >
              {view.kind === "globe" ? "Flat" : "Globe"}
            </button>
          )}
          <button
            type="button"
            className="quiet"
            aria-pressed={panel}
            onClick={() => {
              setPanel(!panel);
              // One panel at a time: on a phone they share the bottom of the screen.
              setSelected(null);
            }}
          >
            Layers
          </button>
          <button
            type="button"
            className={editing ? "primary" : "quiet"}
            onClick={() => {
              if (editing && saveState !== "saved") void save();
              setEditing(!editing);
              setTool("select");
              setSketch([]);
              setSelected(null);
            }}
          >
            {editing ? "Done" : "Edit"}
          </button>
        </span>
      </div>

      {editing && (
        <div className="map-tools" role="toolbar" aria-label="Map tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              aria-pressed={tool === t.tool}
              onClick={() => {
                setTool(t.tool);
                setSketch([]);
                if (t.tool !== "select") setSelected(null);
              }}
            >
              {t.label}
            </button>
          ))}
          <span className="edit-toolbar-gap" />
          <button
            type="button"
            aria-label="Undo"
            disabled={history.past.length === 0}
            onClick={undo}
          >
            ↶
          </button>
          <button
            type="button"
            aria-label="Redo"
            disabled={history.future.length === 0}
            onClick={redo}
          >
            ↷
          </button>
          <button type="button" className="danger" onClick={remove}>
            Delete map
          </button>
        </div>
      )}

      {notice && (
        <p className="banner map-notice" role="status">
          {notice}{" "}
          <button type="button" className="plain" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="map-frame" ref={frame}>
        <canvas ref={glCanvas} className="map-canvas" />
        <canvas
          ref={topCanvas}
          className={`map-canvas map-top tool-${editing ? tool : "read"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div className="map-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.6)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.6)}>
            −
          </button>
          <button
            type="button"
            aria-label="Show the whole map"
            onClick={() => setView(initialView(map.space, size.width, size.height))}
          >
            ⤢
          </button>
        </div>

        {editing && (tool === "path" || tool === "zone") && (
          <p className="map-hint">
            Tap to add points.{" "}
            <button
              type="button"
              className="primary"
              disabled={sketch.length < (tool === "zone" ? 3 : 2)}
              onClick={finishSketch}
            >
              Done
            </button>
          </p>
        )}
        {editing && tool === "marker" && <p className="map-hint">Tap where the marker goes.</p>}
        {editing && tool === "measure" && (
          <p className="map-hint" role="status">
            {measured ? lengthText(measured, sphere) : "Tap two or more points."}{" "}
            {sketch.length > 0 && (
              <button type="button" className="plain" onClick={() => setSketch([])}>
                Clear
              </button>
            )}{" "}
            {(sphere || measured) && (
              <button type="button" className="plain" onClick={setSize2}>
                {sphere ? "Set the radius" : "Set the scale from this line"}
              </button>
            )}
          </p>
        )}

        {panel && (
          <LayerPanel
            map={map}
            hidden={hidden}
            shownImages={shownImages}
            editing={editing}
            activeLayer={activeLayer}
            onToggleLayer={(layer) =>
              setHidden((h) => {
                const next = new Set(h);
                if (!next.delete(layer)) next.add(layer);
                return next;
              })
            }
            onToggleImage={(image) =>
              setShownImages((s) => {
                const next = new Set(s);
                if (!next.delete(image)) next.add(image);
                return next;
              })
            }
            onActive={setActiveLayer}
            onChange={change}
            onAddImage={(path) => {
              const image = {
                id: newItemId(),
                // Named after its file, without the folders and the ending.
                name: path.replace(/^.*\//, "").replace(/\.[^.]+$/, ""),
                path,
                extent: wholeExtent(map.space),
                visible: true,
              };
              change({ ...map, images: [...map.images, image] });
              setShownImages((shown) => new Set(shown).add(image.id));
            }}
            onKeepAsOpening={() =>
              change({
                ...map,
                layers: map.layers.map((l) => ({ ...l, visible: !hidden.has(l.id) })),
                images: map.images.map((i) => ({ ...i, visible: shownImages.has(i.id) })),
              })
            }
          />
        )}

        {feature && !editing && (
          <FeatureCard
            feature={feature}
            title={titleOf(feature)}
            names={names}
            children={children}
            onClose={() => setSelected(null)}
          />
        )}
        {feature && editing && tool === "select" && (
          <FeatureEditor
            key={feature.id}
            feature={feature}
            map={map}
            names={names}
            pendingEntry={pendingNames[feature.id] ?? null}
            sets={sets}
            otherMaps={otherMaps}
            vertex={vertex}
            onChange={(next) => setFeature(next)}
            onLink={(path, title) => {
              links.current = links.current.filter((l) => l.feature !== feature.id);
              setPendingNames((p) => {
                const next = { ...p };
                if (path) next[feature.id] = title;
                else delete next[feature.id];
                return next;
              });
              if (path) links.current.push({ feature: feature.id, path, title });
              setFeature({ ...feature, entry: null });
              // Linking changes nothing in the map until the server answers, so ask it now.
              schedule();
            }}
            onDelete={() => {
              change({ ...map, features: map.features.filter((f) => f.id !== feature.id) });
              setSelected(null);
            }}
            onRemoveVertex={() => {
              if (feature.kind === "marker" || vertex === null) return;
              setFeature({
                ...feature,
                points: feature.points.filter((_, i) => i !== vertex),
              } as MapFeature);
              setVertex(null);
            }}
            canMove={{
              forward: reorderFeature(map.features, feature.id, 1) !== map.features,
              back: reorderFeature(map.features, feature.id, -1) !== map.features,
            }}
            onMove={(by) =>
              change({ ...map, features: reorderFeature(map.features, feature.id, by) })
            }
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
