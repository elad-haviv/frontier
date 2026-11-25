/**
 * Exploring a map (docs/designs/stage-21-explore-points-of-interest.md): the points of interest
 * found from what is drawn now, the filters, the road or river explored along, the places chosen
 * and what asking about them would cost. Everything but the cost and the asking works offline.
 */
import { makeView, type Position, type ViewState } from "@frontier/geo";
import type { MapFeature, MapFile, MapStyle } from "@frontier/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SpotAsk } from "../../api.ts";
import { useConnection } from "../../sync/connection.ts";
import { kmPerUnit } from "../findPaths/page.ts";
import type { Resolved } from "../time.ts";
import { project } from "./geometry.ts";
import { loadHeights } from "./heights.ts";
import {
  alongOf,
  contextOf,
  type DayMode,
  FAMILIES,
  type Family,
  findSpots,
  type HeightAt,
  hereSpot,
  type Spot,
} from "./spots.ts";

interface Prefs {
  /** The points of interest are shown. */
  overlay: boolean;
  /** The families hidden. */
  off: Family[];
  day: DayMode;
}
const DEFAULT_PREFS: Prefs = { overlay: true, off: [], day: "horse" };
const prefsKey = (id: string) => `frontier.explore.${id}`;

/** The filters, remembered per map on this device. */
function readPrefs(id: string): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(prefsKey(id)) ?? "null") as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    return {
      overlay: raw.overlay !== false,
      off: Array.isArray(raw.off) ? raw.off.filter((f) => FAMILIES.some((x) => x.id === f)) : [],
      day: raw.day === "foot" || raw.day === "cart" ? raw.day : "horse",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** The places as they are sent: without the spot each was made from. */
export const sendable = (asks: readonly (SpotAsk & { spot: Spot })[]): SpotAsk[] =>
  asks.map((a) => ({
    at: a.at,
    kind: a.kind,
    title: a.title,
    lines: a.lines,
    features: a.features,
  }));

export interface Estimate {
  key: string;
  calls: number;
  usd: number | null;
  spentUsd: number;
  capUsd: number;
}

export function useExplore(o: {
  id: string;
  map: MapFile | null;
  resolved: readonly Resolved[];
  hidden: ReadonlySet<string>;
  styles: readonly MapStyle[];
  titleOf: (f: MapFeature) => string;
  exploring: boolean;
  /** The year shown, when time is on. */
  year: number | null;
  moment: { chronicle: string | null; year: number | null };
}) {
  const { id, map, exploring } = o;
  const [prefs, setPrefsNow] = useState<Prefs>(() => readPrefs(id));
  useEffect(() => setPrefsNow(readPrefs(id)), [id]);
  const setPrefs = (change: Partial<Prefs>) =>
    setPrefsNow((now) => {
      const next = { ...now, ...change };
      try {
        localStorage.setItem(prefsKey(id), JSON.stringify(next));
      } catch {
        // Remembered only while it can be.
      }
      return next;
    });

  // The height map, read once per terrain while exploring.
  const terrainKey = map?.terrain ? JSON.stringify(map.terrain) : null;
  const [heights, setHeights] = useState<{ key: string; at: HeightAt | null } | null>(null);
  useEffect(() => {
    if (!exploring || !map || !terrainKey || heights?.key === terrainKey) return;
    let stale = false;
    loadHeights(map).then(
      (at) => !stale && setHeights({ key: terrainKey, at }),
      () => !stale && setHeights({ key: terrainKey, at: null }),
    );
    return () => {
      stale = true;
    };
    // The terrain's key stands for the map's terrain.
  }, [exploring, terrainKey]);
  const heightAt = terrainKey && heights?.key === terrainKey ? heights.at : null;

  const flat = map?.space.kind === "flat" ? map.space : null;
  const km = map ? kmPerUnit(map.space) : null;
  // What is drawn now: present at the year shown, in shown layers, not hidden.
  const drawn = useMemo(
    () =>
      o.resolved
        .filter((r) => r.presence !== "not_yet" && r.presence !== "gone")
        .filter((r) => !o.hidden.has(r.feature.layer) && !o.hidden.has(r.feature.id))
        .map((r) => r.feature),
    [o.resolved, o.hidden],
  );
  const titleOf = useRef(o.titleOf);
  titleOf.current = o.titleOf;
  const found = useMemo(
    () =>
      exploring && flat
        ? findSpots({
            width: flat.width,
            height: flat.height,
            kmPerUnit: km,
            features: drawn,
            styles: o.styles,
            nameOf: (f) => titleOf.current(f),
            heights: heightAt,
            day: prefs.day,
          })
        : null,
    [exploring, flat, km, drawn, o.styles, heightAt, prefs.day],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(FAMILIES.map((f) => [f.id, 0])) as Record<Family, number>;
    for (const s of found?.spots ?? []) if (s.family !== "here") c[s.family]++;
    return c;
  }, [found]);
  const shown = useMemo(
    () =>
      found && prefs.overlay
        ? found.spots.filter((s) => s.family === "here" || !prefs.off.includes(s.family))
        : [],
    [found, prefs.overlay, prefs.off],
  );

  const [chosen, setChosen] = useState<Spot[]>([]);
  const [along, setAlongNow] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  // A spot no longer found (the year moved, a filter of the day's travel changed) leaves the
  // choice; one found again is the new one. A place clicked stays.
  useEffect(() => {
    if (!found) return;
    setChosen((now) => {
      const next = now
        .map((c) => (c.kind === "here" ? c : found.spots.find((s) => s.id === c.id)))
        .filter((c): c is Spot => !!c);
      return next.length === now.length && next.every((c, i) => c === now[i]) ? now : next;
    });
    if (along && !found.lines.some((l) => l.id === along)) setAlongNow(null);
  }, [found]);
  // Leaving Explore lets everything go.
  useEffect(() => {
    if (exploring) return;
    setChosen([]);
    setAlongNow(null);
    setCursor(null);
  }, [exploring, id]);

  const setAlong = (line: string | null) => {
    setAlongNow(line);
    setCursor(null);
  };
  const isChosen = (spot: Spot) => chosen.some((c) => c.id === spot.id);
  const toggle = (spot: Spot) =>
    setChosen((now) =>
      now.some((c) => c.id === spot.id) ? now.filter((c) => c.id !== spot.id) : [...now, spot],
    );
  /** A spot's pin clicked: along a path it is added or taken out, else it is the choice. */
  const pick = (spot: Spot, add: boolean) => {
    if (along || add) toggle(spot);
    else setChosen([spot]);
    setCursor(spot.id);
  };

  const alongItems = useMemo(
    () => (found && along ? alongOf(found, along, shown) : []),
    [found, along, shown],
  );
  const alongSpots = alongItems.flatMap((i) => (i.spot ? [i.spot] : []));
  /** Chooses every spot along the path, or clears them when all are chosen. */
  const chooseAll = () => {
    if (alongSpots.length === 0) return false;
    const all = alongSpots.every(isChosen);
    setChosen((now) =>
      all
        ? now.filter((c) => !alongSpots.some((s) => s.id === c.id))
        : [...now, ...alongSpots.filter((s) => !now.some((c) => c.id === s.id))],
    );
  };

  /**
   * A click on the map while exploring: on a road or river, explore along it (or, along it
   * already, choose that point of it); anywhere else, choose this place.
   */
  const tapAt = (
    at: Position,
    screen: { x: number; y: number },
    how: { add: boolean; touch: boolean },
    view: ViewState | null,
    size: { width: number; height: number },
  ): "along" | "place" | null => {
    if (!found || !map) return null;
    const diag = Math.hypot(flat?.width ?? 1, flat?.height ?? 1);
    let line: string | null = null;
    if (view) {
      const v = makeView(view, size.width, size.height);
      const reach = how.touch ? 14 : 8;
      let best = reach;
      for (const l of found.lines) {
        const pts = l.line
          .map((p) => v.project(p))
          .filter((p): p is [number, number] => !!p);
        const q = project([screen.x, screen.y], pts);
        if (q.d < best) {
          best = q.d;
          line = l.id;
        }
      }
    }
    if (line && line !== along) {
      setAlong(line);
      return "along";
    }
    const on = line ? found.lines.find((l) => l.id === line) : null;
    const point = on ? project(at, on.line).at : at;
    const here = hereSpot(found, point, km, diag);
    if (how.add || along) toggle(here);
    else setChosen([here]);
    setCursor(null);
    return "place";
  };

  // "Explore here" from the map's menu: the place is chosen once the spots are found.
  const [pendingHere, setPendingHere] = useState<Position | null>(null);
  useEffect(() => {
    if (!found || !pendingHere) return;
    setChosen([hereSpot(found, pendingHere, km, Math.hypot(flat?.width ?? 1, flat?.height ?? 1))]);
    setPendingHere(null);
  }, [found, pendingHere]);

  /** What is sent for each place chosen. */
  const asks: (SpotAsk & { spot: Spot })[] = useMemo(
    () =>
      found
        ? chosen.map((spot) => {
            const ctx = contextOf(spot, found, {
              km,
              heights: heightAt,
              guessed: map?.terrain?.guessed === true,
              year: o.moment.year,
            });
            return {
              spot,
              at: spot.at,
              kind: spot.kind,
              title: spot.title,
              lines: ctx.lines,
              features: ctx.features,
            };
          })
        : [],
    [found, chosen, km, heightAt, map?.terrain?.guessed, o.moment.year],
  );

  // What asking would cost, asked of the server a moment after the choice settles.
  const { state } = useConnection();
  const online = state === "online";
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const estimateKey = JSON.stringify([
    id,
    asks.map((a) => [a.kind, a.at, a.lines]),
    o.moment.chronicle,
    o.moment.year,
  ]);
  useEffect(() => {
    if (!exploring || asks.length === 0 || !online) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      api
        .estimateDiscovery(
          id,
          sendable(asks),
          o.moment.chronicle,
          o.moment.year,
        )
        .then(
          (r) => !stale && setEstimate({ key: estimateKey, ...r }),
          () => undefined,
        );
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [estimateKey, exploring, online]);

  return {
    flat: flat !== null,
    km,
    found,
    counts,
    shown,
    prefs,
    setPrefs,
    heightsRead: !terrainKey || heights?.key === terrainKey,
    hasHeights: heightAt !== null,
    chosen,
    setChosen,
    isChosen,
    toggle,
    pick,
    along,
    setAlong,
    alongItems,
    alongSpots,
    chooseAll,
    cursor,
    setCursor,
    tapAt,
    chooseHere: setPendingHere,
    asks,
    online,
    estimate: estimate?.key === estimateKey ? estimate : null,
  };
}

export type Explore = ReturnType<typeof useExplore>;
