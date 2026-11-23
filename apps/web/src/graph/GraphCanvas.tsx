/**
 * The graph on a canvas, shared by the graph screen and (from 14b) an entry's Graph tab: the
 * layout run in slices, the drawing, pan and zoom, hover, select and open. What is shown, what is
 * selected and what opening does are the caller's.
 */
import { quadtree, type Quadtree } from "d3-quadtree";
import {
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { entryUrl } from "../api.ts";
import { HoverPreview } from "../components/HoverPreview.tsx";
import { nodeColours, useTheme } from "./colours.ts";
import { drawGraph, type Palette, readPalette, screenRadius } from "./draw.ts";
import { fnv1a, type Layout, type LayoutNode } from "./layout.ts";
import type { GraphModel, Shown } from "./model.ts";
import {
  clampZoom,
  type FlatView,
  type HitNode,
  hitTest,
  type Point,
  tapAction,
} from "./pointer.ts";
import { reducedMotion, runLayout } from "./runner.ts";
import { usePanZoom } from "./usePanZoom.ts";
import "./GraphCanvas.css";

/** The zoom a node is shown at when the graph opens on it and no zoom is remembered. */
export const FOCUS_ZOOM = 1.4;
/** The room kept around the graph when it is fitted, in screen pixels. */
const FIT_PAD = 32;

export interface GraphCanvasHandle {
  /** Fits the shown graph to the screen. */
  fit(): void;
  /** Zooms about the middle of the screen. */
  zoom(factor: number): void;
  /** Puts a node in the middle, at the given zoom or the current one. */
  centre(i: number, k?: number): void;
  /** Puts the keyboard's focus on the stage, where the graph's keys work. */
  focus(): void;
}

export interface GraphCanvasProps {
  model: GraphModel;
  shown: Shown;
  /** Kept for the visit by the caller, so coming back shows the settled picture at once. */
  layout: Layout;
  /** The local graph's centre, ringed and fixed in the middle. */
  centre?: number | null;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onOpen: (i: number) => void;
  /** Read once: a node to open on, else a view to start from; with neither the graph is fitted. */
  arrival: { focus: number | null; view: FlatView | null };
  /** The view stopped moving. */
  onViewSettled?: (view: FlatView) => void;
  /** The canvas's description for screen readers. */
  label: string;
  ref?: Ref<GraphCanvasHandle>;
}

/** What a layout was last given, so the same picture is not laid out again. */
const keyOf = (model: GraphModel, shown: Shown, centre: number | null) => {
  const paths = shown.nodes.map((i) => model.nodes[i]!.path).join("\n");
  const edges = shown.edges.map(([a, b]) => `${model.nodes[a]!.path}\n${model.nodes[b]!.path}`);
  // The indexes too: a node added elsewhere in the model moves the indexes after it.
  return [paths, edges.join("\n"), shown.nodes.join(",")].map(fnv1a).join(" ") + ` ${centre ?? ""}`;
};
const keys = new WeakMap<Layout, string>();

export function GraphCanvas({
  model,
  shown,
  layout,
  centre = null,
  selected,
  onSelect,
  onOpen,
  arrival,
  onViewSettled,
  label,
  ref,
}: GraphCanvasProps) {
  const id = useId();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const size = useRef({ width: 0, height: 0 });
  const view = useRef<FlatView>(arrival.view ?? { kind: "flat", x: 0, y: 0, k: 1 });
  const placed = useRef(arrival.view !== null);
  const tree = useRef<Quadtree<HitNode>>(quadtree<HitNode>());
  const maxR = useRef(0);
  const [hover, setHover] = useState<number | null>(null);
  const [arranging, setArranging] = useState(false);
  const theme = useTheme();
  const palette = useRef<Palette | null>(null);
  const arrived = useRef(false);
  const first = useRef(arrival);

  const colours = useMemo(() => nodeColours(model, theme), [model, theme]);

  // What the drawing reads, kept current without drawing React again.
  const scene = useRef({ model, shown, colours, hover, selected, centre });
  scene.current = { model, shown, colours, hover, selected, centre };

  const frame = useRef<number | null>(null);
  const drawNow = useCallback(() => {
    frame.current = null;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const { width, height } = size.current;
    if (!el || !ctx || width === 0) return;
    palette.current ??= readPalette(el);
    const s = scene.current;
    const at = new Map<number, LayoutNode>(layout.nodes.map((n) => [n.i, n]));
    drawGraph(
      ctx,
      { ...s, at, palette: palette.current, view: view.current, width, height },
      window.devicePixelRatio || 1,
    );
    // The hover link sits over the hovered node's circle.
    const a = link.current;
    const n = s.hover !== null ? at.get(s.hover) : undefined;
    if (a && n) {
      const r = screenRadius(n.r, view.current.k);
      const x = (n.x! - view.current.x) * view.current.k + width / 2;
      const y = (n.y! - view.current.y) * view.current.k + height / 2;
      Object.assign(a.style, {
        left: `${x - r}px`,
        top: `${y - r}px`,
        width: `${2 * r}px`,
        height: `${2 * r}px`,
      });
    }
  }, [layout]);
  const redraw = useCallback(() => {
    frame.current ??= requestAnimationFrame(drawNow);
  }, [drawNow]);
  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);

  /** Rebuilds the index of positions that taps and hover search. */
  const index = useCallback(() => {
    const nodes = layout.nodes.map((n) => ({ i: n.i, x: n.x!, y: n.y!, r: n.r }));
    tree.current = quadtree<HitNode>()
      .x((n) => n.x)
      .y((n) => n.y)
      .addAll(nodes);
    maxR.current = Math.max(0, ...nodes.map((n) => n.r));
  }, [layout]);

  const fitView = useCallback((): FlatView => {
    const { width, height } = size.current;
    if (layout.nodes.length === 0 || width === 0) return view.current;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const n of layout.nodes) {
      x0 = Math.min(x0, n.x! - n.r);
      y0 = Math.min(y0, n.y! - n.r);
      x1 = Math.max(x1, n.x! + n.r);
      y1 = Math.max(y1, n.y! + n.r);
    }
    const k = clampZoom(
      Math.min(
        (width - 2 * FIT_PAD) / Math.max(1, x1 - x0),
        (height - 2 * FIT_PAD) / Math.max(1, y1 - y0),
      ),
    );
    return { kind: "flat", x: (x0 + x1) / 2, y: (y0 + y1) / 2, k };
  }, [layout]);

  const hideCard = useCallback(() => {
    // HoverPreview closes its card when the link it opened from is left.
    link.current?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
  }, []);

  const { handlers, setView } = usePanZoom({
    stage,
    view,
    size,
    onView: redraw,
    onSettle: (v) => onViewSettled?.(v),
    onMoveStart: hideCard,
    onHover: (p) => {
      const next = p ? hitAt(p, false) : null;
      if (next !== scene.current.hover) {
        hideCard();
        setHover(next);
      }
    },
    onTap: (p, touch) => {
      const action = tapAction(hitAt(p, touch), scene.current.selected, touch);
      if ("open" in action) onOpen(action.open);
      else onSelect(action.select);
    },
    onDouble: (p) => {
      const hit = hitAt(p, false);
      if (hit !== null) onOpen(hit);
    },
  });

  function hitAt(p: Point, touch: boolean): number | null {
    const v = view.current;
    const { width, height } = size.current;
    const at = { x: (p.x - width / 2) / v.k + v.x, y: (p.y - height / 2) / v.k + v.y };
    return hitTest(tree.current, maxR.current, at, v.k, touch);
  }

  /** Once the picture is ready: the node asked for in the middle, else the whole graph. */
  const arrive = useCallback(() => {
    // Fitting needs the screen's size, which comes after the first layout.
    if (arrived.current || size.current.width === 0) return;
    arrived.current = true;
    const { focus, view: kept } = first.current;
    const n = focus !== null ? layout.nodes.find((x) => x.i === focus) : undefined;
    if (n) setView({ kind: "flat", x: n.x!, y: n.y!, k: kept?.k ?? FOCUS_ZOOM });
    else if (!kept) setView(fitView());
  }, [layout, fitView, setView]);

  // Lays out what is shown, unless the layout already holds this very picture.
  useEffect(() => {
    const key = keyOf(model, shown, centre);
    if (keys.get(layout) !== key) {
      layout.set(model, shown, centre);
      keys.set(layout, key);
    }
    index();
    if (!placed.current && size.current.width > 0 && !layout.done) {
      // Until the layout ends, the seeded disc fills the screen.
      const { width, height } = size.current;
      const disc = 10 * Math.sqrt(Math.max(1, shown.nodes.length)) + 20;
      setView({ kind: "flat", x: 0, y: 0, k: clampZoom(Math.min(width, height) / (2 * disc)) });
      placed.current = true;
    }
    const reduced = reducedMotion();
    setArranging(!layout.done);
    const stop = runLayout(layout, {
      reduced,
      onSlice: () => {
        index();
        redraw();
      },
      onDone: () => {
        index();
        setArranging(false);
        arrive();
        redraw();
      },
    });
    redraw();
    return stop;
  }, [model, shown, centre, layout, index, redraw, arrive, setView]);

  // The canvas follows its box, at the screen's pixel density.
  useEffect(() => {
    const el = stage.current;
    const c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const box = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { width: box.width, height: box.height };
      c.width = Math.round(box.width * dpr);
      c.height = Math.round(box.height * dpr);
      if (!placed.current && box.width > 0) {
        placed.current = true;
        const disc = 10 * Math.sqrt(Math.max(1, layout.nodes.length)) + 20;
        view.current = {
          kind: "flat",
          x: 0,
          y: 0,
          k: clampZoom(Math.min(box.width, box.height) / (2 * disc)),
        };
      }
      if (layout.done && box.width > 0) arrive();
      drawNow();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout, arrive, drawNow]);

  // The page's colours are read again when its colour scheme changes.
  useEffect(() => {
    palette.current = null;
  }, [theme]);

  useEffect(redraw, [redraw, colours, hover, selected, centre]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => setView(fitView()),
      zoom: (factor) => {
        const v = view.current;
        setView({ ...v, k: clampZoom(v.k * factor) });
      },
      centre: (i, k) => {
        const n = layout.nodes.find((x) => x.i === i);
        if (n) setView({ kind: "flat", x: n.x!, y: n.y!, k: k ?? view.current.k });
      },
      focus: () => stage.current?.focus(),
    }),
    [layout, fitView, setView],
  );

  const hovered = hover !== null ? model.nodes[hover] : undefined;
  return (
    <div ref={stage} className="graph-stage" data-graph-stage={id} tabIndex={0} {...handlers}>
      <canvas
        ref={canvas}
        className="graph-canvas"
        role="img"
        aria-label={label}
        aria-busy={arranging}
      />
      {hovered && (
        <a
          ref={link}
          key={hovered.path}
          className="link-resolved graph-hit"
          href={entryUrl(hovered.path)}
          tabIndex={-1}
          aria-hidden="true"
          draggable={false}
          // A press on it focuses the stage, where the graph's keys work, not the link.
          onMouseDown={(e) => {
            e.preventDefault();
            stage.current?.focus({ preventScroll: true });
          }}
          onClick={(e) => e.preventDefault()}
        />
      )}
      {arranging && reducedMotion() && (
        <p className="graph-arranging" aria-hidden="true">
          Arranging…
        </p>
      )}
      <HoverPreview scope={`[data-graph-stage="${id}"]`} />
    </div>
  );
}
