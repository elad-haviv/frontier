import {
  forwardRef,
  type KeyboardEvent,
  type ReactElement,
  type PointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { TreeLine } from "@frontier/schema";
import type { AddWhere } from "../../trees/data.ts";
import { addTitle } from "../../trees/data.ts";
import {
  bounds,
  CARD_H,
  CARD_W,
  edgeOf,
  type Graph,
  type Kinship,
  kindNamed,
  type Layout,
  title,
  ups,
  warningsOf,
} from "../../trees/model.ts";

export interface TreeDrawingHandle {
  /** Shows the whole tree. */
  fit(): void;
  zoom(factor: number): void;
  /** Brings a card into view, if it is out of it. */
  reveal(key: string): void;
  focus(): void;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The largest the page is shown smaller than real size when a tree opens: names stay readable. */
const OPEN_SCALE = 1.08;
const MIN_W = 240;
const MAX_W = 9000;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const initials = (n: string) =>
  n
    .replace(/^(the|of)\s+/i, "")
    .split(/[\s-]+/)
    .filter((w) => /^\p{Lu}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("") || n.slice(0, 1).toUpperCase();

/**
 * A tree drawn as cards and lines: pan by dragging, zoom with the wheel or a pinch, arrows to move
 * along it. Children hang from their couple by a smooth curve; partners sit beside, joined by a
 * ring. The + around the selected (or hovered) card adds above, below or beside.
 */
export const TreeDrawing = forwardRef<
  TreeDrawingHandle,
  {
    g: Graph;
    tree: TreeLine;
    layout: Layout;
    selected: string | null;
    compare: Kinship | null;
    matches: Set<string>;
    fine: string[];
    phone: boolean;
    label: string;
    onSelect: (key: string, second: boolean) => void;
    onClear: () => void;
    onOpen: (key: string) => void;
    onAdd: (where: AddWhere, key: string, at: DOMRect) => void;
    onFold: (key: string) => void;
    /** What a screen reader hears about the selected card. */
    said: string;
    /** The graph without proposals, for checks (stage 31). */
    checks?: Graph;
    /** Words for each proposed relation drawn, by its place, for its ? mark. */
    proposalLabel?: (i: number) => string;
    selectedProposal?: number | null;
    onProposal?: (i: number) => void;
  }
>(function TreeDrawing(props, ref) {
  const { g, tree, layout: L, selected, compare, matches, fine, phone } = props;
  const svg = useRef<SVGSVGElement>(null);
  const view = useRef<View | null>(null);
  const sig = `${tree.id}|${tree.way ?? "down"}|${tree.from ?? ""}|${tree.dir}|${L.root}`;
  const shownSig = useRef("");
  const kind = kindNamed(g, tree.kind);
  const k = kind?.name ?? tree.kind;

  const apply = useCallback(() => {
    const v = view.current;
    if (v && svg.current) {
      svg.current.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
      // Zoomed far out, many ? marks give way to the count in the banner.
      svg.current.toggleAttribute("data-far", v.w > 1500);
    }
  }, []);

  const size = () => {
    const r = svg.current?.getBoundingClientRect();
    return { w: r?.width || 800, h: r?.height || 500 };
  };

  /** The whole tree, or (`readable`) the part round `key` at a size whose names can be read. */
  const frame = useCallback(
    (readable: boolean, key?: string | null) => {
      const b = bounds(L);
      const { w: aw, h: ah } = size();
      const want = Math.max(b.w / aw, b.h / ah, 0.6);
      const s = readable ? Math.min(want, OPEN_SCALE) : want;
      const w = aw * s;
      const h = ah * s;
      if (want > s) {
        const at = key && L.nodes.has(key) ? key : L.root;
        const r = L.rect(at);
        const y = L.up ? r.y + CARD_H / 2 - h / 2 : Math.max(b.y, r.y + CARD_H / 2 - h / 2);
        view.current = { x: r.x + CARD_W / 2 - w / 2, y, w, h };
      } else view.current = { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h };
      apply();
    },
    [L, apply],
  );

  useLayoutEffect(() => {
    if (shownSig.current !== sig || !view.current) {
      shownSig.current = sig;
      frame(true, selected);
    } else apply();
  });

  // The frame keeps its centre when the page changes size.
  useEffect(() => {
    const el = svg.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = el.getBoundingClientRect();
    const ro = new ResizeObserver(() => {
      const now = el.getBoundingClientRect();
      const v = view.current;
      if (v && last.width > 0 && now.width > 0) {
        const s = v.w / last.width;
        const cx = v.x + v.w / 2;
        const cy = v.y + v.h / 2;
        v.w = now.width * s;
        v.h = now.height * s;
        v.x = cx - v.w / 2;
        v.y = cy - v.h / 2;
        apply();
      }
      last = now;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply]);

  const zoomAt = useCallback(
    (f: number, cx?: number, cy?: number) => {
      const v = view.current;
      const el = svg.current;
      if (!v || !el) return;
      const r = el.getBoundingClientRect();
      const px = cx === undefined ? 0.5 : (cx - r.left) / r.width;
      const py = cy === undefined ? 0.5 : (cy - r.top) / r.height;
      const nw = Math.min(Math.max(v.w * f, MIN_W), MAX_W);
      const nh = v.h * (nw / v.w);
      v.x += (v.w - nw) * px;
      v.y += (v.h - nh) * py;
      v.w = nw;
      v.h = nh;
      apply();
    },
    [apply],
  );

  const reveal = useCallback(
    (key: string) => {
      const v = view.current;
      if (!v || !L.nodes.has(key)) return;
      const r = L.rect(key);
      const cx = r.x + CARD_W / 2;
      const cy = r.y + CARD_H / 2;
      const m = 40;
      if (cx < v.x + m || cx > v.x + v.w - m || cy < v.y + m || cy > v.y + v.h - m) {
        v.x = cx - v.w / 2;
        v.y = cy - v.h / 2;
        apply();
      }
    },
    [L, apply],
  );

  useImperativeHandle(ref, () => ({
    fit: () => frame(false),
    zoom: (f) => zoomAt(1 / f),
    reveal,
    focus: () => svg.current?.focus(),
  }));

  // Wheel zoom needs a listener that may stop the page from scrolling.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  // Dragging pans; two fingers pinch. A press that does not move is a click.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{
    x: number;
    y: number;
    v: View;
    moved: boolean;
    pinch: number | null;
  } | null>(null);
  function down(e: PointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest("[data-tool]")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const pinch =
      pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : null;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      v: { ...view.current! },
      moved: drag.current?.moved ?? false,
      pinch,
    };
    if (pinch === null) drag.current.moved = false;
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId) || !drag.current || !view.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    const pts = [...pointers.current.values()];
    if (d.pinch && pts.length === 2) {
      const now = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (now > 0) {
        view.current = { ...d.v };
        zoomAt(d.pinch / now, (pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2);
      }
      d.moved = true;
      return;
    }
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5) {
      if (!d.moved) svg.current?.setPointerCapture(e.pointerId);
      d.moved = true;
    }
    if (!d.moved) return;
    const r = svg.current!.getBoundingClientRect();
    view.current.x = d.v.x - (e.clientX - d.x) * (d.v.w / r.width);
    view.current.y = d.v.y - (e.clientY - d.y) * (d.v.h / r.height);
    apply();
  }
  function up(e: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && drag.current && !drag.current.moved) {
      const target = e.target as Element;
      const card = target.closest<SVGGElement>("[data-key]");
      if (card && !target.closest("[data-tool]")) {
        props.onSelect(card.dataset.key!, e.shiftKey);
      } else if (!target.closest("[data-tool]")) props.onClear();
    }
    if (pointers.current.size === 0) drag.current = null;
  }

  function keys(e: KeyboardEvent<SVGSVGElement>) {
    const id = selected && L.nodes.has(selected) ? selected : L.root;
    const node = L.nodes.get(id);
    if (!node) return;
    const fwd = L.down ? "ArrowDown" : "ArrowRight";
    const back = L.down ? "ArrowUp" : "ArrowLeft";
    const next = L.down ? "ArrowRight" : "ArrowDown";
    const prev = L.down ? "ArrowLeft" : "ArrowUp";
    let to: string | undefined;
    const towardRoot = L.up ? fwd : back;
    const awayRoot = L.up ? back : fwd;
    if (e.key === towardRoot) {
      to = L.up
        ? [...L.nodes.values()].find((n) => ups(props.g, n.key, k).includes(id))?.key
        : (ups(props.g, id, k).find((u) => L.nodes.has(u)) ??
          (node.inlaw ? node.owner : undefined));
    } else if (e.key === awayRoot) {
      to = L.edges.find(
        (x) => x.type === "down" && (x.from === id || (node.inlaw && x.from === node.owner)),
      )?.to;
    } else if (e.key === next || e.key === prev) {
      const row = [...L.nodes.values()].filter((n) => n.d === node.d).sort((a, b) => a.b - b.b);
      const at = row.findIndex((n) => n.key === id);
      to = row[at + (e.key === next ? 1 : -1)]?.key;
    } else if (e.key === "Enter") {
      e.preventDefault();
      props.onOpen(id);
      return;
    } else if (e.key === "Escape") {
      props.onClear();
      return;
    } else return;
    e.preventDefault();
    if (to) {
      props.onSelect(to, false);
      reveal(to);
    }
  }

  const onPath = new Set(compare?.path ?? []);
  const lit = (a: string, b: string) => onPath.has(a) && onPath.has(b);
  const checks = props.checks ?? g;
  /**
   * The ? on a proposed line: a button reached with Tab, which opens the proposal. Drawn on a
   * layer above the cards, so a card's + never covers it.
   */
  const marks: ReactElement[] = [];
  const mark = (i: number, x: number, y: number): null => {
    marks.push(markAt(i, x, y));
    return null;
  };
  const markAt = (i: number, x: number, y: number) => (
    <g
      key={`q${i}-${x}-${y}`}
      className={`tr-q${props.selectedProposal === i ? " is-selected" : ""}`}
      data-tool="proposal"
      tabIndex={0}
      role="button"
      aria-label={props.proposalLabel?.(i) ?? "Proposed relation"}
      onClick={() => props.onProposal?.(i)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          props.onProposal?.(i);
        }
      }}
    >
      <circle cx={x} cy={y} r={9} />
      <text x={x} y={y + 4} textAnchor="middle">
        ?
      </text>
    </g>
  );
  // Someone in the tree only through proposals says so on their card.
  const confirmedKeys = new Set<string>([L.root]);
  for (const e of L.edges) {
    if (e.proposal === null) {
      confirmedKeys.add(e.from);
      confirmedKeys.add(e.to);
    }
  }

  const lines = L.edges.map((e, i) => {
    if (e.type === "couple") {
      const A = L.nodes.get(e.from)!;
      const B = L.nodes.get(e.to)!;
      const half = (L.down ? CARD_W : CARD_H) / 2;
      const lo = Math.min(A.b, B.b) + half;
      const hi = Math.max(A.b, B.b) - half;
      const dd = A.d + (L.down ? CARD_H : CARD_W) / 2;
      const [x1, y1] = L.at(lo, dd);
      const [x2, y2] = L.at(hi, dd);
      const [mx, my] = L.at((lo + hi) / 2, dd);
      const cls = lit(e.from, e.to) ? " is-path" : "";
      if (e.proposal !== null) {
        return (
          <g key={`c${i}`} className="tr-couple is-proposed">
            <path className="tr-line" d={`M${x1},${y1} L${x2},${y2}`} />
            {mark(e.proposal, mx, my)}
          </g>
        );
      }
      return (
        <g key={`c${i}`} className={`tr-couple${cls}`}>
          <path className="tr-line" d={`M${x1},${y1} L${x2},${y2}`} />
          <g>
            <title>{`${title(g, e.from)} and ${title(g, e.to)}, partners${e.ended ? ", ended" : ""}`}</title>
            <circle className="tr-ring" cx={mx - 3} cy={my} r={4.5} />
            <circle className="tr-ring is-open" cx={mx + 3} cy={my} r={4.5} />
          </g>
          {e.ended && (
            <text className="tr-ended" x={mx} y={my + 17} textAnchor="middle">
              ended
            </text>
          )}
        </g>
      );
    }
    const m = e.ad + (e.kd - e.ad) * 0.55;
    const [x0, y0] = L.at(e.ab, e.ad);
    const [c1x, c1y] = L.at(e.ab, m);
    const [c2x, c2y] = L.at(e.kb, m);
    const [x1, y1] = L.at(e.kb, e.kd);
    const path = lit(e.from, e.to) ? " is-path" : "";
    const [qx, qy] = L.at((e.ab + e.kb) / 2, m);
    return (
      <g key={`d${i}`} className={`tr-down${path}${e.proposal !== null ? " is-proposed" : ""}`}>
        <path
          className={`tr-line${e.dashed ? " is-dashed" : ""}`}
          d={`M${x0},${y0} C${c1x},${c1y} ${c2x},${c2y} ${x1},${y1}`}
        />
        <circle className="tr-dot" cx={x1} cy={y1} r={3} />
        {e.proposal !== null && mark(e.proposal, qx, qy)}
      </g>
    );
  });

  const overlay = L.lines.map((l, i) => {
    const a = L.rect(l.a);
    const b = L.rect(l.b);
    const ax = a.x + CARD_W / 2;
    const bx = b.x + CARD_W / 2;
    const ay = a.y;
    const by = b.y;
    const mx = (ax + bx) / 2;
    const my = Math.min(ay, by) - 46 - Math.abs(ax - bx) * 0.08;
    return (
      <g key={`o${i}`} className="tr-over">
        <path d={`M${ax},${ay} Q${mx},${my} ${bx},${by}`} />
        <text x={mx} y={(my + Math.min(ay, by)) / 2 + 4} textAnchor="middle">
          {l.kind === "rival" ? "rivals" : l.kind}
        </text>
      </g>
    );
  });

  const cards = [...L.nodes.values()].map((n) => {
    const p = g.people.get(n.key);
    const stub = !p?.path;
    const { x, y } = L.rect(n.key);
    const warn = warningsOf(checks, k, n.key, fine);
    const hiddenUp = ups(g, n.key, k).filter((u) => !L.nodes.has(u));
    const adopted = /adopt|foster/i.test(edgeOf(g, k, ups(g, n.key, k)[0] ?? "", n.key)?.how ?? "");
    const sub = [
      p?.dates
        ? `${p.dates}${p.died != null ? " †" : ""}`
        : stub
          ? "No entry yet"
          : (p?.type ?? ""),
      adopted ? "adopted" : "",
      confirmedKeys.has(n.key) ? "" : "proposed",
    ]
      .filter(Boolean)
      .join(" · ");
    const cls = [
      "tr-card",
      n.key === selected ? "is-selected" : "",
      stub ? "is-stub" : "",
      matches.has(n.key) ? "is-match" : "",
      onPath.has(n.key) ? "is-path" : "",
    ].join(" ");
    const tx = stub ? 12 : 44;
    const above: [number, number] = L.down ? [CARD_W / 2, -14] : [-14, CARD_H / 2];
    const belowAt: [number, number] = L.down
      ? [CARD_W / 2, CARD_H + 14]
      : [CARD_W + 14, CARD_H / 2];
    const tools: [AddWhere, number, number][] = [];
    if (!phone && !stub) {
      tools.push(["up", ...above]);
      if (!L.up && (!n.inlaw || !L.family)) tools.push(["down", ...belowAt]);
      if (L.family && !L.up)
        tools.push(["pair", L.down ? CARD_W + 14 : CARD_W / 2, L.down ? CARD_H / 2 : CARD_H + 14]);
    }
    return (
      <g key={n.key} className={cls} data-key={n.key} transform={`translate(${x},${y})`}>
        <rect className="tr-box" width={CARD_W} height={CARD_H} rx={8} />
        {!stub && (
          <>
            <circle className="tr-avatar" cx={22} cy={CARD_H / 2} r={14} />
            <text className="tr-initials" x={22} y={CARD_H / 2 + 4} textAnchor="middle">
              {initials(title(g, n.key))}
            </text>
          </>
        )}
        <text className="tr-name" x={tx} y={24}>
          {short(title(g, n.key), 18)}
        </text>
        <text className="tr-sub" x={tx} y={41}>
          {short(sub, 24)}
        </text>
        {n.inlaw && L.family && (
          <text className="tr-tag" x={CARD_W - 8} y={CARD_H - 6} textAnchor="end">
            MARRIED IN
          </text>
        )}
        {warn.length > 0 && (
          <text className="tr-warn" x={CARD_W - 13} y={18} textAnchor="middle">
            ⚠<title>{warn.map((w) => w.text).join(" ")}</title>
          </text>
        )}
        {hiddenUp.length > 0 && !L.up && (
          <g
            className="tr-chip"
            transform={
              L.down ? `translate(${CARD_W / 2 - 32},-17)` : `translate(-50,${CARD_H / 2 - 8})`
            }
          >
            <title>{`${hiddenUp.map((u) => title(g, u)).join(", ")}: not drawn in this tree`}</title>
            <rect width={64} height={16} rx={8} />
            <text x={32} y={12} textAnchor="middle">
              {`${L.down ? "↑" : "←"} ${hiddenUp.length} more`}
            </text>
          </g>
        )}
        {n.hidden > 0 || (!L.up && L.edges.some((e) => e.type === "down" && e.from === n.key)) ? (
          <g
            className="tr-fold"
            data-tool="fold"
            role="button"
            aria-label={
              n.folded
                ? `Show the ${n.hidden} below ${title(g, n.key)}`
                : `Fold what is below ${title(g, n.key)}`
            }
            transform={
              L.down
                ? `translate(${CARD_W - (n.folded ? 40 : 24)},${CARD_H + 3})`
                : `translate(${CARD_W + 3},${CARD_H - 20})`
            }
            onClick={() => props.onFold(n.key)}
          >
            <rect width={n.folded ? 34 : 18} height={16} rx={8} />
            <text x={n.folded ? 17 : 9} y={12} textAnchor="middle">
              {n.folded ? `▸ ${n.hidden}` : "▾"}
            </text>
          </g>
        ) : null}
        {tools.length > 0 && (
          <g className="tr-tools">
            {tools.map(([where, hx, hy]) => (
              <g
                key={where}
                data-tool={where}
                role="button"
                aria-label={addTitle(g, k, where, title(g, n.key))}
                onClick={(e) =>
                  props.onAdd(
                    where,
                    n.key,
                    (e.currentTarget as SVGGElement).getBoundingClientRect(),
                  )
                }
              >
                <title>{addTitle(g, k, where, title(g, n.key))}</title>
                <circle cx={hx} cy={hy} r={phone ? 14 : 10} />
                <text x={hx} y={hy + 5} textAnchor="middle">
                  +
                </text>
              </g>
            ))}
          </g>
        )}
      </g>
    );
  });

  return (
    <>
      <svg
        ref={svg}
        className={`tr-svg${compare ? " is-comparing" : ""}`}
        data-many={L.edges.filter((e) => e.proposal !== null).length > 15 ? "" : undefined}
        tabIndex={0}
        role="application"
        aria-roledescription="tree"
        aria-label={`${props.label}. Arrow keys move between people, Enter opens, A adds, C compares, F shows all, Escape clears.`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          drag.current = null;
        }}
        onKeyDown={keys}
      >
        <g className="tr-lines">{lines}</g>
        <g className="tr-overlays">{overlay}</g>
        <g className="tr-cards">{cards}</g>
        <g className="tr-marks">{marks}</g>
      </svg>
      <div className="sr-only" role="status" aria-live="polite">
        {props.said}
      </div>
    </>
  );
});

/** The shape of a tree, small and without words, for its card on the Trees page. */
export function TreeShape({ layout: L }: { layout: Layout }) {
  const b = bounds(L);
  return (
    <svg
      className="tr-shape"
      viewBox={`${b.x} ${b.y + 30} ${b.w} ${Math.max(b.h - 30, CARD_H)}`}
      aria-hidden="true"
    >
      {L.edges.map((e, i) => {
        if (e.type === "couple") {
          const A = L.nodes.get(e.from)!;
          const B = L.nodes.get(e.to)!;
          const [x1, y1] = L.at(Math.min(A.b, B.b), A.d + (L.down ? CARD_H : CARD_W) / 2);
          const [x2, y2] = L.at(Math.max(A.b, B.b), A.d + (L.down ? CARD_H : CARD_W) / 2);
          return <path key={i} d={`M${x1},${y1} L${x2},${y2}`} />;
        }
        const m = e.ad + (e.kd - e.ad) * 0.55;
        const [x0, y0] = L.at(e.ab, e.ad);
        const [c1x, c1y] = L.at(e.ab, m);
        const [c2x, c2y] = L.at(e.kb, m);
        const [x1, y1] = L.at(e.kb, e.kd);
        return <path key={i} d={`M${x0},${y0} C${c1x},${c1y} ${c2x},${c2y} ${x1},${y1}`} />;
      })}
      {[...L.nodes.keys()].map((key) => {
        const r = L.rect(key);
        return <rect key={key} x={r.x} y={r.y} width={CARD_W} height={CARD_H} rx={10} />;
      })}
    </svg>
  );
}
