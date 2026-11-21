import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import type { ChronicleLane } from "@frontier/schema";

/** One span as a view places it along the time axis, in pixels. */
export interface Drawn {
  id: string;
  lane: string;
  point: boolean;
  t0: number;
  t1: number;
  track: number;
  /** For a view to scale: how much of each end fades, and whether an end is a broken edge. */
  fade0?: number;
  fade1?: number;
  openStart?: boolean;
  openEnd?: boolean;
  small?: boolean;
}

interface Props {
  lanes: readonly ChronicleLane[];
  spans: readonly Drawn[];
  tracks: ReadonlyMap<string, number>;
  /** The whole length along the time axis. */
  length: number;
  /** Stretches between blocks that are not related to each other. */
  gaps?: readonly { at: number; size: number }[];
  /** The marks of a ruler, when the view is to scale. */
  marks?: readonly { at: number; label: string }[];
  /** How wide an event's name may be when time runs across. */
  eventRoom: number;
  nameOf: (id: string) => string;
  markOf: (id: string) => "red" | "amber" | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
  /** True on a phone: time runs down the page and one lane is open. */
  narrow: boolean;
  openLane: string;
  onOpenLane: (id: string) => void;
  /** How a span compares with the other chronicle, when two are shown. */
  stateOf?: (id: string) => "differs" | "only" | undefined;
  /** Leaves sideways scrolling to the parent, so two canvases move as one. */
  bare?: boolean;
  /** A heading over the canvas, such as the chronicle's title when two are shown. */
  heading?: string;
  children?: ReactNode;
}

const ROW = 40;
const STRIP = 16;

/** Lanes of spans: rows across a wide screen, one open column and thin strips on a phone. */
export function LaneCanvas(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const scaled = p.marks !== undefined;

  // The selected span is kept in sight, also when the form covers the lower half of a phone.
  useEffect(() => {
    if (!p.selected) return;
    const el = box.current?.querySelector(`[data-span="${CSS.escape(p.selected)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [p.selected, p.narrow, p.openLane]);

  const colorOf = (lane: string) => p.lanes.find((l) => l.id === lane)?.color ?? "#888";

  const bar = (s: Drawn, style: CSSProperties) => {
    const mark = p.markOf(s.id);
    const versus = p.stateOf?.(s.id);
    const name = p.nameOf(s.id);
    const size = Math.max(1, s.t1 - s.t0);
    const vars = {
      "--lane": colorOf(s.lane),
      "--f0": `${Math.min(s.fade0 ?? 0, size)}px`,
      "--f1": `${Math.min(s.fade1 ?? 0, size)}px`,
    };
    return (
      <button
        key={s.id}
        type="button"
        data-span={s.id}
        className={
          "ch-span" +
          (s.point ? " ch-event" : "") +
          (scaled && !s.point ? " is-scaled" : "") +
          (s.openStart ? " is-open-start" : "") +
          (s.openEnd ? " is-open-end" : "") +
          (p.selected === s.id ? " is-selected" : "") +
          (mark ? ` is-${mark}` : "") +
          (versus ? ` is-${versus}` : "")
        }
        style={{ ...style, ...vars } as CSSProperties}
        onClick={() => p.onSelect(s.id)}
        title={name}
      >
        {s.point && <i className="ch-diamond" aria-hidden="true" />}
        <span>
          {name}
          {s.small && <small> (not to scale)</small>}
        </span>
        {mark && <b className="sr-only">{mark === "red" ? " (does not fit)" : " (may not fit)"}</b>}
        {versus && (
          <b className="sr-only">
            {versus === "differs" ? " (differs between the two)" : " (only in this one)"}
          </b>
        )}
      </button>
    );
  };

  if (!p.narrow) {
    const top = scaled ? 22 : 0;
    return (
      <div className={p.bare ? "" : "ch-across"} ref={box}>
        {p.heading && <h3 className="ch-version">{p.heading}</h3>}
        <div className="ch-canvas" style={{ width: p.length }}>
          {p.marks?.map((m) => (
            <div key={m.at} className="ch-mark" style={{ left: m.at }}>
              <span>{m.label}</span>
            </div>
          ))}
          {p.gaps?.map((g) => (
            <div key={g.at} className="ch-gap" style={{ left: g.at, width: g.size }}>
              <span>not related to the others yet</span>
            </div>
          ))}
          {scaled && <div style={{ height: top }} />}
          {p.lanes.map((lane) => (
            <div
              key={lane.id}
              className="ch-lane"
              style={{ height: (p.tracks.get(lane.id) ?? 1) * ROW + 26 }}
            >
              <h3 style={{ color: lane.color }}>{lane.name}</h3>
              {p.spans
                .filter((s) => s.lane === lane.id)
                .map((s) =>
                  bar(
                    s,
                    s.point
                      ? { left: s.t0 - 10, top: 24 + s.track * ROW, width: p.eventRoom }
                      : {
                          left: s.t0,
                          top: 24 + s.track * ROW,
                          width: Math.max(scaled ? 6 : 24, s.t1 - s.t0 - (scaled ? 0 : 4)),
                        },
                  ),
                )}
            </div>
          ))}
        </div>
        {p.children}
      </div>
    );
  }

  return (
    <div ref={box}>
      {p.heading && <h3 className="ch-version">{p.heading}</h3>}
      <div className="ch-lane-tabs" role="tablist" aria-label="Lane shown">
        {p.lanes.map((lane) => (
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
      <div className="ch-down" style={{ height: p.length }}>
        {p.marks?.map((m) => (
          <div key={m.at} className="ch-mark" style={{ top: m.at }}>
            <span>{m.label}</span>
          </div>
        ))}
        {p.gaps?.map((g) => (
          <div key={g.at} className="ch-gap" style={{ top: g.at, height: g.size }}>
            <span>not related to the others yet</span>
          </div>
        ))}
        {p.lanes
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
              {p.spans
                .filter((s) => s.lane === lane.id)
                .map((s) => (
                  <i
                    key={s.id}
                    className={s.point ? "is-point" : ""}
                    style={
                      s.point
                        ? { top: s.t0 - 4 }
                        : { top: s.t0, height: Math.max(6, s.t1 - s.t0 - (scaled ? 0 : 4)) }
                    }
                  />
                ))}
            </button>
          ))}
        <div className="ch-open" style={{ left: Math.max(0, p.lanes.length - 1) * STRIP + 4 }}>
          {p.spans
            .filter((s) => s.lane === p.openLane)
            .map((s) => {
              const tracks = p.tracks.get(s.lane) ?? 1;
              const across = {
                left: `${(s.track / tracks) * 100}%`,
                width: `calc(${100 / tracks}% - 4px)`,
              };
              return bar(
                s,
                s.point
                  ? { ...across, top: s.t0 - 22, height: 44 }
                  : {
                      ...across,
                      top: s.t0,
                      // A bar to scale keeps its true height; a transparent margin makes it tappable.
                      height: Math.max(scaled ? 6 : 44, s.t1 - s.t0 - (scaled ? 0 : 4)),
                    },
              );
            })}
        </div>
      </div>
      {p.children}
    </div>
  );
}
