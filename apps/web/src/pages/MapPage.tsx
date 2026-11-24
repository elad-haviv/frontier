import {
  centreOn,
  initialView,
  makeView,
  measure,
  panBy,
  type Position,
  turnTo,
} from "@frontier/geo";
import { MapPin, Layers as LayersIcon, Palette, Sparkles } from "lucide-react";
import {
  hiddenWithin,
  isLined,
  lockedWithin,
  orderFeature,
  reorderFeature,
} from "@frontier/schema";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { entryUrl, mapUrl } from "../api.ts";
import { useDialogs } from "../components/Dialogs.tsx";
import { OfflineCopy } from "../components/OfflineCopy.tsx";
import { DiscoveryPins, OpenDiscovery } from "../components/map/DiscoveryPins.tsx";
import type { FindHandle } from "../components/map/FindAreas.tsx";
import { FeatureEntryDialog } from "../components/map/FeatureEntryDialog.tsx";
import { FeaturePanel } from "../components/map/FeaturePanel.tsx";
import { GhostPins, PlacePanel, usePlace } from "../components/map/PlacePanel.tsx";
import { LayerPanel } from "../components/map/LayerPanel.tsx";
import { Legend } from "../components/map/Legend.tsx";
import { MapBar } from "../components/map/MapBar.tsx";
import { MapContextMenu, type MapMenu } from "../components/map/MapContextMenu.tsx";
import { type Hovered, MapHover } from "../components/map/MapHover.tsx";
import { FocusBox, MapHints } from "../components/map/MapHints.tsx";
import { MapSetup } from "../components/map/MapSetup.tsx";
import { MapTools } from "../components/map/MapTools.tsx";
import { MapZoom } from "../components/map/MapZoom.tsx";
import { StylesPanel } from "../components/map/StylesPanel.tsx";
import { TimeBar } from "../components/MapTime.tsx";
import { TurnPanel } from "../components/MapTurn.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { usePageTitle, usePanel, useRightBar, useSheetFloor } from "../components/shell/panels.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { askSize } from "../map/askSize.ts";
import { useCurveSetting } from "../map/curveSetting.ts";
import { type MenuTarget, menuTargetOf, type PointerKind } from "../map/gesture.ts";
import { aboveAndBelow } from "../map/layersBeneath.ts";
import { legendOf, withStyle } from "../map/mapStyles.ts";
import { savePicture } from "../map/savePicture.ts";
import {
  canFinish,
  deleteFeature,
  finishSketch,
  insertPoint,
  placeMarker,
  removePoint,
  removeReason,
  setCurve,
  type Step,
  takeBackPoint,
  type Tool,
} from "../map/tools.ts";
import { folderFor } from "../map/featureEntry.ts";
import { choicesFor, ghostMarker, withProposal } from "../map/place.ts";
import { useSnapSetting } from "../map/snap.ts";
import { useDiscovery } from "../map/useDiscovery.ts";
import { useMapDraw } from "../map/useMapDraw.ts";
import { useMapFile } from "../map/useMapFile.ts";
import { useMapKeys } from "../map/useMapKeys.ts";
import { useMapStyles } from "../map/useMapStyles.ts";
import { useMapTime, useShownAt } from "../map/useMapTime.ts";
import { openingShown, pointOn, useMapView, useWheelZoom } from "../map/useMapView.ts";
import { usePointer } from "../map/usePointer.ts";
import { queue } from "../sync/queue.ts";

/** Find areas, with the worker that looks at the picture, loads when the tool is first chosen. */
const FindAreas = lazy(() => import("../components/map/FindAreas.tsx"));

export function MapPage() {
  const dialogs = useDialogs();
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const toast = useToast();

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
  /** A word over the map that goes by itself, such as why a key did nothing. */
  const [said, setSaid] = useState<string | null>(null);
  const saidTimer = useRef<number | undefined>(undefined);
  const say = (words: string) => {
    window.clearTimeout(saidTimer.current);
    setSaid(words);
    saidTimer.current = window.setTimeout(() => setSaid(null), 4000);
  };
  useEffect(() => () => window.clearTimeout(saidTimer.current), []);
  // The right-click menu: what it acts on and where, and whether it is open. It is off while the
  // last press was a touch or held Shift, so touch has no menu and Shift gives the browser's.
  const [menuAt, setMenuAt] = useState<{ target: MenuTarget; at: Position | null } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOff, setMenuOff] = useState(
    () => !window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  // New paths and zones curved or not; the kind of pointer that last pressed, for the "+" sizes.
  const [curve, setCurveOn] = useCurveSetting();
  // Points of paths and zones snap to the paths and zones beside them, unless turned off here.
  const [snap, setSnap] = useSnapSetting();
  /** The entry being made for a feature, from its entry list or a generated description. */
  const [makingEntry, setMakingEntry] = useState<{
    feature: string;
    name: string;
    body: string;
  } | null>(null);
  // Place with AI: the proposals on the map, and the one picked in its tab.
  const place = usePlace(id);
  const [pickedGhost, setPickedGhost] = useState<string | null>(null);
  /** Find areas while it is on: it takes the taps, and its clicks are undone before the map's. */
  const findRef = useRef<FindHandle | null>(null);
  const [findSteps, setFindSteps] = useState({ undo: false, redo: false });
  const [pressKind, setPressKind] = useState<PointerKind>(() =>
    window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
  );

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
  // What is not drawn: the hidden layers with all that is inside them, and hidden features.
  const layers = map?.layers;
  const hiddenNow = useMemo(
    () => (layers ? hiddenWithin(layers, hidden) : hidden),
    [layers, hidden],
  );
  const locked = useMemo(() => (layers ? lockedWithin(layers) : new Set<string>()), [layers]);
  /** The selected feature is in a locked layer: it is shown, but cannot be changed on the map. */
  const selectedLocked = !!map?.features.some((f) => f.id === selected && locked.has(f.layer));
  const shown = useShownAt(map, time, { selected, editing, hidden: hiddenNow });
  const { onScreen } = shown;
  // The library's path and zone styles, shared by every open map.
  const { styles } = useMapStyles();
  // A picked corner lasts while its shape stays on screen.
  useEffect(() => setVertex(null), [onScreen?.shape]);
  const { view, setView, viewRef, size, frame, goLayer, zoom, placeLink, viewLink } = useMapView(
    map,
    {
      params,
      setParams,
      editing,
      time,
      hidden,
      shownImages,
      onWanted: setSelected,
      // Where a feature is at the year shown: the shape in force then, or its first.
      placeOf: (f) => {
        const drawn = shown.resolved.find((r) => r.feature.id === f.id)?.feature ?? f;
        return !isLined(drawn) ? drawn.at : drawn.points[0]!;
      },
    },
  );
  const draw = useMapDraw(map, {
    ...shown,
    view,
    size,
    hidden: hiddenNow,
    shownImages,
    selected,
    vertex,
    sketch,
    tool,
    editing,
    names: file.names,
    pendingNames: file.pendingNames,
    sets: file.sets,
    curve,
    pressKind,
    styles,
  });
  const { titleOf } = draw;
  const discovery = useDiscovery(id, { ...time, setNotice });
  /** The moment the map is seen at, which what the AI proposes must fit. */
  const moment = {
    chronicle: time.timeOn ? time.chronicleId : null,
    year: time.timeOn ? time.year : null,
  };
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
    // A feature in a locked layer, chosen in the Layers tab, cannot be dragged.
    selected: selectedLocked ? null : selected,
    sketch,
    activeLayer,
    focusing,
    setFocusing,
    exploring: discovery.exploring,
    explore: discovery.explore,
    apply,
    frame,
    paused: menuOpen,
    curve,
    onPressKind: setPressKind,
    snap,
    find: findRef,
  });
  const { box, setBox } = pointer;
  useWheelZoom(draw.topCanvas, viewRef, setView, [map === null, draw.glError]);

  /** Copies a link, and says so. */
  const copy = (link: string, what: string) =>
    void navigator.clipboard.writeText(link).then(
      () => toast({ message: `Copied a link to ${what}.` }),
      () => toast({ message: "The link could not be copied." }),
    );
  const copyPlace = (feature: string) => copy(placeLink(feature), "this place");
  const copyView = () => copy(viewLink(), "this view");
  const startEditing = (feature: string | null = null) => {
    setEditing(true);
    setTool("select");
    setSketch([]);
    setSelected(feature);
  };
  const stopEditing = () => {
    void queue.sendNow(file.key);
    setEditing(false);
    setTool("select");
    setSketch([]);
    setSelected(null);
  };
  const chooseTool = (next: Tool) => {
    setTool(next);
    setSketch([]);
    // Find areas keeps the selection: the chosen areas can be added to the selected zone.
    if (next !== "select" && next !== "find") setSelected(null);
    // Proposals not placed are only previews: they go with the tool.
    if (next !== "place") {
      place.setGhosts([]);
      setPickedGhost(null);
    }
  };
  /** Deletes the picked point if there is one, else the selected feature: one step to undo. */
  const deleteSelection = () => {
    const now = file.mapRef.current;
    if (!now || !selected) return;
    if (selectedLocked) return say("It is in a locked layer.");
    if (vertex !== null && shown.onScreen) {
      const done = removePoint(now, shown.onScreen, vertex);
      if (done && "reason" in done) say(done.reason);
      else if (done) {
        file.setFeature(done.feature);
        setVertex(null);
      }
      return;
    }
    change(deleteFeature(now, selected));
    setSelected(null);
  };
  const whole = () => map && setView(initialView(map.space, size.width, size.height));
  const drawing =
    sketch.length > 0 &&
    (tool === "path" || tool === "zone" || tool === "measure" || tool === "place");
  /** Finishes the path or zone being drawn, when it has the points it needs. */
  const finish = () => {
    if (!map || !canFinish(tool, sketch)) return false;
    apply(finishSketch(map, tool, sketch, activeLayer, curve));
  };
  /** Curved or straight: the next path or zone while drawing, else the selected one. */
  const toggleCurve = () => {
    if (tool === "path" || tool === "zone") return setCurveOn(!curve);
    const chosen = file.mapRef.current?.features.find((f) => f.id === selected);
    if (tool !== "select" || !chosen || !isLined(chosen)) return false;
    file.setFeature(setCurve(chosen, (chosen as { curve?: string }).curve !== "smooth"));
  };
  const schematicMap = map?.space.kind === "flat" && map.space.schematic === true;
  /** Find areas looks at the map's picture: it needs one shown. */
  const hasPicture = !!map?.images.some((i) => shownImages.has(i.id));
  const canUndo = findSteps.undo || file.history.past.length > 0;
  const canRedo = findSteps.redo || file.history.future.length > 0;
  const undo = () => findRef.current?.undo() || file.undo();
  const redo = () => findRef.current?.redo() || file.redo();
  useMapKeys({
    editing,
    frame,
    focusing,
    stopFocus: () => {
      setFocusing(false);
      setBox(null);
    },
    drawing,
    cancelDrawing: () => setSketch([]),
    takeBack: () => setSketch(takeBackPoint(sketch)),
    finish,
    toggleCurve,
    tool,
    tools: [
      "select",
      "marker",
      "path",
      "zone",
      "label",
      ...(schematicMap ? [] : ["measure" as const]),
      ...(found.ready ? ["place" as const] : []),
      ...(hasPicture ? ["find" as const] : []),
    ],
    toggleSnap: () => setSnap(!snap),
    setTool: chooseTool,
    vertex,
    clearVertex: () => setVertex(null),
    selected,
    clearSelection: () => setSelected(null),
    edit: () => startEditing(selected),
    done: stopEditing,
    canUndo,
    canRedo,
    undo,
    redo,
    remove: deleteSelection,
    zoom,
    fit: whole,
    pan: (dx, dy) => viewRef.current && setView(panBy(viewRef.current, dx, dy)),
    toggleLayers: () => bar.toggle("layers"),
    toggleTime: () => {
      if (time.chronicles.length === 0) return false;
      time.setTimeOn(!time.timeOn);
      time.setPin(null);
    },
  });

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
  // The Styles tab is there while editing; the styles are the library's, not this map's.
  usePanel(
    map && editing
      ? { id: "styles", title: "Styles", icon: Palette, render: () => <StylesPanel /> }
      : null,
  );
  // The Marker and Label tools stay on: what was just placed opens its tab, to be named at once.
  const showsFeature =
    feature !== null &&
    (!editing || tool === "select" || tool === "marker" || tool === "label" || tool === "find");
  // Place with AI has its own tab while the tool is on.
  let placePanel: ReactNode = null;
  usePanel(
    map && editing && tool === "place"
      ? { id: "place", title: "Place with AI", icon: Sparkles, render: () => placePanel }
      : null,
  );
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
  // A feature chosen on the map opens its panel; one chosen in the Layers tab leaves that open.
  const showPanel = bar.show;
  const fromLayers = useRef(false);
  useEffect(() => {
    if (showsFeature && !fromLayers.current) showPanel("feature");
    fromLayers.current = false;
  }, [selected, showsFeature, showPanel]);
  /** Selects a feature from the Layers tab, and centres the map on it. */
  const selectFromLayers = (id: string) => {
    const f = map?.features.find((x) => x.id === id);
    if (!f) return;
    fromLayers.current = true;
    // Find areas stays on: a zone chosen in Layers is one to add the chosen areas to.
    if (tool !== "select" && tool !== "find" && editing) chooseTool("select");
    setSelected(id);
    setVertex(null);
    // Where it is at the year shown; a kind of feature this page does not know may have either.
    const drawn = (shown.resolved.find((r) => r.feature.id === id)?.feature ?? f) as {
      at?: Position;
      points?: Position[];
    };
    const at = drawn.at ?? drawn.points?.[0];
    if (!at || !view) return;
    // On a phone the sheet covers the foot of the map: the feature goes in the middle of the rest.
    const sheet = document.querySelector(".bottom-sheet")?.getBoundingClientRect();
    const box = frame.current?.getBoundingClientRect();
    const covered = sheet && box ? Math.max(0, Math.min(box.bottom - sheet.top, box.height)) : 0;
    setView(panBy(centreOn(view, at), 0, -covered / 2));
  };

  // The first tap of Place with AI opens its tab, to say what to place there.
  const placing = editing && tool === "place";
  useEffect(() => {
    if (placing && sketch.length === 1) showPanel("place");
  }, [placing, sketch.length, showPanel]);
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

  // What the mouse is over, as the tooltip and the preview show it.
  const hoveredFeature = pointer.hovered
    ? shown.resolved.find((r) => r.feature.id === pointer.hovered!.target.feature)?.feature
    : undefined;
  const hovered: Hovered | null =
    pointer.hovered && hoveredFeature
      ? {
          kind:
            pointer.hovered.target.kind === "corner" || pointer.hovered.target.kind === "insert"
              ? pointer.hovered.target.kind
              : "feature",
          feature: hoveredFeature,
          title: titleOf(hoveredFeature),
          at: pointer.hovered.at,
          entryPath: hoveredFeature.entry ? (file.names[hoveredFeature.entry]?.path ?? null) : null,
          childTitle: hoveredFeature.child ? (file.children[hoveredFeature.child] ?? null) : null,
        }
      : null;

  // The right-click menu, for what was under the pointer.
  const menuFeature =
    menuAt && menuAt.target.kind !== "nothing"
      ? (map.features.find((f) => f.id === (menuAt.target as { feature: string }).feature) ?? null)
      : null;
  const menuDrawn = menuFeature && shown.resolved.find((r) => r.feature.id === menuFeature.id);
  const menu: MapMenu | null = menuAt
    ? {
        target: menuAt.target,
        editing,
        feature: menuFeature,
        map,
        entryPath: menuFeature?.entry ? (file.names[menuFeature.entry]?.path ?? null) : null,
        childFound: menuFeature?.child ? menuFeature.child in file.children : false,
        removeReason: menuDrawn ? removeReason(menuDrawn.feature) : null,
        canMove: {
          forward:
            !!menuFeature && reorderFeature(map.features, menuFeature.id, 1) !== map.features,
          back: !!menuFeature && reorderFeature(map.features, menuFeature.id, -1) !== map.features,
        },
        canExplore: found.ready,
        openEntry: (path) => navigate(entryUrl(path)),
        openChild: (f) =>
          f.child && navigate(mapUrl(f.child) + (time.carry ? `?${time.carry}` : "")),
        copyPlace: (f) => copyPlace(f.id),
        editFeature: (f) => startEditing(f.id),
        copyView,
        explore: () => discovery.explore(menuAt.at),
        showInBar: (f) => {
          chooseTool("select");
          setSelected(f.id);
          bar.show("feature");
        },
        moveToLayer: (f, layer) => file.setFeature(orderFeature({ ...f, layer })),
        reorder: (f, by) => change({ ...map, features: reorderFeature(map.features, f.id, by) }),
        remove: (f) => {
          change(deleteFeature(map, f.id));
          if (selected === f.id) setSelected(null);
        },
        insertPoint: (f, segment, at) => {
          const drawn = shown.resolved.find((r) => r.feature.id === f.id);
          const done = drawn ? insertPoint(map, drawn, segment, at) : null;
          if (!done) return;
          file.setFeature(done.feature);
          setVertex(done.vertex);
        },
        setCurve: (f, curved) => file.setFeature(setCurve(f, curved)),
        styles,
        setStyle: (f, style) => file.setFeature(withStyle(f, style)),
        removePoint: (f, at) => {
          const drawn = shown.resolved.find((r) => r.feature.id === f.id);
          const done = drawn ? removePoint(map, drawn, at) : null;
          if (done && "feature" in done) {
            file.setFeature(done.feature);
            setVertex(null);
          }
        },
        addMarker: () => menuAt.at && apply({ ...placeMarker(map, activeLayer, menuAt.at) }),
        startPath: () => {
          chooseTool("path");
          if (menuAt.at) setSketch([menuAt.at]);
        },
        startZone: () => {
          chooseTool("zone");
          if (menuAt.at) setSketch([menuAt.at]);
        },
      }
    : null;

  // The legend: the styles of the features drawn now, in shown layers and present at the year.
  const legend = legendOf(
    shown.resolved
      .filter((r) => !hiddenNow.has(r.feature.layer) && !hiddenNow.has(r.feature.id))
      .filter((r) => r.presence !== "not_yet" && r.presence !== "gone")
      .map((r) => r.feature),
    styles,
  );
  layersPanel = (
    <LayerPanel
      legend={<Legend styles={legend} />}
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
      selected={selected}
      onSelect={selectFromLayers}
      titleOf={titleOf}
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
        onCopyLink={() => copyPlace(feature.id)}
        onEdit={() => startEditing(feature.id)}
        styles={styles}
        onEditStyles={() => bar.show("styles")}
        generate={
          found.ready
            ? {
                mapId: id,
                choices: choicesFor(feature.kind, map, styles, file.sets),
                moment,
                onUse: (proposal) => {
                  const now = file.mapRef.current?.features.find((f) => f.id === feature.id);
                  if (now) file.setFeature(withProposal(now, proposal));
                },
              }
            : null
        }
        onMakeEntry={(name, body) => setMakingEntry({ feature: feature.id, name, body })}
      />
    );
  }
  const placeChoices = choicesFor("marker", map, styles, file.sets);
  placePanel = (
    <PlacePanel
      marked={sketch}
      place={place}
      choices={placeChoices}
      picked={pickedGhost}
      onPick={setPickedGhost}
      onPropose={(ask) =>
        view && place.propose(view, size, sketch, { ...ask, choices: placeChoices }, moment)
      }
      onAccept={(ghost) => {
        const now = file.mapRef.current;
        if (now) change({ ...now, features: [...now.features, ghostMarker(ghost, activeLayer)] });
      }}
      onClear={() => setSketch([])}
    />
  );
  const makingFor = makingEntry && map.features.find((f) => f.id === makingEntry.feature);

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
        onCopyView={copyView}
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
        onEdit={() => (editing ? stopEditing() : startEditing())}
        onChange={change}
        onRemove={() => void file.removeMap()}
      />

      {editing && (
        <MapTools
          tool={tool}
          schematic={schematic}
          canPlace={found.ready}
          findReason={hasPicture ? null : "Find areas needs a map image"}
          onTool={chooseTool}
          snap={snap}
          onSnap={setSnap}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
        />
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

      {/* The frame takes the focus when the map is pressed, so the map's keys act on it. */}
      <div className="map-frame" ref={frame} tabIndex={0} role="region" aria-label="The map">
        <canvas ref={draw.glCanvas} className="map-canvas" />
        <MapContextMenu
          menu={menu}
          open={menuOpen}
          disabled={menuOff}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setMenuAt(null);
          }}
          onClosed={() =>
            frame.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
          }
        >
          <canvas
            ref={draw.topCanvas}
            className={`map-canvas map-top tool-${editing ? tool : "read"}`}
            {...pointer.handlers}
            onPointerDown={(e) => {
              // A touch press, or one with Shift held, leaves the next right-click alone.
              setMenuOff(e.pointerType !== "mouse" || e.shiftKey);
              pointer.handlers.onPointerDown(e);
            }}
            onContextMenu={(e) => {
              if (menuOff || e.shiftKey) return;
              const at = pointOn(e.currentTarget, e);
              const v = viewRef.current && makeView(viewRef.current, size.width, size.height);
              pointer.endHover();
              setMenuAt({
                target: menuTargetOf(pointer.pickAt(at)),
                at: v ? v.unproject(at.x, at.y) : null,
              });
            }}
          />
        </MapContextMenu>
        <canvas ref={draw.liveCanvas} className="map-canvas map-live" aria-hidden="true" />
        <MapHover hovered={menuOpen ? null : hovered} editing={editing} frame={size} />
        {view && placing && (
          <GhostPins
            ghosts={place.ghosts}
            view={view}
            size={size}
            picked={pickedGhost}
            onPick={(key) => {
              setPickedGhost(key);
              bar.show("place");
            }}
          />
        )}
        {makingEntry && makingFor && (
          <FeatureEntryDialog
            name={makingEntry.name}
            body={makingEntry.body}
            folder={folderFor(map, makingFor.kind, file.names)}
            onClose={() => setMakingEntry(null)}
            onMade={(path, title) => {
              setMakingEntry(null);
              const now = file.mapRef.current?.features.find((f) => f.id === makingFor.id);
              if (now) file.link(now, path, title);
              refresh();
            }}
          />
        )}
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
          // Why a tap found nothing is said here, over the map, where the eye is.
          <p
            className={`map-hint${discovery.failed && !discovery.seeking ? " map-hint-failed" : ""}`}
            role={discovery.failed && !discovery.seeking ? "alert" : "status"}
          >
            {discovery.seeking
              ? "Looking at what is near…"
              : discovery.failed
                ? `${discovery.failed} Tap a place to try again.`
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
        <MapZoom onZoom={zoom} onWhole={whole} />
        {said && (
          <p className="map-hint map-said" role="status">
            {said}
          </p>
        )}

        {editing && tool === "find" && hasPicture && (
          <Suspense fallback={null}>
            <FindAreas
              map={map}
              mapRef={file.mapRef}
              change={change}
              view={view}
              size={size}
              frame={frame}
              shownImages={shownImages}
              resolved={shown.resolved}
              hidden={hiddenNow}
              locked={locked}
              activeLayer={activeLayer}
              onActiveLayer={setActiveLayer}
              selected={selected}
              onSelect={setSelected}
              snap={snap}
              styles={styles}
              titleOf={titleOf}
              handle={findRef}
              onSteps={setFindSteps}
              say={say}
            />
          </Suspense>
        )}

        {editing && (
          <MapHints
            tool={tool}
            sketch={sketch}
            measured={measured}
            sphere={sphere}
            curve={curve}
            layer={map.layers.find((l) => l.id === activeLayer)?.name ?? ""}
            onCurve={setCurveOn}
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
