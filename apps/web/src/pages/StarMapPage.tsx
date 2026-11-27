import { type MapFeature } from "@frontier/schema";
import { useCanWrite } from "../components/projectContext.ts";
import {
  ChevronLeft,
  Layers as LayersIcon,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Rotate3d,
  Route as RouteIcon,
  Sparkles,
  Star as StarIcon,
  Trash2,
  Undo2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Link } from "../nav.tsx";
import { OfflineCopy } from "../components/OfflineCopy.tsx";
import { type StarCanvasApi, StarCanvas, type StarTool } from "../components/space/StarCanvas.tsx";
import { StarCard, StarEdit, StarLayers } from "../components/space/StarPanels.tsx";
import {
  PageAction,
  usePageTitle,
  usePanel,
  useRightBar,
  useSheetFloor,
} from "../components/shell/panels.tsx";
import { IconButton, IconLink } from "../components/ui/IconButton.tsx";
import { Menu, MenuItem } from "../components/ui/Menu.tsx";
import { SaveStatus } from "../components/ui/SaveStatus.tsx";
import { Tip } from "../components/ui/Tip.tsx";
import { focusIsFree, shortcutText, useScope, useShortcut } from "../keys.ts";
import {
  addRoute,
  addStar,
  isRoute,
  isStar,
  type Route,
  removeFeature,
  type Star,
  stars,
} from "../map/starMap.ts";
import { useMapFile } from "../map/useMapFile.ts";
import { queue } from "../sync/queue.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import "../components/space/StarMap.css";

const TURN = 0.18;

/**
 * A star map (stage 20): stars in open space, drawn as light dots or pins over a plane, with
 * routes between them. It keeps the map page's bar, side-bar tabs, save queue and keys, and has
 * its own canvas, since places have three numbers and no image.
 */
export function StarMapPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  // Editing is for writers: a reader opening `?edit=1` simply reads (stage 27c).
  const canWrite = useCanWrite();
  const [wantsEdit, setEditing] = useState(params.get("edit") === "1");
  const editing = wantsEdit && canWrite;
  const [tool, setTool] = useState<StarTool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [show, setShow] = useState({ names: true, drops: true, rings: true });
  const [draft, setDraft] = useState<string[] | null>(null);
  const [activeLayer, setActiveLayer] = useState("");
  const [top, setTop] = useState(false);
  const canvas = useRef<StarCanvasApi>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRightBar();
  const offline = useNeedsConnection();
  const phone = useMemo(() => window.matchMedia("(max-width: 47.99rem)").matches, []);

  // The map has no time: the file hook is given a year that is never set.
  const yearRef = useRef<number | null>(null);
  const noTime = useMemo(
    () => ({ yearRef, setYear: () => undefined, setPin: () => undefined }),
    [],
  );
  const file = useMapFile(id, {
    time: noTime,
    setNotice,
    onOpen: () => setSelected(null),
    onLoaded: (loaded) => {
      setActiveLayer(loaded.layers.find((l) => l.look !== "pin")?.id ?? loaded.layers[0]!.id);
      setHidden(new Set(loaded.layers.filter((l) => !l.visible).map((l) => l.id)));
    },
  });
  const { map, change } = file;

  const nameOf = useCallback(
    (f: Star | Route): string =>
      f.label ||
      (f.entry && file.names[f.entry]?.title) ||
      file.pendingNames[f.id] ||
      (f.kind === "route" ? "A route" : "Unnamed star"),
    [file.names, file.pendingNames],
  );

  const feature = map?.features.find((f) => f.id === selected && (isStar(f) || isRoute(f))) as
    Star | Route | undefined;

  // ---- Editing -------------------------------------------------------------------------------

  const chooseTool = (next: StarTool) => {
    setTool(next);
    setDraft(null);
  };
  const startEditing = () => {
    if (canWrite) setEditing(true);
  };
  const stopEditing = () => {
    // Sent at once, so the map is on the server when the author leaves; the address stops asking
    // for editing, so a page read again opens in viewing.
    void queue.sendNow(file.key);
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
  const place = (x: number, y: number) => {
    if (!map) return;
    const r = addStar(map, activeLayer || map.layers[0]!.id, x, y);
    change(r.map);
    setSelected(r.id);
  };
  const finishRoute = () => {
    if (!map || !draft) return;
    const r = addRoute(map, activeLayer || map.layers[0]!.id, draft);
    setDraft(null);
    if (!r) {
      setNotice("A route needs at least two different stars.");
      return;
    }
    change(r.map);
    setSelected(r.id);
    setTool("select");
  };
  const removeSelected = () => {
    if (!map || !selected) return;
    change(removeFeature(map, selected));
    setSelected(null);
  };

  // ---- Panels --------------------------------------------------------------------------------

  const flyToSelected = () => selected && canvas.current?.flyTo(selected);
  const select = (next: string | null) => setSelected(next);
  // A star chosen on the map opens its tab; one chosen in the Layers tab leaves that open.
  const showPanel = bar.show;
  const fromLayers = useRef(false);
  const showsFeature = feature !== undefined;
  useEffect(() => {
    if (showsFeature && !fromLayers.current) showPanel("feature");
    fromLayers.current = false;
  }, [selected, showsFeature, showPanel]);
  const fromList = (next: string) => {
    fromLayers.current = true;
    setSelected(next);
    if (map?.features.find((f) => f.id === next)?.kind === "marker") canvas.current?.flyTo(next);
  };
  usePanel(
    map
      ? {
          id: "layers",
          title: "Layers",
          icon: LayersIcon,
          render: () => (
            <StarLayers
              map={map}
              nameOf={nameOf}
              editing={editing}
              hidden={hidden}
              onHidden={(layer, hide) => {
                const next = new Set(hidden);
                if (hide) next.add(layer);
                else next.delete(layer);
                setHidden(next);
              }}
              show={show}
              onShow={setShow}
              selected={selected}
              onSelect={fromList}
              onChange={change}
            />
          ),
        }
      : null,
  );
  usePanel(
    map && feature
      ? {
          id: "feature",
          title: editing ? "Edit feature" : "Selected",
          icon: StarIcon,
          render: () =>
            editing ? (
              <StarEdit
                map={map}
                feature={feature}
                names={file.names}
                otherMaps={file.otherMaps}
                nameOf={nameOf}
                onChange={change}
                onLink={(path, title) => file.link(feature as MapFeature, path, title)}
                onRemove={removeSelected}
              />
            ) : (
              <StarCard
                map={map}
                feature={feature}
                names={file.names}
                childTitles={file.children}
                nameOf={nameOf}
                onFly={flyToSelected}
                onSelect={fromList}
              />
            ),
        }
      : null,
  );
  usePageTitle(map?.title ?? "Star map");
  useSheetFloor(frame, "bottom", map !== null);

  // ---- Keys ----------------------------------------------------------------------------------

  useScope("map");
  const lastKey = useRef("");
  useEffect(() => {
    const hear = (e: KeyboardEvent) => (lastKey.current = e.key);
    document.addEventListener("keydown", hear, { capture: true });
    return () => document.removeEventListener("keydown", hear, { capture: true });
  }, []);
  // The canvas inside the frame holds the focus once it is pressed: that is the map's own focus.
  const free = () =>
    focusIsFree(document.activeElement, frame.current) ||
    frame.current?.contains(document.activeElement) === true;
  useShortcut("map.edit", () => (editing ? false : startEditing()));
  useShortcut("map.done", () => (editing ? stopEditing() : false));
  useShortcut("map.select", () => (editing ? chooseTool("select") : false));
  useShortcut("map.marker", () => (editing ? chooseTool("marker") : false));
  useShortcut("map.path", () => (editing ? chooseTool("route") : false));
  useShortcut("map.undo", () =>
    editing && free() && file.history.past.length ? file.undo() : false,
  );
  useShortcut("map.redo", () =>
    editing && free() && file.history.future.length ? file.redo() : false,
  );
  useShortcut("map.delete", () => {
    if (!editing || !free()) return false;
    if (draft) return setDraft(draft.length > 1 ? draft.slice(0, -1) : null);
    return selected ? removeSelected() : false;
  });
  useShortcut("map.finish", () => (editing && free() && draft ? finishRoute() : false));
  useShortcut("map.cancel", () => {
    if (draft) return setDraft(null);
    if (editing && tool !== "select") return chooseTool("select");
    if (selected) return setSelected(null);
    return false;
  });
  useShortcut("map.zoomIn", () => canvas.current?.zoomBy(1.4));
  useShortcut("map.zoomOut", () => canvas.current?.zoomBy(1 / 1.4));
  useShortcut("map.fit", () => canvas.current?.whole());
  useShortcut("map.layers", () => bar.toggle("layers"));
  // The arrows turn the view: left and right about the stars, up and down tilting it.
  useShortcut("map.pan", () => {
    if (!free()) return false;
    const k = lastKey.current;
    if (k === "ArrowLeft") canvas.current?.turn(-TURN, 0);
    else if (k === "ArrowRight") canvas.current?.turn(TURN, 0);
    else if (k === "ArrowUp") canvas.current?.turn(0, 0.1);
    else if (k === "ArrowDown") canvas.current?.turn(0, -0.1);
    else return false;
  });

  if (file.error) {
    return (
      <div className="center">
        <p className="error">{file.error}</p>
        <Link to="/maps">All maps</Link>
      </div>
    );
  }
  if (!map) return <p className="muted">Loading…</p>;
  if (map.space.kind !== "stars") return <p className="error">This is not a star map.</p>;

  // ---- What is drawn -------------------------------------------------------------------------

  const layerName = map.layers.find((l) => l.id === activeLayer)?.name ?? "";
  let hint: ReactNode = null;
  if (editing && tool === "marker") {
    hint = <>Click the plane to place a star in {layerName}, then drag its ↕ handle to lift it.</>;
  } else if (editing && tool === "route") {
    hint = draft?.length ? (
      <>
        {draft.length} {draft.length === 1 ? "stop" : "stops"}. Click the next star.{" "}
        <button type="button" className="primary" onClick={finishRoute} disabled={draft.length < 2}>
          Finish route
        </button>
      </>
    ) : (
      "Click the first star of the route."
    );
  }
  const empty = stars(map).length === 0;

  return (
    <div className="map-page star-page">
      <div className="map-bar">
        <IconLink to="/maps" className="map-back" label="All maps" icon={ChevronLeft} />
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
        {editing && <SaveStatus state={file.saving.state} />}
        <span className="map-actions">
          <StarFind
            names={stars(map).map((s) => ({ id: s.id, name: nameOf(s) }))}
            onFind={(sid) => {
              select(sid);
              canvas.current?.flyTo(sid);
            }}
          />
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
                label={editing ? "Done editing" : "Edit the map"}
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
          {canWrite && (
            <Menu label="More actions" className="map-more">
              <MenuItem
                icon={Trash2}
                danger
                disabled={offline !== undefined}
                disabledReason={offline}
                onSelect={() => void file.removeMap()}
              >
                Delete map
              </MenuItem>
            </Menu>
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
            label="Star"
            icon={Sparkles}
            shortcut="map.marker"
            showLabel
            aria-pressed={tool === "marker"}
            onClick={() => chooseTool("marker")}
          />
          <IconButton
            label="Route"
            icon={RouteIcon}
            shortcut="map.path"
            showLabel
            aria-pressed={tool === "route"}
            onClick={() => chooseTool("route")}
          />
          <span className="edit-toolbar-gap" />
          {tool === "marker" && map.layers.length > 1 && (
            <label className="star-into">
              <span className="muted">New stars go in</span>
              <select value={activeLayer} onChange={(e) => setActiveLayer(e.target.value)}>
                {map.layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <IconButton
            label="Undo"
            icon={Undo2}
            shortcut="map.undo"
            disabled={file.history.past.length === 0}
            onClick={file.undo}
          />
          <IconButton
            label="Redo"
            icon={Redo2}
            shortcut="map.redo"
            disabled={file.history.future.length === 0}
            onClick={file.redo}
          />
        </div>
      )}

      <OfflineCopy at={file.offlineAt} className="map-offline" />
      {notice && (
        <p className="banner map-notice" role="status">
          {notice}{" "}
          <button type="button" className="plain" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="map-frame star-frame" ref={frame}>
        <StarCanvas
          api={canvas}
          map={map}
          nameOf={nameOf}
          hiddenLayers={hidden}
          show={show}
          editing={editing}
          tool={tool}
          selected={selected}
          onSelect={select}
          onBegin={file.beginStep}
          onChange={change}
          onPlace={place}
          draft={draft}
          onDraft={setDraft}
          onFinishRoute={finishRoute}
          onTop={setTop}
          phone={phone}
        />
        {hint && (
          <p className="map-hint" role="status">
            {hint}
          </p>
        )}
        {empty && !editing && (
          <div className="star-empty">
            <h2>This star map is empty</h2>
            <p>
              Place stars on the plane, lift them above or below it, then join them with routes.
            </p>
            {canWrite && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  startEditing();
                  chooseTool("marker");
                }}
              >
                Place the first star
              </button>
            )}
          </div>
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
            label="Show the whole map"
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

/** "Find a star": a typed name flies to it, since a small dot is hard to spot. */
function StarFind({
  names,
  onFind,
}: {
  names: { id: string; name: string }[];
  onFind: (id: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <span className="star-find">
      <input
        type="search"
        list="star-names"
        placeholder="Find a star"
        aria-label="Find a star"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const exact = names.find(
            (n) => n.name.toLowerCase() === e.target.value.trim().toLowerCase(),
          );
          if (exact) {
            onFind(exact.id);
            setText("");
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const hit = names.find((n) => n.name.toLowerCase().includes(text.trim().toLowerCase()));
          if (hit && text.trim()) {
            onFind(hit.id);
            setText("");
          }
        }}
      />
      <datalist id="star-names">
        {names.map((n) => (
          <option key={n.id} value={n.name} />
        ))}
      </datalist>
    </span>
  );
}
