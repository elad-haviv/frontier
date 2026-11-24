import { MessageSquare, Sparkles } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon.tsx";
import "./CommentBubbles.css";

/** A comment to show in the margin, level with its passage. */
export interface Bubble {
  id: string;
  /** How far below the top of the page's column the passage starts, in pixels. */
  top: number;
  text: string;
  for: "me" | "ai";
}

/** The narrowest margin bubbles are shown in, and the widest they grow. */
const NARROWEST = 150;
const WIDEST = 256;
/** Space kept between the column and the bubbles, and between two bubbles. */
const GAP = 16;
const BETWEEN = 6;

/**
 * Bubbles stacked from their passages down, so none covers another: each starts level with its
 * passage, or just below the one above when that one reaches further.
 */
export function stack(items: { top: number; height: number }[], between = BETWEEN): number[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.top - items[b]!.top);
  const out = new Array<number>(items.length);
  let floor = -Infinity;
  for (const i of order) {
    const y = Math.max(items[i]!.top, floor);
    out[i] = y;
    floor = y + items[i]!.height + between;
  }
  return out;
}

/**
 * The room to the right of a page's column, inside the scrolling page area, and where each
 * comment's passage is. `measure` is given the column's box and gives the bubbles; it is asked
 * again when the page area or the column changes size, when the page scrolls (the editor
 * measures its lines as they come into view) and when `deps` change. Off, or with too little room,
 * there are none.
 */
export function useMargin(
  column: RefObject<HTMLElement | null>,
  on: boolean,
  measure: (box: DOMRect) => Bubble[],
  deps: unknown[],
): { width: number; bubbles: Bubble[] } {
  const [state, setState] = useState<{ width: number; bubbles: Bubble[] }>({
    width: 0,
    bubbles: [],
  });
  const latest = useRef(measure);
  latest.current = measure;
  useEffect(() => {
    const el = column.current;
    const area = el?.closest<HTMLElement>(".content");
    if (!on || !el || !area) {
      setState((s) => (s.width === 0 && s.bubbles.length === 0 ? s : { width: 0, bubbles: [] }));
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const areaBox = area.getBoundingClientRect();
      const room = areaBox.left + area.clientWidth - box.right - GAP * 2;
      const width = room >= NARROWEST ? Math.min(WIDEST, room) : 0;
      const bubbles = width > 0 ? latest.current(box) : [];
      setState((s) =>
        s.width === width && JSON.stringify(s.bubbles) === JSON.stringify(bubbles)
          ? s
          : { width, bubbles },
      );
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(soon);
    observer.observe(area);
    observer.observe(el);
    area.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      area.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
    };
    // `deps` say when the passages may have moved.
  }, [column, on, ...deps]);
  return state;
}

/**
 * Comments as bubbles in the margin to the right of the page's column, each level with the text
 * it is on and none covering another. Pressing one opens its comment in full.
 */
export function CommentBubbles({
  width,
  bubbles,
  onOpen,
}: {
  width: number;
  bubbles: Bubble[];
  onOpen: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Placed once drawn, when their heights are known.
  useLayoutEffect(() => {
    const els = [...(box.current?.querySelectorAll<HTMLElement>(".comment-bubble") ?? [])];
    const tops = stack(els.map((el, i) => ({ top: bubbles[i]!.top, height: el.offsetHeight })));
    els.forEach((el, i) => {
      el.style.top = `${tops[i]}px`;
    });
  }, [bubbles, width]);
  if (width === 0 || bubbles.length === 0) return null;
  return (
    <div
      ref={box}
      className="comment-margin"
      style={{ width, left: `calc(100% + ${GAP}px)` }}
      aria-label="Comments"
      role="group"
    >
      {bubbles.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`comment-bubble${b.for === "ai" ? " is-ai" : ""}`}
          style={{ top: b.top }}
          data-id={b.id}
          title="Open this comment"
          onClick={() => onOpen(b.id)}
        >
          <Icon icon={b.for === "ai" ? Sparkles : MessageSquare} size="sm" />
          <span className="comment-bubble-text">{b.text}</span>
          {b.for === "ai" && <span className="sr-only"> (for the AI)</span>}
        </button>
      ))}
    </div>
  );
}
