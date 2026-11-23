import { initialView, measure, type Position, turnTo } from "@frontier/geo";
import { MapPin, Layers as LayersIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useDialogs } from "../components/Dialogs.tsx";
import { DiscoveryPins, OpenDiscovery } from "../components/map/DiscoveryPins.tsx";
import { FeaturePanel } from "../components/map/FeaturePanel.tsx";
import { LayerPanel } from "../components/map/LayerPanel.tsx";
import { MapBar } from "../components/map/MapBar.tsx";
import { FocusBox, MapHints } from "../components/map/MapHints.tsx";
import { MapSetup } from "../components/map/MapSetup.tsx";
import { MapTools } from "../components/map/MapTools.tsx";
import { MapZoom } from "../components/map/MapZoom.tsx";
import { TimeBar } from "../components/MapTime.tsx";
import { TurnPanel } from "../components/MapTurn.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { usePageTitle, usePanel, useRightBar, useSheetFloor } from "../components/shell/panels.tsx";
import { askSize } from "../map/askSize.ts";
import { aboveAndBelow } from "../map/layersBeneath.ts";
import { savePicture } from "../map/savePicture.ts";
import { finishSketch, type Step, type Tool } from "../map/tools.ts";
import { useDiscovery } from "../map/useDiscovery.ts";
import { useMapDraw } from "../map/useMapDraw.ts";
import { useMapFile } from "../map/useMapFile.ts";
import { useMapKeys } from "../map/useMapKeys.ts";
import { useMapTime, useShownAt } from "../map/useMapTime.ts";
import { openingShown, useMapView, useWheelZoom } from "../map/useMapView.ts";
import { usePointer } from "../map/usePointer.ts";
import { queue } from "../sync/queue.ts";

export function MapPage() {
  const dialogs = useDialogs();
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const refresh = useRefresh();

  const [notice, setNotice] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shownImages, setShownImages] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [vertex, setVertex] = useState<number | null>(null);
  const [sketch, setSketch] = useState<Position[]>([]);
  const [activeLayer, setActiveLayer] = useState("");
  // Layers and the selected feature are panels of the side bar, beside the map, not over it.
  const bar = useRightBar();
  // Projections: the panel of the turn's three angles, and marking a box to focus on.
  const [turning, setTurning] = useState(false);
  const [focusing, setFocusing] = useState(false);

  const time = useMapTime(id, params, setNotice);
  const file = useMapFile(id, {
    time,
    setNotice,
    onOpen: () => setSelected(null),
    onLoaded: (loaded) => {
      setActiveLayer(loaded.layers[0]!.id);
      const opening = openingShown(loaded, params);
      setHidden(opening.hidden);
      setShownImages(opening.images);
    },
  });
  const { map, change } = file;
  const shown = useShownAt(map, time, { selected, editing, hidden });
  const { onScreen } = shown;
  // A picked corner lasts while its shape stays on screen.
  useEffect(() => setVertex(null), [onScreen?.shape]);
  const { view, setView, viewRef, size, frame, goLayer, zoom } = useMapView(map, {
    params,
    setParams,
    editing,
    time,
    hidden,
    shownImages,
    onWanted: setSelected,
  });
  const draw = useMapDraw(map, {
    ...shown,
    view,
    size,
    hidden,
    shownImages,
    selected,
    vertex,
    sketch,
    tool,
    editing,
    names: file.names,
    pendingNames: file.pendingNames,
    sets: file.sets,
  });
  const { titleOf } = draw;
  const discovery = useDiscovery(id, { ...time, setNotice });
  const { found, openFound, setOpenFound } = discovery;

  /** Sets what a tool's step changes. */
  const apply = (step: Step) => {
    if (step.map) change(step.map);
    if (step.selected !== undefined) setSelected(step.selected);
    if (step.vertex !== undefined) setVertex(step.vertex);
    if (step.sketch) setSketch(step.sketch);
    if (step.tool) setTool(step.tool);
  };
  const pointer = usePointer({
    ...file,
    ...draw,
    ...shown,
    viewRef,
    setView,
    size,
    seenRef: time.seenRef,
    yearRef: time.yearRef,
    editing,
    tool,
    selected,
    sketch,
    activeLayer,
    focusing,
    setFocusing,
    exploring: discovery.exploring,
    explore: discovery.explore,
    apply,
  });
  const { box, setBox } = pointer;
  useMapKeys({
    focusing,
    stopFocus: () => {
      setFocusing(false);
      setBox(null);
    },
  });
  useWheelZoom(draw.topCanvas, viewRef, setView, [map === null, draw.glError]);

  // ---- The page --------------------------------------------------------------------------------

  const feature = useMemo(
    () => map?.features.find((f) => f.id === selected) ?? null,
    [map, selected],
  );
  const measured = useMemo(
    () => (map && tool === "measure" && sketch.length > 1 ? measure(map.space, sketch) : null),
    [map, tool, sketch],
  );
  const schematic = map?.space.kind === "flat" && map.space.schematic === true;
  const { above, below } = aboveAndBelow(map, id, file.otherMaps);

  // The panels are declared here, before the page may stop early; what they draw is set below,
  // once the map is known, and read when the shell draws them.
  let layersPanel: ReactNode = null;
  let featurePanel: ReactNode = null;
  const showsFeature = feature !== null && (!editing || tool === "select");
  usePanel(
    map ? { id: "layers", title: "Layers", icon: LayersIcon, render: () => layersPanel } : null,
  );
  usePanel(
    showsFeature
      ? {
          id: "feature",
          title: editing ? "Edit feature" : "Selected",
          icon: MapPin,
          render: () => featurePanel,
        }
      : null,
  );
  // A feature chosen on the map opens its panel.
  const showPanel = bar.show;
  useEffect(() => {
    if (showsFeature) showPanel("feature");
  }, [selected, showsFeature, showPanel]);
  usePageTitle(map?.title ?? "Map");
  useSheetFloor(frame, "bottom", map !== null);

  if (file.error) {
    return (
      <div className="center">
        <p className="error">{file.error}</p>
        <Link to="/maps">All maps</Link>
      </div>
    );
  }
  if (!map) return <p className="center muted">Opening the map…</p>;
  if (draw.glError) return <p className="center error">{draw.glError}</p>;

  const sphere = map.space.kind === "sphere";
  const finish = () => apply(finishSketch(map, tool, sketch, activeLayer));

  layersPanel = (
    <LayerPanel
      timeLine={shown.timeLine}
      setup={<MapSetup id={id} map={map} otherMaps={file.otherMaps} onChange={change} />}
      map={map}
      hidden={hidden}
      shownImages={shownImages}
      editing={editing}
      activeLayer={activeLayer}
      onHidden={setHidden}
      onShownImages={setShownImages}
      onActive={setActiveLayer}
      onChange={change}
    />
  );
  if (feature) {
    featurePanel = (
      <FeaturePanel
        feature={feature}
        map={map}
        editing={editing}
        tool={tool}
        file={file}
        time={time}
        onScreen={onScreen}
        vertex={vertex}
        titleOf={titleOf}
        onVertex={setVertex}
        onSelect={setSelected}
      />
    );
  }

  return (
    <div className="map-page">
      <MapBar
        map={map}
        editing={editing}
        saving={file.saving}
        view={view}
        size={size}
        onView={setView}
        turning={turning}
        onTurning={setTurning}
        onStopFocus={() => setFocusing(false)}
        above={above}
        below={below}
        onLayer={goLayer}
        onPicture={(scale) => {
          if (!view || !shown.shownMap) return;
          void savePicture({
            map,
            shown: shown.shownMap,
            state: view,
            width: size.width,
            height: size.height,
            scale,
            shownImages,
            overlay: draw.overlay,
            year: time.timeOn ? time.year : null,
            say: setNotice,
          });
        }}
        canExplore={found.ready}
        exploring={discovery.exploring}
        onExplore={() => {
          discovery.setExploring(!discovery.exploring);
          setSelected(null);
        }}
        hasTime={time.chronicles.length > 0}
        timeOn={time.timeOn}
        onTime={() => {
          time.setTimeOn(!time.timeOn);
          time.setPin(null);
        }}
        layersOpen={bar.open === "layers"}
        onLayers={() => bar.toggle("layers")}
        onEdit={() => {
          if (editing) void queue.sendNow(file.key);
          setEditing(!editing);
          setTool("select");
          setSketch([]);
          setSelected(null);
        }}
        onChange={change}
        onRemove={() => void file.removeMap()}
      />

      {editing && (
        <MapTools
          tool={tool}
          schematic={schematic}
          onTool={(next) => {
            setTool(next);
            setSketch([]);
            if (next !== "select") setSelected(null);
          }}
          canUndo={file.history.past.length > 0}
          canRedo={file.history.future.length > 0}
          onUndo={file.undo}
          onRedo={file.redo}
        />
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
        <canvas ref={draw.glCanvas} className="map-canvas" />
        <canvas
          ref={draw.topCanvas}
          className={`map-canvas map-top tool-${editing ? tool : "read"}`}
          {...pointer.handlers}
        />
        {view && (
          <DiscoveryPins
            items={found.items}
            view={view}
            size={size}
            open={openFound}
            onOpen={(d) => {
              setSelected(null);
              setOpenFound(d);
            }}
          />
        )}
        {discovery.exploring && !openFound && (
          <p className="map-hint" role="status">
            {discovery.seeking
              ? "Looking at what is near…"
              : "Tap a place to see what might be found there."}
          </p>
        )}
        <FocusBox box={box} focusing={focusing} onCancel={() => setFocusing(false)} />
        {turning && view?.kind === "projected" && (
          <TurnPanel
            rotate={view.rotate}
            onTurn={(rotate) => setView(turnTo(view, rotate))}
            focusing={focusing}
            onFocus={() => setFocusing(!focusing)}
            onClose={() => setTurning(false)}
          />
        )}
        <MapZoom
          onZoom={zoom}
          onWhole={() => setView(initialView(map.space, size.width, size.height))}
        />

        {editing && (
          <MapHints
            tool={tool}
            sketchLength={sketch.length}
            measured={measured}
            sphere={sphere}
            onFinish={finish}
            onClear={() => setSketch([])}
            onSize={async () => {
              const next = await askSize(map, measured ? sketch : null, dialogs);
              if (next) change(next);
            }}
          />
        )}

        {!editing && (
          <OpenDiscovery
            map={id}
            discovery={discovery}
            onKept={(path) => {
              setNotice(`Kept as a new entry, ${path}, with a marker. Both are unsaved changes.`);
              refresh();
              void file.reloadMap();
            }}
          />
        )}
      </div>

      {time.timeOn && time.chronicleId && (
        <TimeBar
          chronicles={time.chronicles}
          chosen={time.chronicleId}
          onChoose={(next) => {
            time.setChosen(next);
            time.setYear(null);
            time.setPin(null);
          }}
          time={time.seen}
          year={time.year ?? 0}
          onYear={time.moveTo}
          stops={shown.stops}
          editing={editing}
          showAll={time.showAll}
          onShowAll={time.setShowAll}
          onClose={() => time.setTimeOn(false)}
        />
      )}
    </div>
  );
}
