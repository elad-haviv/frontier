import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { type SpanPoints, allSpanPoints, formatYears } from "@frontier/time";
import { useShortcut } from "../../keys.ts";
import { type Grip, dragLabel, dragSpans, placeSpan } from "./edit.ts";
import { type Change, type Worked, newSpan, spanName, withTies, withoutSpan } from "./model.ts";
import {
  type Bar,
  type Extent,
  type Row,
  ZOOMS,
  barOf,
  clampZoom,
  extentOf,
  groupBounds,
  levelOf,
  placedBounds,
  rowsOf,
  snapYears,
  ticksOf,
  whenText,
} from "./timelineLayout.ts";
import "./Timeline.css";

/** What the page can ask of the timeline: zoom, fit, and bring an event into sight. */
export interface TimelineHandle {
  zoomTo: (level: number) => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
  reveal: (id: string) => void;
}

/** Another version drawn underneath, matched by id: its bars and what differs. */
export interface Ghost {
  points: Map<string, SpanPoints>;
  /** For each span of this chronicle, the span of the other it matches. */
  matchOf: Map<string, string>;
  spans: Map<string, Pick<ChronicleSpan, "point">>;
  differs: Set<string>;
}

interface Props {
  chronicle: ChronicleFile;
  worked: Worked;
  change: Change;
  /** The selected events; the last is the one the details are about. */
  selected: readonly string[];
  onSelect: (ids: string[]) => void;
  narrow: boolean;
  folded: ReadonlySet<string>;
  onFold: (lane: string) => void;
  /** The year the maps show, drawn as the blue line; null hides it. */
  mapYear: number | null;
  onMapYear: (year: number) => void;
  /** Where to look first: a year to centre on, or null to fit everything. */
  initialYear: number | null;
  onZoomChange: (level: number) => void;
  /** Event ids something on a map follows. */
  onMaps: ReadonlySet<string>;
  /** Whether an event is linked to an entry. */
  linked: (span: ChronicleSpan) => boolean;
  onAddTo: (lane: string) => void;
  /** A new event was drawn: its details should open with the name ready to type. */
  onCreated: (id: string) => void;
  /** Asks for the details' dates to be typed (key D) or the name (Enter). */
  onEdit: (what: "name" | "dates") => void;
  onTypeWhen: (id: string, text: string) => string | null;
  onGroupMenu: (lane: string) => ReactNode;
  onRenameGroup: (lane: string, name: string) => void;
  ghost: Ghost | null;
  ref?: Ref<TimelineHandle>;
}

interface Drag {
  kind: "bars" | "draw" | "place" | "line";
  /** For bars: the events moved and which part of them. */
  ids: string[];
  grip: Grip;
  /** The row's event or group, for drawing and placing. */
  id: string;
  lane: string;
  x0: number;
  y0: number;
  /** The chart x where the pointer went down, for drawing. */
  chartX: number;
  pointer: number;
  /** Touch waits for a press and hold; until then a swipe pans. */
  armed: boolean;
  moved: boolean;
  by: number;
  /** For drawing: the years from and to. */
  from: number;
  to: number;
  clientX: number;
  clientY: number;
  /** For drawing: only an empty row of an event without dates, or a group's last row. */
  drawable?: boolean;
}

const HOLD_MS = 350;

/** One chronicle as a timeline: rows on the left, bars on a ruler on the right. */
export function Timeline(p: Props) {
  const { chronicle, worked, narrow } = p;
  const LIST = narrow ? 0 : 340;
  const ROW = narrow ? 44 : 38;
  const RULER = narrow ? 40 : 46;

  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const [perYear, setPerYear] = useState<number | null>(null);
  const anchor = useRef<{ year: number; offset: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hold = useRef<number | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; error: string | null } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<{ lane: string; text: string } | null>(null);

  const bounds = useMemo(() => placedBounds(worked.points.values()), [worked.points]);
  const chartWidth = Math.max(0, viewport - LIST);
  const zoom = perYear ?? 1;
  const extent = useMemo(
    () => extentOf(bounds, p.mapYear, zoom, Math.max(chartWidth, 200)),
    [bounds, p.mapYear, zoom, chartWidth],
  );
  const xOf = (year: number) => (year - extent.from) * zoom;
  const yearAt = (chartX: number) => extent.from + chartX / zoom;
  const level = levelOf(zoom);

  // While dragging, the chronicle is drawn as it would be after the drag, ties included.
  const shown = useMemo(() => {
    if (!drag?.moved || drag.kind !== "bars") return null;
    const next = withTies(dragSpans(chronicle, drag.ids, drag.grip, drag.by));
    return { chronicle: next, points: allSpanPoints(next.spans) };
  }, [drag, chronicle]);
  const points = shown?.points ?? worked.points;
  const view = shown?.chronicle ?? chronicle;
  const rows = useMemo(() => rowsOf(view, p.folded), [view, p.folded]);
  const rowOf = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => r.kind === "event" && m.set(r.span.id, i));
    return m;
  }, [rows]);
  const selected = new Set(p.selected);
  const primary = p.selected.at(-1) ?? null;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewport(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** The zoom that shows everything placed. */
  const fitZoom = () =>
    bounds
      ? clampZoom((chartWidth - 60) / Math.max(bounds.hi - bounds.lo, 1))
      : clampZoom(chartWidth / 120);

  // The first look, once the width is known: centred on a year asked for, or everything fitted.
  useLayoutEffect(() => {
    if (perYear !== null || chartWidth === 0) return;
    if (p.initialYear !== null) {
      setPerYear(bounds ? Math.max(fitZoom(), ZOOMS[3]!.perYear) : fitZoom());
      anchor.current = { year: p.initialYear, offset: LIST + chartWidth / 2 };
    } else {
      setPerYear(fitZoom());
      anchor.current = { year: bounds?.lo ?? 0, offset: LIST + 30 };
    }
  }, [chartWidth]);

  useEffect(() => {
    if (perYear !== null) p.onZoomChange(ZOOMS.indexOf(levelOf(perYear)));
  }, [perYear]);

  // After a zoom, the year that was under the pointer (or in the middle) stays where it was.
  useLayoutEffect(() => {
    const el = scroller.current;
    const at = anchor.current;
    if (!el || !at || perYear === null) return;
    anchor.current = null;
    el.scrollLeft = LIST + xOf(at.year) - at.offset;
  });

  const zoomAround = (next: number, year: number, offset: number) => {
    anchor.current = { year, offset };
    setPerYear(clampZoom(next));
  };
  /** The year in the middle of the chart, or the selected event's, or the map year. */
  const focusYear = (): number => {
    const sel = primary ? points.get(primary)?.start : null;
    if (sel && Number.isFinite(sel.lo)) return sel.lo;
    const el = scroller.current;
    if (el) return yearAt(el.scrollLeft + chartWidth / 2);
    return p.mapYear ?? 0;
  };
  const middle = () => LIST + chartWidth / 2;

  useImperativeHandle(p.ref, () => ({
    zoomTo: (i) => zoomAround(ZOOMS[i]!.perYear, focusYear(), middle()),
    zoomBy: (f) => zoomAround(zoom * f, focusYear(), middle()),
    fit: () => {
      setPerYear(fitZoom());
      anchor.current = { year: bounds?.lo ?? 0, offset: LIST + 30 };
    },
    reveal: (id) => {
      const s = points.get(id)?.start ?? points.get(id)?.end;
      const el = scroller.current;
      const row = rowOf.get(id);
      if (!el) return;
      if (s && Number.isFinite(s.lo)) {
        const x = LIST + xOf(s.lo);
        if (x - el.scrollLeft < LIST || x - el.scrollLeft > el.clientWidth - 40) {
          el.scrollLeft = x - LIST - 40;
        }
      }
      if (row !== undefined) {
        const y = RULER + row * ROW;
        if (y < el.scrollTop + RULER || y + ROW > el.scrollTop + el.clientHeight) {
          el.scrollTop = Math.max(0, y - el.clientHeight / 3);
        }
      }
    },
  }));

  // Ctrl+wheel, or a pinch on a trackpad, zooms smoothly around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const offset = e.clientX - box.left;
      const chartX = el.scrollLeft + offset - LIST;
      zoomAround(zoom * Math.exp(-e.deltaY * 0.01), yearAt(chartX), offset);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // A pinch with two fingers zooms; a press and hold stops the page from panning while a bar moves.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinch: { dist: number; zoom: number; year: number; offset: number } | null = null;
    const spread = (t: TouchList) =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const box = el.getBoundingClientRect();
      const offset = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - box.left;
      pinch = {
        dist: spread(e.touches),
        zoom,
        year: yearAt(el.scrollLeft + offset - LIST),
        offset,
      };
      cancelHold();
    };
    const onMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (d && d.armed && d.kind !== "line") e.preventDefault();
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        zoomAround(pinch.zoom * (spread(e.touches) / pinch.dist), pinch.year, pinch.offset);
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  });

  function cancelHold() {
    if (hold.current !== null) window.clearTimeout(hold.current);
    hold.current = null;
  }

  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  /** Starts a gesture: at once with a mouse or pen, after a press and hold with a finger. */
  function begin(e: ReactPointerEvent, d: Omit<Drag, "armed" | "moved" | "by" | "pointer">) {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    const target = e.currentTarget as HTMLElement;
    const pointer = e.pointerId;
    const next: Drag = { ...d, pointer, armed: !touch, moved: false, by: 0 };
    dragRef.current = next;
    if (!touch) {
      target.setPointerCapture(pointer);
      return;
    }
    cancelHold();
    hold.current = window.setTimeout(() => {
      hold.current = null;
      const now = dragRef.current;
      if (!now || now.pointer !== pointer) return;
      try {
        target.setPointerCapture(pointer);
      } catch {
        // The finger has already lifted.
      }
      navigator.vibrate?.(10);
      setDragBoth({ ...now, armed: true });
    }, HOLD_MS);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.armed) {
      // A finger that moves before the hold is a swipe: the page pans and nothing is dragged.
      if (Math.hypot(dx, dy) > 10) {
        cancelHold();
        dragRef.current = null;
      }
      return;
    }
    if (!d.moved && Math.abs(dx) < 4) return;
    if (d.kind === "draw" && !d.drawable) return;
    const snap = level.snap;
    const by = snapYears(dx / zoom, snap);
    const next: Drag = { ...d, moved: true, by, clientX: e.clientX, clientY: e.clientY };
    if (d.kind === "draw") {
      next.to = snapYears(yearAt(d.chartX + dx), snap);
    }
    setDragBoth(next);
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = dragRef.current;
    cancelHold();
    if (!d || d.pointer !== e.pointerId) return;
    setDragBoth(null);
    if (!d.moved) {
      tap(e, d);
      return;
    }
    if (d.kind === "bars" && d.by !== 0) {
      p.change((c) => dragSpans(c, d.ids, d.grip, d.by));
    } else if (d.kind === "line") {
      p.onMapYear(snapYears(yearAt(d.chartX + (e.clientX - d.x0)), level.snap));
    } else if (d.kind === "place") {
      p.change((c) => placeSpan(c, d.id, d.from + d.by, null));
      p.onSelect([d.id]);
    } else if (d.kind === "draw" && d.from !== d.to) {
      const made = d.id === "" ? newSpan(d.lane, false, "New event") : null;
      const id = made?.id ?? d.id;
      p.change((c) => placeSpan(made ? { ...c, spans: [...c.spans, made] } : c, id, d.from, d.to));
      p.onSelect([id]);
      if (made) p.onCreated(id);
    }
  }

  function onPointerCancel() {
    cancelHold();
    setDragBoth(null);
  }

  /** A click or tap without a drag: select, or with Shift add to the selection. */
  function tap(e: ReactPointerEvent, d: Drag) {
    if (d.kind === "bars" || d.kind === "place") {
      if (e.shiftKey) {
        const has = p.selected.includes(d.id);
        p.onSelect(has ? p.selected.filter((x) => x !== d.id) : [...p.selected, d.id]);
      } else p.onSelect([d.id]);
    } else if (d.kind === "draw") {
      if (d.id) p.onSelect([d.id]);
      else p.onSelect([]);
    }
  }

  // Double-click on an empty row drops a moment there.
  function onDoubleClick(e: React.MouseEvent, row: Row) {
    const box = scroller.current!.getBoundingClientRect();
    const chartX = scroller.current!.scrollLeft + e.clientX - box.left - LIST;
    const year = snapYears(yearAt(chartX), level.snap);
    if (row.kind === "add") {
      const made = newSpan(row.lane.id, true, "New event");
      p.change((c) => placeSpan({ ...c, spans: [...c.spans, made] }, made.id, year, null));
      p.onSelect([made.id]);
      p.onCreated(made.id);
    } else if (row.kind === "event" && row.span.point && !points.get(row.span.id)?.start) {
      p.change((c) => placeSpan(c, row.span.id, year, null));
    }
  }

  const chartXOf = (e: ReactPointerEvent) => {
    const box = scroller.current!.getBoundingClientRect();
    return scroller.current!.scrollLeft + e.clientX - box.left - LIST;
  };

  // ── Keys ──────────────────────────────────────────────────────────────────────────────
  const frame = useRef<HTMLDivElement>(null);
  /** Arrows and Delete are the timeline's only while the focus is on it or on nothing. */
  const free = () => {
    const a = document.activeElement;
    if (!a || a === document.body) return true;
    if (!frame.current?.contains(a)) return false;
    const tag = (a as HTMLElement).tagName;
    return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT";
  };
  const eventRows = rows.filter((r): r is Extract<Row, { kind: "event" }> => r.kind === "event");
  const step = (by: number) => {
    if (!free() || eventRows.length === 0) return false;
    const at = eventRows.findIndex((r) => r.span.id === primary);
    const next = eventRows[Math.max(0, Math.min(eventRows.length - 1, at + by))] ?? eventRows[0]!;
    p.onSelect([next.span.id]);
    focusBar(next.span.id);
    return true;
  };
  const nudge = (grip: Grip, times: number) => {
    if (!free() || p.selected.length === 0) return false;
    p.change((c) => dragSpans(c, [...p.selected], grip, times * level.snap));
    return true;
  };
  useShortcut("chronicle.up", () => step(-1));
  useShortcut("chronicle.down", () => step(1));
  useShortcut("chronicle.left", () => nudge("move", -1));
  useShortcut("chronicle.right", () => nudge("move", 1));
  useShortcut("chronicle.leftFar", () => nudge("move", -10));
  useShortcut("chronicle.rightFar", () => nudge("move", 10));
  useShortcut("chronicle.endEarlier", () => nudge("end", -1));
  useShortcut("chronicle.endLater", () => nudge("end", 1));
  useShortcut("chronicle.startEarlier", () => nudge("start", -1));
  useShortcut("chronicle.startLater", () => nudge("start", 1));
  useShortcut("chronicle.zoom1", () => zoomAround(ZOOMS[0]!.perYear, focusYear(), middle()));
  useShortcut("chronicle.zoom2", () => zoomAround(ZOOMS[1]!.perYear, focusYear(), middle()));
  useShortcut("chronicle.zoom3", () => zoomAround(ZOOMS[2]!.perYear, focusYear(), middle()));
  useShortcut("chronicle.zoom4", () => zoomAround(ZOOMS[3]!.perYear, focusYear(), middle()));
  useShortcut("chronicle.zoomIn", () => zoomAround(zoom * 2, focusYear(), middle()));
  useShortcut("chronicle.zoomOut", () => zoomAround(zoom / 2, focusYear(), middle()));
  useShortcut("chronicle.fit", () => {
    setPerYear(fitZoom());
    anchor.current = { year: bounds?.lo ?? 0, offset: LIST + 30 };
  });
  useShortcut("chronicle.mapYear", () => {
    const s = primary ? points.get(primary)?.start : null;
    if (!s || !Number.isFinite(s.lo)) return false;
    p.onMapYear(s.lo);
    return true;
  });
  useShortcut("chronicle.delete", () => {
    if (!free() || p.selected.length === 0) return false;
    const ids = [...p.selected];
    p.change((c) => ids.reduce((acc, id) => withoutSpan(acc, id), c));
    p.onSelect([]);
    return true;
  });
  useShortcut("chronicle.deselect", () => {
    if (p.selected.length === 0 || !free()) return false;
    p.onSelect([]);
    return true;
  });
  useShortcut("chronicle.name", () => {
    if (!free() || !primary) return false;
    p.onEdit("name");
    return true;
  });
  useShortcut("chronicle.dates", () => {
    if (!primary) return false;
    p.onEdit("dates");
    return true;
  });
  useShortcut("chronicle.fold", () => {
    const a = document.activeElement as HTMLElement | null;
    const lane = a?.dataset?.["group"];
    if (!lane) return false;
    p.onFold(lane);
    return true;
  });

  function focusBar(id: string) {
    requestAnimationFrame(() =>
      frame.current?.querySelector<HTMLElement>(`[data-bar="${CSS.escape(id)}"]`)?.focus(),
    );
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────────────
  const ticks = useMemo(() => ticksOf(extent, zoom), [extent, zoom]);
  const mapX = p.mapYear !== null ? xOf(p.mapYear) : null;
  const lineDrag = drag?.kind === "line" && drag.moved ? drag : null;
  const shownMapYear =
    lineDrag && p.mapYear !== null
      ? snapYears(yearAt(lineDrag.chartX + (lineDrag.clientX - lineDrag.x0)), level.snap)
      : p.mapYear;
  const label = (() => {
    if (!drag?.moved) return null;
    if (drag.kind === "bars") {
      const s = view.spans.find((x) => x.id === drag.id);
      if (!s) return null;
      const name = drag.ids.length > 1 ? `${drag.ids.length} events` : spanName(s);
      return dragLabel(name, whenText(s, points.get(s.id)), drag.by);
    }
    if (drag.kind === "draw")
      return formatYears(Math.min(drag.from, drag.to), Math.max(drag.from, drag.to));
    if (drag.kind === "place")
      return `Starts ${formatYears(drag.from + drag.by, drag.from + drag.by)}`;
    if (drag.kind === "line" && shownMapYear !== null)
      return `Maps: year ${formatYears(shownMapYear, shownMapYear)}`;
    return null;
  })();

  function grabLine(e: ReactPointerEvent) {
    if (mapX === null) return;
    e.stopPropagation();
    begin(e, {
      kind: "line",
      ids: [],
      grip: "move",
      id: "",
      lane: "",
      x0: e.clientX,
      y0: e.clientY,
      chartX: mapX,
      from: 0,
      to: 0,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  const height = RULER + rows.length * ROW;
  const style = {
    "--tl-list": `${LIST}px`,
    "--tl-row": `${ROW}px`,
    "--tl-ruler": `${RULER}px`,
    "--tl-width": `${extent.width}px`,
  } as CSSProperties;

  const tieLines = useMemo(() => {
    const out: { id: string; d: string }[] = [];
    for (const s of view.spans) {
      const y = rowOf.get(s.id);
      if (y === undefined) continue;
      for (const part of ["start", "end"] as const) {
        const tie = part === "start" ? s.startFrom : s.endFrom;
        if (!tie || (part === "end" && s.point)) continue;
        const ay = rowOf.get(tie.span);
        const at = points.get(tie.span)?.[tie.edge];
        const mine = points.get(s.id)?.[part];
        if (
          ay === undefined ||
          !at ||
          !mine ||
          !Number.isFinite(at.lo) ||
          !Number.isFinite(mine.lo)
        )
          continue;
        const ax = xOf((at.lo + at.hi) / 2);
        const tx = xOf((mine.lo + mine.hi) / 2);
        const y0 = ay * ROW + ROW / 2;
        const y1 = y * ROW + ROW / 2;
        out.push({ id: `${s.id}:${part}`, d: `M${ax},${y0} V${y1} H${tx}` });
      }
    }
    return out;
  }, [view.spans, rowOf, points, extent, zoom]);

  return (
    <div
      ref={frame}
      className={`tl${narrow ? " is-narrow" : ""}${drag?.moved ? " is-dragging" : ""}`}
      style={style}
    >
      <div
        className="tl-scroll"
        ref={scroller}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {perYear !== null && (
          <div
            className="tl-inner"
            role="grid"
            aria-label={`${chronicle.title}: timeline`}
            aria-rowcount={rows.length + 1}
            style={{ width: LIST + extent.width, height }}
          >
            <div className="tl-head" role="row">
              {!narrow && (
                <div className="tl-corner" role="columnheader">
                  <span>Event</span>
                  <span>When</span>
                </div>
              )}
              <div
                className="tl-ruler"
                role="columnheader"
                aria-label={`Years, by ${level.label.toLowerCase()}`}
              >
                {ticks.minor.map((t) => (
                  <i key={`m${t.year}`} className="tl-tick" style={{ left: t.x }} />
                ))}
                {ticks.major.map((t) => (
                  <i key={`M${t.year}`} className="tl-tick is-major" style={{ left: t.x }}>
                    <span>{formatYears(t.year, t.year)}</span>
                  </i>
                ))}
                {shownMapYear !== null && (
                  <button
                    type="button"
                    className="tl-mapflag"
                    style={{ left: xOf(shownMapYear) }}
                    title="The year the maps show. Drag to change it."
                    aria-label={`Maps show year ${formatYears(shownMapYear, shownMapYear)}`}
                    onPointerDown={grabLine}
                  >
                    Maps: {formatYears(shownMapYear, shownMapYear)}
                  </button>
                )}
              </div>
            </div>

            <div className="tl-lines" aria-hidden="true">
              {ticks.major.map((t) => (
                <i key={t.year} style={{ left: LIST + t.x }} />
              ))}
            </div>
            {tieLines.length > 0 && (
              <svg
                className="tl-ties"
                aria-hidden="true"
                width={extent.width}
                height={rows.length * ROW}
                style={{ left: LIST, top: RULER }}
              >
                {tieLines.map((l) => (
                  <path key={l.id} d={l.d} />
                ))}
              </svg>
            )}

            {rows.map((row, i) => (
              <RowView
                key={row.kind === "event" ? row.span.id : `${row.kind}:${row.lane.id}`}
                row={row}
                index={i}
                p={p}
                narrow={narrow}
                points={points}
                extent={extent}
                perYear={zoom}
                selected={selected}
                primary={primary}
                dragging={drag}
                editing={editing}
                setEditing={setEditing}
                renaming={renaming}
                setRenaming={setRenaming}
                marks={worked.marks}
                begin={begin}
                chartXOf={chartXOf}
                yearAt={yearAt}
                onDoubleClick={onDoubleClick}
                chronicle={view}
              />
            ))}

            {mapX !== null && shownMapYear !== null && (
              <div
                className="tl-mapline"
                style={{ left: LIST + xOf(shownMapYear) }}
                onPointerDown={grabLine}
              />
            )}
            {!bounds && (
              <p className="tl-empty-chart" style={{ left: LIST + 16, top: RULER + 8 }}>
                Nothing is placed in years yet. Type a date in any row, or drag a dashed box onto
                the timeline.
              </p>
            )}
          </div>
        )}
      </div>
      {label && drag && (
        <div className="tl-drag-label" style={{ left: drag.clientX + 14, top: drag.clientY - 34 }}>
          {label}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  row: Row;
  index: number;
  p: Props;
  narrow: boolean;
  chronicle: ChronicleFile;
  points: ReadonlyMap<string, SpanPoints>;
  extent: Extent;
  perYear: number;
  selected: Set<string>;
  primary: string | null;
  dragging: Drag | null;
  editing: { id: string; text: string; error: string | null } | null;
  setEditing: (e: { id: string; text: string; error: string | null } | null) => void;
  renaming: { lane: string; text: string } | null;
  setRenaming: (r: { lane: string; text: string } | null) => void;
  marks: Map<string, "red" | "amber">;
  begin: (e: ReactPointerEvent, d: Omit<Drag, "armed" | "moved" | "by" | "pointer">) => void;
  chartXOf: (e: ReactPointerEvent) => number;
  yearAt: (chartX: number) => number;
  onDoubleClick: (e: React.MouseEvent, row: Row) => void;
}

function RowView(r: RowProps) {
  const { row, p, narrow, points, extent, perYear } = r;
  const sel = row.kind === "event" && r.selected.has(row.span.id);
  const lane = row.lane;
  const laneStyle = { "--lane": lane.color } as CSSProperties;

  // ── The list cell ─────────────────────────────────────────────────────────────────────
  let cell: ReactNode = null;
  if (row.kind === "group") {
    const b = groupBounds(
      r.chronicle.spans.filter((s) => s.lane === lane.id),
      points,
    );
    const renamingThis = r.renaming?.lane === lane.id;
    cell = (
      <div className="tl-cell is-group" role="rowheader" style={laneStyle}>
        <button
          type="button"
          className="tl-fold"
          data-group={lane.id}
          aria-expanded={!row.folded}
          aria-label={`${row.folded ? "Unfold" : "Fold"} ${lane.name}`}
          onClick={(e) => {
            if (e.shiftKey) {
              const ids = r.chronicle.spans.filter((s) => s.lane === lane.id).map((s) => s.id);
              p.onSelect([...new Set([...p.selected, ...ids])]);
            } else p.onFold(lane.id);
          }}
        >
          {row.folded ? "▸" : "▾"}
        </button>
        <i className="tl-dot" aria-hidden="true" />
        {renamingThis ? (
          <input
            className="tl-rename"
            aria-label="Group name"
            autoFocus
            value={r.renaming!.text}
            onChange={(e) => r.setRenaming({ lane: lane.id, text: e.target.value })}
            onBlur={() => {
              if (r.renaming!.text.trim()) p.onRenameGroup(lane.id, r.renaming!.text.trim());
              r.setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") r.setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="tl-group-name"
            title="Rename"
            onClick={() => r.setRenaming({ lane: lane.id, text: lane.name })}
          >
            {lane.name}
          </button>
        )}
        <span className="tl-when">
          {b
            ? `${formatYears(b.lo, b.lo)} → ${formatYears(b.hi, b.hi)}`
            : `${row.count} ${row.count === 1 ? "event" : "events"}`}
        </span>
        {p.onGroupMenu(lane.id)}
      </div>
    );
  } else if (row.kind === "event") {
    const s = row.span;
    const pt = points.get(s.id);
    const editingThis = r.editing?.id === s.id;
    const red = r.marks.get(s.id) === "red";
    cell = (
      <div
        className={`tl-cell${sel ? " is-selected" : ""}`}
        role="rowheader"
        style={laneStyle}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("input")) return;
          if (e.shiftKey) {
            p.onSelect(sel ? p.selected.filter((x) => x !== s.id) : [...p.selected, s.id]);
          } else p.onSelect([s.id]);
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-frontier-span", s.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/x-frontier-span")) e.preventDefault();
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/x-frontier-span");
          if (id && id !== s.id) p.change((c) => moveRow(c, id, s.lane, s.id));
        }}
      >
        <span className={`tl-kind${s.point ? " is-moment" : ""}`} aria-hidden="true" />
        <span className="tl-name">
          {spanName(s)}
          {red && (
            <span className="tl-red" title="Doesn't fit a rule" aria-label="Doesn't fit">
              ⚠
            </span>
          )}
        </span>
        {editingThis ? (
          <span className="tl-when-edit">
            <input
              aria-label={`When: ${spanName(s)}`}
              autoFocus
              value={r.editing!.text}
              onChange={(e) => r.setEditing({ id: s.id, text: e.target.value, error: null })}
              onKeyDown={(e) => {
                if (e.key === "Escape") r.setEditing(null);
                if (e.key !== "Enter") return;
                const error = p.onTypeWhen(s.id, r.editing!.text);
                r.setEditing(error ? { ...r.editing!, error } : null);
              }}
              onBlur={() => r.setEditing(null)}
            />
            {r.editing!.error && (
              <em className="tl-when-error" role="alert">
                {r.editing!.error}
              </em>
            )}
          </span>
        ) : (
          <span
            className={`tl-when${pt?.start || pt?.end ? "" : " is-none"}`}
            title="Double-click to type"
            onDoubleClick={() => r.setEditing({ id: s.id, text: typedWhen(s, pt), error: null })}
          >
            {whenText(s, pt)}
          </span>
        )}
      </div>
    );
  } else {
    cell = (
      <div className="tl-cell is-add" role="rowheader">
        <button type="button" className="plain" onClick={() => p.onAddTo(lane.id)}>
          + Add to {lane.name}
        </button>
      </div>
    );
  }

  // ── The chart track ───────────────────────────────────────────────────────────────────
  const startDraw = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, .tl-bar, .tl-nodates")) return;
    const chartX = r.chartXOf(e);
    const year = snapYears(r.yearAt(chartX), levelOf(perYear).snap);
    r.begin(e, {
      drawable: canDraw,
      kind: "draw",
      ids: [],
      grip: "move",
      id: row.kind === "event" ? row.span.id : "",
      lane: lane.id,
      x0: e.clientX,
      y0: e.clientY,
      chartX,
      from: year,
      to: year,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };
  const drawing =
    r.dragging?.kind === "draw" &&
    r.dragging.moved &&
    r.dragging.lane === lane.id &&
    (row.kind === "add"
      ? r.dragging.id === ""
      : row.kind === "event" && r.dragging.id === row.span.id)
      ? r.dragging
      : null;
  const canDraw =
    row.kind === "add" ||
    (row.kind === "event" &&
      !row.span.point &&
      !points.get(row.span.id)?.start &&
      !points.get(row.span.id)?.end);

  let track: ReactNode = null;
  if (row.kind === "group") {
    const b = groupBounds(
      r.chronicle.spans.filter((s) => s.lane === lane.id),
      points,
    );
    track = (
      <>
        {b && (
          <i
            className="tl-summary"
            aria-hidden="true"
            style={{
              left: (b.lo - extent.from) * perYear,
              width: Math.max(2, (b.hi - b.lo) * perYear),
            }}
          />
        )}
        {narrow && (
          <div className="tl-sticky-head">
            <button
              type="button"
              className="tl-fold"
              data-group={lane.id}
              aria-expanded={!row.folded}
              onClick={() => p.onFold(lane.id)}
            >
              {row.folded ? "▸" : "▾"} <i className="tl-dot" aria-hidden="true" /> {lane.name}
              <span className="muted"> · {row.count}</span>
            </button>
            {p.onGroupMenu(lane.id)}
          </div>
        )}
      </>
    );
  } else if (row.kind === "add") {
    track = narrow ? (
      <div className="tl-sticky-head is-add">
        <button type="button" className="plain" onClick={() => p.onAddTo(lane.id)}>
          + Add to {lane.name}
        </button>
      </div>
    ) : null;
  } else {
    track = (
      <>
        {p.ghost && <GhostBar span={row.span} ghost={p.ghost} extent={extent} perYear={perYear} />}
        <BarView
          span={row.span}
          bar={barOf(row.span, points.get(row.span.id), extent, perYear)}
          r={r}
        />
      </>
    );
  }

  return (
    <div className="tl-row" role="row" aria-rowindex={r.index + 2}>
      {!narrow && cell}
      <div
        className={`tl-track is-${row.kind}${sel ? " is-selected" : ""}${canDraw ? " can-draw" : ""}`}
        role="gridcell"
        style={laneStyle}
        onPointerDown={startDraw}
        onDoubleClick={(e) => r.onDoubleClick(e, row)}
      >
        {track}
        {drawing && (
          <i
            className="tl-drawing"
            style={{
              left: (Math.min(drawing.from, drawing.to) - extent.from) * perYear,
              width: Math.abs(drawing.to - drawing.from) * perYear,
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Moves an event to another group, just above another event; an empty `before` puts it last. */
export function moveRow(
  chronicle: ChronicleFile,
  id: string,
  lane: string,
  before: string | null,
): ChronicleFile {
  const span = chronicle.spans.find((s) => s.id === id);
  if (!span) return chronicle;
  const rest = chronicle.spans.filter((s) => s.id !== id);
  const at = before ? rest.findIndex((s) => s.id === before) : -1;
  const moved = { ...span, lane };
  const spans = at === -1 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
  return { ...chronicle, spans };
}

/** What the When cell offers to edit: "270–290 → 300", or one year for a moment. */
function typedWhen(span: ChronicleSpan, p: SpanPoints | undefined): string {
  const t = whenText(span, p);
  return t === "No dates yet" ? "" : t.replace(/\?/g, "").trim();
}

function BarView({ span, bar, r }: { span: ChronicleSpan; bar: Bar; r: RowProps }) {
  const { p, narrow } = r;
  const sel = r.selected.has(span.id);
  const red = r.marks.get(span.id) === "red";
  const pt = r.points.get(span.id);
  const name = spanName(span);
  const icons = (
    <>
      {(span.startFrom || (!span.point && span.endFrom)) && (
        <span className="tl-icon" title="Tied to another event" aria-hidden="true">
          ⛓
        </span>
      )}
      {p.linked(span) && (
        <span className="tl-icon" title="Linked to an entry" aria-hidden="true">
          📖
        </span>
      )}
      {p.onMaps.has(span.id) && (
        <span className="tl-icon" title="Something on a map follows this" aria-hidden="true">
          🗺
        </span>
      )}
    </>
  );
  const describe = () => {
    const parts = [name];
    if (pt?.start) parts.push(`starts ${rangeWords(pt.start)}`);
    if (!span.point && pt?.end) parts.push(`ends ${rangeWords(pt.end)}`);
    if (red) parts.push("doesn't fit a rule");
    return parts.join(", ");
  };

  const down = (e: ReactPointerEvent, grip: Grip) => {
    e.stopPropagation();
    const ids = r.selected.has(span.id) && grip === "move" ? [...p.selected] : [span.id];
    if (!ids.includes(span.id)) ids.push(span.id);
    r.begin(e, {
      kind: "bars",
      ids: grip === "move" ? ids : [span.id],
      grip,
      id: span.id,
      lane: span.lane,
      x0: e.clientX,
      y0: e.clientY,
      chartX: 0,
      from: 0,
      to: 0,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  if (bar.kind === "none") {
    const placing = r.dragging?.kind === "place" && r.dragging.id === span.id && r.dragging.moved;
    return (
      <button
        type="button"
        className={`tl-nodates${sel ? " is-selected" : ""}`}
        data-bar={span.id}
        aria-label={`${name}, no dates yet`}
        style={
          placing
            ? { transform: `translateX(${r.dragging!.clientX - r.dragging!.x0}px)` }
            : undefined
        }
        onPointerDown={(e) => {
          e.stopPropagation();
          const box = e.currentTarget.getBoundingClientRect();
          const chartX = r.chartXOf({ ...e, clientX: box.left } as ReactPointerEvent);
          r.begin(e, {
            kind: "place",
            ids: [span.id],
            grip: "move",
            id: span.id,
            lane: span.lane,
            x0: e.clientX,
            y0: e.clientY,
            chartX,
            from: snapYears(r.yearAt(chartX), levelOf(r.perYear).snap),
            to: 0,
            clientX: e.clientX,
            clientY: e.clientY,
          });
        }}
      >
        {narrow && <strong>{name} · </strong>}
        No dates yet
        {bar.length
          ? ` · ${formatYears(bar.length.lo, bar.length.hi)} years · drag to place`
          : " · drag onto the timeline"}
      </button>
    );
  }

  if (bar.kind === "moment") {
    return (
      <button
        type="button"
        className={`tl-moment${sel ? " is-selected" : ""}${red ? " is-red" : ""}${bar.open ? " is-open" : ""}`}
        data-bar={span.id}
        aria-label={describe()}
        aria-pressed={sel}
        style={{ left: bar.x }}
        onPointerDown={(e) => down(e, "move")}
      >
        {bar.whisker && (
          <i
            className="tl-whisker"
            style={{ left: bar.whisker[0] - bar.x, width: bar.whisker[1] - bar.whisker[0] }}
            title={`some time from ${rangeWords(pt!.start!)}`}
          />
        )}
        <i className="tl-diamond" />
        <span className="tl-label is-out">
          {name}
          {icons}
        </span>
      </button>
    );
  }

  const width = bar.x1 - bar.x0;
  const inside = width > name.length * 7.5 + 30;
  const rel = (a: number) => a - bar.x0;
  return (
    <button
      type="button"
      className={`tl-bar${sel ? " is-selected" : ""}${red ? " is-red" : ""}${bar.unknownStart ? " is-unknown-start" : ""}${bar.openStart ? " is-open-start" : ""}${bar.unknownEnd ? " is-unknown-end" : ""}`}
      data-bar={span.id}
      aria-label={describe()}
      aria-pressed={sel}
      style={{ left: bar.x0, width }}
      onPointerDown={(e) => down(e, "move")}
    >
      {bar.core && (
        <i
          className="tl-core"
          style={{ left: rel(bar.core[0]), width: bar.core[1] - bar.core[0] }}
        />
      )}
      {bar.soft0 && (
        <i
          className="tl-soft is-start"
          style={{ left: rel(bar.soft0[0]), width: bar.soft0[1] - bar.soft0[0] }}
          title={`starts some time from ${rangeWords(pt!.start!)}`}
        />
      )}
      {bar.soft1 && (
        <i
          className="tl-soft is-end"
          style={{ left: rel(bar.soft1[0]), width: bar.soft1[1] - bar.soft1[0] }}
          title={`ends some time from ${rangeWords(pt!.end!)}`}
        />
      )}
      {!bar.core && !bar.soft0 && !bar.soft1 && (
        <i className="tl-core" style={{ left: 0, width }} />
      )}
      {bar.openStart && <i className="tl-open is-start">‹</i>}
      {bar.openEnd && <i className="tl-open is-end">›</i>}
      <span
        className={`tl-label${inside ? "" : " is-out"}`}
        style={inside ? undefined : { left: width + 6 }}
      >
        {name}
        {icons}
      </span>
      {sel && !bar.openStart && (
        <span
          className="tl-grip is-start"
          aria-hidden="true"
          onPointerDown={(e) => down(e, "start")}
        />
      )}
      {sel && !bar.openEnd && (
        <span className="tl-grip is-end" aria-hidden="true" onPointerDown={(e) => down(e, "end")} />
      )}
    </button>
  );
}

function GhostBar({
  span,
  ghost,
  extent,
  perYear,
}: {
  span: ChronicleSpan;
  ghost: Ghost;
  extent: Extent;
  perYear: number;
}) {
  const id = ghost.matchOf.get(span.id);
  const other = id ? ghost.spans.get(id) : undefined;
  if (!id || !other) return null;
  const bar = barOf(other, ghost.points.get(id), extent, perYear);
  const differs = ghost.differs.has(span.id);
  const cls = `tl-ghost${differs ? " is-differs" : ""}`;
  if (bar.kind === "range") {
    return (
      <i
        className={cls}
        style={{ left: bar.x0, width: bar.x1 - bar.x0 }}
        title="The other version"
      />
    );
  }
  if (bar.kind === "moment") {
    return (
      <i className={`${cls} is-moment`} style={{ left: bar.x - 6 }} title="The other version" />
    );
  }
  return null;
}

/** "270 to 290" or "300", for spoken labels and tooltips. */
function rangeWords(r: { lo: number; hi: number }): string {
  if (r.lo === -Infinity) return "before anything shown";
  if (r.hi === Infinity) return "still going on";
  return r.lo === r.hi
    ? formatYears(r.lo, r.lo)
    : `${formatYears(r.lo, r.lo)} to ${formatYears(r.hi, r.hi)}`;
}
