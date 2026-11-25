/**
 * Suggest biomes: ghost biome zones worked out from the terrain in use (a height map, the guess
 * from the picture, or one inferred from it), the latitude and the prevailing wind. Each ghost is
 * accepted with a click (a tap on a phone), skipped with Delete, or all at once. Accepted ghosts
 * become ordinary zones in the Biomes layer; ghosts never cover a biome already on the map, and
 * the world settings are kept on the map once something is accepted. It runs in Find paths'
 * worker, on the same engine. Loaded only when the tool is first chosen.
 * See docs/designs/stage-21-biome-zones.md.
 */
import { makeView, type Position, type Space, type ViewState } from "@frontier/geo";
import {
  biomeById,
  BIOMES,
  DEFAULT_CLIMATE,
  type MapClimate,
  type MapFeature,
  type MapFile,
  type MapImage,
  type MapStyle,
  orderFeature,
  speedsText,
  speedWords,
  type Wind,
  WINDS,
} from "@frontier/schema";
import { Leaf, SlidersHorizontal } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { mapImageUrl } from "../../api.ts";
import { focusIsFree, shortcutText, useShortcut } from "../../keys.ts";
import { asBiomeZones } from "../../map/biomes.ts";
import { openPicture } from "../../map/findAreas/client.ts";
import type { Px } from "../../map/findAreas/contour.ts";
import { type ImageFrame, toPosition, toPx } from "../../map/findAreas/frame.ts";
import { closePaths, openPaths, setTerrain, suggestOf } from "../../map/findPaths/client.ts";
import {
  kmPerUnit,
  terrainBiomes,
  terrainExtent,
  terrainFeatures,
  terrainMetres,
} from "../../map/findPaths/page.ts";
import type { OpenedPaths } from "../../map/findPaths/protocol.ts";
import {
  type ClimateView,
  type Ghost,
  RAIN_RAMP,
  type SuggestReply,
  TEMP_RAMP,
} from "../../map/findPaths/suggest.ts";
import type { Point, PointerKind } from "../../map/gesture.ts";
import { patternFor } from "../../map/patterns.ts";
import type { Resolved } from "../../map/time.ts";
import { useBiomes } from "../../map/useBiomes.ts";
import type { FindPointer } from "../../map/usePointer.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { usePanel, useRightBar } from "../shell/panels.tsx";
import { usePhone } from "../Shell.tsx";
import { Tip } from "../ui/Tip.tsx";
import { useToast } from "../ui/Toast.tsx";
import { BiomeSwatch } from "./BiomePicker.tsx";
import "./Biomes.css";
import "./FindAreas.css";

/** What the page asks of the tool: the pointer's taps and hover, and its own undo and redo. */
export interface SuggestHandle extends FindPointer {
  undo(): boolean;
  redo(): boolean;
}

/** What the legend shows while the tool is on: the ghosts' biomes, or a field's scale. */
export interface SuggestLegend {
  ghosts: string[];
  scale: { title: string; stops: string[]; low: string; high: string } | null;
}

/** The Smallest zone's choices, in km². */
export const MIN_AREAS = [80, 150, 300, 600, 1000, 1600, 2500];
const WIND_NAMES: Record<Wind, string> = {
  N: "north",
  NE: "north-east",
  E: "east",
  SE: "south-east",
  S: "south",
  SW: "south-west",
  W: "west",
  NW: "north-west",
  none: "no prevailing wind",
};
/** The wind dial, as it is laid out: from the north-west across to the south-east. */
const DIAL: Wind[] = ["NW", "N", "NE", "W", "none", "E", "SW", "S", "SE"];
const VIEWS: { view: ClimateView; label: string; short: string; key: string }[] = [
  { view: "biomes", label: "Biomes", short: "Biomes", key: "map.biomesShow" },
  { view: "temp", label: "Temperature", short: "Temp.", key: "map.biomesTemp" },
  { view: "rain", label: "Rainfall", short: "Rain", key: "map.biomesRain" },
];

/** The settings while the app is open, for a map that keeps none of its own. */
const remembered: { view: ClimateView } = { view: "biomes" };

/** "5,680 km²": to the nearest ten from a thousand up. */
const km2Text = (km2: number | null) =>
  km2 === null
    ? ""
    : `${(km2 >= 1000 ? Math.round(km2 / 10) * 10 : Math.round(km2)).toLocaleString("en")} km²`;

function inside(p: Px, ring: readonly Px[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}

const ringArea = (r: readonly Px[]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
  return Math.abs(a) / 2;
};

export default function SuggestBiomes(p: {
  map: MapFile;
  mapRef: RefObject<MapFile | null>;
  change: (next: MapFile) => void;
  view: ViewState | null;
  size: { width: number; height: number };
  frame: RefObject<HTMLElement | null>;
  shownImages: Set<string>;
  resolved: Resolved[];
  hidden: Set<string>;
  styles: readonly MapStyle[];
  /** Adds styles to the library: a biome's usual style, the first time it is used. */
  addStyles: (styles: MapStyle[]) => void;
  handle: RefObject<SuggestHandle | null>;
  onSteps: (steps: { undo: boolean; redo: boolean }) => void;
  onLegend: (legend: SuggestLegend | null) => void;
  onTerrain: () => void;
  /** The map's own undo: takes back an accepted suggestion. */
  undoMap: () => void;
  say: (words: string) => void;
}) {
  const { map, view, size } = p;
  const phone = usePhone();
  const toast = useToast();
  const bar = useRightBar();
  const { custom } = useBiomes();
  const space = map.space as Space;
  const picture: MapImage | null = useMemo(
    () => [...map.images].reverse().find((i) => p.shownImages.has(i.id)) ?? null,
    [map.images, p.shownImages],
  );
  const terrain = map.terrain ?? null;

  // ---- The world's settings --------------------------------------------------------------------

  const [climate, setClimate] = useState<MapClimate>(() => ({
    ...DEFAULT_CLIMATE,
    ...(map.climate ?? {}),
  }));
  const set = (change: Partial<MapClimate>) => setClimate((c) => ({ ...c, ...change }));
  const [showView, setShowView] = useState<ClimateView>(remembered.view);
  useEffect(() => void (remembered.view = showView), [showView]);
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(climate);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(climate), 120);
    return () => window.clearTimeout(t);
  }, [climate]);

  // ---- Looking at the map, as Find paths does ---------------------------------------------------

  const [session, setSession] = useState<
    { status: "looking" } | { status: "failed" } | ({ status: "ready"; key: string } & OpenedPaths)
  >({ status: "looking" });
  const pictureUrl = picture ? mapImageUrl(picture.path, 4096) : null;
  const extent = picture ? picture.extent : terrain ? terrainExtent(map, terrain) : null;
  const sessionKey = JSON.stringify([pictureUrl, terrain, extent]);
  useEffect(() => {
    if (!extent) return;
    let stale = false;
    setSession({ status: "looking" });
    const heights = terrain
      ? {
          url: mapImageUrl(terrain.image, 2560),
          extent: terrainExtent(map, terrain),
          invert: terrain.invert === true,
          smoothing: terrain.smoothing ?? 0,
          seaLevel: terrain.seaLevel ?? null,
          metres: terrainMetres(terrain),
        }
      : null;
    (async () => {
      if (pictureUrl) await openPicture({ type: "open", url: pictureUrl, round: false });
      return openPaths({ url: pictureUrl, extent: extent as ImageFrame["extent"], heights });
    })().then(
      (o) => !stale && setSession({ status: "ready", key: sessionKey, ...o }),
      () => !stale && setSession({ status: "failed" }),
    );
    return () => {
      stale = true;
    };
    // The key holds all the effect reads of the map.
  }, [sessionKey]);
  useEffect(() => () => void closePaths().catch(() => {}), []);
  const ready = session.status === "ready" && session.key === sessionKey ? session : null;
  const imageFrame: ImageFrame | null = useMemo(
    () =>
      ready && extent
        ? { extent: extent as ImageFrame["extent"], sphere: false, w: ready.w, h: ready.h }
        : null,
    [ready],
  );

  const drawn = useMemo(
    () =>
      p.resolved
        .filter((r) => !p.hidden.has(r.feature.layer) && !p.hidden.has(r.feature.id))
        .map((r) => r.feature),
    [p.resolved, p.hidden],
  );
  const features = useMemo(
    () => (imageFrame ? terrainFeatures(space, imageFrame, drawn, p.styles, custom) : []),
    [imageFrame, drawn, p.styles, space, custom],
  );
  const biomes = useMemo(
    () => (imageFrame ? terrainBiomes(space, imageFrame, drawn, custom) : []),
    [imageFrame, drawn, space, custom],
  );
  const perUnit = kmPerUnit(map.space);
  const kmPerPx =
    perUnit !== null && imageFrame
      ? (perUnit * (imageFrame.extent[2] - imageFrame.extent[0])) / imageFrame.w
      : null;

  // ---- The suggestion ----------------------------------------------------------------------------

  const [reply, setReply] = useState<{ key: string; value: SuggestReply } | null>(null);
  const [failed, setFailed] = useState(false);
  const askKey = JSON.stringify([sessionKey, features, biomes, kmPerPx, settled, showView]);
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    (async () => {
      await setTerrain({ useHeights: true, follow: false, features, biomes, kmPerPx });
      return suggestOf({
        wind: settled.wind,
        lat: settled.lat,
        span: settled.span,
        temp: settled.temp,
        wet: settled.wet,
        minArea: settled.minArea,
        biomes,
        view: showView,
      });
    })().then(
      (value) => {
        if (stale) return;
        setFailed(false);
        setReply({ key: askKey, value });
        setTaken(new Set());
      },
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [askKey, ready]);
  const current = reply?.value ?? null;

  // ---- Skipped and accepted, with the tool's own undo -------------------------------------------

  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  /** Accepted since the last answer: hidden until the next one leaves them out by itself. */
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const past = useRef<({ kind: "skip"; keys: string[] } | { kind: "accept" })[]>([]);
  const future = useRef<{ kind: "skip"; keys: string[] }[]>([]);
  const [steps, setSteps] = useState(0);
  const { onSteps } = p;
  useEffect(() => {
    const last = past.current[past.current.length - 1];
    onSteps({ undo: last?.kind === "skip", redo: future.current.length > 0 });
  }, [steps, onSteps]);
  useEffect(() => () => onSteps({ undo: false, redo: false }), [onSteps]);

  const ghosts = useMemo(
    () => (current?.ghosts ?? []).filter((g) => !skipped.has(g.key) && !taken.has(g.key)),
    [current, skipped, taken],
  );
  // Each ghost's outline as positions on the map.
  const placed = useMemo(
    () =>
      imageFrame
        ? new Map(ghosts.map((g) => [g.key, g.ring.map((q) => toPosition(imageFrame, q))]))
        : new Map<string, Position[]>(),
    [ghosts, imageFrame],
  );

  const skip = (keys: string[]) => {
    if (keys.length === 0) return;
    past.current.push({ kind: "skip", keys });
    future.current = [];
    setSkipped((s) => new Set([...s, ...keys]));
    setSteps((n) => n + 1);
  };

  const round = (q: Position): Position => [
    Math.round(q[0] * 1000) / 1000,
    Math.round(q[1] * 1000) / 1000,
  ];
  const accept = (list: Ghost[]) => {
    const now = p.mapRef.current;
    if (!now || list.length === 0 || !imageFrame) return;
    let next: MapFile = now;
    const added: MapStyle[] = [];
    const ids: string[] = [];
    for (const g of list) {
      const biome = biomeById(g.kind, custom)!;
      const zone = orderFeature({
        id: newItemId(),
        kind: "zone",
        layer: now.layers[0]!.id,
        points: (placed.get(g.key) ?? g.ring.map((q) => toPosition(imageFrame, q))).map(round),
        entry: null,
        label: null,
        child: null,
      } as MapFeature);
      ids.push(zone.id);
      const withZone: MapFile = { ...next, features: [...next.features, zone] };
      const done = asBiomeZones(withZone, [zone.id], biome, [...p.styles, ...added], null);
      if (done.add) added.push(done.add);
      next = done.map;
    }
    // The world's settings are kept with what they made.
    next = { ...next, climate: { ...climate } };
    if (added.length) p.addStyles(added);
    p.change(next);
    past.current.push({ kind: "accept" });
    future.current = [];
    setTaken((t) => new Set([...t, ...list.map((g) => g.key)]));
    setSteps((n) => n + 1);
    if (phone && list.length === 1) {
      toast({
        message: `Accepted: ${BIOMES[list[0]!.kind].name}`,
        action: { label: "Undo", run: undoAccept },
      });
    }
  };
  const undoAccept = () => {
    const last = past.current[past.current.length - 1];
    if (last?.kind === "accept") past.current.pop();
    setSteps((n) => n + 1);
    // The map's own undo takes the zone back; the next answer suggests it again.
    p.undoMap();
  };

  useEffect(() => {
    p.handle.current = {
      undo: () => {
        const last = past.current[past.current.length - 1];
        if (!last) return false;
        past.current.pop();
        setSteps((n) => n + 1);
        if (last.kind === "accept") return false;
        future.current.push(last);
        setSkipped((s) => new Set([...s].filter((k) => !last.keys.includes(k))));
        return true;
      },
      redo: () => {
        const next = future.current.pop();
        if (!next) return false;
        past.current.push(next);
        setSkipped((s) => new Set([...s, ...next.keys]));
        setSteps((n) => n + 1);
        return true;
      },
      tap: (at: Point, how: { alt: boolean; shift: boolean; kind: PointerKind }) => {
        void how;
        const g = ghostAt(at);
        if (g) accept([g]);
      },
      hover: (at: Point | null) => {
        setHoverAt(at);
        setHoverKey(at ? (ghostAt(at)?.key ?? null) : null);
      },
    };
    return () => {
      p.handle.current = null;
    };
  });

  // ---- The pointer -------------------------------------------------------------------------------

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverAt, setHoverAt] = useState<Point | null>(null);
  /** The smallest ghost under a point of the screen. */
  function ghostAt(at: Point): Ghost | null {
    if (!view || !imageFrame) return null;
    const v = makeView(view, size.width, size.height);
    const pos = v.unproject(at.x, at.y);
    if (!pos) return null;
    const px = toPx(imageFrame, pos);
    let best: Ghost | null = null;
    for (const g of ghosts) {
      if (inside(px, g.ring) && (!best || ringArea(g.ring) < ringArea(best.ring))) best = g;
    }
    return best;
  }
  const hovered = ghosts.find((g) => g.key === hoverKey) ?? null;

  useShortcut("map.biomesShow", () => setShowView("biomes"));
  useShortcut("map.biomesTemp", () => setShowView("temp"));
  useShortcut("map.biomesRain", () => setShowView("rain"));
  useShortcut("map.biomesAccept", () => {
    if (!focusIsFree(document.activeElement, p.frame.current) || !hovered) return false;
    accept([hovered]);
  });
  useShortcut("map.biomesAcceptAll", () => {
    if (!focusIsFree(document.activeElement, p.frame.current) || ghosts.length === 0) return false;
    accept(ghosts);
  });
  useShortcut("map.biomesSkip", () => {
    if (!focusIsFree(document.activeElement, p.frame.current) || !hovered) return false;
    skip([hovered.key]);
    setHoverKey(null);
  });

  // ---- Drawing -----------------------------------------------------------------------------------

  const fieldCanvas = useMemo(() => {
    const f = current?.field;
    if (!f || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = f.w;
    c.height = f.h;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), f.w, f.h), 0, 0);
    return c;
  }, [current]);
  const canvas = useRef<HTMLCanvasElement>(null);
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
    if (showView !== "biomes" && fieldCanvas && imageFrame && current?.field) {
      const f = current.field;
      const a = v.project(toPosition(imageFrame, [-0.5, -0.5]));
      const b = v.project(toPosition(imageFrame, [f.w * f.cellPx - 0.5, f.h * f.cellPx - 0.5]));
      if (a && b) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(fieldCanvas, a[0], a[1], b[0] - a[0], b[1] - a[1]);
      }
      return;
    }
    const origin = v.projectClamped([0, 0]).point;
    for (const g of ghosts) {
      const ring = placed.get(g.key);
      if (!ring) continue;
      const pts = ring.map((q) => v.projectClamped(q).point);
      const kind = BIOMES[g.kind];
      const colour = kind.style.color;
      const hot = g.key === hoverKey;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = `${colour}${hot ? "88" : "55"}`;
      ctx.fill();
      const pattern = patternFor(ctx, kind.pattern, colour, ratio, origin);
      if (pattern) {
        ctx.globalAlpha = hot ? 1 : 0.7;
        ctx.fillStyle = pattern;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash(hot ? [] : [6, 4]);
      ctx.strokeStyle = "#fbf7f0";
      ctx.lineWidth = hot ? 4 : 3;
      ctx.stroke();
      ctx.strokeStyle = hot ? "#2a2420" : "#4a4034";
      ctx.lineWidth = hot ? 2 : 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // ---- The legend ----------------------------------------------------------------------------------

  const { onLegend } = p;
  const legendKey = JSON.stringify([
    showView,
    [...new Set(ghosts.map((g) => g.kind))],
    current?.field?.low,
    current?.field?.high,
  ]);
  useEffect(() => {
    const f = current?.field;
    const kinds = [...new Set(ghosts.map((g) => g.kind))];
    onLegend({
      ghosts: kinds,
      scale:
        showView === "biomes" || !f
          ? null
          : showView === "temp"
            ? {
                title: "Temperature",
                stops: TEMP_RAMP.map((r) => r[1]),
                low: `${Math.round(f.low)} °C`,
                high: `${Math.round(f.high)} °C`,
              }
            : {
                title: "Rainfall",
                stops: RAIN_RAMP.map((r) => r[1]),
                low: "dry",
                high: "wet",
              },
    });
  }, [legendKey]);
  useEffect(() => () => onLegend(null), [onLegend]);

  // ---- The Suggest tab ---------------------------------------------------------------------------

  const byBiome = useMemo(() => {
    const out = new Map<string, Ghost[]>();
    for (const g of ghosts) out.set(g.kind, [...(out.get(g.kind) ?? []), g]);
    return [...out];
  }, [ghosts]);
  usePanel({
    id: "suggest",
    title: "Suggest",
    icon: Leaf,
    render: () => (
      <aside className="suggest-panel" aria-label="Suggested biomes">
        <p className="muted">
          A starting point, not a survey. Worked out from the {terrainWords.toLowerCase()}, the
          latitude and the prevailing wind; it knows nothing of ocean currents, seasons, monsoons or
          soil. Accept what fits; repaint or skip the rest.
        </p>
        {ghosts.length === 0 && <p className="muted">{status}</p>}
        {byBiome.map(([kind, list]) => {
          const b = BIOMES[kind as keyof typeof BIOMES];
          return (
            <section key={kind} className="suggest-group">
              <h4>
                <BiomeSwatch colour={b.style.color} pattern={b.pattern} ghost />
                {b.name}
                <em className="muted"> cart {speedWords(b.speed.cart)}</em>
              </h4>
              <ul>
                {list.map((g) => (
                  <li
                    key={g.key}
                    className={g.key === hoverKey ? "is-hot" : ""}
                    onPointerEnter={() => setHoverKey(g.key)}
                    onPointerLeave={() => setHoverKey(null)}
                  >
                    <span>{km2Text(g.km2) || "A region"}</span>
                    <button
                      type="button"
                      className="quiet"
                      aria-label={`Accept ${b.name}${g.km2 !== null ? `, ${km2Text(g.km2)}` : ""}`}
                      onClick={() => accept([g])}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      aria-label={`Skip ${b.name}${g.km2 !== null ? `, ${km2Text(g.km2)}` : ""}`}
                      onClick={() => skip([g.key])}
                    >
                      Skip
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {skipped.size > 0 && (
          <p>
            <button type="button" className="quiet" onClick={() => setSkipped(new Set())}>
              Show them again ({skipped.size})
            </button>
          </p>
        )}
      </aside>
    ),
  });

  // ---- The bar ---------------------------------------------------------------------------------

  const terrainWords = terrain
    ? terrain.guessed
      ? "Terrain generated from the picture"
      : `Height map “${(terrain.image.split("/").pop() ?? "").replace(/\.[^.]+$/, "")}”`
    : "Terrain guessed from the picture";
  const guess = !terrain || terrain.guessed === true;
  const kinds = new Set(ghosts.map((g) => g.kind)).size;
  const area = ghosts.reduce((s, g) => s + (g.km2 ?? 0), 0);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  let status: string;
  if (session.status === "failed")
    status = offline ? "The height map isn't on this device." : "The map could not be read.";
  else if (!ready || !current)
    status = failed ? "The climate could not be worked out." : "Working out the climate…";
  else if (ghosts.length === 0)
    status =
      current.ghosts.length > 0
        ? "All skipped or accepted."
        : biomes.length > 0
          ? "Every place here has a biome."
          : "Nothing to suggest here.";
  else if (phone) status = `${ghosts.length} suggestion${ghosts.length === 1 ? "" : "s"}`;
  else
    status = `${ghosts.length} suggestion${ghosts.length === 1 ? "" : "s"} · ${kinds} biome${kinds === 1 ? "" : "s"}${area > 0 ? ` · ${km2Text(area)}` : ""}`;

  const least = current?.leastSpan ?? null;
  const wind = (
    <div className="wind-dial" role="radiogroup" aria-label="Prevailing wind, from">
      {DIAL.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={climate.wind === d}
          tabIndex={climate.wind === d ? 0 : -1}
          aria-label={d === "none" ? "No prevailing wind" : `From the ${WIND_NAMES[d]}`}
          className={d === "none" ? "is-none" : ""}
          onClick={() => set({ wind: d })}
          onKeyDown={(e) => {
            const order = WINDS.filter((x) => x !== "none");
            const at = order.indexOf(climate.wind === "none" ? "N" : climate.wind);
            const by =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? -1
                  : 0;
            if (!by) return;
            e.preventDefault();
            const next = order[(at + by + order.length) % order.length]!;
            set({ wind: next });
            (
              e.currentTarget.parentElement?.querySelector(
                `[aria-label="From the ${WIND_NAMES[next]}"]`,
              ) as HTMLElement | null
            )?.focus();
          }}
        >
          {d === "none" ? "·" : d}
        </button>
      ))}
    </div>
  );
  const options = (
    <div className="find-options suggest-options">
      <span className="suggest-wind">
        <span className="suggest-label">Wind from</span>
        {wind}
      </span>
      <label>
        Latitude
        <input
          type="range"
          min={-80}
          max={80}
          step={1}
          value={climate.lat}
          onChange={(e) => set({ lat: Number(e.target.value) })}
        />
        <small>{climate.lat}°</small>
      </label>
      <label>
        N–S span
        <input
          type="number"
          min={least !== null ? Math.ceil(least * 10) / 10 : 0.5}
          max={180}
          step={0.5}
          value={climate.span ?? (least !== null ? Math.round(least * 10) / 10 : 10)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) set({ span: least !== null && v <= least ? null : v });
          }}
        />
        <small>°</small>
      </label>
      <label>
        Temperature
        <input
          type="range"
          min={-10}
          max={10}
          step={1}
          value={climate.temp}
          onChange={(e) => set({ temp: Number(e.target.value) })}
        />
        <small>
          {climate.temp > 0 ? "+" : ""}
          {climate.temp} °C
        </small>
      </label>
      <label>
        Wetness
        <input
          type="range"
          min={0.4}
          max={2.5}
          step={0.1}
          value={climate.wet}
          onChange={(e) => set({ wet: Number(e.target.value) })}
        />
        <small>×{climate.wet.toFixed(1)}</small>
      </label>
      <label>
        Smallest zone
        <select value={climate.minArea} onChange={(e) => set({ minArea: Number(e.target.value) })}>
          {MIN_AREAS.map((a) => (
            <option key={a} value={a}>
              {a.toLocaleString()} km²
            </option>
          ))}
        </select>
      </label>
      <Tip label="Adjust the terrain in the Terrain dialog">
        <button
          type="button"
          className={`plain suggest-terrain${guess ? " is-guess" : ""}`}
          onClick={p.onTerrain}
        >
          {terrainWords}
        </button>
      </Tip>
    </div>
  );
  const viewSwitch = (
    <span className="find-mode paths-switch" role="group" aria-label="Show">
      {VIEWS.map((v) => (
        <Tip key={v.view} label={`Show the ${v.label.toLowerCase()}`} keys={shortcutText(v.key)}>
          <button
            type="button"
            aria-pressed={showView === v.view}
            className={showView === v.view ? "is-on" : ""}
            onClick={() => setShowView(v.view)}
          >
            {phone ? v.short : v.label}
          </button>
        </Tip>
      ))}
    </span>
  );

  // The tag beside the pointer: what a click there would do.
  const tag =
    hovered && hoverAt && !phone
      ? `Suggested: ${BIOMES[hovered.kind].name}${hovered.km2 !== null ? ` · ${km2Text(hovered.km2)}` : ""} · ${speedsText(BIOMES[hovered.kind].speed)} · Click to accept`
      : null;

  return (
    <>
      <canvas ref={canvas} className="map-canvas map-find" aria-hidden="true" />
      {tag && hoverAt && (
        <div
          className="find-tag find-tag-add"
          style={{ left: hoverAt.x + 14, top: hoverAt.y + 14 }}
          aria-hidden="true"
        >
          {tag}
        </div>
      )}
      <div
        className={`find-bar suggest-bar${open ? " is-open" : ""}`}
        role="group"
        aria-label="Suggest biomes"
        data-ghosts={ghosts.length}
        data-ready={current ? true : undefined}
      >
        {(!phone || open) && options}
        <div className="find-main">
          {viewSwitch}
          <span className="find-status" role="status">
            {status}
          </span>
          {ready && !current && !failed && <span className="find-busy" aria-hidden="true" />}
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
          {!phone && (
            <button
              type="button"
              className="quiet"
              disabled={ghosts.length === 0}
              onClick={() => skip(ghosts.map((g) => g.key))}
            >
              Skip all
            </button>
          )}
          {!phone && (
            <button type="button" className="quiet" onClick={() => bar.show("suggest")}>
              List
            </button>
          )}
          <Tip label="Accept every suggestion" keys={shortcutText("map.biomesAcceptAll")}>
            <button
              type="button"
              className="primary"
              aria-disabled={ghosts.length === 0 || undefined}
              onClick={() => ghosts.length > 0 && accept(ghosts)}
            >
              Accept all
            </button>
          </Tip>
        </div>
      </div>
    </>
  );
}
