/**
 * Points of interest along paths (docs/designs/stage-21-explore-points-of-interest.md): the
 * places where something would naturally be, read from the map's own features with no AI call.
 * Paths count as Road or River by their style, zones as Water; the remembered joins (`startOn`,
 * `endOn`) make junctions, confluences and deltas; the height map, when there is one, gives
 * passes, springs, the sea and slow travel uphill. A pure function of what is drawn at the moment
 * shown, so it works offline and follows the time slider.
 */
import { outline, type Position } from "@frontier/geo";
import { countsAs, isLined, type MapFeature, type MapStyle } from "@frontier/schema";
import { MODES, slopeFactor } from "../findPaths/cost.ts";
import {
  apartOf,
  compass,
  crossings,
  inRing,
  lengthOf,
  pointAt,
  project,
  resample,
} from "./geometry.ts";

export type Family = "roads" | "crossings" | "waters" | "heights" | "stops" | "edges";
export type SpotKind =
  | "crossroads"
  | "junction"
  | "bridge"
  | "ford"
  | "confluence"
  | "delta"
  | "mouth"
  | "pass"
  | "border"
  | "lake"
  | "harbour"
  | "spring"
  | "waystation"
  | "bend"
  | "here";

/** Each kind's name, family and rank: a place with several reasons takes the best-ranked's look. */
export const KINDS: Record<SpotKind, { label: string; family: Family | "here"; rank: number }> = {
  crossroads: { label: "Crossroads", family: "roads", rank: 1 },
  junction: { label: "Junction", family: "roads", rank: 2 },
  bridge: { label: "Bridge or ferry", family: "crossings", rank: 3 },
  ford: { label: "Ford", family: "crossings", rank: 4 },
  confluence: { label: "Confluence", family: "waters", rank: 5 },
  delta: { label: "Delta", family: "waters", rank: 6 },
  mouth: { label: "River mouth", family: "waters", rank: 7 },
  pass: { label: "Pass", family: "heights", rank: 8 },
  border: { label: "Border crossing", family: "edges", rank: 9 },
  lake: { label: "Lake outlet", family: "waters", rank: 10 },
  harbour: { label: "Road meets the sea", family: "edges", rank: 11 },
  spring: { label: "Spring", family: "heights", rank: 12 },
  waystation: { label: "Day's travel", family: "stops", rank: 13 },
  bend: { label: "River bend", family: "waters", rank: 14 },
  here: { label: "This place", family: "here", rank: 20 },
};

export const FAMILIES: { id: Family; name: string }[] = [
  { id: "roads", name: "Crossroads" },
  { id: "crossings", name: "Bridges & fords" },
  { id: "waters", name: "Waters" },
  { id: "heights", name: "Passes & springs" },
  { id: "stops", name: "Day's travel" },
  { id: "edges", name: "Coasts & borders" },
];

export type DayMode = "foot" | "horse" | "cart";
const NUMBER = ["", "A", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
/** Speeds on a level road, in km an hour: eight hours make about 30, 55 and 25 km. */
export const DAYS: Record<DayMode, { name: string; kmh: number; word: (n: number) => string }> = {
  foot: {
    name: "On foot",
    kmh: 3.75,
    word: (n) => `${NUMBER[n] ?? n} day${n > 1 ? "s'" : "'s"} walk`,
  },
  horse: {
    name: "Horse",
    kmh: 6.9,
    word: (n) => `${NUMBER[n] ?? n} day${n > 1 ? "s'" : "'s"} ride`,
  },
  cart: {
    name: "Cart",
    kmh: 3.1,
    word: (n) => `${NUMBER[n] ?? n} day${n > 1 ? "s" : ""} by cart`,
  },
};
const HOURS_A_DAY = 8;

/** What the height map says at a place. */
export interface Height {
  /** 0 (lowest) to 1 (highest). */
  grey: number;
  /** In metres, when the terrain's range is given; else null. */
  metres: number | null;
  sea: boolean;
}
export type HeightAt = (p: Position) => Height | null;

/** One reason a place is worth a look. */
export interface Reason {
  kind: SpotKind;
  title: string;
  why: string;
  /** The ids of the paths (and zones) it is found from. */
  paths: string[];
}

/** A point of interest: its best reason, and any others found within a few kilometres. */
export interface Spot extends Reason {
  id: string;
  family: Family | "here";
  at: Position;
  also: Reason[];
}

/** A reason found at a marker: the place already exists, so it is not offered again. */
export interface Folded extends Reason {
  marker: string;
  at: Position;
}

/** A road or a river, as it is drawn. */
export interface SpotLine {
  id: string;
  kind: "road" | "river";
  name: string;
  /** The points as drawn (a curved path along its curve). */
  line: Position[];
  length: number;
  entry: string | null;
  startOn: string | null;
  endOn: string | null;
}

export interface SpotZone {
  id: string;
  name: string;
  ring: Position[];
  /** Water, forest, marsh, mountains; "realm" for a realm's zone. */
  counts: string;
  entry: string | null;
}

export interface SpotMarker {
  id: string;
  name: string;
  at: Position;
  entry: string | null;
}

export interface SpotsInput {
  width: number;
  height: number;
  /** Kilometres to one of the map's units; null when the map has no scale. */
  kmPerUnit: number | null;
  /** What is drawn now: present at the year shown, in shown layers. */
  features: readonly MapFeature[];
  styles: readonly MapStyle[];
  /** A feature's name as the map shows it, or "" when it has none. */
  nameOf: (f: MapFeature) => string;
  heights: HeightAt | null;
  day: DayMode;
}

export interface FoundSpots {
  spots: Spot[];
  folded: Folded[];
  lines: SpotLine[];
  zones: SpotZone[];
  markers: SpotMarker[];
  /** Map units: a spot this close to a marker is the marker's, and this close to a line is on it. */
  fold: number;
  near: number;
}

/** A border's look: the usual Border style, or any style named like one. */
const isBorderStyle = (s: MapStyle | undefined) =>
  !!s && (s.id === "strborde" || /border|frontier|boundary/i.test(s.name));
const isRealmStyle = (s: MapStyle | undefined) =>
  !!s && (s.id === "strrealm" || /realm/i.test(s.name));

/** The road and river lines, zones and markers of what is drawn. */
export function readMap(input: SpotsInput): Pick<FoundSpots, "lines" | "zones" | "markers"> & {
  borders: { id: string; name: string; line: Position[]; zone: boolean }[];
} {
  const space = {
    kind: "flat" as const,
    width: input.width,
    height: input.height,
    scale: null,
    unit: "",
  };
  const lines: SpotLine[] = [];
  const zones: SpotZone[] = [];
  const markers: SpotMarker[] = [];
  const borders: { id: string; name: string; line: Position[]; zone: boolean }[] = [];
  for (const f of input.features) {
    if (f.kind === "marker") {
      markers.push({ id: f.id, name: input.nameOf(f), at: f.at, entry: f.entry });
      continue;
    }
    if (!isLined(f)) continue;
    const style = input.styles.find((s) => s.id === f.style && s.for === f.kind);
    const counts = countsAs(style);
    const drawn = outline(space, f.points, {
      curve: f.curve === "smooth",
      closed: f.kind === "zone",
    }).line;
    if (f.kind === "path") {
      if (counts === "road" || counts === "river") {
        lines.push({
          id: f.id,
          kind: counts,
          name: input.nameOf(f),
          line: drawn,
          length: lengthOf(drawn),
          entry: f.entry,
          startOn: f.startOn ?? null,
          endOn: f.endOn ?? null,
        });
      } else if (isBorderStyle(style)) {
        borders.push({ id: f.id, name: input.nameOf(f), line: drawn, zone: false });
      }
    } else {
      const realm = isRealmStyle(style);
      if (counts || realm || input.nameOf(f)) {
        zones.push({
          id: f.id,
          name: input.nameOf(f),
          ring: drawn,
          counts: counts ?? (realm ? "realm" : ""),
          entry: f.entry,
        });
      }
      if (realm)
        borders.push({ id: f.id, name: input.nameOf(f), line: [...drawn, drawn[0]!], zone: true });
    }
  }
  return { lines, zones, markers, borders };
}

/** "the King's Road", or "a road" when it has no name. */
export const nameText = (l: { name: string; kind: string }) => l.name || `a ${l.kind}`;
const Cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const metresText = (m: number) =>
  `${Math.round(m / 10) * 10}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Everything the map's own features say about where something could be. */
export function findSpots(input: SpotsInput): FoundSpots {
  const { lines, zones, markers, borders } = readMap(input);
  const diag = Math.hypot(input.width, input.height);
  const km = input.kmPerUnit;
  // A spot within about 7 km of a marker is the marker's; spots within 8 km are one. On a map
  // with no scale, or a small one, a share of the map stands in.
  const fold = Math.min(km ? 7 / km : Infinity, diag * 0.02);
  const merge = Math.min(km ? 8 / km : Infinity, diag * 0.024);
  const near = diag * 0.004;
  const H = input.heights;
  const roads = lines.filter((l) => l.kind === "road");
  const rivers = lines.filter((l) => l.kind === "river");
  const byId = new Map(lines.map((l) => [l.id, l]));
  const water = zones.filter((z) => z.counts === "water");
  const raw: (Reason & { at: Position })[] = [];
  const put = (kind: SpotKind, at: Position, title: string, why: string, paths: string[]) =>
    raw.push({ kind, at: [at[0], at[1]], title, why, paths });
  const atEnd = (l: SpotLine, p: Position) =>
    apartOf(l.line[0]!, p) < near * 2 || apartOf(l.line[l.line.length - 1]!, p) < near * 2;
  const inWater = (p: Position) => water.find((z) => inRing(p, z.ring)) ?? null;

  // Crossroads (two roads cross) and junctions (a road's end joined to another road).
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const A = roads[i]!;
      const B = roads[j]!;
      for (const x of crossings(A.line, B.line, near * 2)) {
        if (atEnd(A, x) || atEnd(B, x)) continue;
        put(
          "crossroads",
          x,
          `Crossroads of ${nameText(A)} and ${nameText(B)}`,
          `${Cap(nameText(A))} and ${nameText(B)} cross here.`,
          [A.id, B.id],
        );
      }
    }
  }
  for (const r of roads) {
    const ends: [Position, string | null][] = [
      [r.line[0]!, r.startOn],
      [r.line[r.line.length - 1]!, r.endOn],
    ];
    for (const [end, on] of ends) {
      // Joined there, or ending on the other road's line all the same.
      const g =
        (on ? byId.get(on) : undefined) ??
        roads.find((o) => o.id !== r.id && project(end, o.line).d < near);
      if (!g || g.kind !== "road" || g.id === r.id) continue;
      put(
        "junction",
        end,
        `Where ${nameText(r)} meets ${nameText(g)}`,
        `${Cap(nameText(r))} branches off ${nameText(g)}${on ? " (joined there)" : ""}.`,
        [r.id, g.id],
      );
    }
  }

  // Roads over rivers: a bridge or a ferry on a large river far down, a ford on a small one.
  for (const r of roads) {
    for (const v of rivers) {
      for (const x of crossings(r.line, v.line, near * 2)) {
        const down = project(x, v.line).s / (v.length || 1);
        const arm = v.startOn !== null && byId.get(v.startOn)?.kind === "river";
        const big = v.endOn === null && !arm && down > 0.35;
        put(
          big ? "bridge" : "ford",
          x,
          big
            ? `${Cap(nameText(r))} crosses ${nameText(v)}`
            : `${Cap(nameText(r))} fords ${nameText(v)}`,
          big
            ? `A road over a large river (${Math.round(down * 100)}% of the way to its end): a bridge, or a ferry.`
            : `A road over ${v.endOn ? "a tributary" : "the upper river"}: shallow enough to wade.`,
          [r.id, v.id],
        );
      }
    }
  }

  // Rivers: confluences, deltas, mouths, springs, lake outlets and bends.
  for (const v of rivers) {
    const end = v.line[v.line.length - 1]!;
    const start = v.line[0]!;
    // Joined to a river, or ending on one's line (not at an arm's start, which is a delta).
    const host =
      (v.endOn ? byId.get(v.endOn) : undefined) ??
      rivers.find(
        (o) =>
          o.id !== v.id &&
          o.startOn !== v.id &&
          apartOf(o.line[0]!, end) > near &&
          project(end, o.line).d < near,
      );
    if (host && host.kind === "river") {
      put(
        "confluence",
        end,
        `${Cap(nameText(v))} joins ${nameText(host)}`,
        `A tributary meets its river${v.endOn ? " (joined there)" : ""}.`,
        [v.id, host.id],
      );
    }
    const arms = rivers.filter((a) => a.startOn === v.id);
    const isArm = v.startOn !== null && byId.get(v.startOn)?.kind === "river";
    if (arms.length > 0) {
      put(
        "delta",
        arms[0]!.line[0]!,
        `Head of the ${v.name || "river"} delta`,
        `${Cap(nameText(v))} splits into ${arms.length + 1} arms.`,
        [v.id, ...arms.map((a) => a.id)],
      );
    } else if (!host && !isArm) {
      const h = H?.(end) ?? null;
      const lake = inWater(end);
      if (lake) {
        // It ends in a lake: no mouth to the sea.
      } else if (!H || h?.sea) {
        put(
          "mouth",
          end,
          `Mouth of ${nameText(v)}`,
          H ? `${Cap(nameText(v))} reaches the sea.` : `Where ${nameText(v)} ends: its mouth.`,
          [v.id],
        );
      }
    }
    // Where it rises: a spring, unless it leaves a lake or another river.
    const from = inWater(start);
    if (from) {
      put(
        "lake",
        start,
        `Where ${nameText(v)} leaves ${from.name || "the lake"}`,
        "A lake's outlet: the one place its water runs out.",
        [v.id, from.id],
      );
    } else if (!isArm && !(v.startOn && byId.get(v.startOn))) {
      const h = H?.(start) ?? null;
      put(
        "spring",
        start,
        `Source of ${nameText(v)}`,
        h?.metres != null
          ? `Where ${nameText(v)} rises, about ${metresText(h.metres)} m up.`
          : `Where ${nameText(v)} rises.`,
        [v.id],
      );
    }
    // A river that runs through a lake: its outlet.
    for (const z of water) {
      let was = inRing(start, z.ring);
      for (let i = 1; i < v.line.length; i++) {
        const now = inRing(v.line[i]!, z.ring);
        if (was && !now && i > 1) {
          put(
            "lake",
            v.line[i]!,
            `Where ${nameText(v)} leaves ${z.name || "the lake"}`,
            "A lake's outlet: the one place its water runs out.",
            [v.id, z.id],
          );
        }
        was = now;
      }
    }
    // The sharpest bend on low ground, when one turns by more than about 70°.
    if (!isArm) {
      const P = resample(v.line, diag * 0.004);
      const w = 6;
      let best: { t: number; p: Position } | null = null;
      for (let i = w; i < P.length - w; i++) {
        const a = Math.atan2(P[i]![1] - P[i - w]![1], P[i]![0] - P[i - w]![0]);
        const b = Math.atan2(P[i + w]![1] - P[i]![1], P[i + w]![0] - P[i]![0]);
        let t = Math.abs(b - a);
        if (t > Math.PI) t = 2 * Math.PI - t;
        const h = H?.(P[i]!) ?? null;
        const low = !h || (!h.sea && (h.metres !== null ? h.metres < 400 : h.grey < 0.2));
        if (t > 1.22 && low && (!best || t > best.t)) best = { t, p: P[i]! };
      }
      if (best) {
        put(
          "bend",
          best.p,
          `A tight bend of ${nameText(v)}`,
          `The river turns by ${Math.round((best.t * 180) / Math.PI)}° on low ground: slow water, a good place for a mill or a crossing.`,
          [v.id],
        );
      }
    }
  }

  // Roads: passes, border crossings, and ends at the sea.
  for (const r of roads) {
    if (H) {
      const P = resample(r.line, diag * 0.004);
      let hi: Height | null = null;
      let at = 0;
      P.forEach((p, i) => {
        const h = H(p);
        if (h && (!hi || h.grey > hi.grey)) {
          hi = h;
          at = i;
        }
      });
      const top = hi as Height | null;
      const high = top && (top.metres !== null ? top.metres > 780 : top.grey > 0.3);
      if (top && high && at > P.length * 0.08 && at < P.length * 0.92) {
        put(
          "pass",
          P[at]!,
          `${Cap(nameText(r))} over the heights`,
          top.metres !== null
            ? `The road's highest point, about ${metresText(top.metres)} m: a pass.`
            : "The road's highest point: a pass.",
          [r.id],
        );
      }
    }
    for (const b of borders) {
      for (const x of crossings(r.line, b.line, near * 2)) {
        if (atEnd(r, x)) continue;
        const into = b.zone
          ? inRing(pointAt(r.line, project(x, r.line).s + near * 3), b.line)
          : null;
        put(
          "border",
          x,
          b.zone && b.name
            ? `${Cap(nameText(r))} ${into ? "enters" : "leaves"} ${b.name}`
            : `${Cap(nameText(r))} crosses ${b.name || "the border"}`,
          b.zone && b.name
            ? `${Cap(nameText(r))} crosses the edge of ${b.name} here.`
            : `${Cap(nameText(r))} crosses a border here.`,
          [r.id, b.id],
        );
      }
    }
    if (H) {
      for (const end of [r.line[0]!, r.line[r.line.length - 1]!]) {
        if (markers.some((m) => apartOf(m.at, end) < fold)) continue;
        let wet = false;
        for (let a = 0; a < 12 && !wet; a++) {
          const p: Position = [
            end[0] + Math.cos(a / 2) * near * 3,
            end[1] + Math.sin(a / 2) * near * 3,
          ];
          wet = H(p)?.sea === true;
        }
        if (wet) {
          put(
            "harbour",
            end,
            `${Cap(nameText(r))} ends at the sea`,
            "A road that runs to a coast with nothing there: a landing, a harbour.",
            [r.id],
          );
        }
      }
    }
  }

  // A day's travel along each road, from each town, junction and crossroads.
  if (km) {
    const D = DAYS[input.day];
    const M = MODES[input.day];
    for (const r of roads) {
      const P = resample(r.line, diag * 0.003);
      const hours = [0];
      const s = [0];
      for (let i = 1; i < P.length; i++) {
        const d = apartOf(P[i]!, P[i - 1]!);
        const dk = d * km;
        const a = H?.(P[i - 1]!)?.metres ?? null;
        const b = H?.(P[i]!)?.metres ?? null;
        const slow =
          a !== null && b !== null && dk > 0 ? slopeFactor(M.k, M.off, (b - a) / (dk * 1000)) : 1;
        hours.push(hours[i - 1]! + (dk / D.kmh) * slow);
        s.push(s[i - 1]! + d);
      }
      const index = (p: Position) => {
        const along = project(p, r.line).s;
        let i = 0;
        while (i < s.length - 1 && s[i]! < along) i++;
        return i;
      };
      const stops: { i: number; name: string | null }[] = [
        { i: 0, name: null },
        { i: P.length - 1, name: null },
      ];
      for (const m of markers) {
        if (project(m.at, r.line).d < fold)
          stops.push({ i: index(m.at), name: m.name || "the marker" });
      }
      for (const x of raw) {
        if (!x.paths.includes(r.id) || (x.kind !== "crossroads" && x.kind !== "junction")) continue;
        if (markers.some((m) => apartOf(m.at, x.at) < fold)) continue;
        stops.push({
          i: index(x.at),
          name: x.kind === "crossroads" ? "the crossroads" : "the junction",
        });
      }
      stops.sort((a, b) => a.i - b.i);
      for (let k = 0; k + 1 < stops.length; k++) {
        const a = stops[k]!;
        const b = stops[k + 1]!;
        for (let n = 1; ; n++) {
          const want = hours[a.i]! + HOURS_A_DAY * n;
          if (want > hours[b.i]! - HOURS_A_DAY * 0.35) break;
          let i = a.i;
          while (i < b.i && hours[i]! < want) i++;
          // Between the two points either side of the hour.
          const t = i > 0 ? (want - hours[i - 1]!) / (hours[i]! - hours[i - 1]! || 1) : 0;
          const p0 = P[Math.max(0, i - 1)]!;
          const at: Position = [p0[0] + (P[i]![0] - p0[0]) * t, p0[1] + (P[i]![1] - p0[1]) * t];
          const far = Math.round(
            (s[Math.max(0, i - 1)]! + (s[i]! - s[Math.max(0, i - 1)]!) * t - s[a.i]!) * km,
          );
          const word = D.word(n);
          const from = a.name ?? (k === 0 ? null : "the last stop");
          put(
            "waystation",
            at,
            from ? `${word} from ${from}` : `${word} along ${nameText(r)}`,
            `${word} along ${nameText(r)} from ${from ?? "its start"} (${far} km, ${HOURS_A_DAY} hours a day).`,
            [r.id],
          );
        }
      }
    }
  }

  // Spots at a marker are that place's; spots close together are one, with several reasons.
  const folded: Folded[] = [];
  const loose: (Reason & { at: Position })[] = [];
  for (const x of raw) {
    const m = markers.find((m) => apartOf(m.at, x.at) < fold);
    if (m) folded.push({ ...x, marker: m.id });
    else loose.push(x);
  }
  loose.sort((a, b) => KINDS[a.kind].rank - KINDS[b.kind].rank);
  const spots: Spot[] = [];
  for (const x of loose) {
    const into = spots.find(
      (m) => apartOf(m.at, x.at) < merge && !(m.kind === "waystation" && x.kind === "waystation"),
    );
    if (into) {
      into.also.push({ kind: x.kind, title: x.title, why: x.why, paths: x.paths });
      for (const id of x.paths) if (!into.paths.includes(id)) into.paths.push(id);
    } else {
      spots.push({ ...x, id: spotId(x.kind, x.at, diag), family: KINDS[x.kind].family, also: [] });
    }
  }
  return { spots, folded, lines, zones, markers, fold, near };
}

/** An id that stays the same while the map does, so a choice outlives a change of filter. */
export const spotId = (kind: SpotKind, at: Position, diag: number): string => {
  const q = diag / 2000 || 1;
  return `${kind}:${Math.round(at[0] / q)},${Math.round(at[1] / q)}`;
};

/** How far, in words: "12 km", or nothing on a map with no scale. */
export function farText(units: number, km: number | null): string {
  if (km === null) return "";
  const k = units * km;
  return k < 10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`;
}

/** A spot's place along each road or river it lies on. */
export function linesAt(found: FoundSpots, at: Position): { line: SpotLine; s: number }[] {
  return found.lines
    .map((line) => ({ line, q: project(at, line.line) }))
    .filter((o) => o.q.d < found.near * 2.5)
    .map((o) => ({ line: o.line, s: o.q.s }));
}

/**
 * A place clicked that is no spot: "This place", described from what is near: "On the King's
 * Road · 3 km from the crossroads of …", or "67 km north-west of Calder Bridge".
 */
export function hereSpot(found: FoundSpots, at: Position, km: number | null, diag: number): Spot {
  const on = linesAt(found, at)[0];
  const byDistance = (list: { name: string; at: Position; town: boolean }[]) =>
    list.map((x) => ({ ...x, d: apartOf(x.at, at) })).sort((a, b) => a.d - b.d)[0];
  const town = byDistance(
    found.markers.filter((m) => m.name).map((m) => ({ name: m.name, at: m.at, town: true })),
  );
  const spot = byDistance(found.spots.map((s) => ({ name: s.title, at: s.at, town: false })));
  // On a road, the nearest of either; off the roads, the nearest town when there is one.
  const nearest = on ? (town && (!spot || town.d <= spot.d) ? town : spot) : (town ?? spot);
  const far = (d: number) => farText(d, km);
  let why: string;
  if (on) {
    why = `On ${nameText(on.line)}`;
    if (nearest) {
      const f = far(nearest.d);
      why += ` · ${f ? `${f} from` : "near"} ${nearest.town ? nearest.name : lower(nearest.name)}`;
    }
  } else if (nearest) {
    const f = far(nearest.d);
    const where = compass(nearest.at, at);
    why =
      where === "here"
        ? `At ${nearest.name}`
        : `${Cap(f ? `${f} ${where} of` : `${where} of`)} ${nearest.town ? nearest.name : lower(nearest.name)}`;
  } else {
    why = "A place on the map with nothing marked near.";
  }
  return {
    id: spotId("here", at, diag),
    kind: "here",
    family: "here",
    at: [at[0], at[1]],
    title: "This place",
    why,
    paths: on ? [on.line.id] : [],
    also: [],
  };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What a place is, as Frontier tells the AI: its reasons, what it lies on, what is near. */
export interface PlaceContext {
  lines: string[];
  /** The ids of the features whose entries the server adds. */
  features: string[];
}

export function contextOf(
  spot: Spot,
  found: FoundSpots,
  o: { km: number | null; heights: HeightAt | null; guessed: boolean; year: number | null },
): PlaceContext {
  const lines: string[] = [];
  const features = new Set<string>();
  const far = (d: number) => farText(d, o.km);
  if (spot.kind !== "here") {
    lines.push(`What is here: ${[spot.title, ...spot.also.map((a) => a.title)].join("; ")}.`);
    lines.push(`Why: ${[spot.why, ...spot.also.map((a) => a.why)].join(" ")}`);
  } else {
    lines.push(`What is here: a place the author chose. ${spot.why}.`);
  }
  const on = linesAt(found, spot.at);
  if (on.length > 0) {
    for (const x of on) features.add(x.line.id);
    lines.push(
      `On: ${on
        .map(
          (x) =>
            `${nameText(x.line)} (${x.line.kind}${x.line.entry ? ", an entry" : ", a name on the map"})`,
        )
        .join(", ")}.`,
    );
  }
  const nearby = found.lines
    .filter((l) => !on.some((x) => x.line.id === l.id))
    .map((l) => ({ l, q: project(spot.at, l.line) }))
    .filter((x) => x.q.d < found.fold * 4)
    .sort((a, b) => a.q.d - b.q.d)
    .slice(0, 3);
  if (nearby.length > 0) {
    lines.push(
      `Near: ${nearby
        .map((x) => {
          features.add(x.l.id);
          const f = far(x.q.d);
          return `${nameText(x.l)} (${x.l.kind}), ${f ? `${f} ` : ""}to the ${compass(spot.at, x.q.at)}`;
        })
        .join("; ")}.`,
    );
  }
  const towns = found.markers
    .filter((m) => m.name)
    .map((m) => ({ m, d: apartOf(m.at, spot.at) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2);
  if (towns.length > 0) {
    lines.push(
      `Towns: ${towns
        .map(({ m, d }) => {
          features.add(m.id);
          const where = compass(spot.at, m.at);
          if (where === "here") return `${m.name}, here`;
          const f = far(d);
          return `${m.name}, ${f ? `${f} ` : ""}to the ${where}`;
        })
        .join("; ")}.`,
    );
  }
  const inside = found.zones.filter((z) => inRing(spot.at, z.ring));
  if (inside.length > 0) {
    lines.push(
      `Inside: ${inside
        .map((z) => {
          features.add(z.id);
          return `${z.name || "a zone"}${z.counts && z.counts !== "realm" ? ` (${z.counts})` : z.counts === "realm" ? " (a realm)" : ""}`;
        })
        .join(", ")}.`,
    );
  }
  const h = o.heights?.(spot.at) ?? null;
  if (h) {
    const from = o.guessed ? "guessed from the picture" : "from the height map";
    lines.push(
      h.sea
        ? `Ground: the shore or the sea (${from}).`
        : h.metres !== null
          ? `Ground: about ${metresText(h.metres)} m up (${from}).`
          : `Ground: ${h.grey > 0.6 ? "high ground" : h.grey > 0.3 ? "uplands" : "low ground"} (${from}).`,
    );
  }
  if (o.year !== null) lines.push(`The moment: year ${o.year}.`);
  return { lines, features: [...features] };
}

/** One road or river explored along: its spots and milestones, in order from its start. */
export interface AlongItem {
  s: number;
  spot: Spot | null;
  /** A marker on the way, or an end: shown, not chosen. */
  milestone: { name: string; note: string } | null;
}

export function alongOf(found: FoundSpots, lineId: string, shown: readonly Spot[]): AlongItem[] {
  const line = found.lines.find((l) => l.id === lineId);
  if (!line) return [];
  const items: AlongItem[] = [];
  for (const spot of shown) {
    const q = project(spot.at, line.line);
    if (spot.paths.includes(line.id) || q.d < found.near * 2.5)
      items.push({ s: q.s, spot, milestone: null });
  }
  const ends = [
    { s: 0, at: line.line[0]! },
    { s: line.length, at: line.line[line.line.length - 1]! },
  ];
  for (const m of found.markers) {
    const q = project(m.at, line.line);
    if (q.d >= found.fold) continue;
    const reasons = found.folded
      .filter((f) => f.marker === m.id)
      .map((f) => KINDS[f.kind].label.toLowerCase());
    const note =
      reasons.length > 0
        ? `also ${[...new Set(reasons)].join(", ")}: not offered again`
        : "a place already on the map";
    items.push({ s: q.s, spot: null, milestone: { name: m.name || "A marker", note } });
  }
  for (const e of ends) {
    if (items.some((i) => i.milestone && Math.abs(i.s - e.s) < found.fold)) continue;
    items.push({
      s: e.s,
      spot: null,
      milestone: {
        name: e.s === 0 ? (line.kind === "river" ? "Its source" : "Its start") : "Its end",
        note: e.s === 0 ? `where ${nameText(line)} begins` : `where ${nameText(line)} ends`,
      },
    });
  }
  return items.sort((a, b) => a.s - b.s);
}
