import type { MapFeature } from "@frontier/schema";
import { useCanWrite } from "../components/projectContext.ts";
import {
  ChevronLeft,
  Layers as LayersIcon,
  Maximize2,
  Minus,
  MousePointer2,
  Orbit,
  Pause,
  Play,
  Plus,
  Redo2,
  Rotate3d,
  Trash2,
  Undo2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Link } from "../nav.tsx";
import { OfflineCopy } from "../components/OfflineCopy.tsx";
import {
  PageAction,
  usePageTitle,
  usePanel,
  useRightBar,
  useSheetFloor,
} from "../components/shell/panels.tsx";
import type { Look } from "../components/space/drawSystem.ts";
import {
  SystemCanvas,
  type SystemCanvasApi,
  type SystemTool,
} from "../components/space/SystemCanvas.tsx";
import {
  AddPicker,
  SystemCard,
  SystemEdit,
  SystemObjects,
  type SystemShow,
} from "../components/space/SystemPanels.tsx";
import { IconButton, IconLink } from "../components/ui/IconButton.tsx";
import { Menu, MenuItem } from "../components/ui/Menu.tsx";
import { SaveStatus } from "../components/ui/SaveStatus.tsx";
import { Tip } from "../components/ui/Tip.tsx";
import { focusIsFree, shortcutText, useScope, useShortcut } from "../keys.ts";
import {
  ADDABLE,
  type BodyType,
  PRESETS,
  type Scale,
  yearLength,
  yearWords,
} from "../map/orbits.ts";
import {
  addBody,
  type BodyFeature,
  bodiesOf,
  bodyFeatures,
  colourOf,
  firstStar,
  hasBody,
  hasPair,
  removeBody,
} from "../map/systemMap.ts";
import { type Placement } from "../map/systemMap.ts";
import { useMapFile } from "../map/useMapFile.ts";
import { queue } from "../sync/queue.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import "../components/space/StarMap.css";

/** How far time may be played or dragged, in years. */
const YEARS = 100;
/** Days a second at each speed. */
const SPEEDS = [
  ["1 day a second", "Day / s", 1],
  ["1 month a second", "Month / s", 30],
  ["1 year a second", "Year / s", 365.25],
  ["10 years a second", "Decade / s", 3652.5],
] as const;

/**
 * A system model (stage 20b): a star and what circles it, on fixed orbits that move as time plays.
 * It keeps the map page's bar, side-bar tabs, save queue and keys; the canvas is its own.
 */
export function SystemMapPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  // Editing is for writers: a reader opening `?edit=1` simply reads (stage 27c).
  const canWrite = useCanWrite();
  const [wantsEdit, setEditing] = useState(params.get("edit") === "1");
  const editing = wantsEdit && canWrite;
  const [tool, setTool] = useState<SystemTool>("select");
  const [adding, setAdding] = useState<BodyType | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  const [show, setShow] = useState<SystemShow>({ names: true, orbits: true, zone: false });
  const [scale, setScale] = useState<Scale>("schematic");
  const [tilted, setTilted] = useState(true);
  const canvas = useRef<SystemCanvasApi>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRightBar();
  const offline = useNeedsConnection();
  const phone = useMemo(() => window.matchMedia("(max-width: 47.99rem)").matches, []);

  // Time: the day is read by the canvas every frame; the page hears of it a few times a second.
  const dayRef = useRef(0);
  const [day, setDayState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(30);
  const setDay = (d: number) => {
    dayRef.current = Math.max(0, d);
    setDayState(dayRef.current);
  };

  const yearRef = useRef<number | null>(null);
  const noTime = useMemo(
    () => ({ yearRef, setYear: () => undefined, setPin: () => undefined }),
    [],
  );
  const file = useMapFile(id, {
    time: noTime,
    setNotice,
    onOpen: () => setSelected(null),
    onLoaded: () => undefined,
  });
  const { map, change } = file;

  const bodies = useMemo(() => (map ? bodiesOf(map) : []), [map]);
  const length = yearLength(bodies);
  const nameOf = useCallback(
    (f: MapFeature): string =>
      f.label || (f.entry && file.names[f.entry]?.title) || file.pendingNames[f.id] || "Unnamed",
    [file.names, file.pendingNames],
  );
  const looks = useMemo(() => {
    const m = new Map<string, Look>();
    if (map)
      for (const f of bodyFeatures(map)) m.set(f.id, { name: nameOf(f), colour: colourOf(f) });
    return m;
  }, [map, nameOf]);
  const feature = map?.features.find((f) => f.id === selected && hasBody(f)) as
    BodyFeature | undefined;
  const home = bodies.find((b) => b.home);

  // Playing: stops by itself at the end of the range, and when editing begins.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let heard = last;
    let frameId = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = dayRef.current + speed * dt;
      const end = YEARS * length;
      if (next >= end) {
        dayRef.current = end;
        setDayState(end);
        setPlaying(false);
        return;
      }
      dayRef.current = next;
      if (now - heard > 250) {
        heard = now;
        setDayState(next);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, speed, length]);

  // ---- Editing -------------------------------------------------------------------------------

  const layer = map?.layers[0]?.id ?? "";
  const chooseTool = (next: SystemTool) => {
    setTool(next);
    setAdding(null);
  };
  const startEditing = () => {
    if (!canWrite) return;
    setPlaying(false);
    setEditing(true);
  };
  const stopEditing = () => {
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
  const pick = (kind: BodyType) => {
    if (!map) return;
    if (kind === "companion") {
      const star = bodies.find((b) => b.type === "star");
      if (!star) return;
      const r = addBody(map, layer, "companion", null, 0.3, 0.5, dayRef.current);
      change(r.map);
      setSelected(r.id);
      chooseTool("select");
      setNotice("The two stars now circle each other. The planets circle both.");
      return;
    }
    setAdding(kind);
  };
  const place = (type: BodyType, at: Placement) => {
    if (!map) return;
    const r = addBody(map, layer, type, at.parent, at.a, at.angle, dayRef.current);
    change(r.map);
    setSelected(r.id);
    chooseTool("select");
  };
  const removeSelected = () => {
    if (!map || !selected) return;
    const target = bodies.find((b) => b.id === selected);
    if (target?.type === "star") {
      setNotice("A system keeps its first star.");
      return;
    }
    change(removeBody(map, selected));
    setSelected(null);
  };

  // ---- Panels --------------------------------------------------------------------------------

  const showPanel = bar.show;
  const fromList = useRef(false);
  const showsFeature = feature !== undefined;
  useEffect(() => {
    if (showsFeature && !fromList.current) showPanel("feature");
    fromList.current = false;
  }, [selected, showsFeature, showPanel]);
  const chooseFromList = (next: string) => {
    fromList.current = true;
    setSelected(next);
  };
  usePanel(
    map
      ? {
          id: "layers",
          title: "Objects",
          icon: LayersIcon,
          render: () => (
            <SystemObjects
              bodies={bodies}
              looks={looks}
              editing={editing}
              selected={selected}
              onSelect={chooseFromList}
              show={show}
              onShow={setShow}
              scale={scale}
              onScale={setScale}
              onAdd={() => chooseTool("add")}
              home={home}
            />
          ),
        }
      : null,
  );
  usePanel(
    map && feature
      ? {
          id: "feature",
          title: editing ? "Edit object" : "Selected",
          icon: Orbit,
          render: () =>
            editing ? (
              <SystemEdit
                map={map}
                bodies={bodies}
                feature={feature}
                looks={looks}
                names={file.names}
                otherMaps={file.otherMaps}
                day={day}
                onChange={change}
                onLink={(path, title) => file.link(feature as MapFeature, path, title)}
                onRemove={removeSelected}
              />
            ) : (
              <SystemCard
                bodies={bodies}
                feature={feature}
                looks={looks}
                names={file.names}
                childTitles={file.children}
                day={day}
                onFollow={() => canvas.current?.follow(feature.id)}
              />
            ),
        }
      : null,
  );
  usePageTitle(map?.title ?? "System model");
  useSheetFloor(frame, "bottom", map !== null);

  // ---- Keys ----------------------------------------------------------------------------------

  useScope("map");
  const free = () =>
    focusIsFree(document.activeElement, frame.current) ||
    frame.current?.contains(document.activeElement) === true;
  useShortcut("map.edit", () => (editing ? false : startEditing()));
  useShortcut("map.done", () => (editing ? stopEditing() : false));
  useShortcut("map.select", () => (editing ? chooseTool("select") : false));
  useShortcut("map.marker", () => (editing ? chooseTool("add") : false));
  useShortcut("map.undo", () =>
    editing && free() && file.history.past.length ? file.undo() : false,
  );
  useShortcut("map.redo", () =>
    editing && free() && file.history.future.length ? file.redo() : false,
  );
  useShortcut("map.delete", () => (editing && free() && selected ? removeSelected() : false));
  useShortcut("map.cancel", () => {
    if (adding) return setAdding(null);
    if (editing && tool !== "select") return chooseTool("select");
    if (followed) return canvas.current?.whole();
    if (selected) return setSelected(null);
    return false;
  });
  useShortcut("map.zoomIn", () => canvas.current?.zoomBy(1.4));
  useShortcut("map.zoomOut", () => canvas.current?.zoomBy(1 / 1.4));
  useShortcut("map.fit", () => canvas.current?.whole());
  useShortcut("map.layers", () => bar.toggle("layers"));
  useShortcut("map.time", () => (editing ? false : setPlaying((p) => !p)));

  if (file.error) {
    return (
      <div className="center">
        <p className="error">{file.error}</p>
        <Link to="/maps">All maps</Link>
      </div>
    );
  }
  if (!map) return <p className="muted">Loading…</p>;
  if (map.space.kind !== "system") return <p className="error">This is not a system model.</p>;

  let hint: ReactNode = null;
  if (editing && tool === "add" && adding) {
    hint = PRESETS[adding].local
      ? "Point near the planet it circles, then click."
      : "Move out from the centre to set the distance, then click.";
  } else if (editing && tool === "add") {
    hint = null;
  }
  const hasStar = bodies.some((b) => b.type === "star");

  return (
    <div className="map-page star-page system-page">
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
          <SystemFind
            names={bodies.map((b) => ({ id: b.id, name: looks.get(b.id)?.name ?? "" }))}
            onFind={(bid) => {
              setSelected(bid);
              const b = bodies.find((x) => x.id === bid);
              if (b && b.type !== "belt") canvas.current?.follow(bid);
            }}
          />
          <IconButton
            label="Objects"
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
            label="Add object"
            icon={Plus}
            shortcut="map.marker"
            showLabel
            aria-pressed={tool === "add"}
            onClick={() => chooseTool("add")}
          />
          <span className="edit-toolbar-gap" />
          <span className="muted map-tools-note">Drag an object to change its orbit.</span>
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
        <SystemCanvas
          api={canvas}
          map={map}
          bodies={bodies}
          looks={looks}
          dayRef={dayRef}
          playing={playing}
          scale={scale}
          show={show}
          editing={editing}
          tool={tool}
          adding={adding}
          selected={selected}
          followed={followed}
          onSelect={setSelected}
          onBegin={() => {
            setPlaying(false);
            file.beginStep();
          }}
          onChange={change}
          onPlace={place}
          onFollow={setFollowed}
          onTilt={setTilted}
          phone={phone}
        />
        {hint && (
          <p className="map-hint" role="status">
            {hint}
          </p>
        )}
        {editing && tool === "add" && !adding && (
          <AddPicker kinds={ADDABLE} hasPair={hasPair(map)} onPick={pick} />
        )}
        {!hasStar && (
          <div className="star-empty">
            <h2>A system starts with its star</h2>
            <p>Add the worlds that circle it. Each gets its orbit from how far out you put it.</p>
            {canWrite && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  change(firstStar(map, layer));
                  startEditing();
                }}
              >
                Add the star
              </button>
            )}
          </div>
        )}
        {hasStar && bodies.length === 1 && !editing && (
          <div className="star-empty">
            <h2>Only the star so far</h2>
            <p>Add the worlds that circle it. Each gets its orbit from how far out you put it.</p>
            {canWrite && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  startEditing();
                  chooseTool("add");
                }}
              >
                Add a planet
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
            label={tilted ? "Look from above" : "Tilt the view"}
            icon={Rotate3d}
            tipSide="left"
            aria-pressed={!tilted}
            onClick={() => canvas.current?.toggleTilt()}
          />
          <IconButton
            label="Show the whole system"
            icon={Maximize2}
            shortcut="map.fit"
            tipSide="left"
            onClick={() => canvas.current?.whole()}
          />
        </div>
      </div>

      <div className="time-bar system-time">
        <div className="time-row">
          <IconButton
            label={playing ? "Pause" : "Play"}
            icon={playing ? Pause : Play}
            shortcut="map.time"
            disabled={editing}
            disabledReason="Finish editing to play time"
            className={playing ? "playing" : ""}
            onClick={() => setPlaying(!playing)}
          />
          <input
            type="range"
            aria-label="Year shown"
            min={0}
            max={YEARS}
            step={0.01}
            value={day / length}
            onChange={(e) => setDay(Number(e.target.value) * length)}
          />
          <span className="time-year" aria-live="off">
            {yearWords(day, bodies)}
          </span>
          <select
            aria-label="Speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map(([long, short, v]) => (
              <option key={v} value={v}>
                {phone ? short : long}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** "Find an object": a typed name flies to it. */
function SystemFind({
  names,
  onFind,
}: {
  names: { id: string; name: string }[];
  onFind: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const go = (name: string, exact: boolean) => {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return;
    const hit = names.find((n) =>
      exact ? n.name.toLowerCase() === wanted : n.name.toLowerCase().includes(wanted),
    );
    if (hit) {
      onFind(hit.id);
      setText("");
    }
  };
  return (
    <span className="star-find">
      <input
        type="search"
        list="system-names"
        placeholder="Find an object"
        aria-label="Find an object"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          go(e.target.value, true);
        }}
        onKeyDown={(e) => e.key === "Enter" && go(text, false)}
      />
      <datalist id="system-names">
        {names.map((n) => (
          <option key={n.id} value={n.name} />
        ))}
      </datalist>
    </span>
  );
}
