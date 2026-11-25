/**
 * Build one from the picture: the Terrain dialog's hints workspace. Frontier looks at the map's
 * picture for what tells height (sea and coast, rivers and the way they flow, mountain symbols,
 * lakes, marsh), marks each as a hint the owner can accept, move or change, lets him draw his
 * own, and builds a height map that agrees with them. Nothing reaches the map until Use, which
 * saves the image in the library with the hints and the settings to build it again.
 * See docs/designs/stage-21-infer-height-map.md.
 */
import type {
  MapFeature,
  MapFile,
  MapImage,
  MapStyle,
  MapTerrain,
  MapTerrainHint,
  TerrainHintKind,
} from "@frontier/schema";
import {
  ArrowDownToDot,
  Check,
  ChevronDown,
  ChevronRight,
  Dices,
  Download,
  Maximize2,
  Minus,
  Mountain,
  MousePointer2,
  Pentagon,
  Plus,
  Redo2,
  Trash2,
  Triangle,
  TrendingDown,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, mapImageUrl } from "../../api.ts";
import { openPicture } from "../../map/findAreas/client.ts";
import { flatGrid } from "../../map/findPaths/grid.ts";
import { kmPerUnit } from "../../map/findPaths/page.ts";
import { reliefPicture } from "../../map/findPaths/terrain.ts";
import { buildFromHints, findTerrainHints, imageFromHints } from "../../map/terrainHints/client.ts";
import {
  forStore,
  foundHints,
  type Hint,
  heightOf,
  heightWords,
  hintName,
  hintsHash,
  inUse,
  KINDS,
  LINE_KINDS,
  mergeFound,
  reasonOf,
  tiedHints,
  ZONE_KINDS,
} from "../../map/terrainHints/page.ts";
import type { HintsBuilt } from "../../map/terrainHints/protocol.ts";
import { type BuildSettings, DEFAULT_SETTINGS } from "../../map/terrainHints/types.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { useConnection } from "../../sync/connection.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { Tip } from "../ui/Tip.tsx";
import "./TerrainHints.css";

type Pos = [number, number];
type Extent = [number, number, number, number];
type View = "picture" | "heights" | "relief" | "contours";
type Tool = "select" | "peak" | "hollow" | "ridge" | "valley" | "cliff" | "zone";
type ZoneKind = "highland" | "lowland" | "plain" | "marsh";
type Tab = "hints" | "build";

const TOOLS: { id: Tool; label: string; key: string; tip: string; icon: typeof Mountain }[] = [
  { id: "select", label: "Select", key: "V", tip: "Select and move", icon: MousePointer2 },
  { id: "peak", label: "Peak", key: "P", tip: "Peak: a summit with a height", icon: Triangle },
  {
    id: "hollow",
    label: "Hollow",
    key: "O",
    tip: "Hollow: a low point, a basin",
    icon: ArrowDownToDot,
  },
  { id: "ridge", label: "Ridge", key: "R", tip: "Ridge: a line of high ground", icon: Mountain },
  {
    id: "valley",
    label: "Valley",
    key: "Y",
    tip: "Valley: lower than either side, falling the way you draw it",
    icon: ChevronDown,
  },
  {
    id: "cliff",
    label: "Cliff",
    key: "C",
    tip: "Cliff: a sudden step, high on the left as you draw it",
    icon: TrendingDown,
  },
  {
    id: "zone",
    label: "Zone",
    key: "Z",
    tip: "Zone: highland, lowland, plain or marsh",
    icon: Pentagon,
  },
];
const VIEWS: { id: View; label: string; tip: string }[] = [
  { id: "picture", label: "Picture", tip: "The map's picture" },
  { id: "heights", label: "Heights", tip: "The built height map as greys: brighter is higher" },
  { id: "relief", label: "Relief", tip: "Light and shade" },
  { id: "contours", label: "Contours", tip: "Lines of equal height" },
];
const ZONE_KINDS_DRAWN: { id: ZoneKind; label: string }[] = [
  { id: "highland", label: "Highland" },
  { id: "lowland", label: "Lowland" },
  { id: "plain", label: "Plain" },
  { id: "marsh", label: "Marsh" },
];
const DETAILS: { id: 1 | 2 | 3; label: string }[] = [
  { id: 1, label: "Draft" },
  { id: 2, label: "Normal" },
  { id: 3, label: "Fine" },
];
/** The colour of each kind's mark on the preview. */
const INK: Record<TerrainHintKind, string> = {
  sea: "#2f5f8a",
  coast: "#1f3f66",
  lake: "#2f6f9f",
  river: "#2f6f9f",
  valley: "#2f6f9f",
  ridge: "#7a4a22",
  peak: "#6b3a17",
  hollow: "#2f6f9f",
  cliff: "#5b4636",
  highland: "#8a5a2b",
  lowland: "#5f8a4a",
  plain: "#8a8a3a",
  marsh: "#3f7a6a",
  road: "#8a3520",
};

interface Step {
  hints: Hint[];
  settings: BuildSettings;
}

const percent = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");

export default function TerrainHints(p: {
  map: MapFile;
  picture: MapImage;
  drawn: readonly MapFeature[];
  styles: readonly MapStyle[];
  phone: boolean;
  /** The picture's water on a small grid, from the Terrain dialog's look: the coast is drawn from it. */
  water: { w: number; h: number; data: Uint8Array } | null;
  /** Look at the picture at once (Find hints), or open the hints the map keeps. */
  find: boolean;
  onUse: (terrain: MapTerrain, hints: MapTerrainHint[], count: number) => void;
  /** Offline: the hints alone are kept, to build and use once back online. */
  onKeep: (hints: MapTerrainHint[]) => void;
  onCancel: () => void;
  /** To the ordinary dialog, to choose a height map instead (for a terrain built from hints). */
  onPlain?: () => void;
}) {
  const { map, picture, phone } = p;
  const ext = picture.extent as Extent;
  const space = map.space;
  const pictureUrl = mapImageUrl(picture.path, 4096);
  const online = useConnection().state === "online";
  const kpu = kmPerUnit(space);
  const generated = map.terrain?.generated ?? null;

  // ---- The hints and the settings, with their history -------------------------------------------

  const startHints = useMemo<Hint[]>(() => {
    const kept = map.terrainHints ?? [];
    const own = kept.filter((h) => !h.by.startsWith("feature:"));
    return [...own, ...tiedHints(space, p.drawn, p.styles, kept)];
  }, []);
  const [step, setStep] = useState<Step>(() => ({
    hints: startHints,
    settings: generated
      ? {
          seed: generated.seed,
          rough: generated.rough,
          sharp: generated.sharp,
          erosion: generated.erosion,
          detail: generated.detail as 1 | 2 | 3,
          carve: generated.carve,
          lakes: generated.lakes,
        }
      : DEFAULT_SETTINGS,
  }));
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);
  const [, bump] = useState(0);
  const { hints, settings } = step;
  /** One change, one step to undo. */
  const commit = (next: Partial<Step>) => {
    past.current.push(step);
    future.current = [];
    setStep({ ...step, ...next });
  };
  /** A change during a drag: the step to undo was taken when the drag began. */
  const live = (next: Partial<Step>) => setStep((s) => ({ ...s, ...next }));
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(step);
    setStep(prev);
    bump((n) => n + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(step);
    setStep(next);
    bump((n) => n + 1);
  };
  const setHints = (next: Hint[]) => commit({ hints: next });
  const change = (id: string, patch: Partial<Hint>, asStep = true) => {
    const next = hints.map((h) => (h.id === id ? ({ ...h, ...patch, touched: true } as Hint) : h));
    if (asStep) commit({ hints: next });
    else live({ hints: next });
  };
  const setSettings = (patch: Partial<BuildSettings>) =>
    commit({ settings: { ...settings, ...patch } });

  const [top, setTop] = useState(() =>
    map.terrain?.generated && map.terrain.range ? String(map.terrain.range[1]) : "",
  );
  const [unit, setUnit] = useState(map.terrain?.rangeUnit === "ft" ? "ft" : "m");
  const topValue = Number(top);
  const topH =
    top.trim() !== "" && Number.isFinite(topValue) && topValue > 0
      ? { value: topValue, unit }
      : null;

  // ---- The picture --------------------------------------------------------------------------------

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = pictureUrl;
    openPicture({ type: "open", url: pictureUrl, round: false }).then(
      (o) => setSize({ w: o.w, h: o.h }),
      () => setFailed("The map's picture could not be read."),
    );
  }, [pictureUrl]);

  // ---- Finding hints ------------------------------------------------------------------------------

  const [finding, setFinding] = useState(false);
  const [foundNote, setFoundNote] = useState<{ ms: number; notUsed: string[] } | null>(null);
  const kmPerPx = (w: number) => (kpu === null ? null : (kpu * (ext[2] - ext[0])) / w);
  const find = (mode: "first" | "again" | "over") => {
    if (!size) return;
    setFinding(true);
    findTerrainHints({ url: pictureUrl, kmPerPx: kmPerPx(size.w) }).then(
      (found) => {
        setFinding(false);
        setFoundNote({ ms: found.ms, notUsed: found.notUsed });
        const fresh = foundHints(found, ext);
        const near = (ext[2] - ext[0]) * 0.03;
        const tied = hints.filter((h) => h.by.startsWith("feature:"));
        if (mode === "over") setHints([...fresh, ...tied]);
        else if (mode === "first" && hints.every((h) => h.by.startsWith("feature:"))) {
          // A found hint where a feature of the map already says it is left out: the map wins.
          // What is found first is where the dialog starts from, not a step to undo.
          live({
            hints: [...tied, ...mergeFound(tied, fresh, near).filter((h) => h.by === "found")],
          });
        } else setHints(mergeFound(hints, fresh, near));
        if (mode === "first") setSelected(null);
      },
      () => {
        setFinding(false);
        setFailed("The picture could not be looked at on this device.");
      },
    );
  };
  const looked = useRef(false);
  useEffect(() => {
    if (!size || looked.current) return;
    looked.current = true;
    if (p.find) find("first");
  }, [size]);

  // ---- Building -----------------------------------------------------------------------------------

  const [built, setBuilt] = useState<{ key: string; value: HintsBuilt } | null>(null);
  const [building, setBuilding] = useState(false);
  const [wantBuild, setWantBuild] = useState(!!generated);
  const usedHash = hintsHash(hints);
  const buildKey = JSON.stringify([usedHash, settings]);
  const queued = useRef<string | null>(null);
  const inFlight = useRef(false);
  const runBuild = () => {
    if (!size) return;
    if (inFlight.current) {
      queued.current = buildKey;
      return;
    }
    inFlight.current = true;
    setBuilding(true);
    const key = buildKey;
    buildFromHints({
      url: pictureUrl,
      hints: inUse(hints, ext, size.w, size.h),
      settings,
    }).then(
      (value) => {
        inFlight.current = false;
        setBuilding(false);
        setBuilt({ key, value });
        if (queued.current && queued.current !== key) {
          queued.current = null;
          setRebuild((n) => n + 1);
        }
      },
      () => {
        inFlight.current = false;
        setBuilding(false);
        setFailed("The height map could not be built on this device.");
      },
    );
  };
  const [rebuild, setRebuild] = useState(0);
  // After the first build, every change rebuilds by itself, a moment after it is made.
  useEffect(() => {
    if (!wantBuild || !size || finding) return;
    if (built?.key === buildKey) return;
    const t = setTimeout(runBuild, built ? 200 : 0);
    return () => clearTimeout(t);
  }, [wantBuild, size, finding, buildKey, rebuild]);
  const stale = !!built && built.key !== buildKey;
  const checks = built?.value.checks ?? null;

  // ---- The preview --------------------------------------------------------------------------------

  const [view, setView] = useState<View>(generated ? "relief" : "picture");
  const [showHints, setShowHints] = useState(true);
  const [strength, setStrength] = useState(85);
  const [tool, setTool] = useState<Tool>("select");
  const [zoneKind, setZoneKind] = useState<ZoneKind>("highland");
  const [drawing, setDrawing] = useState<Pos[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Pos | null>(null);
  const [zoom, setZoom] = useState<{ k: number; cx: number; cy: number }>({
    k: 1,
    cx: (ext[0] + ext[2]) / 2,
    cy: (ext[1] + ext[3]) / 2,
  });
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setCanvasSize({
        w: Math.max(100, Math.round(r.width)),
        h: Math.max(100, Math.round(r.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = Math.min(canvasSize.w / (ext[2] - ext[0]), canvasSize.h / (ext[3] - ext[1]));
  const k = fit * zoom.k;
  const sx = (x: number) => (x - zoom.cx) * k + canvasSize.w / 2;
  const sy = (y: number) => (y - zoom.cy) * k + canvasSize.h / 2;
  const toMap = (x: number, y: number): Pos => [
    (x - canvasSize.w / 2) / k + zoom.cx,
    (y - canvasSize.h / 2) / k + zoom.cy,
  ];

  /** The built heights as a small picture for the view, made once per build and view. */
  const layer = useMemo(() => {
    if (!built || view === "picture") return null;
    const b = built.value;
    const n = b.w * b.h;
    const rgba = new Uint8ClampedArray(n * 4);
    if (view === "heights") {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        lo = Math.min(lo, b.heights[i]!);
        hi = Math.max(hi, b.heights[i]!);
      }
      for (let i = 0; i < n; i++) {
        const v = Math.round(((b.heights[i]! - lo) / (hi - lo || 1)) * 255);
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
    } else {
      const relief = reliefPicture(flatGrid(b.w, b.h), b.heights, b.sea);
      for (let i = 0; i < n; i++) {
        const edge = relief[i * 4] === 92;
        if (view === "contours" && !edge) continue;
        for (let c = 0; c < 4; c++) rgba[i * 4 + c] = relief[i * 4 + c]!;
        if (view === "relief" && !b.sea[i]) rgba[i * 4 + 3] = Math.max(rgba[i * 4 + 3]!, 30);
      }
    }
    const c = document.createElement("canvas");
    c.width = b.w;
    c.height = b.h;
    c.getContext("2d")!.putImageData(new ImageData(rgba, b.w, b.h), 0, 0);
    return c;
  }, [built, view]);

  /** The coast of the picture, for the coast hint's line: water cells beside land. */
  const coastCells = useMemo(() => {
    const w = p.water;
    if (!w) return [];
    // The sea only: water joined to the map's edge (a lake has its own hint).
    const sea = new Uint8Array(w.w * w.h);
    const stack: number[] = [];
    for (let i = 0; i < w.w * w.h; i++) {
      const x = i % w.w;
      const y = (i / w.w) | 0;
      if (w.data[i] && (x === 0 || y === 0 || x === w.w - 1 || y === w.h - 1)) {
        sea[i] = 1;
        stack.push(i);
      }
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w.w;
      for (const j of [x > 0 ? i - 1 : -1, x < w.w - 1 ? i + 1 : -1, i - w.w, i + w.w]) {
        if (j >= 0 && j < sea.length && w.data[j] && !sea[j]) {
          sea[j] = 1;
          stack.push(j);
        }
      }
    }
    const out: number[] = [];
    for (let y = 1; y < w.h - 1; y++) {
      for (let x = 1; x < w.w - 1; x++) {
        const i = y * w.w + x;
        if (!sea[i]) continue;
        if (!w.data[i - 1] || !w.data[i + 1] || !w.data[i - w.w] || !w.data[i + w.w]) out.push(i);
      }
    }
    return out;
  }, [p.water]);

  const shown = hints.filter((h) => h.state !== "rejected");
  const sel = hints.find((h) => h.id === selected) ?? null;
  const handles = (h: Hint): Pos[] => (h.at ? [h.at as Pos] : ((h.points ?? []) as Pos[]));

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(canvasSize.w * dpr);
    c.height = Math.round(canvasSize.h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#e9e2d2";
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
    const [x0, y0, x1, y1] = ext;
    const rect = [sx(x0), sy(y0), (x1 - x0) * k, (y1 - y0) * k] as const;
    if (img) ctx.drawImage(img, ...rect);
    if (layer) {
      ctx.globalAlpha = view === "heights" ? strength / 100 : Math.min(1, (strength / 100) * 1.15);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(layer, ...rect);
      ctx.globalAlpha = 1;
    }
    if (!showHints) return;
    const faint = view !== "picture" && !!layer;
    // The coast: where the picture's sea meets the land.
    const coast = hints.find((h) => h.kind === "coast" && h.state !== "rejected");
    if (coast && p.water && coastCells.length) {
      ctx.strokeStyle = coast.state === "accepted" ? INK.coast : "rgba(31,63,102,0.45)";
      ctx.lineWidth = 1.8;
      const ww = p.water.w;
      const d = p.water.data;
      const cw = ((x1 - x0) / ww) * k;
      const ch = ((y1 - y0) / p.water.h) * k;
      ctx.beginPath();
      // Each edge the sea shares with the land.
      for (const i of coastCells) {
        const left = rect[0] + (i % ww) * cw;
        const top_ = rect[1] + ((i / ww) | 0) * ch;
        if (!d[i - 1]) {
          ctx.moveTo(left, top_);
          ctx.lineTo(left, top_ + ch);
        }
        if (!d[i + 1]) {
          ctx.moveTo(left + cw, top_);
          ctx.lineTo(left + cw, top_ + ch);
        }
        if (!d[i - ww]) {
          ctx.moveTo(left, top_);
          ctx.lineTo(left + cw, top_);
        }
        if (!d[i + ww]) {
          ctx.moveTo(left, top_ + ch);
          ctx.lineTo(left + cw, top_ + ch);
        }
      }
      ctx.stroke();
    }
    for (const h of shown) drawHint(ctx, h, h.id === selected, h.id === hover, faint);
    if (sel) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#9a3b1c";
      ctx.lineWidth = 1.5;
      for (const q of handles(sel)) {
        ctx.fillRect(sx(q[0]) - 4, sy(q[1]) - 4, 8, 8);
        ctx.strokeRect(sx(q[0]) - 4, sy(q[1]) - 4, 8, 8);
      }
    }
    if (drawing && drawing.length) {
      const pts = cursor ? [...drawing, cursor] : drawing;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#9a3b1c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1]))));
      if (tool === "zone" && pts.length > 2) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9a3b1c";
      for (const q of drawing) ctx.fillRect(sx(q[0]) - 3, sy(q[1]) - 3, 6, 6);
    }
  });

  function drawHint(
    ctx: CanvasRenderingContext2D,
    h: Hint,
    isSel: boolean,
    isHover: boolean,
    faint: boolean,
  ) {
    const waiting = h.state === "waiting";
    const ink = INK[h.kind];
    ctx.save();
    ctx.globalAlpha = (waiting ? 0.6 : 1) * (faint ? 0.75 : 1);
    ctx.setLineDash(waiting ? [6, 4] : []);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    const pts = ((h.points ?? []) as Pos[]).map((q): Pos => [sx(q[0]), sy(q[1])]);
    const path = (closed: boolean) => {
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      if (closed) ctx.closePath();
    };
    if (isSel || isHover) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.globalAlpha = isSel ? 0.45 : 0.25;
      ctx.strokeStyle = "#e08a5f";
      ctx.lineWidth = 9;
      if (h.at) {
        ctx.beginPath();
        ctx.arc(sx(h.at[0]), sy(h.at[1]), 11, 0, Math.PI * 2);
        ctx.stroke();
      } else if (pts.length) {
        path(ZONE_KINDS.includes(h.kind));
        ctx.stroke();
      }
      ctx.restore();
    }
    const arrows = (every: number) => {
      // Arrows downstream along a line.
      let along = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        along += l;
        if (along < every) continue;
        along = 0;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        ctx.beginPath();
        ctx.moveTo(mx + Math.cos(ang) * 6, my + Math.sin(ang) * 6);
        ctx.lineTo(mx + Math.cos(ang + 2.5) * 6, my + Math.sin(ang + 2.5) * 6);
        ctx.lineTo(mx + Math.cos(ang - 2.5) * 6, my + Math.sin(ang - 2.5) * 6);
        ctx.closePath();
        ctx.fill();
      }
    };
    switch (h.kind) {
      case "lake":
      case "highland":
      case "lowland":
      case "plain":
      case "marsh": {
        if (pts.length < 3) break;
        path(true);
        ctx.globalAlpha *= faint ? 0.12 : h.kind === "lake" ? 0.5 : 0.18;
        ctx.fill();
        ctx.globalAlpha = (waiting ? 0.6 : 1) * (faint ? 0.75 : 1);
        ctx.lineWidth = 1.6;
        if (h.kind === "marsh") ctx.setLineDash([3, 3]);
        else if (h.kind !== "lake") ctx.setLineDash([7, 4]);
        path(true);
        ctx.stroke();
        break;
      }
      case "river":
      case "valley": {
        if (pts.length < 2) break;
        if (h.flip) pts.reverse();
        ctx.lineWidth = h.kind === "river" ? 2.4 : 2;
        if (h.kind === "valley") ctx.setLineDash([8, 5]);
        path(false);
        ctx.stroke();
        ctx.setLineDash([]);
        arrows(70);
        break;
      }
      case "road": {
        if (pts.length < 2) break;
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 4]);
        path(false);
        ctx.stroke();
        break;
      }
      case "ridge":
      case "cliff": {
        if (pts.length < 2) break;
        ctx.lineWidth = h.kind === "ridge" ? 3 : 2.2;
        path(false);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.4;
        // Teeth along a ridge's crest; ticks down a cliff's low side.
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const nx = -(b[1] - a[1]) / (l || 1);
          const ny = (b[0] - a[0]) / (l || 1);
          const side = h.kind === "cliff" ? (h.flip ? -1 : 1) : 1;
          for (let s = 6; s < l; s += 9) {
            const x = a[0] + ((b[0] - a[0]) * s) / l;
            const y = a[1] + ((b[1] - a[1]) * s) / l;
            ctx.beginPath();
            if (h.kind === "ridge") {
              ctx.moveTo(x - nx * 4, y - ny * 4);
              ctx.lineTo(x + nx * 4, y + ny * 4);
            } else {
              ctx.moveTo(x, y);
              ctx.lineTo(x + nx * 6 * side, y + ny * 6 * side);
            }
            ctx.stroke();
          }
        }
        break;
      }
      case "peak":
      case "hollow": {
        if (!h.at) break;
        const x = sx(h.at[0]);
        const y = sy(h.at[1]);
        const up = h.kind === "peak" ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x, y + up * 8);
        ctx.lineTo(x - 7, y - up * 5);
        ctx.lineTo(x + 7, y - up * 5);
        ctx.closePath();
        ctx.fillStyle = "#fffdf8";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.font = "600 11px system-ui, sans-serif";
        const text = heightWords(heightOf(h), topH);
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(35,32,27,0.78)";
        ctx.fillRect(x - tw / 2 - 4, y - 26, tw + 8, 15);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, x - tw / 2, y - 15);
        break;
      }
      default:
        break;
    }
    if (waiting && h.conf !== undefined) {
      const m = h.at ? [sx(h.at[0]), sy(h.at[1])] : pts[Math.floor(pts.length / 2)];
      if (m) {
        const text = `${percent(h.conf)}?`;
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.font = "600 11px system-ui, sans-serif";
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = "#f5d58a";
        ctx.fillRect(m[0]! + 8, m[1]! - 8, tw + 8, 15);
        ctx.fillStyle = "#5a3a00";
        ctx.fillText(text, m[0]! + 12, m[1]! + 3);
      }
    }
    ctx.restore();
  }

  // ---- Pointing ----------------------------------------------------------------------------------

  const reachPx = phone ? 14 : 8;
  const segDist = (q: Pos, a: Pos, b: Pos) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
  };
  const inside = (q: Pos, ring: readonly Pos[]) => {
    let inn = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (
        a[1] > q[1] !== b[1] > q[1] &&
        q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inn = !inn;
    }
    return inn;
  };
  /** The hint under a point of the screen: points first, then lines, then zones, smallest first. */
  const hintAt = (x: number, y: number): Hint | null => {
    const q: Pos = [x, y];
    const screen = (h: Hint) => ((h.points ?? []) as Pos[]).map((r): Pos => [sx(r[0]), sy(r[1])]);
    for (const h of shown) {
      if (h.at && Math.hypot(sx(h.at[0]) - x, sy(h.at[1]) - y) < reachPx + 4) return h;
    }
    for (const h of shown) {
      if (!LINE_KINDS.includes(h.kind)) continue;
      const pts = screen(h);
      for (let i = 1; i < pts.length; i++) if (segDist(q, pts[i - 1]!, pts[i]!) < reachPx) return h;
    }
    let best: Hint | null = null;
    let area = Infinity;
    for (const h of shown) {
      if (!ZONE_KINDS.includes(h.kind)) continue;
      const pts = screen(h);
      if (pts.length < 3) continue;
      const near = pts.some((r, i) => segDist(q, r, pts[(i + 1) % pts.length]!) < reachPx);
      if (!near && !inside(q, pts)) continue;
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const r = pts[i]!;
        const s = pts[(i + 1) % pts.length]!;
        a += r[0] * s[1] - s[0] * r[1];
      }
      if (Math.abs(a) < area) {
        area = Math.abs(a);
        best = h;
      }
    }
    return best;
  };
  const drag = useRef<
    | { kind: "pan"; from: Pos; c: Pos; moved: boolean }
    | { kind: "hint"; id: string; from: Pos; start: Hint; handle: number | null; moved: boolean }
    | null
  >(null);
  const touches = useRef(new Map<number, Pos>());
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }): Pos => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const select = (id: string | null) => {
    setSelected(id);
    if (id && tab !== "hints") setTab("hints");
  };

  /** Adds a point of the line or zone being drawn, or finishes it. */
  const addPoint = (at: Pos, x: number, y: number) => {
    if (tool === "peak" || tool === "hollow") {
      const h: Hint = {
        id: newItemId(),
        kind: tool,
        at: at.map((v) => Math.round(v * 1000) / 1000) as Pos,
        h: tool === "peak" ? 0.85 : 0.06,
        strength: 0.7,
        state: "accepted",
        by: "you",
      };
      setHints([...hints, h]);
      setSelected(h.id);
      return;
    }
    const pts = drawing ?? [];
    const close = (i: number) =>
      pts[i] && Math.hypot(sx(pts[i][0]) - x, sy(pts[i][1]) - y) < reachPx + 2;
    if (tool === "zone" ? pts.length >= 3 && close(0) : pts.length >= 2 && close(pts.length - 1)) {
      return finishDrawing(pts);
    }
    setDrawing([...pts, at]);
  };
  const finishDrawing = (pts: Pos[] | null = drawing) => {
    setDrawing(null);
    setCursor(null);
    if (!pts) return;
    const kind: TerrainHintKind = tool === "zone" ? zoneKind : (tool as TerrainHintKind);
    if (pts.length < (tool === "zone" ? 3 : 2)) return;
    const h: Hint = {
      id: newItemId(),
      kind,
      points: pts.map((q) => q.map((v) => Math.round(v * 1000) / 1000) as Pos),
      ...(kind === "ridge" ? { h: 0.7 } : {}),
      ...(kind === "cliff" ? { h: 0.12 } : {}),
      ...(kind === "highland" ? { h: 0.45, h2: 0.75 } : {}),
      ...(kind === "lowland" ? { h: 0.08 } : {}),
      ...(kind === "plain" ? { h: 0.16 } : {}),
      ...(["valley", "marsh"].includes(kind) ? {} : { strength: 0.7 }),
      state: "accepted",
      by: "you",
    };
    setHints([...hints, h]);
    setSelected(h.id);
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = local(e);
    canvas.current!.setPointerCapture(e.pointerId);
    touches.current.set(e.pointerId, [x, y]);
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()] as [Pos, Pos];
      pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: zoom.k };
      drag.current = null;
      return;
    }
    const at = toMap(x, y);
    if (tool !== "select") {
      drag.current = { kind: "pan", from: [x, y], c: [zoom.cx, zoom.cy], moved: false };
      return;
    }
    // A handle of the selected hint, then any hint; on a phone one finger drags only the selected.
    if (sel && !sel.by.startsWith("feature:")) {
      const hs = handles(sel);
      const i = hs.findIndex((q) => Math.hypot(sx(q[0]) - x, sy(q[1]) - y) < reachPx);
      if (i >= 0) {
        past.current.push(step);
        future.current = [];
        drag.current = {
          kind: "hint",
          id: sel.id,
          from: at,
          start: sel,
          handle: sel.at ? null : i,
          moved: false,
        };
        return;
      }
    }
    const hit = hintAt(x, y);
    if (hit && (!phone || hit.id === selected) && !hit.by.startsWith("feature:")) {
      past.current.push(step);
      future.current = [];
      drag.current = { kind: "hint", id: hit.id, from: at, start: hit, handle: null, moved: false };
      select(hit.id);
      return;
    }
    drag.current = { kind: "pan", from: [x, y], c: [zoom.cx, zoom.cy], moved: false };
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = local(e);
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, [x, y]);
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()] as [Pos, Pos];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      setZoom((z) => ({
        ...z,
        k: Math.max(1, Math.min(12, pinch.current!.k * (d / pinch.current!.d))),
      }));
      return;
    }
    const d = drag.current;
    if (!d) {
      if (drawing) setCursor(toMap(x, y));
      if (e.pointerType === "mouse" && tool === "select") setHover(hintAt(x, y)?.id ?? null);
      return;
    }
    if (d.kind === "pan") {
      const dx = x - d.from[0];
      const dy = y - d.from[1];
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setZoom((z) => ({ ...z, cx: d.c[0] - dx / k, cy: d.c[1] - dy / k }));
      return;
    }
    const at = toMap(x, y);
    const dx = at[0] - d.from[0];
    const dy = at[1] - d.from[1];
    if (!d.moved && Math.hypot(dx * k, dy * k) < 3) return;
    d.moved = true;
    const s = d.start;
    const shift = (q: readonly number[]): Pos => [q[0]! + dx, q[1]! + dy];
    const patch: Partial<Hint> = s.at
      ? { at: shift(s.at) }
      : {
          points: (s.points ?? []).map((q, i) =>
            d.handle === null || d.handle === i ? shift(q) : q,
          ) as Pos[],
        };
    // Moving a waiting suggestion accepts it.
    if (s.state === "waiting") patch.state = "accepted";
    change(d.id, patch, false);
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    const [x, y] = local(e);
    if (d?.kind === "hint" && !d.moved) {
      // Only a click: nothing changed, so no step to undo.
      past.current.pop();
      return;
    }
    if (d?.kind === "hint") return;
    if (d?.kind === "pan" && d.moved) return;
    if (tool !== "select") return addPoint(toMap(x, y), x, y);
    const hit = hintAt(x, y);
    select(hit?.id ?? null);
  };
  const zoomBy = (f: number) => setZoom((z) => ({ ...z, k: Math.max(1, Math.min(12, z.k * f)) }));
  const fitAll = () => setZoom({ k: 1, cx: (ext[0] + ext[2]) / 2, cy: (ext[1] + ext[3]) / 2 });
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      const before = toMap(x, y);
      const f = Math.exp(-e.deltaY * 0.0015);
      setZoom((z) => {
        const nk = Math.max(1, Math.min(12, z.k * f));
        const kk = fit * nk;
        return {
          k: nk,
          cx: before[0] - (x - canvasSize.w / 2) / kk,
          cy: before[1] - (y - canvasSize.h / 2) / kk,
        };
      });
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  });

  // ---- Reviewing ---------------------------------------------------------------------------------

  const [tab, setTab] = useState<Tab>(generated ? "build" : "hints");
  const [open, setOpen] = useState<Set<TerrainHintKind>>(new Set());
  const waiting = hints.filter((h) => h.state === "waiting");
  const accepted = hints.filter((h) => h.state === "accepted");
  const nextSuggestion = (from: string | null, back = false) => {
    const list = waiting.filter((h) => h.id !== from);
    if (list.length === 0) return null;
    const order = hints.filter((h) => h.state === "waiting" || h.id === from);
    const at = order.findIndex((h) => h.id === from);
    const pick = back
      ? (order[(at - 1 + order.length) % order.length] ?? list[0]!)
      : (order[(at + 1) % order.length] ?? list[0]!);
    return pick.id === from ? null : pick;
  };
  const goNext = (back = false) => {
    const n = nextSuggestion(selected, back);
    if (n) {
      select(n.id);
      setOpen((o) => new Set(o).add(n.kind));
    }
  };
  /** Accept or reject one; a suggestion's review goes on to the next waiting one. */
  const decide = (h: Hint, state: Hint["state"]) => {
    const wasWaiting = h.state === "waiting";
    const nextOne = wasWaiting ? nextSuggestion(h.id) : null;
    setHints(hints.map((x) => (x.id === h.id ? { ...x, state } : x)));
    if (wasWaiting && h.id === selected) setSelected(nextOne?.id ?? null);
  };
  const remove = (h: Hint) => {
    setHints(hints.filter((x) => x.id !== h.id));
    if (selected === h.id) setSelected(null);
  };
  const allOfKind = (kind: TerrainHintKind, state: "accepted" | "rejected") =>
    setHints(hints.map((x) => (x.kind === kind && x.by !== "you" ? { ...x, state } : x)));
  const acceptLikely = () =>
    setHints(
      hints.map((x) =>
        x.state === "waiting" && (x.conf ?? 0) >= 0.5 ? { ...x, state: "accepted" } : x,
      ),
    );
  const likelyCount = waiting.filter((x) => (x.conf ?? 0) >= 0.5).length;

  // ---- Use ---------------------------------------------------------------------------------------

  const [saving, setSaving] = useState<string | null>(null);
  const use = async () => {
    if (!size || saving) return;
    if (!online) {
      p.onKeep(forStore(hints));
      return;
    }
    setSaving("Building the height map at full size…");
    try {
      const naturalW = img?.naturalWidth ?? size.w;
      const image = await imageFromHints({
        url: pictureUrl,
        hints: inUse(hints, ext, size.w, size.h),
        settings,
        width: Math.min(2048, naturalW),
      });
      setSaving("Saving it in the library…");
      const base = (map.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "map").toLowerCase();
      const file = new File(
        [image.png as BlobPart],
        `${base.replace(/\s+/g, "-")}-heights-generated.png`,
        {
          type: "image/png",
        },
      );
      const { path } = await api.upload(file);
      const high = image.high > 0 ? image.high : 1;
      const terrain: MapTerrain = {
        image: path,
        seaLevel: Math.round(image.seaLevel * 1000) / 1000,
        ...(topH
          ? {
              range: [Math.round((image.low / high) * topH.value), Math.round(topH.value)] as [
                number,
                number,
              ],
              rangeUnit: topH.unit,
            }
          : {}),
        generated: { from: "hints", ...settings, hints: hintsHash(forStore(hints)) },
      };
      p.onUse(terrain, forStore(hints), accepted.length);
    } catch {
      setSaving(null);
      setFailed("The height map could not be saved. Try again when the connection is steady.");
    }
  };

  // ---- Keys --------------------------------------------------------------------------------------

  const cancel = () => {
    if (drawing) {
      setDrawing(null);
      setCursor(null);
      return;
    }
    if (tool !== "select") return setTool("select");
    if (selected) return setSelected(null);
    p.onCancel();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && key === "z") {
      done();
      return e.shiftKey ? redo() : undo();
    }
    if (mod) return;
    if (e.key === "Enter" && drawing) {
      done();
      return finishDrawing();
    }
    if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    const t = TOOLS.find((x) => x.key.toLowerCase() === key);
    if (t && !e.shiftKey) {
      done();
      setDrawing(null);
      return setTool(t.id);
    }
    if (key === "n") {
      done();
      return goNext(e.shiftKey);
    }
    if (key === "a" && sel && sel.state === "waiting") {
      done();
      return decide(sel, "accepted");
    }
    if ((key === "x" || e.key === "Delete" || e.key === "Backspace") && sel) {
      done();
      return sel.by === "you" ? remove(sel) : decide(sel, "rejected");
    }
    if (key === "h") {
      done();
      return setShowHints(!showHints);
    }
    if (key === "b") {
      done();
      setWantBuild(true);
      return setRebuild((n) => n + 1);
    }
    if (key === "s" && !e.shiftKey) {
      done();
      return setSettings({ seed: settings.seed + 1 });
    }
    if (["1", "2", "3", "4"].includes(key)) {
      done();
      return setView(VIEWS[Number(key) - 1]!.id);
    }
    if (key === "+" || key === "=") {
      done();
      return zoomBy(1.25);
    }
    if (key === "-") {
      done();
      return zoomBy(0.8);
    }
    if (key === "0") {
      done();
      return fitAll();
    }
    const arrows: Record<string, Pos> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    };
    const m = arrows[key];
    if (m && sel && !sel.by.startsWith("feature:") && e.target === canvas.current) {
      done();
      const by = (e.shiftKey ? 10 : 1) / k;
      const shift = (q: readonly number[]): Pos => [q[0]! + m[0] * by, q[1]! + m[1] * by];
      change(sel.id, sel.at ? { at: shift(sel.at) } : { points: (sel.points ?? []).map(shift) });
    }
  };

  // ---- What is said ------------------------------------------------------------------------------

  const verdict: { tone: "good" | "warn" | "bad"; text: string } = (() => {
    if (finding) return { tone: "good", text: "Looking at the picture…" };
    if (!online)
      return {
        tone: "warn",
        text: "Offline: Use keeps the hints, to build and use once back online.",
      };
    if (checks && checks.rivers > checks.drain)
      return { tone: "bad", text: `Rivers drain correctly: ${checks.drain}/${checks.rivers}` };
    if (checks && checks.coast !== null && checks.coast < 0.9)
      return { tone: "warn", text: `Lines up with the painted coast: ${percent(checks.coast)}` };
    if (waiting.length && !built)
      return {
        tone: "warn",
        text: `${plural(waiting.length, "suggestion waits", "suggestions wait")} for you; build the height map to use it.`,
      };
    if (!built) return { tone: "good", text: "Build the height map to use it." };
    if (waiting.length)
      return { tone: "warn", text: `${plural(waiting.length, "suggestion")} not used yet` };
    return { tone: "good", text: "Ready to use." };
  })();

  const checkList: {
    tone: "good" | "warn" | "bad";
    text: string;
    advice?: string;
    act?: ReactNode;
  }[] = [];
  if (checks) {
    if (checks.coast !== null) {
      checkList.push({
        tone: checks.coast >= 0.9 ? "good" : "warn",
        text: `Lines up with the painted coast: ${percent(checks.coast)}`,
      });
    }
    if (checks.rivers) {
      const ok = checks.drain === checks.rivers;
      checkList.push({
        tone: ok ? "good" : "bad",
        text: `Rivers drain correctly: ${checks.drain}/${checks.rivers}`,
        advice: ok
          ? "Water from each river's source runs along it to the sea or a lake."
          : "Water put at a river's source runs off elsewhere.",
        ...(ok || settings.carve
          ? {}
          : {
              act: (
                <button type="button" onClick={() => setSettings({ carve: true })}>
                  Carve rivers
                </button>
              ),
            }),
      });
    }
    if (checks.lakes) {
      checkList.push({
        tone: checks.lakesHeld === checks.lakes ? "good" : "warn",
        text: `Lakes hold water: ${checks.lakesHeld}/${checks.lakes}`,
      });
    }
    if (checks.peaksAsked) {
      checkList.push({
        tone: checks.peaks === checks.peaksAsked ? "good" : "warn",
        text: `Peaks reach their heights: ${checks.peaks}/${checks.peaksAsked}`,
        ...(checks.peaks < checks.peaksAsked
          ? { advice: "Hints pull against each other near a peak." }
          : {}),
      });
    }
    if (waiting.length) {
      checkList.push({
        tone: "warn",
        text: `${plural(waiting.length, "suggestion")} not used yet`,
        act: (
          <button
            type="button"
            onClick={() => {
              setTab("hints");
              goNext();
            }}
          >
            Review
          </button>
        ),
      });
    }
    if (!topH) {
      checkList.push({
        tone: "warn",
        text: "Heights are relative",
        advice: "Give the highest point to make slopes and travelling times real.",
      });
    }
  }
  const order = { bad: 0, warn: 1, good: 2 };
  checkList.sort((a, b) => order[a.tone] - order[b.tone]);

  // ---- The parts ---------------------------------------------------------------------------------

  const toolStrip = (
    <div
      className={`hints-tools${phone ? " is-column" : ""}`}
      role="toolbar"
      aria-label="Hint tools"
    >
      {TOOLS.map((t) => (
        <Tip key={t.id} label={t.tip} keys={t.key}>
          <button
            type="button"
            aria-label={t.label}
            aria-pressed={tool === t.id}
            onClick={() => {
              setDrawing(null);
              setTool(t.id);
            }}
          >
            <t.icon size={15} aria-hidden />
            {!phone && <span>{t.label}</span>}
          </button>
        </Tip>
      ))}
      {!phone && (
        <>
          <select
            aria-label="Kind of zone to draw"
            value={zoneKind}
            onChange={(e) => {
              setZoneKind(e.target.value as ZoneKind);
              setTool("zone");
            }}
          >
            {ZONE_KINDS_DRAWN.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
          <Tip label="Undo" keys="Ctrl+Z">
            <button
              type="button"
              aria-label="Undo"
              aria-disabled={!past.current.length || undefined}
              onClick={undo}
            >
              <Undo2 size={15} aria-hidden />
            </button>
          </Tip>
          <Tip label="Redo" keys="Shift+Ctrl+Z">
            <button
              type="button"
              aria-label="Redo"
              aria-disabled={!future.current.length || undefined}
              onClick={redo}
            >
              <Redo2 size={15} aria-hidden />
            </button>
          </Tip>
        </>
      )}
    </div>
  );

  const banner =
    tool === "select"
      ? null
      : tool === "peak" || tool === "hollow"
        ? `Click to place a ${tool} · Esc to stop`
        : drawing && drawing.length
          ? tool === "zone"
            ? "Click on, then the first point again, double-click or Enter to finish · Esc to stop"
            : "Click on, then the last point again, double-click or Enter to finish · Esc to stop"
          : `Click to start the ${tool === "zone" ? `${zoneKind} zone` : tool} · Esc to stop`;

  const preview = (
    <div className="hints-preview">
      {!phone && toolStrip}
      <div className="hints-canvas" ref={box}>
        <canvas
          ref={canvas}
          tabIndex={0}
          role="application"
          aria-roledescription="hint editor"
          aria-label={`The map with its terrain hints. Tools: V select, P peak, O hollow, R ridge, Y valley, C cliff, Z zone. N goes to the next suggestion; A accepts it, X rejects it.${sel ? ` Selected: ${hintName(sel, topH, kpu)}, ${sel.state === "waiting" ? "waiting" : sel.state === "accepted" ? "in use" : "rejected"}.` : ""}`}
          className={`is-${tool}`}
          style={{ width: canvasSize.w, height: canvasSize.h }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={(e) => {
            touches.current.delete(e.pointerId);
            drag.current = null;
            pinch.current = null;
          }}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() =>
            drawing &&
            finishDrawing(
              drawing.slice(0, -1).length >= (tool === "zone" ? 3 : 2)
                ? drawing.slice(0, -1)
                : drawing,
            )
          }
        />
        {phone && toolStrip}
        <div className="hints-badges" role="status" aria-label="How the build turned out">
          {checks?.coast !== null && checks?.coast !== undefined && (
            <span className={checks.coast >= 0.9 ? "is-good" : "is-warn"}>
              Coast {percent(checks.coast)}
            </span>
          )}
          {checks && checks.rivers > 0 && (
            <span className={checks.drain === checks.rivers ? "is-good" : "is-bad"}>
              Rivers drain {checks.drain}/{checks.rivers}
            </span>
          )}
          {stale && <span className="is-warn">Hints changed</span>}
          {building && <span>Building…</span>}
        </div>
        {banner && (
          <p className="hints-banner" role="status">
            {banner}
          </p>
        )}
        {(finding || saving) && (
          <div className="hints-busy" role="status">
            <span />
            <b>{saving ?? "Looking at the picture…"}</b>
          </div>
        )}
        <div className="hints-zoom">
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => zoomBy(1.25)}
          >
            <Plus size={15} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => zoomBy(0.8)}
          >
            <Minus size={15} aria-hidden />
          </button>
          <button type="button" aria-label="Show it all" title="Show it all (0)" onClick={fitAll}>
            <Maximize2 size={15} aria-hidden />
          </button>
        </div>
      </div>
      <div className="hints-views">
        <span className="find-mode" role="group" aria-label="Show">
          {VIEWS.map((v, i) => (
            <Tip key={v.id} label={v.tip} keys={String(i + 1)}>
              <button
                type="button"
                aria-pressed={view === v.id}
                aria-disabled={(v.id !== "picture" && !built) || undefined}
                onClick={() => (v.id === "picture" || built) && setView(v.id)}
              >
                {phone && v.id === "contours" ? "Lines" : v.label}
              </button>
            </Tip>
          ))}
        </span>
        <Tip label="Show the hints over the map" keys="H">
          <button
            type="button"
            className="hints-chip"
            aria-pressed={showHints}
            onClick={() => setShowHints(!showHints)}
          >
            Hints
          </button>
        </Tip>
        {!phone && (
          <label>
            Strength
            <input
              type="range"
              min={0}
              max={100}
              value={strength}
              aria-label="Strength of the heights over the picture"
              onChange={(e) => setStrength(Number(e.target.value))}
            />
          </label>
        )}
      </div>
    </div>
  );

  const holds = (h: Hint) => (
    <label className="hints-slider">
      <span>Holds</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        aria-label="Holds"
        value={h.strength ?? 0.7}
        onChange={(e) => change(h.id, { strength: Number(e.target.value) })}
      />
      <small>
        {(h.strength ?? 0.7) < 0.35 ? "a nudge" : (h.strength ?? 0.7) > 0.85 ? "exactly" : "firmly"}
      </small>
    </label>
  );
  const heightSlider = (h: Hint, label: string, key: "h" | "h2", fallback: number) => (
    <label className="hints-slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        aria-label={label}
        value={h[key] ?? fallback}
        onChange={(e) => change(h.id, { [key]: Number(e.target.value) } as Partial<Hint>)}
      />
      <small>{heightWords(h[key] ?? fallback, topH)}</small>
    </label>
  );
  const editor = sel && (
    <section className="hints-selected" aria-label="The selected hint">
      <h4>{hintName(sel, topH, kpu)}</h4>
      <p className="muted">
        {sel.by === "you"
          ? "Drawn by you"
          : sel.by.startsWith("feature:")
            ? "From your map"
            : `Found · ${percent(sel.conf ?? 1)}`}{" "}
        ·{" "}
        {sel.state === "accepted"
          ? "in use"
          : sel.state === "waiting"
            ? "waiting for you"
            : "rejected"}
      </p>
      <p>{reasonOf(sel)}</p>
      {["peak", "hollow", "ridge", "lowland", "plain"].includes(sel.kind) &&
        heightSlider(sel, "Height", "h", heightOf(sel))}
      {sel.kind === "highland" && (
        <>
          {heightSlider(sel, "From", "h", heightOf(sel))}
          {heightSlider(sel, "To", "h2", Math.max(heightOf(sel), 0.75))}
        </>
      )}
      {sel.kind === "cliff" && heightSlider(sel, "Height of the step", "h", 0.12)}
      {(sel.kind === "cliff" || sel.kind === "river" || sel.kind === "valley") && (
        <label className="hints-check">
          <input
            type="checkbox"
            checked={!!sel.flip}
            onChange={(e) => {
              const next = { ...sel } as Hint;
              if (e.target.checked) next.flip = true;
              else delete next.flip;
              setHints(hints.map((x) => (x.id === sel.id ? { ...next, touched: true } : x)));
            }}
          />
          {sel.kind === "cliff" ? "High side the other way" : "Flows the other way"}
        </label>
      )}
      {!["sea", "coast", "lake", "river", "marsh", "road"].includes(sel.kind) && holds(sel)}
      {sel.by === "you" && ZONE_KINDS.includes(sel.kind) && sel.kind !== "lake" && (
        <label className="hints-slider">
          <span>Kind</span>
          <select
            value={sel.kind}
            onChange={(e) => change(sel.id, { kind: e.target.value as TerrainHintKind })}
          >
            {ZONE_KINDS_DRAWN.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hints-acts">
        {sel.state === "waiting" && (
          <button type="button" className="primary" onClick={() => decide(sel, "accepted")}>
            <Check size={14} aria-hidden /> Accept
          </button>
        )}
        {sel.state !== "rejected" && sel.by !== "you" && (
          <button type="button" onClick={() => decide(sel, "rejected")}>
            <X size={14} aria-hidden /> Reject
          </button>
        )}
        {sel.state === "rejected" && (
          <button type="button" onClick={() => decide(sel, "accepted")}>
            Put back
          </button>
        )}
        {sel.by === "you" && (
          <button type="button" onClick={() => remove(sel)}>
            <Trash2 size={14} aria-hidden /> Delete
          </button>
        )}
      </p>
    </section>
  );

  const kindRows = KINDS.filter((k) => hints.some((h) => h.kind === k.kind)).map((k) => {
    const list = hints.filter((h) => h.kind === k.kind);
    const used = list.filter((h) => h.state === "accepted").length;
    const wait = list.filter((h) => h.state === "waiting").length;
    const isOpen = open.has(k.kind);
    return (
      <li key={k.kind} className="hints-kind">
        <div className="hints-kind-row">
          <button
            type="button"
            className="hints-expand"
            aria-expanded={isOpen}
            onClick={() => {
              const next = new Set(open);
              if (isOpen) next.delete(k.kind);
              else next.add(k.kind);
              setOpen(next);
            }}
          >
            {isOpen ? (
              <ChevronDown size={14} aria-hidden />
            ) : (
              <ChevronRight size={14} aria-hidden />
            )}
            <span className="hints-swatch" style={{ background: INK[k.kind] }} aria-hidden />
            <strong>{k.name}</strong>
            <span className="muted">
              {used} of {list.length} used{wait ? ` · ${wait} waiting` : ""}
            </span>
          </button>
          <span className="hints-yesno">
            <Tip label={`Use all ${k.name.toLowerCase()}`}>
              <button
                type="button"
                aria-label={`Use all ${k.name.toLowerCase()}`}
                onClick={() => allOfKind(k.kind, "accepted")}
              >
                <Check size={14} aria-hidden />
              </button>
            </Tip>
            <Tip label={`Reject all ${k.name.toLowerCase()}`}>
              <button
                type="button"
                aria-label={`Reject all ${k.name.toLowerCase()}`}
                onClick={() => allOfKind(k.kind, "rejected")}
              >
                <X size={14} aria-hidden />
              </button>
            </Tip>
          </span>
        </div>
        {isOpen && (
          <ul className="hints-items">
            {list.map((h) => {
              const name = hintName(h, topH, kpu);
              return (
                <li
                  key={h.id}
                  className={`is-${h.state}${h.id === selected ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="hints-item"
                    aria-current={h.id === selected || undefined}
                    onClick={() => select(h.id)}
                    onPointerEnter={() => setHover(h.id)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <span className="hints-name">{name}</span>
                    {h.conf !== undefined && (
                      <span className="hints-conf" aria-label={`${percent(h.conf)} sure`}>
                        <i style={{ width: `${Math.round(h.conf * 100)}%` }} />
                        <small>{percent(h.conf)}</small>
                      </span>
                    )}
                  </button>
                  <span className="hints-yesno">
                    {h.by === "you" ? (
                      <button type="button" aria-label={`Delete ${name}`} onClick={() => remove(h)}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={`Use ${name}`}
                          aria-pressed={h.state === "accepted"}
                          onClick={() => decide(h, "accepted")}
                        >
                          <Check size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Reject ${name}`}
                          aria-pressed={h.state === "rejected"}
                          onClick={() => decide(h, "rejected")}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  });

  const hintsTab = (
    <section className="hints-tab" aria-label="Hints">
      {editor}
      <p className="hints-sum">
        <strong>{accepted.length}</strong> {accepted.length === 1 ? "hint" : "hints"} in use
        {waiting.length > 0 && (
          <>
            , <strong>{waiting.length}</strong> waiting for you
          </>
        )}
        . {foundNote && `Found in ${(foundNote.ms / 1000).toFixed(2)} s from the picture alone. `}
        Click a hint on the map or in the list to check it; drag to move it.
      </p>
      <p className="hints-acts">
        <button
          type="button"
          aria-disabled={!likelyCount || undefined}
          onClick={() => likelyCount && acceptLikely()}
        >
          <Check size={14} aria-hidden /> Accept the likely ones
        </button>
        <Tip label="Go to the next suggestion" keys="N">
          <button
            type="button"
            className="quiet"
            aria-disabled={!waiting.length || undefined}
            onClick={() => goNext()}
          >
            Next suggestion
          </button>
        </Tip>
        <Tip label="Look at the picture again. Your own hints and changes stay.">
          <button
            type="button"
            className="quiet"
            onClick={() => find("again")}
            aria-disabled={finding || undefined}
          >
            Find again
          </button>
        </Tip>
      </p>
      <ul className="hints-kinds">{kindRows}</ul>
      {hints.length === 0 && !finding && (
        <p className="muted">
          No hints yet. Find hints looks at the picture; the tools above the map draw your own.
        </p>
      )}
      {foundNote?.notUsed.length ? (
        <div className="hints-notused">
          <h4>Not used</h4>
          {foundNote.notUsed.map((t) => (
            <p key={t} className="muted">
              {t}
            </p>
          ))}
        </div>
      ) : null}
      <div className="hints-frommap">
        <h4>From your map</h4>
        {hints.some((h) => h.by.startsWith("feature:")) ? (
          <p className="muted">
            Zones and paths whose style counts as something are hints tied to their feature: move
            the feature and the hint moves.
          </p>
        ) : (
          <p className="muted">
            Nothing on this map counts yet. Zones and paths whose style counts as Water, Mountains,
            Marsh, River or Road become hints here, tied to their feature.
          </p>
        )}
      </div>
    </section>
  );

  const slider = (key: "rough" | "sharp" | "erosion", label: string, lo: string, hi: string) => (
    <label className="hints-build-slider">
      <span>
        {label} <output>{Math.round(settings[key] * 100)}</output>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        aria-label={label}
        value={Math.round(settings[key] * 100)}
        onChange={(e) => live({ settings: { ...settings, [key]: Number(e.target.value) / 100 } })}
        onPointerDown={() => {
          past.current.push(step);
          future.current = [];
        }}
        onKeyDown={() => {
          past.current.push(step);
          future.current = [];
        }}
      />
      <small>
        <i>{lo}</i>
        <i>{hi}</i>
      </small>
    </label>
  );
  const savePng = async () => {
    if (!size) return;
    const image = await imageFromHints({
      url: pictureUrl,
      hints: inUse(hints, ext, size.w, size.h),
      settings,
      width: Math.min(2048, img?.naturalWidth ?? size.w),
    });
    const url = URL.createObjectURL(new Blob([image.png as BlobPart], { type: "image/png" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${map.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "map"} heights.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const buildTab = (
    <section className="hints-tab" aria-label="Build">
      <div className="hints-build">
        {slider("rough", "Roughness", "smooth", "rugged")}
        {slider("sharp", "Mountain sharpness", "rounded", "jagged")}
        {slider("erosion", "Erosion", "none", "old, worn land")}
        <div className="hints-build-slider">
          <span>Detail</span>
          <span className="find-mode" role="group" aria-label="Detail">
            {DETAILS.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={settings.detail === d.id}
                onClick={() => setSettings({ detail: d.id })}
              >
                {d.label}
              </button>
            ))}
          </span>
        </div>
        <div className="hints-build-slider">
          <span>
            Variation <output>#{settings.seed}</output>
          </span>
          <p className="hints-acts">
            <Tip label="The same hints, different natural detail" keys="S">
              <button type="button" onClick={() => setSettings({ seed: settings.seed + 1 })}>
                <Dices size={14} aria-hidden /> Another one
              </button>
            </Tip>
          </p>
        </div>
        <label className="hints-check">
          <input
            type="checkbox"
            checked={settings.carve}
            onChange={(e) => setSettings({ carve: e.target.checked })}
          />
          Carve rivers so they drain
        </label>
        <label className="hints-check">
          <input
            type="checkbox"
            checked={settings.lakes}
            onChange={(e) => setSettings({ lakes: e.target.checked })}
          />
          Keep lakes as hollows
        </label>
        <div className="hints-top">
          <label>
            <span>Highest point</span>
            <input
              inputMode="decimal"
              placeholder="relative"
              value={top}
              onChange={(e) => setTop(e.target.value)}
            />
          </label>
          <label>
            <span>Unit</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="m">m</option>
              <option value="ft">ft</option>
            </select>
          </label>
          <small className="muted">
            {topH
              ? "Every height reads in metres or feet; slopes and travelling times are real."
              : "Left empty, heights are relative: low … high."}
          </small>
        </div>
      </div>
      <p className="hints-acts">
        <button
          type="button"
          className="primary"
          aria-disabled={(built && !stale) || building || undefined}
          onClick={() => {
            setWantBuild(true);
            setRebuild((n) => n + 1);
          }}
        >
          <Mountain size={14} aria-hidden />{" "}
          {built && !stale ? "Up to date" : building ? "Building…" : "Build height map"}
        </button>
        {checks && (
          <span className="muted">
            Built in {(checks.ms / 1000).toFixed(2)} s from {plural(accepted.length, "hint")} ·{" "}
            {built!.value.w} × {built!.value.h} working grid
          </span>
        )}
      </p>
      <ul className="terrain-checks">
        {checkList.map((c) => (
          <li key={c.text} className={`is-${c.tone}`}>
            <strong>{c.text}</strong>
            {c.advice && <span className="muted"> {c.advice}</span>} {c.act}
          </li>
        ))}
      </ul>
      <p className="hints-acts">
        <button
          type="button"
          aria-disabled={!built || undefined}
          onClick={() => built && void savePng()}
        >
          <Download size={14} aria-hidden /> Save as PNG
        </button>
        <small className="muted">a grey image, white is high</small>
      </p>
      {p.onPlain && (
        <p className="hints-acts">
          <button type="button" className="quiet" onClick={p.onPlain}>
            Use a height map you have instead…
          </button>
        </p>
      )}
    </section>
  );

  const tabs = (
    <div className="hints-tabs" role="tablist" aria-label="Hints or build">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "hints"}
        onClick={() => setTab("hints")}
      >
        Hints {waiting.length > 0 && <span className="hints-count">{waiting.length} waiting</span>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "build"}
        onClick={() => setTab("build")}
      >
        Build
      </button>
    </div>
  );

  const useLabel = online ? "Use this height map" : "Keep the hints";
  const canUse =
    !!size && !saving && !finding && (online ? hints.some((h) => h.state === "accepted") : true);
  return (
    <DialogFrame
      title="Terrain"
      className="terrain-dialog hints-dialog"
      onCancel={cancel}
      onSubmit={() => canUse && void use()}
    >
      {phone && (
        <div className="hints-phone-head">
          <button type="button" onClick={p.onCancel}>
            Cancel
          </button>
          <strong aria-hidden="true">Terrain</strong>
          <button type="submit" className="primary" aria-disabled={!canUse || undefined}>
            {online ? "Use" : "Keep"}
          </button>
        </div>
      )}
      <div className="hints-body" onKeyDown={keys}>
        {preview}
        <div className="hints-side">
          {tabs}
          {tab === "hints" ? hintsTab : buildTab}
          {failed && (
            <p className="terrain-note" role="alert">
              {failed}
            </p>
          )}
        </div>
      </div>
      <div className="terrain-foot hints-foot">
        {!phone && (
          <button
            type="button"
            className="quiet"
            onClick={() => find("over")}
            aria-disabled={finding || undefined}
          >
            <WandSparkles size={14} aria-hidden /> Start over
          </button>
        )}
        <span className={`terrain-verdict is-${verdict.tone}`} role="status">
          {verdict.text}
        </span>
        {phone && tab === "hints" && (
          <>
            <button
              type="button"
              aria-disabled={!likelyCount || undefined}
              onClick={() => likelyCount && acceptLikely()}
            >
              Accept likely ({likelyCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("build");
                setWantBuild(true);
              }}
            >
              {built ? "Build ›" : "Build height map"}
            </button>
          </>
        )}
        {phone && tab === "build" && (
          <button type="button" onClick={() => setTab("hints")}>
            ‹ Hints
          </button>
        )}
        {!phone && (
          <>
            <button type="button" onClick={p.onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" aria-disabled={!canUse || undefined}>
              {useLabel}
            </button>
          </>
        )}
        {phone && tab === "build" && (
          <button type="submit" className="primary" aria-disabled={!canUse || undefined}>
            {useLabel}
          </button>
        )}
      </div>
    </DialogFrame>
  );
}
