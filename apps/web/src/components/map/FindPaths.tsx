/**
 * Find paths: the tool that makes paths from the map's picture and its heights. Choose a kind:
 * River (click where it rises and it runs downhill to the sea), Route (click the start and the
 * end and the quickest way is found for a way of travelling) or Trace (click a line painted in
 * the picture). What would be made is shown first; Make path makes it a path in the current
 * layer. The engine runs in Find areas' worker (findPaths/engine.ts); this is the page's side: the
 * bar, what is drawn over the map, and the clicks. Loaded only when the tool is first chosen.
 * See docs/designs/stage-20-find-paths.md.
 */
import {
  makeView,
  measure,
  outline,
  type Position,
  type Space,
  type View,
  type ViewState,
} from "@frontier/geo";
import { countsAs, layerTree, type MapFile, type MapImage, type MapStyle } from "@frontier/schema";
import {
  Mountain,
  PenLine,
  Route as RouteIcon,
  SlidersHorizontal,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { mapImageUrl } from "../../api.ts";
import { focusIsFree, shortcutText, useShortcut } from "../../keys.ts";
import { openPicture } from "../../map/findAreas/client.ts";
import type { Px } from "../../map/findAreas/contour.ts";
import { type ImageFrame, toPosition, toPx } from "../../map/findAreas/frame.ts";
import { DEFAULT_DETAIL, DETAIL_EPS } from "../../map/findAreas/simplify.ts";
import {
  closePaths,
  likelyRivers,
  openPaths,
  reliefOf,
  riverAt,
  routeFor,
  setTerrain,
  traceAt,
} from "../../map/findPaths/client.ts";
import { type Mode, MODES, type Variant } from "../../map/findPaths/cost.ts";
import { nearestOn } from "../../map/findPaths/lines.ts";
import { crossCorners, joinNewPath, joinReach } from "../../map/joins.ts";
import {
  addToPath,
  kmPerUnit,
  makePaths,
  type NewPath,
  plural,
  stopIndex,
  terrainExtent,
  terrainFeatures,
  terrainMetres,
} from "../../map/findPaths/page.ts";
import type {
  Mark,
  OpenedPaths,
  RouteReply,
  TerrainInfo,
  TraceReply,
} from "../../map/findPaths/protocol.ts";
import { HOURS_A_DAY, travelTime } from "../../map/findPaths/travel.ts";
import type { Point, PointerKind } from "../../map/gesture.ts";
import { lengthText } from "../../map/lengthText.ts";
import { selectColour } from "../../map/overlay.ts";
import type { Resolved } from "../../map/time.ts";
import type { FindPointer } from "../../map/usePointer.ts";
import { usePhone } from "../Shell.tsx";
import { Tip } from "../ui/Tip.tsx";
import { hintsChanged } from "../../map/terrainHints/hash.ts";
import "./FindAreas.css";
import "./FindPaths.css";

/** What the page asks of the tool: the pointer's taps, hover and drags, and its undo and redo. */
export interface PathsHandle extends FindPointer {
  undo(): boolean;
  redo(): boolean;
}

type Kind = "river" | "route" | "trace";
interface Stop {
  at: Position;
  name?: string;
}
/** What has been clicked so far: what the proposed path is worked out from. */
type Pend =
  | { kind: "river"; at: Position; from: "source" | "mouth"; exact: boolean }
  | { kind: "route"; stops: Stop[] }
  | { kind: "trace"; seed: Position; end: Position | null; branches: string[] };

interface Ghost {
  key: string;
  points: Position[];
  label: string;
  blue?: boolean;
}
/** What Make path would make, and what else is offered. */
interface Proposal {
  paths: NewPath[];
  ghosts: Ghost[];
  marks: { at: Position; kind: Mark["kind"] }[];
  /** The bar's status, and its short form for a phone. */
  text: string;
  short: string;
  /** Why there is nothing to make. */
  fail?: boolean;
  /** No way by land: a ship's way is offered. */
  ship?: { hours: number | null };
  /** Said once the path is made. */
  note?: string;
  /** What a traced line's colour suggests it is. */
  traced?: "river" | "road" | "line";
  /** Each way's time for the switch, when a route is proposed. */
  ways?: Partial<Record<Variant, { hours: number | null; same: boolean } | null>>;
}

const KINDS: { kind: Kind; label: string; icon: typeof Waves; key: string; hint: string }[] = [
  {
    kind: "river",
    label: "River",
    icon: Waves,
    key: "map.pathsRiver",
    hint: "Click where a river rises: it runs downhill to the sea",
  },
  {
    kind: "route",
    label: "Route",
    icon: RouteIcon,
    key: "map.pathsRoute",
    hint: "Click the start, then the end: the quickest way between them",
  },
  {
    kind: "trace",
    label: "Trace",
    icon: PenLine,
    key: "map.pathsTrace",
    hint: "Click a river, road or coast painted in the picture",
  },
];
const MODE_LABELS: Record<Mode, string> = {
  foot: "On foot",
  horse: "Horse",
  cart: "Cart",
  ship: "Ship",
};
const WAY_LABELS: Record<Variant, string> = {
  fast: "Fastest",
  flat: "Flattest",
  dry: "Avoid water",
};
const WAYS: Variant[] = ["fast", "flat", "dry"];
/** "Above": the land a likely river must drain, in km², and as a share of the map without a scale. */
const ABOVE_KM2 = [80, 140, 220, 350, 550, 900, 1500];
const ABOVE_SHARE = [0.0005, 0.001, 0.0015, 0.0025, 0.004, 0.006, 0.01];

/** What the tool remembers while the app is open. */
const remembered = {
  kind: "river" as Kind,
  from: "source" as "source" | "mouth",
  meander: 3,
  likely: false,
  above: 2,
  mode: "foot" as Mode,
  variant: "fast" as Variant,
  useHeights: true,
  follow: true,
  detail: DEFAULT_DETAIL,
  styleFor: {} as Partial<Record<Kind, string>>,
};

export default function FindPaths(p: {
  map: MapFile;
  mapRef: RefObject<MapFile | null>;
  change: (next: MapFile) => void;
  view: ViewState | null;
  size: { width: number; height: number };
  /** The map's frame: Enter makes a path only while it, or nothing, has the focus. */
  frame: RefObject<HTMLElement | null>;
  shownImages: Set<string>;
  /** The features as drawn now. */
  resolved: Resolved[];
  hidden: Set<string>;
  locked: Set<string>;
  activeLayer: string;
  onActiveLayer: (id: string) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Picks several at once: a traced line made with its branches. */
  onSelectSeveral: (ids: string[]) => void;
  /** Groups the paths made in a row. */
  onGroup: (ids: string[]) => void;
  snap: boolean;
  /** Snapping to paths is on: a new path that ends on another is joined to it. */
  joinPaths: boolean;
  /** New paths are curved: the map's own Straight / Curved setting. */
  curve: boolean;
  onCurve: (curved: boolean) => void;
  styles: readonly MapStyle[];
  titleOf: (f: Resolved["feature"]) => string;
  handle: RefObject<PathsHandle | null>;
  onSteps: (steps: { undo: boolean; redo: boolean }) => void;
  say: (words: string) => void;
  /** The terrain in use is drawn over the map as relief. */
  relief: boolean;
  onRelief: (on: boolean) => void;
  /** Opens the Terrain dialog. */
  onTerrain: () => void;
}) {
  const { map, view, size } = p;
  const phone = usePhone();
  const space = map.space as Space;
  const schematic = map.space.kind === "flat" && map.space.schematic === true;
  // The picture looked at: the topmost one shown.
  const picture: MapImage | null = useMemo(
    () => [...map.images].reverse().find((i) => p.shownImages.has(i.id)) ?? null,
    [map.images, p.shownImages],
  );
  const terrain = map.terrain ?? null;

  const [kind, setKindNow] = useState<Kind>(
    schematic || !picture ? (schematic ? "trace" : "river") : remembered.kind,
  );
  const [from, setFrom] = useState(remembered.from);
  const [meander, setMeander] = useState(remembered.meander);
  const [likely, setLikely] = useState(remembered.likely);
  const [above, setAbove] = useState(remembered.above);
  const [mode, setMode] = useState<Mode>(remembered.mode);
  const [variant, setVariant] = useState<Variant>(remembered.variant);
  const [useHeights, setUseHeights] = useState(remembered.useHeights);
  const [follow, setFollow] = useState(remembered.follow);
  const [detail, setDetail] = useState(remembered.detail);
  const [styleFor, setStyleFor] = useState(remembered.styleFor);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    Object.assign(remembered, {
      kind,
      from,
      meander,
      likely,
      above,
      mode,
      variant,
      useHeights,
      follow,
      detail,
      styleFor,
    });
  }, [kind, from, meander, likely, above, mode, variant, useHeights, follow, detail, styleFor]);
  // A curve needs fewer points: its thinning may stray further from what was found.
  const eps = DETAIL_EPS[detail]! * (p.curve ? 1.5 : 1);

  // ---- Looking at the map --------------------------------------------------------------------

  const [session, setSession] = useState<
    { status: "looking" } | { status: "failed" } | ({ status: "ready"; key: string } & OpenedPaths)
  >({ status: "looking" });
  const pictureUrl = picture ? mapImageUrl(picture.path, 4096) : null;
  const extent = picture ? picture.extent : terrain ? terrainExtent(map, terrain) : null;
  const sessionKey = JSON.stringify([pictureUrl, terrain, extent]);
  useEffect(() => {
    if (!extent) return;
    let stale = false;
    setSession({ status: "looking" });
    const heights = terrain
      ? {
          url: mapImageUrl(terrain.image, 2560),
          extent: terrainExtent(map, terrain),
          invert: terrain.invert === true,
          smoothing: terrain.smoothing ?? 0,
          seaLevel: terrain.seaLevel ?? null,
          metres: terrainMetres(terrain),
        }
      : null;
    (async () => {
      // Find areas' worker looks at the picture once, for both tools.
      if (pictureUrl) await openPicture({ type: "open", url: pictureUrl, round: false });
      return openPaths({ url: pictureUrl, extent: extent as ImageFrame["extent"], heights });
    })().then(
      (o) => !stale && setSession({ status: "ready", key: sessionKey, ...o }),
      () => !stale && setSession({ status: "failed" }),
    );
    return () => {
      stale = true;
    };
    // The key holds all the effect reads of the map.
  }, [sessionKey]);
  // Leaving the tool lets the worker's heights, flow and cost surfaces go.
  useEffect(() => () => void closePaths().catch(() => {}), []);
  const ready = session.status === "ready" && session.key === sessionKey ? session : null;
  const imageFrame: ImageFrame | null = useMemo(
    () =>
      ready && extent
        ? { extent: extent as ImageFrame["extent"], sphere: false, w: ready.w, h: ready.h }
        : null,
    // The session's key holds the extent.
    [ready],
  );
  const px = (at: Position): Px => toPx(imageFrame!, at);
  const pos = (at: Px): Position => toPosition(imageFrame!, at);

  // ---- The terrain in use ----------------------------------------------------------------------

  const drawn = useMemo(
    () =>
      p.resolved
        .filter((r) => !p.hidden.has(r.feature.layer) && !p.hidden.has(r.feature.id))
        .map((r) => r.feature),
    [p.resolved, p.hidden],
  );
  const features = useMemo(
    () => (imageFrame ? terrainFeatures(space, imageFrame, drawn, p.styles) : []),
    [imageFrame, drawn, p.styles, space],
  );
  const perUnit = kmPerUnit(map.space);
  const kmPerPx =
    perUnit !== null && imageFrame
      ? (perUnit * (imageFrame.extent[2] - imageFrame.extent[0])) / imageFrame.w
      : null;
  const terrainKey = JSON.stringify([sessionKey, useHeights, follow, features, kmPerPx]);
  const [info, setInfo] = useState<({ key: string } & TerrainInfo) | null>(null);
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    setTerrain({ useHeights, follow, features, kmPerPx }).then(
      (t) => !stale && setInfo({ key: terrainKey, ...t }),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [terrainKey, ready]);
  const terrainReady = info?.key === terrainKey ? info : null;

  // ---- What has been clicked, with its undo ---------------------------------------------------

  const [pend, setPendNow] = useState<Pend | null>(null);
  const past = useRef<(Pend | null)[]>([]);
  const future = useRef<(Pend | null)[]>([]);
  const [steps, setSteps] = useState(0);
  const { onSteps } = p;
  useEffect(() => {
    onSteps({ undo: past.current.length > 0, redo: future.current.length > 0 });
  }, [steps, onSteps]);
  useEffect(() => () => onSteps({ undo: false, redo: false }), [onSteps]);
  const remember = () => {
    past.current.push(pend);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setSteps((n) => n + 1);
  };
  /** Sets what is clicked as a step Undo takes back. */
  const choose = (next: Pend | null) => {
    remember();
    setPendNow(next);
  };
  const reset = () => {
    past.current = [];
    future.current = [];
    setPendNow(null);
    setSteps((n) => n + 1);
  };
  const setKind = (next: Kind) => {
    if (next === kind) return;
    setKindNow(next);
    if (pend) choose(null);
  };
  /** A stop is being dragged: only the proposed way is worked out until it is let go. */
  const [dragging, setDragging] = useState(false);

  // ---- What the clicks give ----------------------------------------------------------------------

  /** A line's length in the map's words: "184 km", or map units when it has no scale. */
  const lengthOf = (points: Position[]) =>
    lengthText(
      measure(space, outline(space, points, { curve: p.curve, closed: false }).line),
      false,
    );
  const guessed = terrainReady?.guessed ?? true;
  // A height map built from hints is the owner's terrain, not a guess; but never mistaken for a
  // surveyed one (stage 21).
  const fromHints = !guessed && !!terrain?.generated;
  const terrainNote = guessed
    ? "Terrain guessed from the picture."
    : fromHints
      ? "Terrain from hints."
      : "Terrain from the height map.";

  const [proposal, setProposal] = useState<{ key: string; value: Proposal } | null>(null);
  const [busy, setBusy] = useState(false);
  const proposalKey = JSON.stringify([
    terrainKey,
    pend,
    kind,
    meander,
    mode,
    variant,
    eps,
    p.snap,
    p.joinPaths,
    p.curve,
    dragging,
  ]);
  const wanted = useRef("");
  wanted.current = proposalKey;
  /** The names of a route's ends: a marker's, or Start and End. */
  const stopName = (stops: Stop[], i: number) =>
    stops[i]?.name || (i === 0 ? "Start" : i === stops.length - 1 ? "End" : "Stop");

  useEffect(() => {
    if (!pend || !imageFrame || !terrainReady) {
      setProposal(null);
      setBusy(false);
      return;
    }
    const key = proposalKey;
    const current = () => wanted.current === key;
    const done = (value: Proposal) => {
      if (!current()) return;
      setProposal({ key, value });
    };
    setBusy(true);
    const work = async () => {
      if (pend.kind === "river") {
        const r = await riverAt({
          at: px(pend.at),
          from: pend.from,
          exact: pend.exact,
          meander,
          eps,
          snap: p.joinPaths,
        });
        if (!r.ok) {
          const why = {
            sea:
              pend.from === "mouth"
                ? "No land near here. Click the coast where the river comes out."
                : "That is water. Click on land, where the river rises.",
            noLand: "No land near here. Click the coast where the river comes out.",
            short: "Too short to be a river: click further from the water.",
            onRiver: "A river already runs here.",
          }[r.why];
          return done({ paths: [], ghosts: [], marks: [], text: why, short: why, fail: true });
        }
        const points = r.points.map(pos);
        const joined = r.joined ? p.resolved.find((x) => x.feature.id === r.joined) : undefined;
        const joinedName = joined ? p.titleOf(joined.feature) || "a river" : "";
        const ends =
          r.end === "sea"
            ? terrainReady.hasSea
              ? "reaches the sea"
              : "reaches water"
            : r.end === "river"
              ? `joins ${joinedName}`
              : "runs off the map";
        const length = lengthOf(points);
        const flat = r.flatShare > 1 / 3 ? " · flat ground: the course here is a guess" : "";
        return done({
          paths: [{ points, exactEnd: r.end === "river" }],
          ghosts: [],
          marks: [],
          text: `River · ${length} · ${ends} · ${plural(points.length, "point")}${flat}`,
          short: `${length} · ${ends}`,
          note: `River of ${length}${r.fall !== null ? `, falling about ${Math.round(r.fall / 10) * 10} m` : ""}. ${terrainNote}`,
        });
      }

      if (pend.kind === "route") {
        const { stops } = pend;
        if (stops.length < 2) {
          return done({
            paths: [],
            ghosts: [],
            marks: [],
            text: `From ${stopName(stops, 0)} · now ${phone ? "tap" : "click"} where the route ends`,
            short: "Now tap the end",
          });
        }
        const ask = (m: Mode, v: Variant) =>
          routeFor({ stops: stops.map((s) => px(s.at)), mode: m, variant: v, eps });
        const title = `${stopName(stops, 0)} → ${stopName(stops, stops.length - 1)}`;
        const main = await ask(mode, variant);
        if (!current()) return;
        const timeOf = (r: RouteReply & { ok: true }) =>
          r.hours === null ? "" : travelTime(r.hours);
        if (!main.ok) {
          // No way by land: the same search with sailing allowed, offered.
          const ship = mode === "ship" ? main : await ask("ship", "fast");
          if (variant !== "fast") {
            // The fastest may still exist where this way does not.
            const fast = await ask(mode, "fast");
            if (fast.ok && current()) return setVariant("fast");
          }
          const by = MODES[mode].name;
          const why = terrainReady.hasSea ? ": water is in the way." : ".";
          return done({
            paths: [],
            ghosts: ship.ok
              ? [
                  {
                    key: "ship",
                    points: ship.points.map(pos),
                    label: `By ship${ship.hours !== null ? ` · ${timeOf(ship)}` : ""}`,
                  },
                ]
              : [],
            marks: ship.ok ? ship.marks.map((m) => ({ at: pos(m.at), kind: m.kind })) : [],
            text: `No way ${by} from ${title}${why}`,
            short: `No way ${by}.`,
            fail: true,
            ...(ship.ok ? { ship: { hours: ship.hours } } : {}),
          });
        }
        const describe = (
          r: RouteReply & { ok: true },
          ways: Proposal["ways"],
          ghosts: Ghost[],
        ): Proposal => {
          const points = r.points.map(pos);
          const bits: string[] = [];
          if (r.bridges) bits.push(plural(r.bridges, "bridge"));
          if (r.fords) bits.push(plural(r.fords, "ford"));
          if (r.seaShare > 0.02) bits.push("part by sea");
          const length = lengthOf(points);
          const time = timeOf(r);
          const about = time ? ` · about ${time} ${MODES[mode].name}` : ` · ${MODES[mode].name}`;
          const extra = bits.length ? ` · ${bits.join(", ")}` : "";
          const noTime =
            r.hours === null ? " Set the map's scale in km or miles to see travelling time." : "";
          return {
            paths: [
              {
                points,
                label: stops[0]!.name && stops[stops.length - 1]!.name ? title : null,
              },
            ],
            ghosts,
            marks: r.marks.map((m) => ({ at: pos(m.at), kind: m.kind })),
            text: `${title} · ${length}${about}${extra}`,
            short: `${length}${time ? ` · ${time}` : ""}${extra}`,
            note: `${WAY_LABELS[variant]} way ${MODES[mode].name}: ${length}${time ? `, about ${time} at ${HOURS_A_DAY} hours a day` : ""}${bits.length ? ` (${bits.join(", ")})` : ""}. ${terrainNote}${noTime}`,
            ...(ways ? { ways } : {}),
          };
        };
        const ways: NonNullable<Proposal["ways"]> = {
          [variant]: { hours: main.hours, same: main.same },
        };
        done(describe(main, ways, []));
        if (dragging) return;
        // The other ways follow, one at a time, as ghosts and as times on the switch.
        const ghosts: Ghost[] = [];
        for (const v of WAYS) {
          if (v === variant) continue;
          const other = await ask(mode, v);
          if (!current()) return;
          ways[v] = other.ok ? { hours: other.hours, same: other.same } : null;
          const differs = other.ok && (v === "fast" ? !main.same : !other.same);
          if (other.ok && differs) {
            ghosts.push({
              key: v,
              points: other.points.map(pos),
              label: `${WAY_LABELS[v]}${other.hours !== null ? ` · ${timeOf(other)}` : ""}`,
            });
          }
          done(describe(main, { ...ways }, [...ghosts]));
        }
        return;
      }

      // Trace.
      const ask = (at: Position, end: Position | null) =>
        traceAt({ at: px(at), end: end ? px(end) : null, eps, curved: p.curve, branches: true });
      const r: TraceReply = await ask(pend.seed, pend.end);
      if (!current()) return;
      if (!r.ok && r.why === "other" && pend.end) {
        // The second click was on another line: that line is followed instead.
        setPendNow({ kind: "trace", seed: pend.end, end: null, branches: [] });
        return;
      }
      if (!r.ok) {
        const why = {
          none: "No painted line here. Click a river, road or coast in the picture.",
          short: "A mark, not a line: too short to be a path.",
          other: "That is a different line.",
        }[r.why];
        return done({ paths: [], ghosts: [], marks: [], text: why, short: why, fail: true });
      }
      const keyOf = (b: Px[]) => `${Math.round(b[0]![0])},${Math.round(b[0]![1])}`;
      const main = r.points.map(pos);
      const paths: NewPath[] = [{ points: main }];
      const ghosts: Ghost[] = [];
      for (const b of r.branches) {
        const points = b.map(pos);
        if (pend.branches.includes(keyOf(b))) paths.push({ points, exactEnd: true });
        else ghosts.push({ key: keyOf(b), points, label: "" });
      }
      const what =
        r.kind === "river"
          ? "Painted river"
          : r.kind === "road"
            ? "Painted road"
            : r.loop
              ? "Painted line, all the way round"
              : "Painted line";
      const count = paths.reduce((s, q) => s + q.points.length, 0);
      const length = lengthOf(main);
      const added =
        paths.length > 1 ? ` · ${plural(paths.length - 1, "branch", "branches")} added` : "";
      const offered = ghosts.length
        ? ` · ${plural(ghosts.length, "branch", "branches")} in grey: ${phone ? "tap" : "click"} to add`
        : "";
      const again =
        pend.end || r.loop ? "" : ` · ${phone ? "tap" : "click"} it again to stop there`;
      return done({
        paths,
        ghosts,
        marks: [],
        text: `${what} · ${length} · ${plural(count, "point")}${added}${offered}${again}`,
        short: `${length}${ghosts.length ? ` · ${plural(ghosts.length, "branch", "branches")}` : ""}`,
        note: "Traced from the picture's own line.",
        traced: r.kind,
      });
    };
    void work()
      .catch(() => current() && p.say("The path could not be worked out."))
      .finally(() => current() && setBusy(false));
    // Everything it reads is in the key.
  }, [proposalKey, imageFrame, terrainReady === null]);
  const current = proposal?.key === proposalKey ? proposal.value : null;
  // What was last shown stays while the next is worked out, so a dragged stop does not flicker.
  const shown = current ?? (pend && proposal ? proposal.value : null);

  // ---- Likely rivers, as ghosts ------------------------------------------------------------------

  const [streams, setStreams] = useState<{ key: string; rivers: Position[][] } | null>(null);
  const aboveCells = ready
    ? kmPerPx !== null
      ? ABOVE_KM2[above]! / (kmPerPx * ready.cell) ** 2
      : ABOVE_SHARE[above]! * ready.gw * ready.gh
    : 0;
  const streamsKey = JSON.stringify([terrainKey, likely && kind === "river", above]);
  useEffect(() => {
    if (!likely || kind !== "river" || !terrainReady || !imageFrame) return;
    let stale = false;
    likelyRivers(aboveCells).then(
      (l) => !stale && setStreams({ key: streamsKey, rivers: l.rivers.map((r) => r.map(pos)) }),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [streamsKey, terrainReady === null]);
  const likelyGhosts: Ghost[] =
    likely && kind === "river" && streams?.key === streamsKey
      ? streams.rivers.map((points, i) => ({ key: `likely${i}`, points, label: "", blue: true }))
      : [];
  const ghosts = [...likelyGhosts, ...(shown?.ghosts ?? [])];

  // The path style: the one chosen for this kind, else the usual one for what is being made.
  const pathStyles = p.styles.filter((s) => s.for === "path");
  const usual = (counts: "river" | "road") =>
    pathStyles.find((s) => countsAs(s) === counts)?.id ?? "";
  const tracedAs = shown?.traced;
  const guessedStyle =
    kind === "river"
      ? usual("river")
      : kind === "route"
        ? usual("road")
        : tracedAs === "river"
          ? usual("river")
          : tracedAs === "road"
            ? usual("road")
            : "";
  const chosenStyle = styleFor[kind];
  const style =
    chosenStyle !== undefined &&
    (chosenStyle === "" || pathStyles.some((s) => s.id === chosenStyle))
      ? chosenStyle
      : guessedStyle;

  // ---- Pointing at the map -------------------------------------------------------------------------

  const viewNow = (): View | null => (view ? makeView(view, size.width, size.height) : null);
  const onScreen = (points: Position[]): Point[] => {
    const v = viewNow();
    if (!v) return [];
    const { line } = outline(space, points, { curve: false, closed: false });
    return line.flatMap((q) => {
      const s = v.project(q);
      return s ? [{ x: s[0], y: s[1] }] : [];
    });
  };
  /** The ghost under a point of the screen, if one is within reach. */
  const ghostAt = (at: Point, kindOf: PointerKind): Ghost | null => {
    const reach = kindOf === "mouse" ? 8 : 14;
    let best: Ghost | null = null;
    let bd = reach;
    for (const g of ghosts) {
      const line = onScreen(g.points).map((q): Px => [q.x, q.y]);
      if (line.length < 2) continue;
      const d = nearestOn([at.x, at.y], line).d;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  };
  /** A stop where it is put: on a marker near it (taking its name), or on the end of a path. */
  const snapStop = (at: Point): Stop | null => {
    const v = viewNow();
    const here = v?.unproject(at.x, at.y);
    if (!v || !here) return null;
    if (p.snap) {
      let best: Stop | null = null;
      let bd = 14;
      for (const f of drawn) {
        const ends: Position[] =
          f.kind === "marker"
            ? [f.at]
            : f.kind === "path"
              ? [f.points[0]!, f.points[f.points.length - 1]!]
              : [];
        for (const e of ends) {
          const s = v.project(e);
          if (!s) continue;
          // A marker wins over the end of a path beside it.
          const d = Math.hypot(s[0] - at.x, s[1] - at.y) - (f.kind === "marker" ? 4 : 0);
          if (d < bd) {
            bd = d;
            const name = f.kind === "marker" ? p.titleOf(f) : "";
            best = name ? { at: e, name } : { at: e };
          }
        }
      }
      if (best) return best;
    }
    return { at: here };
  };
  const stopAt = (at: Point, kindOf: PointerKind): number | null => {
    const v = viewNow();
    if (!v || pend?.kind !== "route") return null;
    const reach = kindOf === "mouse" ? 12 : 24;
    let best: number | null = null;
    let bd = reach;
    pend.stops.forEach((s, i) => {
      const q = v.project(s.at);
      if (!q) return;
      const d = Math.hypot(q[0] - at.x, q[1] - at.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const inPicture = (at: Position) => {
    if (!imageFrame) return false;
    const [x, y] = toPx(imageFrame, at);
    return x >= -0.5 && y >= -0.5 && x < imageFrame.w - 0.5 && y < imageFrame.h - 0.5;
  };

  const [hover, setHover] = useState<{ at: Point; line: Position[] | null; tag: string } | null>(
    null,
  );
  const hovering = useRef<{ busy: boolean; next: Point | null }>({ busy: false, next: null });
  const hoverAt = (at: Point | null) => {
    if (!at || phone || !imageFrame || !terrainReady) return setHover(null);
    const ghost = ghostAt(at, "mouse");
    if (ghost) {
      return setHover({
        at,
        line: null,
        tag: ghost.blue
          ? "Click to take this river"
          : ghost.key === "ship"
            ? "Click to go by ship"
            : kind === "trace"
              ? "Click to add this branch"
              : "Click to take this way",
      });
    }
    const here = viewNow()?.unproject(at.x, at.y);
    if (!here || !inPicture(here) || (kind !== "river" && (kind !== "trace" || pend))) {
      return setHover(null);
    }
    // One at a time: the pointer's latest place is asked when the last answer is back.
    const h = hovering.current;
    h.next = at;
    if (h.busy) return;
    const run = () => {
      const next = h.next;
      if (!next) return;
      h.next = null;
      h.busy = true;
      const where = viewNow()?.unproject(next.x, next.y);
      if (!where) {
        h.busy = false;
        return;
      }
      const asked =
        kind === "river"
          ? riverAt({ at: px(where), from, exact: true, meander, eps, snap: p.joinPaths }).then(
              (r) => (r.ok ? { line: r.points.map(pos), tag: "" } : null),
            )
          : traceAt({ at: px(where), end: null, eps, curved: p.curve, branches: false }).then(
              (r) =>
                r.ok
                  ? {
                      line: r.points.map(pos),
                      tag: `Click to follow this ${r.kind === "line" ? "line" : r.kind}`,
                    }
                  : null,
            );
      asked
        .then(
          (found) => setHover(found ? { at: next, ...found } : null),
          () => setHover(null),
        )
        .finally(() => {
          h.busy = false;
          run();
        });
    };
    run();
  };
  // Another kind, or a click, ends what the pointer was shown.
  useEffect(() => setHover(null), [kind, pend, terrainKey]);

  const tap: PathsHandle["tap"] = (at, how) => {
    // A click while the water is being worked out again (a path was just made) still counts:
    // what it gives is shown once the terrain is ready.
    if (!imageFrame) return p.say("Still looking at the map…");
    const v = viewNow();
    const here = v?.unproject(at.x, at.y);
    if (!here) return;
    const ghost = ghostAt(at, how.kind);
    if (ghost) {
      if (ghost.blue)
        return choose({ kind: "river", at: ghost.points[0]!, from: "source", exact: false });
      if (ghost.key === "ship") return setMode("ship");
      if (pend?.kind === "trace")
        return choose({ ...pend, branches: [...pend.branches, ghost.key] });
      if (WAYS.includes(ghost.key as Variant)) return setVariant(ghost.key as Variant);
    }
    if (!inPicture(here))
      return p.say(picture ? "That is off the picture." : "That is off the height map.");
    if (kind === "river") return choose({ kind: "river", at: here, from, exact: true });
    if (kind === "trace") {
      if (pend?.kind === "trace" && !pend.end) return choose({ ...pend, end: here });
      return choose({ kind: "trace", seed: here, end: null, branches: [] });
    }
    const stops = pend?.kind === "route" ? pend.stops : [];
    const on = stopAt(at, how.kind);
    if (how.alt && on !== null) {
      // Alt-click takes a stop away; a route needs its two ends.
      const left = stops.filter((_, i) => i !== on);
      return choose(left.length > 0 ? { kind: "route", stops: left } : null);
    }
    if (on !== null) return;
    const stop = snapStop(at);
    if (!stop) return;
    if (stops.length < 2) return choose({ kind: "route", stops: [...stops, stop] });
    const i = stopIndex(
      stops.map((s) => s.at),
      stop.at,
    );
    choose({ kind: "route", stops: [...stops.slice(0, i), stop, ...stops.slice(i)] });
  };

  p.handle.current = {
    tap,
    hover: hoverAt,
    grab: (at, kindOf) => stopAt(at, kindOf),
    dragStop: (index, at) => {
      if (pend?.kind !== "route") return;
      const stop = snapStop(at);
      if (!stop) return;
      // The whole drag is one step to undo.
      if (!dragging) {
        remember();
        setDragging(true);
      }
      setPendNow({ kind: "route", stops: pend.stops.map((s, i) => (i === index ? stop : s)) });
    },
    dropStop: () => setDragging(false),
    undo: () => {
      if (past.current.length === 0) return false;
      const back = past.current.pop()!;
      future.current.push(pend);
      setPendNow(back);
      if (back) setKindNow(back.kind);
      setSteps((n) => n + 1);
      return true;
    },
    redo: () => {
      if (future.current.length === 0) return false;
      const on = future.current.pop()!;
      past.current.push(pend);
      setPendNow(on);
      if (on) setKindNow(on.kind);
      setSteps((n) => n + 1);
      return true;
    },
  };
  useEffect(() => {
    const handle = p.handle;
    return () => {
      handle.current = null;
    };
  }, [p.handle]);

  // ---- What the tool does ----------------------------------------------------------------------

  /** The paths made in a row, which Group makes one group of. */
  const [made, setMade] = useState<string[]>([]);
  const madeNow = made.filter((id) => map.features.some((f) => f.id === id));
  const canMake = !!current && current.paths.length > 0 && !busy;
  const layerLocked = p.locked.has(p.activeLayer);
  const make = () => {
    if (!canMake || !current) return;
    if (layerLocked) return p.say("That layer is locked. Choose another to make the path in.");
    const now = p.mapRef.current;
    if (now && carryOn && continuing) {
      // Continue: the proposed path and the one it meets become one path.
      const next = addToPath(now, carryOn.drawn, current.paths[0]!.points);
      if (!next) return;
      p.change(next);
      p.onSelect(carryOn.drawn.feature.id);
      reset();
      if (current.note) p.say(current.note);
      return;
    }
    const done = now ? makePaths(now, p.activeLayer, style || null, p.curve, current.paths) : null;
    if (!done) return;
    if (p.joinPaths) {
      // Each new path that ends on another path is joined to it: the other gets a corner there.
      for (const id of done.ids) done.map = joinNewPath(done.map, space, id);
      // A new road that crosses a road gets a crossroads corner in both.
      const roads = new Set(
        drawn.filter((f) => f.kind === "path" && roadIds.has(f.id)).map((f) => f.id),
      );
      const isRoad = countsAs(pathStyles.find((s) => s.id === style)) === "road";
      if (isRoad && roads.size > 0) {
        for (const id of done.ids) done.map = crossCorners(done.map, space, id, roads).map;
      }
    }
    p.change(done.map);
    if (done.ids.length > 1) p.onSelectSeveral(done.ids);
    else p.onSelect(done.ids[0]!);
    setMade([...madeNow, ...done.ids]);
    reset();
    if (current.note) p.say(current.note);
  };
  /** The paths that count as roads, by their styles. */
  const roadIds = useMemo(
    () => new Set(features.filter((f) => f.counts === "road").map((f) => f.id)),
    [features],
  );
  // Continue: the proposed path starts or ends on the very end of a path of the same kind (the
  // same style, or one that counts as the same). The two can be made one path.
  const carryOn = useMemo(() => {
    const main = current?.paths.length === 1 ? current.paths[0]! : null;
    if (!main || !p.joinPaths) return null;
    const mine = countsAs(pathStyles.find((s) => s.id === style));
    const reach = joinReach(space);
    const ends = [main.points[0]!, main.points[main.points.length - 1]!];
    for (const r of p.resolved) {
      const f = r.feature;
      if (
        f.kind !== "path" ||
        p.hidden.has(f.id) ||
        p.hidden.has(f.layer) ||
        p.locked.has(f.layer)
      ) {
        continue;
      }
      const theirs = countsAs(pathStyles.find((s) => s.id === f.style));
      const alike = (f.style ?? "") === style || (mine !== null && mine === theirs);
      if (!alike) continue;
      const tips = [f.points[0]!, f.points[f.points.length - 1]!];
      if (ends.some((e) => tips.some((t) => Math.hypot(e[0] - t[0], e[1] - t[1]) <= reach))) {
        return { drawn: r, name: p.titleOf(f) || "the path" };
      }
    }
    return null;
    // The proposal changes with its key; the map with what is drawn.
  }, [current, p.resolved, p.joinPaths, style]);
  const [separate, setSeparate] = useState(false);
  const continuing = carryOn !== null && !separate;
  // Each new proposal starts with the default again: Continue.
  useEffect(() => setSeparate(false), [pend]);
  const selectedPath = p.resolved.find(
    (r) => r.feature.id === p.selected && r.feature.kind === "path",
  );
  const pathLocked = !!selectedPath && p.locked.has(selectedPath.feature.layer);
  const addTo = () => {
    if (!selectedPath || pathLocked || !canMake || !current) return;
    const now = p.mapRef.current;
    const next = now ? addToPath(now, selectedPath, current.paths[0]!.points) : null;
    if (!next) return;
    p.change(next);
    p.onSelect(selectedPath.feature.id);
    reset();
  };
  const clear = () => {
    if (pend) choose(null);
  };
  /** X: the kind's own switch. */
  const switchKind = () => {
    if (kind === "river") {
      const next = from === "source" ? "mouth" : "source";
      setFrom(next);
      if (pend?.kind === "river" && pend.exact) setPendNow({ ...pend, from: next });
    } else if (kind === "route") {
      const usable = WAYS.filter(
        (v) => v === variant || (current?.ways?.[v] && !current.ways[v]!.same),
      );
      setVariant(usable[(usable.indexOf(variant) + 1) % usable.length] ?? "fast");
    } else return false;
  };

  const free = () => focusIsFree(document.activeElement, p.frame.current);
  useShortcut("map.pathsRiver", () => (free() && !schematic ? setKind("river") : false));
  useShortcut("map.pathsRoute", () => (free() && !schematic ? setKind("route") : false));
  useShortcut("map.pathsTrace", () => (free() && picture ? setKind("trace") : false));
  useShortcut("map.pathsSwitch", () => (free() ? switchKind() : false));
  useShortcut("map.pathsMake", () => {
    if (!free() || !canMake) return false;
    make();
  });
  useShortcut("map.pathsClear", () => {
    if (pend) return clear();
    if (p.selected) return p.onSelect(null);
    return false;
  });

  // ---- Drawing ---------------------------------------------------------------------------------

  const canvas = useRef<HTMLCanvasElement>(null);
  const [reliefPicture, setReliefPicture] = useState<{
    key: string;
    canvas: HTMLCanvasElement;
  } | null>(null);
  useEffect(() => {
    if (!p.relief || !terrainReady) return;
    let stale = false;
    reliefOf().then(
      (r) => {
        if (stale) return;
        const c = document.createElement("canvas");
        c.width = r.w;
        c.height = r.h;
        c.getContext("2d")!.putImageData(
          new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h),
          0,
          0,
        );
        setReliefPicture({ key: terrainKey, canvas: c });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [p.relief, terrainKey, terrainReady === null]);
  const ants = useRef(0);
  const paint = useRef(() => {});
  paint.current = () => {
    const c = canvas.current;
    const v = viewNow();
    if (!c || !v) return;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(size.width * ratio);
    const h = Math.round(size.height * ratio);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const accent = selectColour();
    const paper = "#fbf7f0";
    const trace = (points: Position[], curved: boolean) => {
      const { line } = outline(space, points, { curve: curved, closed: false });
      ctx.beginPath();
      let started = false;
      for (const q of line) {
        const s = v.project(q);
        if (!s) continue;
        if (started) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
        started = true;
      }
    };
    const pill = (at: Position, text: string, colour: string) => {
      const s = v.project(at);
      if (!s || !text) return;
      ctx.font = "600 11px system-ui, sans-serif";
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = paper;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.roundRect(s[0] - tw / 2, s[1] - 22, tw, 16, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colour;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, s[0], s[1] - 14);
    };

    if (p.relief && reliefPicture && imageFrame) {
      const a = v.project([imageFrame.extent[0], imageFrame.extent[1]]);
      const b = v.project([imageFrame.extent[2], imageFrame.extent[3]]);
      if (a && b) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(reliefPicture.canvas, a[0], a[1], b[0] - a[0], b[1] - a[1]);
      }
    }
    // What is offered and not yet taken: thin dashes, blue for likely rivers, grey for the rest.
    for (const g of ghosts) {
      trace(g.points, !g.blue && p.curve);
      ctx.setLineDash([]);
      ctx.strokeStyle = paper;
      ctx.lineWidth = 3.5;
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = g.blue ? "#2f6f9f" : "#5d564d";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      if (g.label) pill(g.points[Math.floor(g.points.length / 2)]!, g.label, "#5d564d");
    }
    if (hover?.line && !phone) {
      trace(hover.line, p.curve);
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // What Make path would make: the selection colour, marching dashes, its points as dots.
    for (const path of shown?.paths ?? []) {
      trace(path.points, p.curve);
      ctx.setLineDash([]);
      ctx.strokeStyle = paper;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -ants.current;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.lineDashOffset = 0;
      ctx.setLineDash([]);
      for (const q of path.points) {
        const s = v.project(q);
        if (!s) continue;
        ctx.beginPath();
        ctx.arc(s[0], s[1], 2.6, 0, Math.PI * 2);
        ctx.fillStyle = paper;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = accent;
        ctx.stroke();
      }
    }
    const MARKS: Record<Mark["kind"], string> = {
      ford: "ford",
      bridge: "bridge",
      sail: "board ship",
      land: "land",
    };
    for (const m of shown?.marks ?? []) pill(m.at, MARKS[m.kind], "#5d564d");
    if (pend?.kind === "route") {
      pend.stops.forEach((stop, i) => {
        const s = v.project(stop.at);
        if (!s) return;
        const end = i === 0 || i === pend.stops.length - 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(s[0], s[1], end ? 7 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? accent : paper;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = accent;
        ctx.stroke();
      });
    }
    if (pend?.kind === "river" && pend.exact) {
      const s = v.project(pend.at);
      if (s) {
        ctx.beginPath();
        ctx.arc(s[0], s[1], 5, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      }
    }
  };
  useEffect(() => paint.current());
  // The proposed path's dashes march, unless the reader asked for less motion.
  const marching = (shown?.paths.length ?? 0) > 0;
  useEffect(() => {
    if (!marching || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      ants.current = (ants.current + 1) % 12;
      paint.current();
    }, 70);
    return () => window.clearInterval(timer);
  }, [marching]);

  // ---- The bar ---------------------------------------------------------------------------------

  const click = phone ? "tap" : "click";
  let status: string;
  if (session.status === "failed") status = "The map could not be looked at.";
  else if (!ready) status = picture ? "Looking at the picture…" : "Reading the height map…";
  else if (!terrainReady) status = "Working out the water…";
  else if (shown && pend) status = shown.text;
  else if (pend) status = "Working it out…";
  else if (kind === "river") {
    status =
      from === "source"
        ? `${phone ? "Tap" : "Click"} where a river rises: it runs downhill to the sea`
        : `${phone ? "Tap" : "Click"} the coast where a river comes out: it is followed up to its source`;
    if (likelyGhosts.length)
      status = `${plural(likelyGhosts.length, "likely river")} · ${click} one to take it`;
  } else if (kind === "route") {
    status = `${phone ? "Tap" : "Click"} the start, then the end · markers are snapped to`;
  } else status = `${phone ? "Tap" : "Click"} a river, road or coast painted in the picture`;
  const short = shown && pend ? shown.short : status;

  const layers = layerTree(map.layers);
  const makeCount = current?.paths.length ?? 0;
  const makeLabel = continuing
    ? `Continue “${carryOn.name}”`
    : makeCount > 1
      ? `Make ${makeCount} paths`
      : "Make path";
  const makeReason = !pend
    ? `${phone ? "Tap" : "Click"} the map first`
    : !canMake
      ? busy
        ? "Still working it out"
        : "There is nothing to make yet"
      : null;
  const pathName = selectedPath ? p.titleOf(selectedPath.feature) : "";
  const addToLabel = pathName ? `Add to “${pathName}”` : "Add to selected path";
  const addToReason = !selectedPath
    ? "Select a path first"
    : pathLocked
      ? "It is in a locked layer"
      : !canMake
        ? "Nothing is proposed yet"
        : null;
  const terrainName = terrain ? (terrain.image.split("/").pop() ?? "").replace(/\.[^.]+$/, "") : "";
  const speeds = (m: Mode) => {
    const s = MODES[m];
    return `Open land ${s.open} km/h · forest ${s.forest} · road ${s.road}${s.sea ? ` · sea ${s.sea}` : ""}`;
  };

  const kindSwitch = (
    <span className="find-mode" role="group" aria-label="Kind of path">
      {KINDS.map((k) => {
        const off =
          k.kind === "trace"
            ? picture
              ? null
              : "Trace needs a picture"
            : schematic
              ? "A diagram has no terrain: Trace only"
              : null;
        return (
          <Tip
            key={k.kind}
            label={k.hint}
            keys={shortcutText(k.key)}
            {...(off ? { note: off } : {})}
          >
            <button
              type="button"
              aria-pressed={kind === k.kind}
              aria-label={k.label}
              aria-disabled={off !== null || undefined}
              onClick={() => off === null && setKind(k.kind)}
            >
              <k.icon size={15} aria-hidden />
              {!phone && <span>{k.label}</span>}
            </button>
          </Tip>
        );
      })}
    </span>
  );
  const segmented = <T extends string>(
    label: string,
    value: T,
    options: { value: T; label: string; tip: string; note?: string; off?: boolean }[],
    set: (v: T) => void,
    keys?: string,
  ) => (
    <span className="find-mode paths-switch" role="group" aria-label={label}>
      {options.map((o) => (
        <Tip key={o.value} label={o.tip} {...(keys ? { keys } : {})}>
          <button
            type="button"
            aria-pressed={value === o.value}
            aria-disabled={o.off || undefined}
            onClick={() => !o.off && set(o.value)}
          >
            <span>{o.label}</span>
            {o.note && <small>{o.note}</small>}
          </button>
        </Tip>
      ))}
    </span>
  );
  const clearButton = (
    <Tip label="Clear what is proposed" keys={shortcutText("map.pathsClear")}>
      <button type="button" className="plain" aria-disabled={!pend || undefined} onClick={clear}>
        Clear
      </button>
    </Tip>
  );
  const addToButton = (
    <Tip
      label="Join the proposed path to the selected one, end to end"
      {...(addToReason ? { note: addToReason } : {})}
    >
      <button
        type="button"
        aria-disabled={addToReason !== null || undefined}
        onClick={() => addToReason === null && addTo()}
      >
        {addToLabel}
      </button>
    </Tip>
  );
  const groupButton = madeNow.length > 1 && (
    <Tip label="Make one group of the paths just made" keys={shortcutText("map.group")}>
      <button
        type="button"
        onClick={() => {
          p.onGroup(madeNow);
          setMade([]);
        }}
      >
        Group {madeNow.length} paths
      </button>
    </Tip>
  );
  // The terrain line: where the terrain comes from, as a way into the Terrain dialog.
  const terrainLine =
    kind === "trace" ? null : !terrainReady ? null : terrainReady.guessed ? (
      <Tip
        label={
          terrain
            ? "The height map is switched off: the terrain is guessed"
            : "This map has no height map: rivers are rough. Add one in Terrain"
        }
      >
        <button type="button" className="paths-terrain is-guess" onClick={p.onTerrain}>
          <TriangleAlert size={14} aria-hidden />
          <span>Guessing terrain from the picture</span>
        </button>
      </Tip>
    ) : fromHints ? (
      <Tip
        label={
          hintsChanged(map)
            ? "The hints changed since the height map was built: build it again in Terrain"
            : "Built from terrain hints: adjust them in Terrain"
        }
      >
        <button
          type="button"
          className={`paths-terrain${hintsChanged(map) ? " is-guess" : ""}`}
          onClick={p.onTerrain}
        >
          <Mountain size={14} aria-hidden />
          <span>
            {hintsChanged(map)
              ? "Hints changed since it was built · Build again"
              : "Terrain from hints (generated)"}
          </span>
        </button>
      </Tip>
    ) : (
      <Tip label="Adjust the height map in Terrain">
        <button type="button" className="paths-terrain" onClick={p.onTerrain}>
          <Mountain size={14} aria-hidden />
          <span>Terrain from “{terrainName}”</span>
        </button>
      </Tip>
    );
  const options_ = (
    <div className="find-options">
      {kind === "river" && (
        <>
          {segmented(
            "A click is",
            from,
            [
              { value: "source", label: "From its source", tip: "Click where the river rises" },
              {
                value: "mouth",
                label: "From its mouth",
                tip: "Click the coast where it comes out",
              },
            ],
            (v) => {
              setFrom(v);
              if (pend?.kind === "river" && pend.exact) setPendNow({ ...pend, from: v });
            },
            shortcutText("map.pathsSwitch"),
          )}
          <label className="find-range">
            Meander
            <small>straight</small>
            <input
              type="range"
              min={0}
              max={8}
              value={meander}
              onChange={(e) => setMeander(Number(e.target.value))}
            />
            <small>winding</small>
          </label>
          <Tip label="Every stream that drains enough land is offered: click one to take it">
            <button
              type="button"
              className="find-chip"
              aria-pressed={likely}
              onClick={() => setLikely(!likely)}
            >
              Show likely rivers
            </button>
          </Tip>
          {likely && (
            <label className="find-range">
              Above
              <small>small</small>
              <input
                type="range"
                min={0}
                max={ABOVE_KM2.length - 1}
                value={above}
                aria-valuetext={kmPerPx !== null ? `${ABOVE_KM2[above]} km²` : undefined}
                onChange={(e) => setAbove(Number(e.target.value))}
              />
              <small>{kmPerPx !== null ? `${ABOVE_KM2[above]} km²` : "large"}</small>
            </label>
          )}
        </>
      )}
      {kind === "route" && (
        <>
          {segmented(
            "Travelling",
            mode,
            (Object.keys(MODES) as Mode[]).map((m) => ({
              value: m,
              label: MODE_LABELS[m],
              tip: speeds(m),
            })),
            setMode,
          )}
          {segmented(
            "Which way",
            variant,
            WAYS.map((v) => {
              const w = current?.ways?.[v];
              return {
                value: v,
                label: WAY_LABELS[v],
                tip:
                  v === "fast"
                    ? "The least time"
                    : v === "flat"
                      ? "Avoids climbing, even when longer"
                      : "No fords and no sea: bridges only",
                ...(w === null
                  ? { note: "none", off: true }
                  : w && v !== variant
                    ? { note: w.same ? "same" : w.hours !== null ? travelTime(w.hours) : "" }
                    : {}),
              };
            }),
            setVariant,
            shortcutText("map.pathsSwitch"),
          )}
        </>
      )}
      {kind !== "trace" && (
        <>
          {terrainLine}
          <Tip
            label="Use the map's height map; off, the terrain is guessed from the picture"
            {...(terrain ? {} : { note: "This map has no height map: add one in Terrain" })}
          >
            <button
              type="button"
              className="find-chip"
              aria-pressed={!!terrain && useHeights}
              aria-disabled={!terrain || !picture || undefined}
              onClick={() => terrain && picture && setUseHeights(!useHeights)}
            >
              Height map
            </button>
          </Tip>
          <Tip
            label="Draws the terrain in use as light, shade and contour lines"
            keys={shortcutText("map.relief")}
          >
            <button
              type="button"
              className="find-chip"
              aria-pressed={p.relief}
              onClick={() => p.onRelief(!p.relief)}
            >
              Show relief
            </button>
          </Tip>
          <Tip label="Painted rivers pull water and are in a traveller's way; painted roads are quick">
            <button
              type="button"
              className="find-chip"
              aria-pressed={follow}
              aria-disabled={!picture || undefined}
              onClick={() => picture && setFollow(!follow)}
            >
              Follow drawn lines
            </button>
          </Tip>
        </>
      )}
      <label className="find-range">
        Points
        <small>fewer</small>
        <input
          type="range"
          min={0}
          max={DETAIL_EPS.length - 1}
          value={detail}
          onChange={(e) => setDetail(Number(e.target.value))}
        />
        <small>more</small>
      </label>
      {segmented(
        "Straight or curved",
        p.curve ? "curved" : "straight",
        [
          { value: "straight", label: "Straight", tip: "Straight from point to point" },
          { value: "curved", label: "Curved", tip: "A smooth line through the points" },
        ],
        (v) => p.onCurve(v === "curved"),
        shortcutText("map.curve"),
      )}
      {phone && (
        <span className="find-actions">
          {clearButton}
          {addToButton}
          {groupButton}
        </span>
      )}
      <span className="find-into">
        <label>
          New path in
          <select value={p.activeLayer} onChange={(e) => p.onActiveLayer(e.target.value)}>
            {layers.map((n) => (
              <option key={n.layer.id} value={n.layer.id}>
                {" ".repeat(n.depth)}
                {n.layer.name}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="Path style"
          value={style}
          onChange={(e) => setStyleFor({ ...styleFor, [kind]: e.target.value })}
        >
          <option value="">The layer's look</option>
          {pathStyles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </span>
    </div>
  );

  return (
    <>
      <canvas ref={canvas} className="map-canvas map-find" aria-hidden="true" />
      {hover?.tag && !phone && (
        <div
          className="find-tag"
          style={{ left: hover.at.x + 14, top: hover.at.y + 14 }}
          aria-hidden="true"
        >
          {hover.tag}
        </div>
      )}
      <div
        className={`find-bar paths-bar${open ? " is-open" : ""}${shown?.fail && pend ? " is-failed" : ""}`}
        role="group"
        aria-label="Find paths"
        data-kind={kind}
        data-state={!ready ? "looking" : !terrainReady ? "water" : "ready"}
        data-ready={canMake || undefined}
        data-guessed={terrainReady ? String(terrainReady.guessed) : undefined}
        data-ghosts={ghosts.length}
        data-paths={makeCount}
        data-stops={pend?.kind === "route" ? pend.stops.length : 0}
      >
        {(!phone || open) && options_}
        <div className="find-main">
          {kindSwitch}
          {phone && kind !== "trace" && terrainReady && (
            <button
              type="button"
              className={`paths-terrain-icon${terrainReady.guessed ? " is-guess" : ""}`}
              aria-label={
                terrainReady.guessed
                  ? "Guessing terrain from the picture"
                  : `Terrain from “${terrainName}”`
              }
              onClick={p.onTerrain}
            >
              {terrainReady.guessed ? (
                <TriangleAlert size={16} aria-hidden />
              ) : (
                <Mountain size={16} aria-hidden />
              )}
            </button>
          )}
          <span className="find-status" role="status">
            {phone ? short : status}
            {shown?.ship && pend && (
              <>
                {" "}
                <button type="button" className="plain paths-ship" onClick={() => setMode("ship")}>
                  Go by ship{shown.ship.hours !== null ? ` (${travelTime(shown.ship.hours)})` : ""}
                </button>
              </>
            )}
          </span>
          {(busy || !ready || !terrainReady) && <span className="find-busy" aria-hidden="true" />}
          {phone && (
            <button
              type="button"
              className="find-more"
              aria-expanded={open}
              aria-label="Options"
              onClick={() => setOpen(!open)}
            >
              <SlidersHorizontal size={16} aria-hidden />
            </button>
          )}
          {!phone && clearButton}
          {!phone && addToButton}
          {!phone && groupButton}
          {carryOn && (
            <Tip
              label={
                continuing
                  ? "It meets the end of a path of the same kind: the two become one path"
                  : "It is made a path of its own, joined to the other at the end they share"
              }
            >
              <button type="button" aria-pressed={separate} onClick={() => setSeparate(!separate)}>
                {separate ? "Make separate path ✓" : "Make separate path"}
              </button>
            </Tip>
          )}
          <Tip
            label="Make a path of what is proposed, in the current layer"
            keys={shortcutText("map.pathsMake")}
            {...(makeReason ? { note: makeReason } : {})}
          >
            <button
              type="button"
              className="primary"
              aria-disabled={makeReason !== null || undefined}
              onClick={() => makeReason === null && make()}
            >
              {makeLabel}
            </button>
          </Tip>
        </div>
      </div>
    </>
  );
}
