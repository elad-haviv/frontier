/**
 * Terrain: the one place for a map's height map. It answers the four questions a height map
 * raises (which way up is it, where does it lie, where is the sea, how high is high) with a live
 * preview over the map's picture, and says plainly whether the result can be trusted. It works on
 * a copy: nothing reaches the map until Done. Loaded when it is first opened.
 * See docs/designs/stage-20-terrain-dialog.md.
 */
import {
  extentProblem,
  type MapFeature,
  type MapFile,
  type MapImage,
  type MapStyle,
  type MapTerrain,
  wholeExtent,
} from "@frontier/schema";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { mapImageUrl } from "../../api.ts";
import { lookAtTerrain } from "../../map/findPaths/client.ts";
import { flatGrid } from "../../map/findPaths/grid.ts";
import { terrainHints } from "../../map/findPaths/page.ts";
import type { TerrainLook } from "../../map/findPaths/protocol.ts";
import { type Extent, reliefPicture } from "../../map/findPaths/terrain.ts";
import {
  lineUp,
  looksInverted,
  matchTwoPoints,
  measure,
  prepared,
  verdict,
} from "../../map/terrain/fit.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { MapImagePicker } from "../images/MapImagePicker.tsx";
import { usePhone } from "../Shell.tsx";
import { COUNTS_LABELS } from "./StyleForm.tsx";
import "./TerrainDialog.css";

type View = "heights" | "relief" | "contours";
type Step = "image" | "lineup" | "sea" | "heights" | "check";
const STEPS: { id: Step; label: string }[] = [
  { id: "image", label: "Image" },
  { id: "lineup", label: "Line up" },
  { id: "sea", label: "Sea" },
  { id: "heights", label: "Heights" },
  { id: "check", label: "Check" },
];
const SMOOTHING = ["None", "Light", "Medium", "Strong", "Very strong"];

/** The copy the dialog works on. */
interface Draft {
  image: string | null;
  extent: Extent;
  invert: boolean;
  /** Null: matched to the picture's coast. */
  seaLevel: number | null;
  low: string;
  high: string;
  unit: string;
  smoothing: number;
}

const nameOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
const percent = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function TerrainDialog(p: {
  map: MapFile;
  /** The picture the height map is measured against: the topmost one shown. */
  picture: MapImage | null;
  /** The features drawn now, and the library's styles: what counts as terrain is listed. */
  drawn: readonly MapFeature[];
  styles: readonly MapStyle[];
  /** Done: the terrain to set, or null to remove it. */
  onDone: (terrain: MapTerrain | null) => void;
  onCancel: () => void;
}) {
  const { map, picture } = p;
  const phone = usePhone();
  const whole = useMemo(() => wholeExtent(map.space) as Extent, [map.space]);
  const gridExtent: Extent = picture ? (picture.extent as Extent) : whole;
  const had = map.terrain ?? null;
  const [draft, setDraft] = useState<Draft>(() => ({
    image: had?.image ?? null,
    extent: (had?.extent as Extent | undefined) ?? whole,
    invert: had?.invert === true,
    seaLevel: had?.seaLevel ?? null,
    low: had?.range ? String(had.range[0]) : "",
    high: had?.range ? String(had.range[1]) : "",
    unit: had?.rangeUnit ?? "m",
    smoothing: had?.smoothing ?? 0,
  }));
  const set = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));
  const changed = useRef(false);
  const edit = (change: Partial<Draft>) => {
    changed.current = true;
    set(change);
  };
  const [view, setView] = useState<View>("heights");
  const [strength, setStrength] = useState(60);
  const [flood, setFlood] = useState(true);
  const [step, setStep] = useState<Step>("image");
  const [picking, setPicking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Match two points: the places clicked so far (two on the height map, two on the picture). */
  const [points, setPoints] = useState<[number, number][] | null>(null);

  // ---- Looking at the picture and the height picture --------------------------------------------

  const pictureUrl = picture ? mapImageUrl(picture.path, 4096) : null;
  const heightUrl = draft.image ? mapImageUrl(draft.image, 2560) : null;
  const [look, setLook] = useState<{ key: string; value: TerrainLook } | null>(null);
  const [failed, setFailed] = useState(false);
  const lookKey = `${pictureUrl}|${heightUrl}`;
  /** The image just chosen: its way up and its sea level are worked out once it is read. */
  const fresh = useRef<string | null>(null);
  useEffect(() => {
    let stale = false;
    setFailed(false);
    lookAtTerrain(pictureUrl, heightUrl).then(
      (value) => {
        if (stale) return;
        setLook({ key: lookKey, value });
      },
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [lookKey]);
  const seen = look?.key === lookKey ? look.value : null;
  const grid = useMemo(() => (seen ? flatGrid(seen.gw, seen.gh) : null), [seen]);
  const read = useMemo(
    () =>
      seen?.heights
        ? prepared(seen.heights, { invert: draft.invert, smoothing: draft.smoothing })
        : null,
    [seen, draft.invert, draft.smoothing],
  );
  const fit = useMemo(
    () =>
      read && grid && seen
        ? measure(read, draft.extent, seen.water, grid, gridExtent, draft.seaLevel)
        : null,
    // The grid's extent is the picture's, which the look's key holds.
    [read, grid, seen, draft.extent, draft.seaLevel],
  );
  // A newly chosen image: Frontier tries both ways up and takes the one whose sea fits.
  useEffect(() => {
    if (!seen?.heights || !grid || fresh.current !== draft.image) return;
    fresh.current = null;
    const invert = looksInverted(seen.heights, draft.extent, seen.water, grid, gridExtent);
    set({ invert, seaLevel: null });
    setNote(
      !seen.water
        ? null
        : invert
          ? "Frontier saw that black is high here, and set the sea level to match the picture's coast. Change either below."
          : "Frontier set the sea level to match the picture's coast. Change it below.",
    );
  }, [seen]);

  // ---- The preview -----------------------------------------------------------------------------

  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!pictureUrl) return setImg(null);
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = pictureUrl;
  }, [pictureUrl]);
  const aspect = (gridExtent[2] - gridExtent[0]) / (gridExtent[3] - gridExtent[1]);
  /** In Match two points, the height map and the picture are each shown alone in turn. */
  const alone = points === null ? null : points.length % 2 === 0 ? "heights" : "picture";
  useEffect(() => {
    const c = canvas.current;
    if (!c || !seen || !grid) return;
    const W = c.width;
    const H = c.height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#efe8da";
    ctx.fillRect(0, 0, W, H);
    if (img && alone !== "heights") ctx.drawImage(img, 0, 0, W, H);
    const heights = fit?.heights ?? seen.guess;
    if (heights && alone !== "picture") {
      const sea = fit?.sea ?? Uint8Array.from(seen.water ?? new Uint8Array(heights.length));
      const n = grid.w * grid.h;
      const rgba = new Uint8ClampedArray(n * 4);
      const a = alone === "heights" ? 255 : Math.round((strength / 100) * 255);
      const kind: View = fit ? view : "relief";
      if (kind === "heights") {
        for (let i = 0; i < n; i++) {
          const v = Math.round(heights[i]! * 255);
          rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
          rgba[i * 4 + 3] = a;
        }
      } else {
        const relief = reliefPicture(grid, heights, sea);
        for (let i = 0; i < n; i++) {
          const edge = relief[i * 4] === 92;
          if (kind === "contours" && !edge) continue;
          rgba[i * 4] = relief[i * 4]!;
          rgba[i * 4 + 1] = relief[i * 4 + 1]!;
          rgba[i * 4 + 2] = relief[i * 4 + 2]!;
          rgba[i * 4 + 3] = (relief[i * 4 + 3]! * a) / 255;
        }
      }
      if (fit && flood && seen.water && alone === null) {
        // Blue where the sea level floods what the picture shows as land; sand where it leaves
        // dry what the picture shows as sea.
        for (let i = 0; i < n; i++) {
          const wet = fit.sea[i] === 1;
          if (wet === (seen.water[i] === 1)) continue;
          const [r, g, b] = wet ? [47, 111, 159] : [214, 178, 96];
          rgba[i * 4] = r!;
          rgba[i * 4 + 1] = g!;
          rgba[i * 4 + 2] = b!;
          rgba[i * 4 + 3] = 190;
        }
      }
      const small = document.createElement("canvas");
      small.width = grid.w;
      small.height = grid.h;
      small.getContext("2d")!.putImageData(new ImageData(rgba, grid.w, grid.h), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, W, H);
    }
    const toX = (x: number) => ((x - gridExtent[0]) / (gridExtent[2] - gridExtent[0])) * W;
    const toY = (y: number) => ((y - gridExtent[1]) / (gridExtent[3] - gridExtent[1])) * H;
    if (moving && fit) {
      const [x0, y0, x1, y1] = draft.extent;
      ctx.setLineDash([8, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#c2410c";
      ctx.strokeRect(toX(x0), toY(y0), toX(x1) - toX(x0), toY(y1) - toY(y0));
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      for (const [x, y] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ] as const) {
        ctx.beginPath();
        ctx.rect(toX(x) - 6, toY(y) - 6, 12, 12);
        ctx.fill();
        ctx.stroke();
      }
    }
    for (const [i, q] of (points ?? []).entries()) {
      // Each pair in its own colour; only the points of what is shown now.
      if ((i % 2 === 0) !== (alone === "heights")) continue;
      ctx.beginPath();
      ctx.arc(toX(q[0]), toY(q[1]), 6, 0, Math.PI * 2);
      ctx.fillStyle = i < 2 ? "#c2410c" : "#2f6f9f";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
  });

  /** A place of the preview as a position of the map. */
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = canvas.current!.getBoundingClientRect();
    return [
      gridExtent[0] + ((e.clientX - box.left) / box.width) * (gridExtent[2] - gridExtent[0]),
      gridExtent[1] + ((e.clientY - box.top) / box.height) * (gridExtent[3] - gridExtent[1]),
    ];
  };
  const drag = useRef<{ from: [number, number]; extent: Extent; corner: number | null } | null>(null);
  const perPixel = () =>
    (gridExtent[2] - gridExtent[0]) / (canvas.current?.getBoundingClientRect().width ?? 1);
  // On a phone the Line up step is the one in which a finger moves the height map.
  const canMove = fit !== null && points === null && (moving || (phone && step === "lineup"));
  const down = (e: React.PointerEvent) => {
    if (points !== null) {
      const next = [...points, at(e)];
      if (next.length < 4) return setPoints(next);
      const placed = matchTwoPoints(
        draft.extent,
        [next[0]!, next[2]!],
        [next[1]!, next[3]!],
      );
      setPoints(null);
      if (!placed || extentProblem(map.space, placed)) {
        return setNote("Those two places are too close together to tell. Choose two far apart.");
      }
      edit({ extent: placed, seaLevel: null });
      return setNote("Placed by the two points, and the sea level matched again.");
    }
    if (!canMove) return;
    const here = at(e);
    const reach = (phone ? 22 : 10) * perPixel();
    const [x0, y0, x1, y1] = draft.extent;
    const corners: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ];
    const corner = corners.findIndex((c) => Math.hypot(c[0] - here[0], c[1] - here[1]) < reach);
    drag.current = { from: here, extent: draft.extent, corner: corner < 0 ? null : corner };
    if (phone) setMoving(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const here = at(e);
    const [x0, y0, x1, y1] = d.extent;
    if (d.corner === null) {
      const dx = here[0] - d.from[0];
      const dy = here[1] - d.from[1];
      return edit({ extent: [x0 + dx, y0 + dy, x1 + dx, y1 + dy] });
    }
    // A corner resizes about the opposite one, proportions kept (Shift frees them).
    const ax = d.corner % 2 === 0 ? x1 : x0;
    const ay = d.corner < 2 ? y1 : y0;
    let w = Math.abs(here[0] - ax);
    let h = Math.abs(here[1] - ay);
    if (!e.shiftKey) {
      const k = Math.max(w / (x1 - x0), h / (y1 - y0));
      w = (x1 - x0) * k;
      h = (y1 - y0) * k;
    }
    if (w < perPixel() * 20 || h < perPixel() * 20) return;
    const nx0 = d.corner % 2 === 0 ? ax - w : ax;
    const ny0 = d.corner < 2 ? ay - h : ay;
    edit({ extent: [nx0, ny0, nx0 + w, ny0 + h] });
  };
  const nudge = (e: React.KeyboardEvent) => {
    if (!fit || points !== null) return;
    const [x0, y0, x1, y1] = draft.extent;
    const by = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-by, 0],
      ArrowRight: [by, 0],
      ArrowUp: [0, -by],
      ArrowDown: [0, by],
    };
    const m = moves[e.key];
    let next: Extent | null = null;
    if (m) next = [x0 + m[0], y0 + m[1], x1 + m[0], y1 + m[1]];
    else if (e.key === "+" || e.key === "=" || e.key === "-") {
      const k = e.key === "-" ? 0.995 : 1.005;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      next = [cx - ((x1 - x0) * k) / 2, cy - ((y1 - y0) * k) / 2, cx + ((x1 - x0) * k) / 2, cy + ((y1 - y0) * k) / 2];
    } else if (e.key === "0") next = whole;
    if (!next) return;
    e.preventDefault();
    setMoving(true);
    edit({ extent: next });
  };

  // ---- What the dialog does ----------------------------------------------------------------------

  const low = draft.low.trim() === "" ? null : Number(draft.low);
  const high = draft.high.trim() === "" ? null : Number(draft.high);
  const range: [number, number] | null =
    low !== null && high !== null && Number.isFinite(low) && Number.isFinite(high) && low < high
      ? [low, high]
      : null;
  const half = (low === null) !== (high === null) || (low !== null && high !== null && !range);
  const level = fit?.seaLevel ?? 0;
  const levelText = range
    ? `${Math.round(range[0] + level * (range[1] - range[0])).toLocaleString()} ${draft.unit}`
    : `${percent(level)} grey`;
  const scale = map.space.kind === "flat" ? map.space.scale : null;
  const area = (share: number) => {
    const all = (gridExtent[2] - gridExtent[0]) * (gridExtent[3] - gridExtent[1]);
    return scale !== null
      ? `${Math.round(share * all * scale * scale).toLocaleString()} ${map.space.unit}²`
      : `${(share * 100).toFixed(1)}% of the map`;
  };
  const lineUpNow = () => {
    if (!read || !grid || !seen || !fit) return;
    const before = fit.match;
    const extent = lineUp(read, draft.extent, seen.water, grid, gridExtent);
    const after = measure(read, extent, seen.water, grid, gridExtent, null);
    edit({ extent, seaLevel: null });
    setNote(
      before === null || after.match === null
        ? "There is no sea in the picture to line it up with. Use Match two points."
        : extent === draft.extent
          ? `It already lies where its sea fits best: coast ${percent(after.match)}.`
          : `Lined up: coast ${percent(before)} → ${percent(after.match)}.`,
    );
  };
  const moved = (() => {
    const [x0, y0, x1] = draft.extent;
    if (draft.extent.every((v, i) => Math.abs(v - whole[i]!) < 1e-9)) {
      return "It lies over the whole map.";
    }
    const unit = scale !== null ? map.space.unit : "map units";
    const k = scale ?? 1;
    const east = Math.round(((x0 + x1) / 2 - (whole[0] + whole[2]) / 2) * k);
    const south = Math.round(((y0 + draft.extent[3]) / 2 - (whole[1] + whole[3]) / 2) * k);
    const size = (((x1 - x0) / (whole[2] - whole[0])) * 100).toFixed(1);
    const way = (n: number, plus: string, minus: string) =>
      n === 0 ? null : `${Math.abs(n)} ${unit} ${n > 0 ? plus : minus}`;
    const parts = [way(east, "east", "west"), way(south, "south", "north")].filter(Boolean);
    return `${parts.length ? `Moved ${parts.join(", ")}` : "In place"} and drawn at ${size}% of the map's size.`;
  })();

  const state = verdict(fit?.match ?? null);
  const checks: { tone: "good" | "warn" | "bad"; text: string; advice?: string; act?: ReactNode }[] = [];
  if (fit) {
    if (state === "good") checks.push({ tone: "good", text: `Lines up with the coast: ${percent(fit.match!)} match` });
    if (state === "near") {
      checks.push({
        tone: "warn",
        text: `Nearly on the coast: ${percent(fit.match!)} match`,
        advice:
          "Try the sea level first, then nudge it. If it fits in one place and not another, the height map was made from another version of the map.",
        act: (
          <button type="button" onClick={() => edit({ seaLevel: null })}>
            Match the picture's coast
          </button>
        ),
      });
    }
    if (state === "off") {
      checks.push({
        tone: "bad",
        text: `Doesn't line up with the coast: ${percent(fit.match!)} match`,
        advice: "Rivers would cross the painted shore. Let Frontier slide it into place, or move it by hand.",
        act: (
          <button type="button" onClick={lineUpNow}>
            Line up for me
          </button>
        ),
      });
    }
    if (state === "none") {
      checks.push({
        tone: "warn",
        text: "No sea in the picture to check against",
        advice: "Use Match two points to line it up, and Relief to judge it by eye.",
      });
    }
    if (seen?.heights && grid && looksInverted(read!, draft.extent, seen.water, grid, gridExtent)) {
      checks.unshift({
        tone: "bad",
        text: "Looks upside down",
        advice: "The sea is brighter than the land in this image.",
        act: (
          <button type="button" onClick={() => edit({ invert: !draft.invert, seaLevel: null })}>
            Switch to {draft.invert ? "White" : "Black"} is high
          </button>
        ),
      });
    }
    const smooth = (
      <button
        type="button"
        aria-disabled={draft.smoothing >= 4 || undefined}
        onClick={() => draft.smoothing < 4 && edit({ smoothing: draft.smoothing + 1 })}
      >
        Smooth it
      </button>
    );
    if (fit.flat > 0.3) {
      checks.push({
        tone: "warn",
        text: `Flat: ${percent(fit.flat)} of the land lies on level steps`,
        advice:
          "Rivers run straight across them and a route can't tell a hill from a plain. An image with more greys is the real cure; smoothing softens the steps.",
        act: smooth,
      });
    } else if (fit.noisy > 0.02) {
      checks.push({
        tone: "warn",
        text: `Too noisy: ${percent(fit.noisy)} of the land is tiny hollows`,
        advice: "Rivers would wriggle from one to the next. Smoothing removes most of them.",
        act: smooth,
      });
    } else checks.push({ tone: "good", text: "Enough detail for rivers and routes" });
    if (fit.cover < 0.995) {
      checks.push({
        tone: "warn",
        text: `Covers ${percent(fit.cover)} of the map`,
        advice: "Outside it, terrain is guessed from the picture.",
      });
    }
    if (!range) {
      checks.push({
        tone: "warn",
        text: "Real heights not given",
        advice: "Slopes are relative: fine for rivers and for comparing routes, rough for travelling times.",
      });
    }
  }
  const worst = checks.find((c) => c.tone === "bad") ?? checks.find((c) => c.tone === "warn") ?? checks[0];

  const done = () => {
    if (!draft.image) return p.onCancel();
    const terrain: MapTerrain = {
      image: draft.image,
      ...(draft.extent.every((v, i) => Math.abs(v - whole[i]!) < 1e-9)
        ? {}
        : { extent: draft.extent.map((v) => Math.round(v * 1000) / 1000) as [number, number, number, number] }),
      ...(draft.invert ? { invert: true as const } : {}),
      ...(fit ? { seaLevel: Math.round(fit.seaLevel * 1000) / 1000 } : {}),
      ...(range ? { range, rangeUnit: draft.unit } : {}),
      ...(draft.smoothing > 0 ? { smoothing: draft.smoothing } : {}),
    };
    p.onDone(terrain);
  };
  const cancel = () => {
    // Esc leaves Match two points, then Move by hand, then the dialog.
    if (points !== null) return setPoints(null);
    if (moving) return setMoving(false);
    p.onCancel();
  };

  // ---- The sections ------------------------------------------------------------------------------

  const hints = terrainHints(p.drawn, p.styles);
  const section = (id: Step, title: string, body: ReactNode) =>
    (!phone || step === id) && (
      <section className="terrain-section" aria-label={title}>
        {!phone && <h3>{title}</h3>}
        {body}
      </section>
    );
  const twoPointWords = [
    "Click a place on the height map that you can find on the picture.",
    "Now click the same place on the picture.",
    "Click a second place on the height map, far from the first.",
    "And that place on the picture.",
  ];

  const preview = (
    <div className="terrain-preview">
      <canvas
        ref={canvas}
        width={Math.round(720 * Math.min(1, aspect))}
        height={Math.round((720 * Math.min(1, aspect)) / aspect)}
        tabIndex={0}
        role="img"
        aria-label={
          fit
            ? "The height map over the map's picture. Arrows move it, plus and minus resize it, 0 puts it back."
            : "What Find paths guesses now"
        }
        className={canMove ? "is-moving" : points !== null ? "is-picking" : ""}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={nudge}
      />
      {fit && fit.match !== null && (
        <span className={`terrain-match is-${state}`} role="status" aria-label="Coast match">
          Coast match {percent(fit.match)}
        </span>
      )}
      {points !== null && (
        <p className="terrain-banner" role="status">
          {twoPointWords[points.length]}{" "}
          <button type="button" className="plain" onClick={() => setPoints(null)}>
            Cancel
          </button>
        </p>
      )}
      {fit ? (
        <div className="terrain-views">
          <span className="find-mode" role="group" aria-label="Show the height map as">
            {(["heights", "relief", "contours"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                {v[0]!.toUpperCase() + v.slice(1)}
              </button>
            ))}
          </span>
          <label>
            Strength
            <input
              type="range"
              min={0}
              max={100}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
            />
          </label>
          <label className="terrain-flood">
            <input type="checkbox" checked={flood} onChange={(e) => setFlood(e.target.checked)} />
            Show flooding
          </label>
        </div>
      ) : (
        <p className="terrain-caption muted">
          {failed
            ? "The height map could not be read."
            : seen
              ? "What Find paths guesses now"
              : "Looking at the map…"}
        </p>
      )}
    </div>
  );

  const empty = (
    <div className="terrain-empty">
      <section className="terrain-section">
        <h3>No height map yet</h3>
        <p>
          A height map is a grey picture of the same land: white is high, black is low. Wonderdraft,
          Azgaar's generator, Gaea and any paint program can make one.
        </p>
        <button type="button" className="primary" onClick={() => setPicking(true)}>
          Choose a height map…
        </button>
      </section>
      <section className="terrain-section">
        <h3>Until then, Find paths guesses</h3>
        <p>
          The guess is good for routes and for tracing painted lines. Rivers are rough: they run
          to the nearest coast and miss real valleys.
        </p>
        {hints.length > 0 ? (
          <ul className="terrain-hints">
            {hints.map((h) => (
              <li key={h.counts}>
                {[h.zones ? plural(h.zones, "zone") : "", h.paths ? plural(h.paths, "path") : ""]
                  .filter(Boolean)
                  .join(" and ")}{" "}
                {h.zones + h.paths === 1 ? "counts" : "count"} as{" "}
                {COUNTS_LABELS[h.counts as keyof typeof COUNTS_LABELS]}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing drawn on this map counts as terrain yet.</p>
        )}
        <p className="muted">
          Draw a zone in a style that counts as Mountains, Water, Forest or Marsh and the guess
          improves at once.
        </p>
      </section>
    </div>
  );

  const settings = draft.image && (
    <div className="terrain-settings">
      {phone && (
        <div className="terrain-steps" role="tablist" aria-label="Steps">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={step === s.id}
              onClick={() => setStep(s.id)}
            >
              {s.label}
              {s.id === "check" && worst && worst.tone !== "good" && (
                <span className={`terrain-dot is-${worst.tone}`} aria-label="Something to check" />
              )}
            </button>
          ))}
        </div>
      )}
      {section(
        "image",
        "Height map",
        <>
          <p className="terrain-image">
            <strong>{nameOf(draft.image)}</strong>
            {seen?.heights && (
              <span className="muted">
                {" "}
                {seen.heights.w} × {seen.heights.h} read
              </span>
            )}{" "}
            <button type="button" onClick={() => setPicking(true)}>
              Replace…
            </button>
          </p>
          <span className="find-mode" role="group" aria-label="Which way up">
            <button
              type="button"
              aria-pressed={!draft.invert}
              onClick={() => edit({ invert: false, seaLevel: null })}
            >
              White is high
            </button>
            <button
              type="button"
              aria-pressed={draft.invert}
              onClick={() => edit({ invert: true, seaLevel: null })}
            >
              Black is high
            </button>
          </span>
        </>,
      )}
      {section(
        "lineup",
        "Line it up",
        <>
          <p className="terrain-actions">
            <button type="button" onClick={lineUpNow}>
              Line up for me
            </button>
            {!phone && (
              <button type="button" aria-pressed={moving} onClick={() => setMoving(!moving)}>
                Move by hand
              </button>
            )}
            <button type="button" onClick={() => setPoints([])}>
              Match two points…
            </button>
          </p>
          <p className="muted" role="status">
            {moved}
          </p>
          {phone && <p className="muted">Drag the height map with a finger; its corners resize it.</p>}
          <p className="terrain-actions">
            <button
              type="button"
              className="quiet"
              onClick={() => edit({ extent: whole, seaLevel: null })}
            >
              Put it back over the whole map
            </button>
          </p>
          <details>
            <summary>Exact position</summary>
            <div className="terrain-extent" role="group" aria-label="Where the height map lies">
              {["Left", "Top", "Right", "Bottom"].map((label, i) => (
                <label key={label}>
                  <span>{label}</span>
                  <input
                    type="number"
                    step="any"
                    value={Math.round(draft.extent[i]! * 1000) / 1000}
                    onChange={(e) => {
                      const next = draft.extent.map((v, k) =>
                        k === i ? Number(e.target.value) : v,
                      ) as unknown as Extent;
                      if (!extentProblem(map.space, next)) edit({ extent: next });
                    }}
                  />
                </label>
              ))}
            </div>
          </details>
        </>,
      )}
      {section(
        "sea",
        "Sea level",
        <>
          <label className="terrain-slider">
            <small>lower</small>
            <input
              type="range"
              aria-label="Sea level"
              min={0}
              max={1}
              step={0.004}
              value={level}
              onChange={(e) => edit({ seaLevel: Number(e.target.value) })}
            />
            <small>higher</small>
            <output>{levelText}</output>
          </label>
          {fit && seen?.water && (
            <p className="muted" role="status" aria-label="What the sea level does">
              Floods <strong>{area(fit.floods)}</strong> the picture shows as land · Leaves dry{" "}
              <strong>{area(fit.bares)}</strong> the picture shows as sea
            </p>
          )}
          <p className="terrain-actions">
            <button
              type="button"
              aria-disabled={draft.seaLevel === null || undefined}
              onClick={() => edit({ seaLevel: null })}
            >
              Match the picture's coast
            </button>
          </p>
        </>,
      )}
      {section(
        "heights",
        "Real heights and smoothing",
        <>
          <div className="terrain-range">
            <label>
              <span>{draft.invert ? "White is" : "Black is"}</span>
              <input
                type="number"
                step="any"
                placeholder="lowest"
                value={draft.low}
                onChange={(e) => edit({ low: e.target.value })}
              />
            </label>
            <label>
              <span>{draft.invert ? "Black is" : "White is"}</span>
              <input
                type="number"
                step="any"
                placeholder="highest"
                value={draft.high}
                onChange={(e) => edit({ high: e.target.value })}
              />
            </label>
            <label>
              <span>Unit</span>
              <select value={draft.unit} onChange={(e) => edit({ unit: e.target.value })}>
                <option value="m">m</option>
                <option value="ft">ft</option>
                {!["m", "ft", "km", "mi", "miles"].includes(map.space.unit) && (
                  <option value={map.space.unit}>{map.space.unit}</option>
                )}
              </select>
            </label>
          </div>
          <p className="muted">
            {half
              ? "Give both, the lowest first."
              : range
                ? `So the sea lies at ${levelText} and the land rises to ${range[1].toLocaleString()} ${draft.unit}. ${
                    scale !== null
                      ? "Slopes and travelling times are real."
                      : "Set the map's scale to make slopes real."
                  }`
                : "Left empty, heights are only relative: fine for rivers, rough for travelling times."}
          </p>
          <label className="terrain-smoothing">
            Smoothing
            <select
              value={draft.smoothing}
              onChange={(e) => edit({ smoothing: Number(e.target.value) })}
            >
              {SMOOTHING.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </>,
      )}
      {section(
        "check",
        "Check",
        <ul className="terrain-checks">
          {checks.map((c) => (
            <li key={c.text} className={`is-${c.tone}`}>
              <strong>{c.text}</strong>
              {c.advice && <span className="muted"> {c.advice}</span>} {c.act}
            </li>
          ))}
        </ul>,
      )}
      {note && (
        <p className="terrain-note" role="status">
          {note}
        </p>
      )}
    </div>
  );

  const at_ = STEPS.findIndex((s) => s.id === step);
  return (
    <>
      <DialogFrame title="Terrain" className="terrain-dialog" onCancel={cancel} onSubmit={done}>
        <div className="terrain-body">
          {preview}
          {draft.image ? settings : empty}
        </div>
        <div className="terrain-foot">
          {had && (
            <button type="button" className="quiet terrain-remove" onClick={() => p.onDone(null)}>
              Remove terrain
            </button>
          )}
          <span className={`terrain-verdict is-${worst?.tone ?? "good"}`} role="status">
            {draft.image ? (worst?.text ?? "") : ""}
          </span>
          {phone && draft.image && (
            <>
              <button
                type="button"
                aria-disabled={at_ === 0 || undefined}
                onClick={() => at_ > 0 && setStep(STEPS[at_ - 1]!.id)}
              >
                Back
              </button>
              {at_ < STEPS.length - 1 && (
                <button type="button" onClick={() => setStep(STEPS[at_ + 1]!.id)}>
                  Next
                </button>
              )}
            </>
          )}
          <button type="button" onClick={p.onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" aria-disabled={!draft.image || undefined}>
            Done
          </button>
        </div>
      </DialogFrame>
      {picking && (
        <MapImagePicker
          title="Choose a height map"
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setPicking(false);
            fresh.current = path;
            changed.current = true;
            setNote(null);
            set({ image: path, extent: whole, seaLevel: null, invert: false });
          }}
        />
      )}
    </>
  );
}
