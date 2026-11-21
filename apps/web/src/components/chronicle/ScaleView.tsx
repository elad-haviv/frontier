import { useEffect, useMemo, useRef, useState } from "react";
import type { ChronicleSpan } from "@frontier/schema";
import { LaneCanvas } from "./LaneCanvas.tsx";
import { LooseSpans, type ViewProps } from "./OrderView.tsx";
import { num, spanName, years } from "./model.ts";
import { type ScaleSizes, layoutScale } from "./scaleLayout.ts";

const ACROSS: ScaleSizes = {
  eventBefore: 10,
  eventAfter: 150,
  open: 28,
  least: 3,
  tick: 6,
  mark: 90,
};
const DOWN: ScaleSizes = { eventBefore: 22, eventAfter: 26, open: 28, least: 3, tick: 6, mark: 56 };
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** Spans on a straight ruler in years, counted from the origin. */
export function ScaleView(p: ViewProps) {
  const { chronicle, worked, narrow } = p;
  const byId = useMemo(() => new Map(chronicle.spans.map((s) => [s.id, s])), [chronicle.spans]);
  const frame = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(900);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWide(Math.max(280, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // On a desktop a pinch on a trackpad, or the wheel with Ctrl held, zooms. A phone zooms by
  // its buttons only, so a pinch there does nothing.
  useEffect(() => {
    const el = frame.current;
    if (!el || narrow) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + (e.deltaY < 0 ? 1 : -1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [narrow]);

  const sizes = narrow ? DOWN : ACROSS;
  const room = (narrow ? 460 : wide) * ZOOMS[zoom]!;
  const layout = useMemo(
    () =>
      layoutScale(
        chronicle.spans,
        worked.points,
        chronicle.lanes.map((l) => l.id),
        room,
        sizes,
      ),
    [chronicle.spans, chronicle.lanes, worked.points, room, sizes],
  );
  const pick = (ids: readonly string[]) =>
    ids.map((id) => byId.get(id)).filter((s): s is ChronicleSpan => s !== undefined);

  return (
    <div className="ch-order ch-scale" ref={frame}>
      <div className="ch-zoom">
        <p className="ch-note muted">
          To scale, in years counted from{" "}
          {chronicle.spans.find((s) => s.id === chronicle.origin)
            ? `the start of ${spanName(byId.get(chronicle.origin ?? "")!)}`
            : "year 0"}
          .
        </p>
        <button
          type="button"
          className="quiet"
          aria-label="Zoom out"
          disabled={zoom === 0}
          onClick={() => setZoom(zoom - 1)}
        >
          −
        </button>
        <button
          type="button"
          className="quiet"
          aria-label="Zoom in"
          disabled={zoom === ZOOMS.length - 1}
          onClick={() => setZoom(zoom + 1)}
        >
          +
        </button>
        <button type="button" className="quiet" disabled={zoom === 0} onClick={() => setZoom(0)}>
          Fit
        </button>
      </div>

      {layout.spans.length === 0 && (
        <p className="empty">
          Nothing is placed yet. Select a span and give it a start: the first one becomes year 0.
        </p>
      )}
      {layout.spans.length > 0 && (
        <LaneCanvas
          lanes={chronicle.lanes}
          spans={layout.spans}
          tracks={layout.tracks}
          length={layout.length}
          marks={layout.marks.map((m) => ({ at: m.at, label: num(m.year) }))}
          eventRoom={ACROSS.eventAfter}
          nameOf={(id) => spanName(byId.get(id) ?? { name: "" })}
          markOf={(id) => worked.marks.get(id)}
          selected={p.selected}
          onSelect={p.onSelect}
          narrow={narrow}
          openLane={p.openLane}
          onOpenLane={p.onOpenLane}
        />
      )}
      <LooseSpans
        title="Not placed: a length, but no start or end"
        chronicle={chronicle}
        spans={pick(layout.notPlaced.map((n) => n.id))}
        selected={p.selected}
        onSelect={p.onSelect}
        detail={(s) => {
          const n = layout.notPlaced.find((x) => x.id === s.id);
          return n ? years({ lo: n.low, hi: n.high }) : "";
        }}
      />
      <LooseSpans
        title="No numbers yet"
        chronicle={chronicle}
        spans={pick(layout.unnumbered)}
        selected={p.selected}
        onSelect={p.onSelect}
      />
    </div>
  );
}
