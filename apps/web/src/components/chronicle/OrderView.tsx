import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { type Worked, spanName } from "./model.ts";
import { type OrderSizes, type PlacedSpan, layoutOrder } from "./orderLayout.ts";

const ACROSS: OrderSizes = { unit: 150, pad: 16, gap: 120, eventBefore: 10, eventAfter: 150 };
const DOWN: OrderSizes = { unit: 64, pad: 12, gap: 64, eventBefore: 22, eventAfter: 26 };
const ROW = 40;
const STRIP = 16;

interface Props {
  chronicle: ChronicleFile;
  worked: Worked;
  selected: string | null;
  onSelect: (id: string) => void;
  /** True on a phone: time runs down the page and one lane is open. */
  narrow: boolean;
  openLane: string;
  onOpenLane: (id: string) => void;
}

/** Spans in the order the author stated, lane by lane. Widths come from ranks, never lengths. */
export function OrderView(p: Props) {
  const { chronicle, worked, narrow } = p;
  const byId = useMemo(() => new Map(chronicle.spans.map((s) => [s.id, s])), [chronicle.spans]);
  const layout = useMemo(
    () =>
      layoutOrder(
        worked.order,
        new Set(chronicle.spans.filter((s) => s.point).map((s) => s.id)),
        chronicle.lanes.map((l) => l.id),
        narrow ? DOWN : ACROSS,
      ),
    [worked.order, chronicle.spans, chronicle.lanes, narrow],
  );
  const box = useRef<HTMLDivElement>(null);

  // The selected span is kept in sight, also when the form covers the lower half of a phone.
  useEffect(() => {
    if (!p.selected) return;
    const el = box.current?.querySelector(`[data-span="${p.selected}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [p.selected, narrow, p.openLane]);

  const notOrdered = worked.order.notOrdered
    .map((id) => byId.get(id))
    .filter((s): s is ChronicleSpan => s !== undefined);
  const colorOf = (lane: string) => chronicle.lanes.find((l) => l.id === lane)?.color ?? "#888";

  const bar = (s: PlacedSpan, style: CSSProperties) => {
    const span = byId.get(s.id);
    if (!span) return null;
    const mark = worked.marks.get(s.id);
    return (
      <button
        key={s.id}
        type="button"
        data-span={s.id}
        className={
          "ch-span" +
          (s.point ? " ch-event" : "") +
          (p.selected === s.id ? " is-selected" : "") +
          (mark ? ` is-${mark}` : "")
        }
        style={{ ...style, "--lane": colorOf(s.lane) } as CSSProperties}
        onClick={() => p.onSelect(s.id)}
        title={spanName(span)}
      >
        {s.point && <i className="ch-diamond" aria-hidden="true" />}
        <span>{spanName(span)}</span>
        {mark && <b className="sr-only">{mark === "red" ? " (does not fit)" : " (may not fit)"}</b>}
      </button>
    );
  };

  const gaps = layout.blocks.slice(0, -1).map((b, i) => ({ at: b.at + b.length, i }));

  return (
    <div className="ch-order" ref={box}>
      <p className="ch-note muted">Order only, not to scale.</p>
      {layout.spans.length === 0 && (
        <p className="empty">
          {chronicle.spans.length === 0
            ? "Nothing here yet. Add a span or an event."
            : "No order stated yet. Select a span and say how it relates to another."}
        </p>
      )}

      {layout.spans.length > 0 && !narrow && (
        <div className="ch-across">
          <div className="ch-canvas" style={{ width: layout.length }}>
            {gaps.map((g) => (
              <div
                key={g.i}
                className="ch-gap"
                style={{ left: g.at, width: ACROSS.gap }}
                aria-label="Not related to the others yet"
              >
                <span>not related to the others yet</span>
              </div>
            ))}
            {chronicle.lanes.map((lane) => (
              <div
                key={lane.id}
                className="ch-lane"
                style={{ height: (layout.tracks.get(lane.id) ?? 1) * ROW + 26 }}
              >
                <h3 style={{ color: lane.color }}>{lane.name}</h3>
                {layout.spans
                  .filter((s) => s.lane === lane.id)
                  .map((s) =>
                    bar(
                      s,
                      s.point
                        ? { left: s.t0 - 10, top: 24 + s.track * ROW, width: ACROSS.eventAfter }
                        : {
                            left: s.t0,
                            top: 24 + s.track * ROW,
                            width: Math.max(24, s.t1 - s.t0 - 4),
                          },
                    ),
                  )}
              </div>
            ))}
          </div>
        </div>
      )}

      {layout.spans.length > 0 && narrow && (
        <>
          <div className="ch-lane-tabs" role="tablist" aria-label="Lane shown">
            {chronicle.lanes.map((lane) => (
              <button
                key={lane.id}
                type="button"
                role="tab"
                aria-selected={lane.id === p.openLane}
                className={lane.id === p.openLane ? "is-on" : ""}
                style={{ "--lane": lane.color } as CSSProperties}
                onClick={() => p.onOpenLane(lane.id)}
              >
                {lane.name}
              </button>
            ))}
          </div>
          <div className="ch-down" style={{ height: layout.length }}>
            {gaps.map((g) => (
              <div key={g.i} className="ch-gap" style={{ top: g.at, height: DOWN.gap }}>
                <span>not related to the others yet</span>
              </div>
            ))}
            {chronicle.lanes
              .filter((l) => l.id !== p.openLane)
              .map((lane, i) => (
                <button
                  key={lane.id}
                  type="button"
                  className="ch-strip"
                  style={{ left: i * STRIP, "--lane": lane.color } as CSSProperties}
                  aria-label={`Show the lane ${lane.name}`}
                  onClick={() => p.onOpenLane(lane.id)}
                >
                  {layout.spans
                    .filter((s) => s.lane === lane.id)
                    .map((s) => (
                      <i
                        key={s.id}
                        className={s.point ? "is-point" : ""}
                        style={
                          s.point
                            ? { top: s.t0 - 4 }
                            : { top: s.t0, height: Math.max(6, s.t1 - s.t0 - 4) }
                        }
                      />
                    ))}
                </button>
              ))}
            <div
              className="ch-open"
              style={{ left: Math.max(0, chronicle.lanes.length - 1) * STRIP + 4 }}
            >
              {layout.spans
                .filter((s) => s.lane === p.openLane)
                .map((s) => {
                  const tracks = layout.tracks.get(s.lane) ?? 1;
                  const across = {
                    left: `${(s.track / tracks) * 100}%`,
                    width: `calc(${100 / tracks}% - 4px)`,
                  };
                  return bar(
                    s,
                    s.point
                      ? { ...across, top: s.t0 - 22, height: 44 }
                      : { ...across, top: s.t0, height: Math.max(44, s.t1 - s.t0 - 4) },
                  );
                })}
            </div>
          </div>
        </>
      )}

      {notOrdered.length > 0 && (
        <section className="ch-loose" aria-label="Not ordered yet">
          <h3>Not ordered yet</h3>
          {chronicle.lanes.map((lane) => {
            const mine = notOrdered.filter((s) => s.lane === lane.id);
            if (mine.length === 0) return null;
            return (
              <p key={lane.id}>
                <span className="ch-loose-lane" style={{ color: lane.color }}>
                  {lane.name}
                </span>
                {mine.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    data-span={s.id}
                    className={"ch-chip" + (p.selected === s.id ? " is-selected" : "")}
                    onClick={() => p.onSelect(s.id)}
                  >
                    {s.point ? "◆ " : ""}
                    {spanName(s)}
                  </button>
                ))}
              </p>
            );
          })}
        </section>
      )}
    </div>
  );
}
