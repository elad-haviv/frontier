/**
 * Time on a map: the chronicle it is seen through, the year, the shape pinned for editing, and the
 * features as they are drawn at that year.
 */
import type { ChronicleSpan, MapFile } from "@frontier/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import type { ChronicleChoice } from "../components/MapTime.tsx";
import { changeYears, clampYear, countFeatures, type MapTime, readTime, resolve } from "./time.ts";

export function useMapTime(
  id: string,
  params: URLSearchParams,
  setNotice: (notice: string | null) => void,
) {
  const [chronicles, setChronicles] = useState<ChronicleChoice[]>([]);
  const [timeOn, setTimeOn] = useState(params.get("t") !== null);
  const [chosen, setChosen] = useState<string | null>(params.get("c"));
  const [time, setTime] = useState<MapTime | null>(null);
  const [spanEntries, setSpanEntries] = useState<Record<string, { title: string }>>({});
  const [year, setYear] = useState<number | null>(
    params.get("t") !== null && Number.isFinite(Number(params.get("t")))
      ? Number(params.get("t"))
      : null,
  );
  const [showAll, setShowAll] = useState(false);
  const [pin, setPin] = useState<{ feature: string; shape: string | null } | null>(null);
  const [focused, setFocused] = useState(0);
  /** The year shown, or null with time off: undo steps are stamped with it. */
  const yearRef = useRef<number | null>(null);
  yearRef.current = timeOn ? year : null;

  // Without the list of chronicles the map simply has no time.
  useEffect(() => {
    let live = true;
    api.chronicles().then(
      (r) =>
        live && setChronicles(r.chronicles.map(({ id, title, main }) => ({ id, title, main }))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [id]);

  const defaultChronicle = chronicles.find((c) => c.main)?.id ?? chronicles[0]?.id ?? null;
  const chronicleId = chosen && chronicles.some((c) => c.id === chosen) ? chosen : defaultChronicle;

  useEffect(() => {
    if (chosen && chronicles.length > 0 && !chronicles.some((c) => c.id === chosen)) {
      setNotice("The chronicle in the address could not be found; another is shown.");
      setChosen(null);
    }
  }, [chosen, chronicles]);

  // The chronicle is read when time is turned on, when another is chosen, and when the tab
  // gets the focus again, since it may have been changed in another tab.
  useEffect(() => {
    if (!timeOn || !chronicleId) return;
    let live = true;
    api.chronicle(chronicleId).then(
      (r) => {
        if (!live) return;
        const read = readTime(r.chronicle);
        setTime(read);
        setSpanEntries(r.entries);
        // The year starts at the latest the chronicle knows, and stays inside its range.
        setYear((y) => clampYear(read, y ?? read.range?.latest ?? 0));
      },
      () => live && setNotice("The chronicle could not be read."),
    );
    return () => {
      live = false;
    };
  }, [timeOn, chronicleId, focused]);

  useEffect(() => {
    const onFocus = () => setFocused((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const seen = timeOn && time?.chronicle.id === chronicleId ? time : null;
  const seenRef = useRef(seen);
  seenRef.current = seen;

  const moveTo = (next: number) => {
    setPin(null);
    setYear(seen ? clampYear(seen, next) : Math.round(next));
  };

  const spanName = (span: ChronicleSpan): string =>
    span.name || (span.entry ? spanEntries[span.entry]?.title : undefined) || "(unnamed)";
  // The year and the chronicle go along into the map of a place.
  const carry =
    timeOn && year !== null
      ? `t=${year}${chronicleId && chronicleId !== defaultChronicle ? `&c=${chronicleId}` : ""}`
      : "";

  return {
    chronicles,
    timeOn,
    setTimeOn,
    setChosen,
    year,
    setYear,
    yearRef,
    showAll,
    setShowAll,
    pin,
    setPin,
    defaultChronicle,
    chronicleId,
    seen,
    seenRef,
    moveTo,
    spanName,
    carry,
  };
}

export type TimeState = ReturnType<typeof useMapTime>;

/** The features as drawn at the year shown, and how the map stands to its chronicle. */
export function useShownAt(
  map: MapFile | null,
  time: TimeState,
  { selected, editing, hidden }: { selected: string | null; editing: boolean; hidden: Set<string> },
) {
  const { seen, year, pin, showAll, setPin } = time;
  /** The features as drawn now: each with the shape on screen, and those not there left out. */
  const resolved = useMemo(
    () => (map ? resolve(map, seen, year ?? 0, { selected, pin, editing, showAll }) : []),
    [map, seen, year, selected, pin, editing, showAll],
  );
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const shownMap = useMemo(
    () => (map ? { ...map, features: resolved.map((r) => r.feature) } : null),
    [map, resolved],
  );
  const presence = useMemo(
    () => new Map(resolved.map((r) => [r.feature.id, { opacity: r.opacity, dashed: r.dashed }])),
    [resolved],
  );
  const onScreen = resolved.find((r) => r.feature.id === selected) ?? null;

  // A pin lasts while its feature stays selected.
  useEffect(() => setPin(null), [selected]);

  const stops = useMemo(() => (map && seen ? changeYears(map, seen) : []), [map, seen]);
  const timeLine = useMemo(() => {
    if (!map || !seen) return null;
    const c = countFeatures(map, seen, hidden);
    return `In time: ${c.follows} follow the chronicle, ${c.undated} undated, ${c.noSpan} with an entry that has no span, ${c.timeless} timeless.`;
  }, [map, seen, hidden]);

  return { resolved, resolvedRef, shownMap, presence, onScreen, stops, timeLine };
}
