import { useEffect, useMemo, useRef, useState } from "react";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { sentenceFor } from "@frontier/time";
import { api } from "../../api.ts";
import { LaneCanvas } from "./LaneCanvas.tsx";
import { LooseSpans, type ViewProps } from "./OrderView.tsx";
import { num, shiftSpan, spanName, work, years } from "./model.ts";
import { type ScaleSizes, layoutScale, scaleBounds } from "./scaleLayout.ts";
import { alignable, compareVersions } from "./versions.ts";

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
  const [others, setOthers] = useState<{ id: string; title: string }[]>([]);
  const [other, setOther] = useState<ChronicleFile | null>(null);
  const [alignOn, setAlignOn] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.chronicles().then(
      (r) => live && setOthers(r.chronicles.filter((c) => c.id !== chronicle.id)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [chronicle.id]);

  const pickOther = (id: string) => {
    setAlignOn(null);
    if (!id) return setOther(null);
    api.chronicle(id).then(
      (r) => setOther(r.chronicle),
      () => setOther(null),
    );
  };

  // The two are brought onto one ruler: on the span both count from, or on one the author picks.
  const two = useMemo(() => {
    if (!other) return null;
    const anchors = alignable(chronicle, other, compareVersions(chronicle, other, 0));
    const anchor =
      anchors.find((a) => a.mine.id === alignOn) ??
      anchors.find((a) => a.mine.id === chronicle.origin) ??
      anchors[0] ??
      null;
    const offset = anchor?.offset ?? 0;
    const moved = { ...other, spans: other.spans.map((x) => shiftSpan(x, offset)) };
    return {
      anchors,
      anchor,
      moved,
      worked: work(moved),
      versus: compareVersions(chronicle, other, offset),
    };
  }, [chronicle, other, alignOn]);

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
  const within = useMemo(() => {
    if (!two) return null;
    return scaleBounds([...worked.points.values(), ...two.worked.points.values()]);
  }, [worked.points, two]);
  const laneIds = (c: ChronicleFile) => c.lanes.map((l) => l.id);
  const layout = useMemo(
    () => layoutScale(chronicle.spans, worked.points, laneIds(chronicle), room, sizes, within),
    [chronicle.spans, chronicle.lanes, worked.points, room, sizes, within],
  );
  const second = useMemo(
    () =>
      two &&
      layoutScale(two.moved.spans, two.worked.points, laneIds(two.moved), room, sizes, within),
    [two, room, sizes, within],
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

      {layout.spans.length === 0 && !two && (
        <p className="empty">
          Nothing is placed yet. Select a span and give it a start: the first one becomes year 0.
        </p>
      )}
      {others.length > 0 && (
        <div className="ch-versus">
          <label>
            <span>Compare with…</span>
            <select value={other?.id ?? ""} onChange={(e) => pickOther(e.target.value)}>
              <option value="">Nothing</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          {two && two.anchors.length > 0 && (
            <label>
              <span>Aligned on the start of</span>
              <select
                value={two.anchor?.mine.id ?? ""}
                onChange={(e) => setAlignOn(e.target.value)}
              >
                {two.anchors.map((a) => (
                  <option key={a.mine.id} value={a.mine.id}>
                    {spanName(a.mine)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {two && two.anchors.length === 0 && (
            <p className="muted ch-words">
              The two share no placed span to align on, so each is drawn by its own years.
            </p>
          )}
          {two && (
            <p className="muted ch-words">
              Outlined: differs between the two. Hatched: only in one. The second is read only.
            </p>
          )}
        </div>
      )}

      {(layout.spans.length > 0 || (second?.spans.length ?? 0) > 0) && (
        <div className={two ? (narrow ? "ch-two-down" : "ch-across") : ""}>
          <LaneCanvas
            lanes={chronicle.lanes}
            spans={layout.spans}
            tracks={layout.tracks}
            length={layout.length}
            marks={layout.marks.map((m) => ({ at: m.at, label: num(m.year) }))}
            eventRoom={ACROSS.eventAfter}
            nameOf={(id) => spanName(byId.get(id) ?? { name: "" })}
            markOf={(id) => worked.marks.get(id)}
            {...(two ? { stateOf: (id: string) => two.versus.mine.get(id), bare: true } : {})}
            {...(two ? { heading: chronicle.title } : {})}
            selected={p.selected}
            onSelect={p.onSelect}
            narrow={narrow}
            openLane={p.openLane}
            onOpenLane={p.onOpenLane}
          />
          {two && second && (
            <LaneCanvas
              lanes={two.moved.lanes}
              spans={second.spans}
              tracks={second.tracks}
              length={second.length}
              marks={second.marks.map((m) => ({ at: m.at, label: num(m.year) }))}
              eventRoom={ACROSS.eventAfter}
              nameOf={(id) => spanName(two.moved.spans.find((x) => x.id === id) ?? { name: "" })}
              markOf={(id) => two.worked.marks.get(id)}
              stateOf={(id) => two.versus.theirs.get(id)}
              bare
              heading={two.moved.title}
              selected={null}
              onSelect={(id) => {
                const mine = two.versus.match.get(id);
                if (mine) p.onSelect(mine);
              }}
              narrow={narrow}
              openLane={
                two.moved.lanes.find((l) => l.id === p.openLane)?.id ??
                two.moved.lanes.find(
                  (l) => l.name === chronicle.lanes.find((x) => x.id === p.openLane)?.name,
                )?.id ??
                two.moved.lanes[0]!.id
              }
              onOpenLane={(id) => {
                const name = two.moved.lanes.find((l) => l.id === id)?.name;
                const mine =
                  chronicle.lanes.find((l) => l.id === id) ??
                  chronicle.lanes.find((l) => l.name === name);
                if (mine) p.onOpenLane(mine.id);
              }}
            />
          )}
        </div>
      )}
      {two && (
        <section className="ch-versus-flags">
          <h3>What does not fit in {two.moved.title}</h3>
          {two.worked.checks.filter((c) => c.state === "does_not_fit").length === 0 ? (
            <p className="muted">Nothing.</p>
          ) : (
            <ul>
              {two.worked.checks
                .filter((c) => c.state === "does_not_fit")
                .map((c) => (
                  <li key={c.relation.id} className="ch-flag is-red">
                    <p>{sentenceFor(c, two.moved)}</p>
                  </li>
                ))}
            </ul>
          )}
        </section>
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
