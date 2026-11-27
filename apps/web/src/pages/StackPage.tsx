import type { MapFeature } from "@frontier/schema";
import { useCanWrite } from "../components/projectContext.ts";
import {
  ChevronLeft,
  Layers as LayersIcon,
  Maximize2,
  Minus,
  MousePointer2,
  Orbit,
  Plus,
  Rotate3d,
  Route as RouteIcon,
  MapPin,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Link } from "../nav.tsx";
import { mapUrl } from "../api.ts";
import {
  PageAction,
  usePageTitle,
  usePanel,
  useRightBar,
  useSheetFloor,
} from "../components/shell/panels.tsx";
import { keyOf } from "../components/space/drawStack.ts";
import {
  StackCanvas,
  type StackCanvasApi,
  type StackTool,
} from "../components/space/StackCanvas.tsx";
import { StackCard, StackLayers, type StackShow } from "../components/space/StackPanels.tsx";
import { IconButton, IconLink } from "../components/ui/IconButton.tsx";
import { Tip } from "../components/ui/Tip.tsx";
import { focusIsFree, shortcutText, useScope, useShortcut } from "../keys.ts";
import {
  addPassage,
  linksOf,
  type Place,
  placesOf,
  removePassage,
  removePlace,
  type Spot,
} from "../map/stack.ts";
import { patchFeature } from "../map/starMap.ts";
import { placeMarker } from "../map/tools.ts";
import { useMapStack } from "../map/useMapStack.ts";
import "../components/space/StarMap.css";

/**
 * The layered view (stage 20c): a globe and the globes set to lie under it, as plates one under the
 * other. Each place belongs to its own layer's map and is saved with it; a passage between two
 * layers is held by the upper place. Layers share longitude and latitude, so a line straight down
 * shows what lies above and below any spot.
 */
export function StackPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const stack = useMapStack(id);
  const { order, maps, names } = stack;
  // Editing is for writers: a reader opening `?edit=1` simply reads (stage 31c).
  const canWrite = useCanWrite();
  const [wantsEdit, setEditing] = useState(params.get("edit") === "1");
  const editing = wantsEdit && canWrite;
  const [tool, setTool] = useState<StackTool>("select");
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [show, setShow] = useState<StackShow>({ names: true, passages: true, plumb: true });
  const [spread, setSpread] = useState(5);
  const [top, setTop] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canvas = useRef<StackCanvasApi>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRightBar();
  const phone = useMemo(() => window.matchMedia("(max-width: 47.99rem)").matches, []);

  // The layer opened is the one worked on first.
  const opened = useRef(false);
  useEffect(() => {
    if (order.length && !opened.current) {
      opened.current = true;
      setActive(Math.max(0, order.indexOf(id)));
    }
  }, [order, id]);

  const places = useMemo(() => placesOf(maps, order), [maps, order]);
  const links = useMemo(() => linksOf(places), [places]);
  const titles = useMemo(
    () => Object.fromEntries(order.map((m) => [m, maps[m]?.title ?? ""])),
    [order, maps],
  );
  const nameOf = useCallback(
    (f: MapFeature): string =>
      f.label || (f.entry && names[f.entry]?.title) || stack.pendingNames[f.id] || "Unnamed place",
    [names, stack.pendingNames],
  );
  const place = places.find((p) => keyOf(p) === selected);
  const activeMap = order[active] ? maps[order[active]!] : undefined;

  const chooseTool = (next: StackTool) => {
    setTool(next);
    setFrom(null);
  };
  const startEditing = () => {
    if (canWrite) setEditing(true);
  };
  const stopEditing = () => {
    stack.sendAll();
    setEditing(false);
    chooseTool("select");
    setSelected(null);
    if (params.has("edit")) {
      setParams(
        (p) => {
          p.delete("edit");
          return p;
        },
        { replace: true },
      );
    }
  };
  const put = (spot: Spot) => {
    const mapId = order[active];
    const file = mapId ? maps[mapId] : undefined;
    if (!mapId || !file) return;
    const layer = file.layers.find((l) => !l.parent)?.id ?? file.layers[0]!.id;
    const step = placeMarker(file, layer, spot);
    const next = patchFeature(step.map!, step.selected!, { label: "New place" });
    stack.change({ [mapId]: next });
    setSelected(`${mapId}/${step.selected}`);
  };
  const joinTo = (key: string) => {
    if (!from) {
      setFrom(key);
      return;
    }
    if (key === from) {
      setFrom(null);
      return;
    }
    const a = places.find((p) => keyOf(p) === from);
    const b = places.find((p) => keyOf(p) === key);
    if (!a || !b) return;
    const made = addPassage(maps, a, b);
    if (!made) {
      setNotice("A passage joins two places on different layers, and the same two only once.");
      return;
    }
    stack.change({ [made.map]: made.next });
    setFrom(null);
    setTool("select");
    setSelected(key);
  };
  const removeSelected = () => {
    if (!place) return;
    stack.change(removePlace(maps, place));
    setSelected(null);
  };
  const edit = (fields: Record<string, unknown>) => {
    if (!place) return;
    const file = maps[place.map];
    if (file) stack.change({ [place.map]: patchFeature(file, place.feature.id, fields) });
  };

  // ---- Panels --------------------------------------------------------------------------------

  const showPanel = bar.show;
  const fromLayers = useRef(false);
  const showsFeature = place !== undefined;
  useEffect(() => {
    if (showsFeature && !fromLayers.current) showPanel("feature");
    fromLayers.current = false;
  }, [selected, showsFeature, showPanel]);
  const chooseFromList = (key: string) => {
    fromLayers.current = true;
    const found = places.find((p) => keyOf(p) === key);
    if (found) setActive(found.layer);
    setSelected(key);
  };
  const toggleHidden = (mapId: string, hide: boolean) => {
    const next = new Set(hidden);
    if (hide) next.add(mapId);
    else next.delete(mapId);
    setHidden(next);
  };
  usePanel(
    order.length
      ? {
          id: "layers",
          title: "Layers",
          icon: LayersIcon,
          render: () => (
            <StackLayers
              order={order}
              maps={maps}
              active={active}
              onActive={setActive}
              hidden={hidden}
              onHidden={toggleHidden}
              spread={spread}
              onSpread={setSpread}
              show={show}
              onShow={setShow}
              places={places}
              nameOf={nameOf}
              selected={selected}
              onSelect={chooseFromList}
            />
          ),
        }
      : null,
  );
  usePanel(
    place
      ? {
          id: "feature",
          title: editing ? "Edit feature" : "Selected",
          icon: MapPin,
          render: () => (
            <StackCard
              place={place}
              places={places}
              links={links}
              maps={maps}
              names={names}
              nameOf={nameOf}
              editing={editing}
              onSelect={chooseFromList}
              onUnlink={(other: Place) => stack.change(removePassage(maps, place, other))}
              onFieldChange={edit}
              onLink={(path, title) => stack.link(place.map, place.feature, path, title)}
              onRemove={removeSelected}
            />
          ),
        }
      : null,
  );
  const title =
    order[0] && maps[order[0]] ? `${maps[order[0]]!.title} and what lies under it` : "Layers";
  usePageTitle(title);
  useSheetFloor(frame, "bottom", order.length > 0);

  // ---- Keys ----------------------------------------------------------------------------------

  useScope("map");
  const free = () =>
    focusIsFree(document.activeElement, frame.current) ||
    frame.current?.contains(document.activeElement) === true;
  useShortcut("map.edit", () => (editing ? false : startEditing()));
  useShortcut("map.done", () => (editing ? stopEditing() : false));
  useShortcut("map.select", () => (editing ? chooseTool("select") : false));
  useShortcut("map.marker", () => (editing ? chooseTool("marker") : false));
  useShortcut("map.path", () => (editing ? chooseTool("passage") : false));
  useShortcut("map.delete", () => (editing && free() && place ? removeSelected() : false));
  useShortcut("map.cancel", () => {
    if (from) return setFrom(null);
    if (editing && tool !== "select") return chooseTool("select");
    if (selected) return setSelected(null);
    return false;
  });
  useShortcut("map.zoomIn", () => canvas.current?.zoomBy(1.4));
  useShortcut("map.zoomOut", () => canvas.current?.zoomBy(1 / 1.4));
  useShortcut("map.fit", () => canvas.current?.whole());
  useShortcut("map.layers", () => bar.toggle("layers"));

  if (stack.error) {
    return (
      <div className="center">
        <p className="error">{stack.error}</p>
        <Link to="/maps">All maps</Link>
      </div>
    );
  }
  if (!order.length) return <p className="muted">Loading…</p>;

  let hint: ReactNode = null;
  if (editing && tool === "marker")
    hint = `Click ${activeMap?.title ?? "the layer"} to place a marker there.`;
  if (editing && tool === "passage") {
    hint = from
      ? "Now click the place on another layer where the passage comes out."
      : "Click the place where the passage starts.";
  }
  return (
    <div className="map-page star-page stack-page">
      <div className="map-bar">
        <IconLink
          to={mapUrl(id)}
          className="map-back"
          label={`Back to ${maps[id]?.title ?? "the map"}`}
          icon={ChevronLeft}
        />
        <h1 className="map-title">{title}</h1>
        <span className="chip">Layers stacked</span>
        <span className="map-actions">
          <IconButton
            label="Layers"
            icon={LayersIcon}
            shortcut="map.layers"
            showLabel
            className="quiet"
            aria-pressed={bar.open === "layers"}
            onClick={() => bar.toggle("layers")}
          />
        </span>
        <span className="map-main">
          {canWrite && (
            <PageAction>
              <Tip
                label={editing ? "Done editing" : "Edit the places and passages"}
                keys={shortcutText(editing ? "map.done" : "map.edit")}
              >
                <button
                  type="button"
                  className={editing ? "primary" : "quiet"}
                  onClick={editing ? stopEditing : startEditing}
                >
                  {editing ? "Done" : "Edit"}
                </button>
              </Tip>
            </PageAction>
          )}
        </span>
      </div>

      {editing && (
        <div className="map-tools" role="toolbar" aria-label="Map tools">
          <IconButton
            label="Select"
            icon={MousePointer2}
            shortcut="map.select"
            showLabel
            aria-pressed={tool === "select"}
            onClick={() => chooseTool("select")}
          />
          <IconButton
            label="Marker"
            icon={Orbit}
            shortcut="map.marker"
            showLabel
            aria-pressed={tool === "marker"}
            onClick={() => chooseTool("marker")}
          />
          <IconButton
            label="Passage"
            icon={RouteIcon}
            shortcut="map.path"
            showLabel
            aria-pressed={tool === "passage"}
            onClick={() => chooseTool("passage")}
          />
          <span className="edit-toolbar-gap" />
          <span className="muted map-tools-note">Markers go on {activeMap?.title}.</span>
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

      <div className="map-frame star-frame" ref={frame}>
        <StackCanvas
          api={canvas}
          order={order}
          maps={maps}
          titles={titles}
          spread={spread}
          active={active}
          onActive={setActive}
          nameOf={nameOf}
          places={places}
          links={links}
          selected={selected}
          onSelect={setSelected}
          hidden={hidden}
          show={show}
          editing={editing}
          tool={tool}
          onPlace={put}
          from={from}
          onPassage={joinTo}
          onTop={setTop}
          phone={phone}
        />
        {hint && (
          <p className="map-hint" role="status">
            {hint}
          </p>
        )}
        <div className="map-zoom">
          <IconButton
            label="Zoom in"
            icon={Plus}
            shortcut="map.zoomIn"
            tipSide="left"
            onClick={() => canvas.current?.zoomBy(1.4)}
          />
          <IconButton
            label="Zoom out"
            icon={Minus}
            shortcut="map.zoomOut"
            tipSide="left"
            onClick={() => canvas.current?.zoomBy(1 / 1.4)}
          />
          <IconButton
            label={top ? "Tilt the view" : "Look from above"}
            icon={Rotate3d}
            tipSide="left"
            aria-pressed={top}
            onClick={() => canvas.current?.toggleTop()}
          />
          <IconButton
            label="Show the whole stack"
            icon={Maximize2}
            shortcut="map.fit"
            tipSide="left"
            onClick={() => canvas.current?.whole()}
          />
        </div>
      </div>
    </div>
  );
}
