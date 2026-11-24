/**
 * Find areas: the tool that makes zones from the map's own picture. Point at the map and the area
 * under the pointer lights up; click to choose areas, Alt-click to remove one; Make zone turns
 * the chosen areas into zones in the current layer, or Add to merges them into the selected zone.
 * The picture is looked at in a worker (findAreas/worker.ts); this is the page's side: its bar,
 * the outlines drawn over the map, and the clicks. Loaded only when the tool is first chosen.
 * See docs/designs/stage-19-find-areas.md.
 */
import { makeView, type Position, type Space, type ViewState } from "@frontier/geo";
import type { Point } from "../../map/gesture.ts";
import { layerTree, type MapFile, type MapImage, type MapStyle } from "@frontier/schema";
import { Minus, Plus, SlidersHorizontal } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { mapImageUrl } from "../../api.ts";
import { focusIsFree, shortcutText, useShortcut } from "../../keys.ts";
import { areaOutline, findAreasIn, openPicture, outlineAreas } from "../../map/findAreas/client.ts";
import { drawRings } from "../../map/findAreas/draw.ts";
import { type ImageFrame, pixelAt } from "../../map/findAreas/frame.ts";
import { type FoundPiece, pointCount } from "../../map/findAreas/outline.ts";
import type { AreaRings, FoundAreas } from "../../map/findAreas/protocol.ts";
import { type AreaOptions, DEFAULT_OPTIONS, INK } from "../../map/findAreas/segment.ts";
import { DEFAULT_DETAIL, DETAIL_EPS } from "../../map/findAreas/simplify.ts";
import { addToZone, holeCount, makeZones, zoneRings } from "../../map/findAreas/zones.ts";
import { selectColour } from "../../map/overlay.ts";
import type { Resolved } from "../../map/time.ts";
import type { FindPointer } from "../../map/usePointer.ts";
import { usePhone } from "../Shell.tsx";
import { Tip } from "../ui/Tip.tsx";
import "./FindAreas.css";

/** What the page asks of the tool: the pointer's taps and hover, and its own undo and redo. */
export interface FindHandle extends FindPointer {
  /** Takes back the last click; false when there is none, so the map's own undo runs. */
  undo(): boolean;
  redo(): boolean;
}

type Mode = "add" | "remove";
/** A click, kept as a point of the picture so it can be replayed when the areas are found again. */
interface Op {
  x: number;
  y: number;
  mode: Mode;
}
interface Choice {
  image: string | null;
  ops: Op[];
}
type Looked =
  | { status: "looking" }
  | { status: "failed" }
  | { status: "ready"; w: number; h: number; areas: FoundAreas | null; areasFor: string };

/** What the tool remembers while the app is open: its options and the style last used. */
const remembered: {
  options: AreaOptions;
  detail: number;
  style: string;
  mode: Mode;
} = { options: DEFAULT_OPTIONS, detail: DEFAULT_DETAIL, style: "", mode: "add" };

const EMPTY: Choice = { image: null, ops: [] };
const urlOf = (image: MapImage) => mapImageUrl(image.path, 4096);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function cssColour(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim() || fallback;
}

export default function FindAreas(p: {
  map: MapFile;
  mapRef: RefObject<MapFile | null>;
  change: (next: MapFile) => void;
  view: ViewState | null;
  size: { width: number; height: number };
  /** The map's frame: Enter makes a zone only while it, or nothing, has the focus. */
  frame: RefObject<HTMLElement | null>;
  shownImages: Set<string>;
  /** The features as drawn now, with their shapes on screen. */
  resolved: Resolved[];
  /** Hidden layers (with what is inside them) and features. */
  hidden: Set<string>;
  locked: Set<string>;
  activeLayer: string;
  onActiveLayer: (id: string) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  snap: boolean;
  styles: readonly MapStyle[];
  titleOf: (f: Resolved["feature"]) => string;
  handle: RefObject<FindHandle | null>;
  onSteps: (steps: { undo: boolean; redo: boolean }) => void;
  say: (words: string) => void;
}) {
  const { map, view, size } = p;
  const phone = usePhone();
  const sphere = map.space.kind === "sphere";
  const pictures = useMemo(
    () => map.images.filter((i) => p.shownImages.has(i.id)),
    [map.images, p.shownImages],
  );

  const [options, setOptions] = useState<AreaOptions>(remembered.options);
  const [detail, setDetail] = useState(remembered.detail);
  const [style, setStyle] = useState(remembered.style);
  const [mode, setMode] = useState<Mode>(remembered.mode);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    Object.assign(remembered, { options, detail, style, mode });
  }, [options, detail, style, mode]);
  // The options the areas are found with: a slider being dragged settles first.
  const [settled, setSettled] = useState(options);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(options), 150);
    return () => window.clearTimeout(timer);
  }, [options]);
  const optionsKey = JSON.stringify(settled);

  // ---- Looking at the pictures, and finding their areas -------------------------------------

  const [looked, setLooked] = useState<Record<string, Looked>>({});
  const frameOf = (image: MapImage): ImageFrame | null => {
    const l = looked[image.id];
    if (l?.status !== "ready") return null;
    return { extent: image.extent, sphere, w: l.w, h: l.h };
  };
  useEffect(() => {
    // The topmost picture first: it is the one most likely pointed at.
    for (const image of [...pictures].reverse()) {
      if (looked[image.id]) continue;
      setLooked((now) => ({ ...now, [image.id]: { status: "looking" } }));
      const round = sphere && image.extent[2] - image.extent[0] >= 359.999;
      openPicture({ type: "open", url: urlOf(image), round }).then(
        (o) =>
          setLooked((now) => ({
            ...now,
            [image.id]: { status: "ready", w: o.w, h: o.h, areas: null, areasFor: "" },
          })),
        () => setLooked((now) => ({ ...now, [image.id]: { status: "failed" } })),
      );
    }
  }, [pictures, looked, sphere]);
  const wantedKey = useRef(optionsKey);
  wantedKey.current = optionsKey;
  const asked = useRef(new Map<string, string>());
  useEffect(() => {
    for (const image of pictures) {
      const l = looked[image.id];
      if (l?.status !== "ready" || l.areasFor === optionsKey) continue;
      if (asked.current.get(image.id) === optionsKey) continue;
      asked.current.set(image.id, optionsKey);
      const key = optionsKey;
      findAreasIn({ type: "areas", url: urlOf(image), options: settled }).then(
        (areas) => {
          if (wantedKey.current !== key) return;
          setLooked((now) => {
            const was = now[image.id];
            if (was?.status !== "ready") return now;
            return { ...now, [image.id]: { ...was, areas, areasFor: key } };
          });
        },
        () => setLooked((now) => ({ ...now, [image.id]: { status: "failed" } })),
      );
    }
  }, [pictures, looked, optionsKey, settled]);

  // ---- The chosen areas ----------------------------------------------------------------------

  const [choice, setChoiceNow] = useState<Choice>(EMPTY);
  const past = useRef<Choice[]>([]);
  const future = useRef<Choice[]>([]);
  const [steps, setSteps] = useState(0);
  const { onSteps } = p;
  useEffect(() => {
    onSteps({ undo: past.current.length > 0, redo: future.current.length > 0 });
  }, [steps, onSteps]);
  useEffect(() => () => onSteps({ undo: false, redo: false }), [onSteps]);
  /** Sets the choice as a step that Undo takes back. */
  const choose = (next: Choice) => {
    past.current.push(choice);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setChoiceNow(next);
    setSteps((n) => n + 1);
  };
  /** Starts again with nothing chosen and nothing to undo, as after a zone is made. */
  const reset = () => {
    past.current = [];
    future.current = [];
    setChoiceNow(EMPTY);
    setSteps((n) => n + 1);
  };

  const choiceImage = pictures.find((i) => i.id === choice.image) ?? null;
  const choiceLooked = choice.image ? looked[choice.image] : undefined;
  const choiceAreas = choiceLooked?.status === "ready" ? choiceLooked.areas : null;
  const chosen = useMemo(() => {
    const set = new Set<number>();
    if (!choiceAreas) return set;
    for (const op of choice.ops) {
      const l = choiceAreas.labels[op.y * choiceAreas.w + op.x]!;
      if (l < 0) continue;
      if (op.mode === "add") set.add(l);
      else set.delete(l);
    }
    return set;
  }, [choice, choiceAreas]);
  const chosenKey = [...chosen].sort((a, b) => a - b).join(",");

  // Other zones on screen, to snap to, as drawn at the year shown.
  const zonesOnScreen = useMemo(
    () =>
      p.resolved.filter(
        (r) =>
          r.feature.kind === "zone" &&
          !p.hidden.has(r.feature.layer) &&
          !p.hidden.has(r.feature.id),
      ),
    [p.resolved, p.hidden],
  );
  const targetsWithout = (skip: string | null): Position[][] =>
    p.snap
      ? zonesOnScreen
          .filter((r) => r.feature.id !== skip)
          .map((r) => (r.feature as { points: Position[] }).points)
      : [];

  // ---- The outline the chosen areas make -----------------------------------------------------

  const [preview, setPreview] = useState<{ key: string; pieces: FoundPiece[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const previewKey = `${choice.image}|${optionsKey}|${chosenKey}|${detail}|${p.snap}`;
  const latest = useRef("");
  const outlineNow = (
    image: MapImage,
    ids: number[],
    targets: Position[][],
    addTo: Position[] | null,
  ) => {
    const frame = frameOf(image);
    if (!frame) return Promise.reject(new Error("The picture is not ready."));
    return outlineAreas({
      type: "outline",
      url: urlOf(image),
      areas: ids,
      frame,
      eps: DETAIL_EPS[detail]!,
      targets,
      addTo,
    }).then((o) => o.pieces);
  };
  useEffect(() => {
    latest.current = previewKey;
    if (!choiceImage || chosen.size === 0 || choiceAreas === null) {
      setPreview(null);
      setBusy(false);
      return;
    }
    const key = previewKey;
    setBusy(true);
    const timer = window.setTimeout(() => {
      outlineNow(choiceImage, [...chosen], targetsWithout(null), null).then(
        (pieces) => {
          if (latest.current !== key) return;
          setPreview({ key, pieces });
          setBusy(false);
        },
        () => latest.current === key && setBusy(false),
      );
    }, 30);
    return () => window.clearTimeout(timer);
    // The targets follow the map; the rest of what it reads is in the key.
  }, [previewKey, zonesOnScreen]);
  const current = preview?.key === previewKey ? preview.pieces : null;

  // ---- Pointing at the map ----------------------------------------------------------------------

  /** The topmost shown picture under a point of the screen, and its area there. */
  const lookup = (at: Point) => {
    if (!view) return null;
    const position = makeView(view, size.width, size.height).unproject(at.x, at.y);
    if (!position) return null;
    for (let i = pictures.length - 1; i >= 0; i--) {
      const image = pictures[i]!;
      const l = looked[image.id];
      const probe: ImageFrame = { extent: image.extent, sphere, w: 1e6, h: 1e6 };
      if (!pixelAt(probe, position)) continue;
      if (l?.status !== "ready" || !l.areas) return { image, pending: true as const };
      const frame = frameOf(image)!;
      const px = pixelAt(frame, position);
      if (!px) continue;
      const label = l.areas.labels[px[1] * l.areas.w + px[0]]!;
      return { image, pending: false as const, px, label, at };
    }
    return null;
  };
  type Lit = { image: string; area: number; at: Point };
  const [hover, setHover] = useState<Lit | null>(null);
  const [flash, setFlash] = useState<Lit | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const [rings, setRings] = useState<Record<string, AreaRings>>({});
  const ringKey = (l: Lit) => `${l.image}|${optionsKey}|${l.area}`;
  const asking = useRef(new Set<string>());
  const wantRings = (lit: Lit | null) => {
    if (!lit || lit.area < 0) return;
    const key = ringKey(lit);
    if (rings[key] || asking.current.has(key)) return;
    const image = pictures.find((i) => i.id === lit.image);
    const frame = image && frameOf(image);
    if (!image || !frame) return;
    asking.current.add(key);
    areaOutline({ type: "area", url: urlOf(image), area: lit.area, frame }).then(
      (r) => {
        asking.current.delete(key);
        setRings((now) => {
          // A handful are kept: what the pointer passed over lately.
          const kept = Object.entries(now).slice(-40);
          return { ...Object.fromEntries(kept), [key]: r };
        });
      },
      () => asking.current.delete(key),
    );
  };
  useEffect(() => wantRings(hover));
  useEffect(() => wantRings(flash));

  const inChoice = (image: string, area: number) => choice.image === image && chosen.has(area);

  // ---- What the tool does ----------------------------------------------------------------------

  const tap: FindHandle["tap"] = (at, how) => {
    const hit = lookup(at);
    if (!hit) return;
    if (hit.pending) return p.say("Still looking at the picture…");
    if (hit.label === INK) {
      return p.say("That is text or a mark. Turn on Ignore text & marks to look past it.");
    }
    if (hit.label < 0) return;
    const doing: Mode = how.alt ? "remove" : how.shift ? "add" : mode;
    const same = choice.image === hit.image.id;
    const has = same && chosen.has(hit.label);
    if (doing === "add" && has) {
      if (how.kind !== "mouse") p.say("Already chosen. Switch to Remove to take it away.");
      return;
    }
    if (doing === "remove" && !has) return;
    if (!same && choice.ops.length > 0) p.say("Started again on this picture.");
    const op = { x: hit.px[0], y: hit.px[1], mode: doing };
    choose({ image: hit.image.id, ops: [...(same ? choice.ops : []), op] });
    if (how.kind !== "mouse") {
      // No hover on a touch screen: the area tapped flashes, so the finger is not left guessing.
      setFlash({ image: hit.image.id, area: hit.label, at });
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 500);
    }
  };
  const pointAt: FindHandle["hover"] = (at) => {
    const hit = at ? lookup(at) : null;
    if (!hit || hit.pending) return setHover(null);
    if (hover?.image === hit.image.id && hover.area === hit.label) {
      if (hover.at.x !== hit.at.x || hover.at.y !== hit.at.y) setHover({ ...hover, at: hit.at });
      return;
    }
    setHover({ image: hit.image.id, area: hit.label, at: hit.at });
  };
  p.handle.current = {
    tap,
    hover: pointAt,
    undo: () => {
      const back = past.current.pop();
      if (!back) return false;
      future.current.push(choice);
      setChoiceNow(back);
      setSteps((n) => n + 1);
      return true;
    },
    redo: () => {
      const on = future.current.pop();
      if (!on) return false;
      past.current.push(choice);
      setChoiceNow(on);
      setSteps((n) => n + 1);
      return true;
    },
  };
  useEffect(() => {
    const handle = p.handle;
    return () => {
      handle.current = null;
    };
  }, [p.handle]);

  const selectedZone = p.resolved.find(
    (r) => r.feature.id === p.selected && r.feature.kind === "zone",
  );
  const zoneLocked = !!selectedZone && p.locked.has(selectedZone.feature.layer);
  const ready = !!current && zoneRings(current).length > 0 && !busy;
  const [making, setMaking] = useState(false);

  const make = () => {
    if (!ready || !current || making) return;
    const now = p.mapRef.current;
    if (!now) return;
    const made = makeZones(now, p.activeLayer, style || null, current);
    if (!made) return;
    p.change(made.map);
    p.onSelect(made.ids[0]!);
    reset();
    if (made.ids.length > 1) {
      p.say(`Made ${made.ids.length} zones, one for each separate piece.`);
    }
  };
  const addTo = async () => {
    if (!selectedZone || !choiceImage || chosen.size === 0 || zoneLocked || making) return;
    setMaking(true);
    try {
      const zone = selectedZone.feature as { id: string; points: Position[] };
      const pieces = await outlineNow(
        choiceImage,
        [...chosen],
        targetsWithout(zone.id),
        zone.points,
      );
      const now = p.mapRef.current;
      const done = now ? addToZone(now, selectedZone, pieces) : null;
      if (!done) return;
      p.change(done.map);
      p.onSelect(zone.id);
      reset();
      if (done.ids.length > 1) {
        p.say(`The pieces apart from it became ${plural(done.ids.length - 1, "new zone")}.`);
      }
    } catch {
      p.say("The areas could not be added.");
    } finally {
      setMaking(false);
    }
  };
  const clear = () => {
    if (choice.ops.length > 0) choose(EMPTY);
  };

  useShortcut("map.findMode", () => setMode(mode === "add" ? "remove" : "add"));
  useShortcut("map.findMake", () => {
    if (!focusIsFree(document.activeElement, p.frame.current) || !ready) return false;
    make();
  });
  useShortcut("map.findClear", () => {
    if (choice.ops.length > 0) return clear();
    if (p.selected) return p.onSelect(null);
    return false;
  });

  // ---- Drawing ---------------------------------------------------------------------------------

  const canvas = useRef<HTMLCanvasElement>(null);
  const hoverRings = hover && hover.area >= 0 ? rings[ringKey(hover)] : undefined;
  const flashRings = flash && flash.area >= 0 ? rings[ringKey(flash)] : undefined;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !view) return;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(size.width * ratio);
    const h = Math.round(size.height * ratio);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    const v = makeView(view, size.width, size.height);
    const space = map.space as Space;
    const accent = selectColour();
    const warn = cssColour("--warn", "#a12a22");
    const split = (r: AreaRings) => ({
      outers: r.rings.filter((x) => x.role === "outer").map((x) => x.points),
      holes: r.rings.filter((x) => x.role === "hole").map((x) => x.points),
    });
    if (hoverRings && hover && !phone) {
      const removing = inChoice(hover.image, hover.area) && mode === "remove";
      const { outers, holes } = split(hoverRings);
      drawRings(ctx, v, space, outers, holes, {
        fill: removing ? warn : accent,
        fillAlpha: removing ? 0.55 : 0.22,
        stroke: removing ? warn : accent,
        width: 2,
        hatch: removing,
      });
    }
    if (current) {
      drawRings(ctx, v, space, zoneRings(current), [], {
        fill: accent,
        fillAlpha: 0.17,
        stroke: accent,
        width: 2,
        dash: [6, 4],
        casing: true,
        dots: true,
      });
    }
    if (flashRings) {
      const { outers, holes } = split(flashRings);
      drawRings(ctx, v, space, outers, holes, {
        fill: accent,
        fillAlpha: 0.4,
        stroke: accent,
        width: 3,
      });
    }
  });

  // ---- The bar ---------------------------------------------------------------------------------

  const statuses = pictures.map((i) => looked[i.id]);
  const lookingNow = statuses.some((l) => !l || l.status === "looking");
  const failed = statuses.length > 0 && statuses.every((l) => l?.status === "failed");
  const topAreas = [...pictures]
    .reverse()
    .map((i) => looked[i.id])
    .find((l) => l?.status === "ready" && l.areas);
  const areaCount = topAreas?.status === "ready" ? (topAreas.areas?.count ?? 0) : 0;
  const findingAgain = statuses.some((l) => l?.status === "ready" && l.areasFor !== optionsKey);
  const click = phone ? "tap" : "click";
  let status: string;
  if (pictures.length === 0) status = "Find areas needs a map image.";
  else if (failed) status = "The picture could not be looked at.";
  else if (lookingNow || areaCount === 0) status = "Looking at the picture…";
  else if (chosen.size === 0) status = `${plural(areaCount, "area")} found · ${click} one to start`;
  else if (!current) status = `${plural(chosen.size, "area")} · outlining…`;
  else {
    const zones = zoneRings(current).length;
    const holes = holeCount(current);
    status =
      zones === 0
        ? `${plural(chosen.size, "area")} · too small to outline`
        : `${plural(chosen.size, "area")} → ${plural(zones, "zone")} · ${pointCount(
            current.map((c) => ({ ...c, holes: [] })),
          )} points${holes > 0 ? ` · ${plural(holes, "hole")} filled` : ""}`;
  }

  const layers = layerTree(map.layers);
  const zoneStyles = p.styles.filter((s) => s.for === "zone");
  const zoneName = selectedZone ? p.titleOf(selectedZone.feature) : "";
  const addToLabel = zoneName ? `Add to “${zoneName}”` : "Add to selected zone";
  const addToReason = !selectedZone
    ? "Select a zone first"
    : zoneLocked
      ? "It is in a locked layer"
      : chosen.size === 0
        ? "Choose an area first"
        : null;
  const makeReason =
    chosen.size === 0 ? "Choose an area first" : !ready ? "Too small to outline" : null;

  const modeSwitch = (
    <span className="find-mode" role="group" aria-label="Clicks">
      {(["add", "remove"] as const).map((m) => (
        <Tip
          key={m}
          label={
            m === "add"
              ? "Clicks add areas (Shift-click always adds)"
              : "Clicks remove areas (Alt-click always removes)"
          }
          keys={shortcutText("map.findMode")}
        >
          <button
            type="button"
            aria-pressed={mode === m}
            aria-label={m === "add" ? "Add" : "Remove"}
            onClick={() => setMode(m)}
          >
            {m === "add" ? <Plus size={15} aria-hidden /> : <Minus size={15} aria-hidden />}
            {!phone && <span>{m === "add" ? "Add" : "Remove"}</span>}
          </button>
        </Tip>
      ))}
    </span>
  );
  const clearButton = (
    <Tip label="Clear the chosen areas" keys={shortcutText("map.findClear")}>
      <button
        type="button"
        className="plain"
        aria-disabled={choice.ops.length === 0 || undefined}
        onClick={clear}
      >
        Clear
      </button>
    </Tip>
  );
  const addToButton = (
    <Tip
      label="Merge the chosen areas into the selected zone"
      {...(addToReason ? { note: addToReason } : {})}
    >
      <button
        type="button"
        aria-disabled={addToReason !== null || undefined}
        onClick={() => addToReason === null && void addTo()}
      >
        {addToLabel}
      </button>
    </Tip>
  );
  const options_ = (
    <div className="find-options">
      <label className="find-range">
        How alike
        <small>strict</small>
        <input
          type="range"
          min={3}
          max={36}
          value={options.tolerance}
          onChange={(e) => setOptions({ ...options, tolerance: Number(e.target.value) })}
        />
        <small>loose</small>
      </label>
      <Tip label="Dark lines (borders, coasts, rivers) are walls an area stops at">
        <button
          type="button"
          className="find-chip"
          aria-pressed={options.stopAtLines}
          onClick={() => setOptions({ ...options, stopAtLines: !options.stopAtLines })}
        >
          Stop at lines
        </button>
      </Tip>
      <Tip label="Letters, mountains, trees and other small marks are looked past">
        <button
          type="button"
          className="find-chip"
          aria-pressed={options.ignoreMarks}
          onClick={() => setOptions({ ...options, ignoreMarks: !options.ignoreMarks })}
        >
          Ignore text &amp; marks
        </button>
      </Tip>
      <label className="find-range">
        Points
        <small>fewer</small>
        <input
          type="range"
          min={0}
          max={DETAIL_EPS.length - 1}
          value={detail}
          onChange={(e) => setDetail(Number(e.target.value))}
        />
        <small>more</small>
      </label>
      {phone && (
        <span className="find-actions">
          {clearButton}
          {addToButton}
        </span>
      )}
      <span className="find-into">
        <label>
          New zone in
          <select value={p.activeLayer} onChange={(e) => p.onActiveLayer(e.target.value)}>
            {layers.map((n) => (
              <option key={n.layer.id} value={n.layer.id}>
                {" ".repeat(n.depth)}
                {n.layer.name}
              </option>
            ))}
          </select>
        </label>
        <select aria-label="Zone style" value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="">The layer's look</option>
          {zoneStyles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </span>
    </div>
  );

  // The tag beside the pointer: what a click there would do.
  let tag: { text: string; kind: string } | null = null;
  if (hover && !phone) {
    if (hover.area === INK) {
      tag = { text: "Text or a mark: turn on Ignore text & marks to look past it", kind: "ink" };
    } else if (inChoice(hover.image, hover.area)) {
      tag =
        mode === "remove"
          ? { text: "− Remove this area", kind: "remove" }
          : { text: "Already chosen · Alt-click removes it", kind: "chosen" };
    } else if (mode === "add") tag = { text: "+ Add this area", kind: "add" };
  }

  return (
    <>
      <canvas ref={canvas} className="map-canvas map-find" aria-hidden="true" />
      {tag && hover && (
        <div
          className={`find-tag find-tag-${tag.kind}`}
          style={{ left: hover.at.x + 14, top: hover.at.y + 14 }}
          aria-hidden="true"
        >
          {tag.text}
        </div>
      )}
      <div
        className={`find-bar${open ? " is-open" : ""}`}
        role="group"
        aria-label="Find areas"
        data-areas={areaCount}
        data-chosen={chosen.size}
        data-ready={ready || undefined}
      >
        {(!phone || open) && options_}
        <div className="find-main">
          {modeSwitch}
          <span className="find-status" role="status">
            {status}
          </span>
          {(findingAgain || busy || making) && chosen.size > 0 && (
            <span className="find-busy" aria-hidden="true" />
          )}
          {phone && (
            <button
              type="button"
              className="find-more"
              aria-expanded={open}
              aria-label="Options"
              onClick={() => setOpen(!open)}
            >
              <SlidersHorizontal size={16} aria-hidden />
            </button>
          )}
          {!phone && clearButton}
          {!phone && addToButton}
          <Tip
            label="Make a zone of the chosen areas"
            keys={shortcutText("map.findMake")}
            {...(makeReason ? { note: makeReason } : {})}
          >
            <button
              type="button"
              className="primary"
              aria-disabled={makeReason !== null || undefined}
              onClick={() => makeReason === null && make()}
            >
              Make zone
            </button>
          </Tip>
        </div>
      </div>
    </>
  );
}
