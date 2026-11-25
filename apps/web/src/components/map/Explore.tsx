/**
 * Explore along paths (docs/designs/stage-21-explore-points-of-interest.md): the bar over the map
 * with the kinds of points of interest and a day's travel, the pins, the band along the road or
 * river explored, the Explore tab with its lists and the tray of what will be sent, and the keys.
 */
import { makeView, type ViewState } from "@frontier/geo";
import {
  Anchor,
  Bridge,
  Check,
  ChevronLeft,
  Droplet,
  Fish,
  Flag,
  Footprints,
  List,
  type LucideIcon,
  MapPin,
  Merge,
  Milestone,
  Mountain,
  Sailboat,
  Signpost,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Split,
  Telescope,
  Tent,
  WifiOff,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Discovery } from "../../api.ts";
import { focusIsFree, shortcutText, useShortcut } from "../../keys.ts";
import {
  farText,
  FAMILIES,
  KINDS,
  nameText,
  type Spot,
  type SpotKind,
} from "../../map/spots/spots.ts";
import type { Explore } from "../../map/spots/useExplore.ts";
import { Tip } from "../ui/Tip.tsx";
// The bar is Find areas' bar, whose look loads with it only when that tool is first chosen.
import "./FindAreas.css";
import "./Explore.css";

export const SPOT_ICONS: Record<SpotKind, LucideIcon> = {
  crossroads: Signpost,
  junction: Milestone,
  bridge: Bridge,
  ford: Footprints,
  confluence: Merge,
  delta: Split,
  mouth: Sailboat,
  pass: Mountain,
  border: Flag,
  lake: Fish,
  harbour: Anchor,
  spring: Droplet,
  waystation: Tent,
  bend: Spline,
  here: MapPin,
};
const FAMILY_ICONS: Record<string, LucideIcon> = {
  roads: Signpost,
  crossings: Bridge,
  waters: Merge,
  heights: Mountain,
  stops: Tent,
  edges: Flag,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (usd: number) => (usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`);
/** Keeps the focus where it is when a control is pressed with the mouse, so the map's keys go on. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/** What the explore bar says. */
function statusOf(x: Explore, phone: boolean): string {
  if (!x.flat)
    return "Points of interest work on flat maps for now. Click any place to explore it.";
  const found = x.found;
  if (!found) return "Looking at the map…";
  const roads = found.lines.filter((l) => l.kind === "road").length;
  const rivers = found.lines.length - roads;
  if (found.lines.length === 0) {
    return "No roads or rivers on this map yet, so there is nothing to look along. Click any place to explore it.";
  }
  if (!x.prefs.overlay)
    return "Points of interest hidden. Roads, rivers and places can still be clicked.";
  if (x.shown.length === 0 && found.spots.length > 0) {
    return "Every kind is hidden. Roads, rivers and places can still be clicked.";
  }
  const n = x.shown.length;
  if (phone) return `${plural(n, "place")} worth a look · free`;
  const along = [roads ? plural(roads, "road") : "", rivers ? plural(rivers, "river") : ""]
    .filter(Boolean)
    .join(" and ");
  const from = x.hasHeights ? "the map's paths and heights" : "the map's paths";
  return `${plural(n, "place")} worth a look along ${along} · found from ${from}, nothing sent${
    x.km === null ? " · the map has no scale, so no day's travel" : ""
  }`;
}

/** The bar over the map while exploring: what is shown, the kinds, and a day's travel. */
export function ExploreBar({
  x,
  phone,
  onList,
}: {
  x: Explore;
  phone: boolean;
  onList: () => void;
}) {
  const [open, setOpen] = useState(false);
  const along = x.found?.lines.find((l) => l.id === x.along);
  const options = (
    <div className="find-options explore-options">
      <Tip label="Show or hide the points of interest" keys={shortcutText("map.spots")}>
        <button
          type="button"
          className="find-chip"
          aria-pressed={x.prefs.overlay}
          onClick={() => x.setPrefs({ overlay: !x.prefs.overlay })}
        >
          Points of interest
        </button>
      </Tip>
      <span className="explore-families" role="group" aria-label="Kinds">
        {FAMILIES.map((f) => {
          const Icon = FAMILY_ICONS[f.id]!;
          const on = !x.prefs.off.includes(f.id);
          return (
            <button
              key={f.id}
              type="button"
              className={`explore-family fam-${f.id}`}
              aria-pressed={on}
              disabled={!x.prefs.overlay}
              onClick={() =>
                x.setPrefs({
                  off: on ? [...x.prefs.off, f.id] : x.prefs.off.filter((o) => o !== f.id),
                })
              }
            >
              <Icon size={14} aria-hidden /> {f.name} <b>{x.counts[f.id]}</b>
            </button>
          );
        })}
      </span>
      <span className="explore-day">
        A day's travel
        <span className="find-mode" role="group" aria-label="A day's travel">
          {(["foot", "horse", "cart"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={x.prefs.day === d}
              onClick={() => x.setPrefs({ day: d })}
            >
              {d === "foot" ? "On foot" : d === "horse" ? "Horse" : "Cart"}
            </button>
          ))}
        </span>
      </span>
    </div>
  );
  return (
    <div
      className={`find-bar explore-bar${open ? " is-open" : ""}`}
      role="group"
      aria-label="Explore"
      data-spots={x.shown.length}
    >
      {(!phone || open) && options}
      <div className="find-main">
        <Telescope size={16} aria-hidden className="explore-mark" />
        <span className="find-status" role="status">
          {statusOf(x, phone)}
        </span>
        {!phone && (
          <span className="explore-hint">
            {along
              ? `Exploring along ${nameText(along)} · Esc to leave`
              : "Click a spot, a road or a river, or anywhere else"}
          </span>
        )}
        {phone && (
          <>
            <button
              type="button"
              className="find-more"
              aria-expanded={open}
              aria-label="Kinds"
              onClick={() => setOpen(!open)}
            >
              <SlidersHorizontal size={16} aria-hidden />
            </button>
            <button type="button" className="find-more" aria-label="List" onClick={onList}>
              <List size={16} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The points of interest on the map, as ghost pins; the places chosen as solid ones. */
export function SpotPins({
  x,
  view,
  size,
  onPick,
}: {
  x: Explore;
  view: ViewState;
  size: { width: number; height: number };
  onPick: (spot: Spot, add: boolean) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const v = makeView(view, size.width, size.height);
  const alongIds = new Set(x.alongSpots.map((s) => s.id));
  const here = x.chosen.filter((c) => c.kind === "here");
  const pins = [...x.shown, ...here]
    .map((spot) => ({ spot, at: v.project(spot.at) }))
    .filter(
      (p): p is { spot: Spot; at: [number, number] } =>
        !!p.at &&
        p.at[0] > -20 &&
        p.at[1] > -20 &&
        p.at[0] < size.width + 20 &&
        p.at[1] < size.height + 20,
    )
    // Best first, so where pins would cover each other on the screen the best-ranked shows (zoom
    // in, or use the list, for the rest); a pin chosen or at the cursor always shows.
    .sort(
      (a, b) =>
        Number(x.isChosen(b.spot) || x.cursor === b.spot.id) -
          Number(x.isChosen(a.spot) || x.cursor === a.spot.id) ||
        KINDS[a.spot.kind].rank - KINDS[b.spot.kind].rank,
    )
    .reduce<{ spot: Spot; at: [number, number] }[]>((kept, p) => {
      const covered = kept.some((q) => Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) < 22);
      if (!covered || x.isChosen(p.spot) || x.cursor === p.spot.id) kept.push(p);
      return kept;
    }, [])
    // In map order, top to bottom, so Tab goes across the map as it reads.
    .sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);
  const tipId = hover ?? x.cursor;
  const tip = pins.find((p) => p.spot.id === tipId);
  return (
    <>
      {pins.map(({ spot, at }) => {
        const Icon = SPOT_ICONS[spot.kind];
        const chosen = x.isChosen(spot);
        const dim = x.along !== null && !alongIds.has(spot.id) && spot.kind !== "here";
        return (
          <button
            key={spot.id}
            type="button"
            className={`spot-pin fam-${spot.family}${chosen ? " is-chosen" : ""}${
              x.cursor === spot.id ? " is-cursor" : ""
            }${dim ? " is-dim" : ""}`}
            style={{ left: at[0], top: at[1] }}
            aria-label={`${KINDS[spot.kind].label}: ${spot.title}`}
            aria-pressed={chosen}
            data-spot={spot.kind}
            onMouseDown={keepFocus}
            onPointerEnter={() => setHover(spot.id)}
            onPointerLeave={() => setHover((h) => (h === spot.id ? null : h))}
            onFocus={() => setHover(spot.id)}
            onBlur={() => setHover((h) => (h === spot.id ? null : h))}
            onClick={(e) => onPick(spot, e.shiftKey)}
          >
            <Icon size={15} aria-hidden />
            {spot.also.length > 0 && <span className="spot-count">{spot.also.length + 1}</span>}
          </button>
        );
      })}
      {tip && (
        <div
          className="spot-tip"
          style={{ left: tip.at[0], top: tip.at[1] + 20 }}
          role="tooltip"
          aria-hidden="true"
        >
          <b>
            {KINDS[tip.spot.kind].label} · {tip.spot.title}
          </b>
          <span>{tip.spot.why}</span>
          {tip.spot.also.map((a, i) => (
            <span key={i}>
              Also {KINDS[a.kind].label.toLowerCase()}: {a.why}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** The road or river explored along, as a soft band. */
export function AlongBand({
  x,
  view,
  size,
}: {
  x: Explore;
  view: ViewState;
  size: { width: number; height: number };
}) {
  const line = x.found?.lines.find((l) => l.id === x.along);
  if (!line) return null;
  const v = makeView(view, size.width, size.height);
  const points = line.line
    .map((p) => v.project(p))
    .filter((p): p is [number, number] => !!p)
    .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  return (
    <svg className="explore-band" width={size.width} height={size.height} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

/** The keys of exploring, while viewing. */
export function ExploreKeys({
  x,
  frame,
  canAsk,
  ask,
  cardOpen,
  closeCard,
  sheetOpen,
  closeSheet,
  onCursor,
}: {
  x: Explore;
  frame: { current: HTMLElement | null };
  canAsk: boolean;
  ask: () => void;
  cardOpen: boolean;
  closeCard: () => void;
  sheetOpen: boolean;
  closeSheet: () => void;
  onCursor: (spot: Spot) => void;
}) {
  const free = () => focusIsFree(document.activeElement, frame.current);
  useShortcut("map.spots", () => (free() ? x.setPrefs({ overlay: !x.prefs.overlay }) : false));
  const step = (by: 1 | -1) => () => {
    if (!free()) return false;
    const list = x.along ? x.alongSpots : x.shown;
    if (list.length === 0) return false;
    const at = list.findIndex((s) => s.id === x.cursor);
    const next =
      list[at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length]!;
    x.setCursor(next.id);
    // Along a path the cursor only moves; else the spot is the choice.
    if (!x.along) x.setChosen([next]);
    onCursor(next);
  };
  useShortcut("map.spotNext", step(1));
  useShortcut("map.spotPrevious", step(-1));
  useShortcut("map.spotToggle", () => {
    const spot = [...x.shown, ...x.chosen].find((s) => s.id === x.cursor);
    if (!free() || !spot) return false;
    x.toggle(spot);
  });
  useShortcut("map.spotAll", () => (free() && x.along ? x.chooseAll() : false));
  useShortcut("map.spotAsk", () => {
    if (!free() || x.chosen.length === 0 || !canAsk) return false;
    ask();
  });
  useShortcut("map.spotBack", () => {
    if (cardOpen) return closeCard();
    if (x.chosen.length > 0) return x.setChosen([]);
    if (x.along) return x.setAlong(null);
    if (sheetOpen) return closeSheet();
    return false;
  });
  return null;
}

/** Why Ask cannot be pressed now, or null. */
export function askReason(x: Explore, seeking: boolean): string | null {
  if (x.chosen.length === 0) return "Choose a place first";
  if (!x.online) {
    return "Asking needs a connection. The points of interest work offline; choose now and ask when you are back.";
  }
  if (seeking) return "Asking…";
  const e = x.estimate;
  if (e && e.capUsd > 0 && e.spentUsd + (e.usd ?? 0) > e.capUsd) {
    return `This would pass this month's cap: $${e.spentUsd.toFixed(2)} of $${e.capUsd.toFixed(2)} spent.`;
  }
  if (e && e.capUsd === 0) return "The monthly cap is $0. Raise it on the settings page.";
  return null;
}

/** The Explore tab: the roads and rivers, the spots, what was found, and the tray. */
export function ExplorePanel({
  x,
  discoveries,
  seeking,
  failed,
  onAsk,
  onOpenFound,
  entryTitle,
  onAlong,
  onSpot,
}: {
  x: Explore;
  discoveries: Discovery[];
  seeking: boolean;
  failed: string | null;
  onAsk: () => void;
  onOpenFound: (id: string) => void;
  /** The title of a feature's entry, or null when it has none. */
  entryTitle: (feature: string) => string | null;
  onAlong: (line: string) => void;
  onSpot: (spot: Spot) => void;
}) {
  const found = x.found;
  const along = found?.lines.find((l) => l.id === x.along) ?? null;
  const km = x.km;
  const kmOf = (units: number) => (km === null ? "" : farText(units, km));
  let body: ReactNode;
  if (!x.flat || !found) {
    body = <p className="muted">Click any place on the map to explore it.</p>;
  } else if (along) {
    const spots = x.alongSpots;
    const all = spots.length > 0 && spots.every(x.isChosen);
    body = (
      <>
        <button
          type="button"
          className="plain explore-back"
          onMouseDown={keepFocus}
          onClick={() => x.setAlong(null)}
        >
          <ChevronLeft size={15} aria-hidden /> All roads and rivers
        </button>
        <h2 className="explore-title">{nameText(along)}</h2>
        <p className="muted explore-sub">
          {along.kind === "road" ? "Road" : "River"}
          {km !== null ? ` · ${kmOf(along.length)}` : ""}
          {along.entry && entryTitle(along.id) ? ` · entry “${entryTitle(along.id)}”` : ""}
        </p>
        {spots.length > 0 ? (
          <p className="explore-all">
            <Tip
              label={all ? "Clear them" : "Choose every spot along it"}
              keys={shortcutText("map.spotAll")}
            >
              <button
                type="button"
                className="quiet"
                onMouseDown={keepFocus}
                onClick={() => x.chooseAll()}
              >
                {all ? "Clear all" : `Choose all ${spots.length}`}
              </button>
            </Tip>
            {km !== null && (
              <span className="muted">
                km from its {along.kind === "river" ? "source" : "start"}
              </span>
            )}
          </p>
        ) : (
          <p className="muted">
            Nothing along {nameText(along)} stands out. Click any place on it to ask what is there.
          </p>
        )}
        <ol className="explore-along" aria-label={`Along ${nameText(along)}`}>
          {x.alongItems.map((item, i) => (
            <li key={item.spot?.id ?? `m${i}`} className={item.spot ? "is-spot" : "is-milestone"}>
              <span className="explore-km">{km !== null ? kmOf(item.s) : ""}</span>
              {item.spot ? (
                <button
                  type="button"
                  className="explore-row"
                  aria-pressed={x.isChosen(item.spot)}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    x.toggle(item.spot!);
                    x.setCursor(item.spot!.id);
                  }}
                >
                  <span className="explore-check" aria-hidden="true">
                    {x.isChosen(item.spot) && <Check size={12} />}
                  </span>
                  <SpotIcon spot={item.spot} />
                  <span>
                    {item.spot.title}
                    <small>
                      {KINDS[item.spot.kind].label}
                      {item.spot.also.length > 0
                        ? ` · also ${item.spot.also.map((a) => KINDS[a.kind].label.toLowerCase()).join(", ")}`
                        : ""}
                    </small>
                  </span>
                </button>
              ) : (
                <span className="explore-row">
                  <span className="explore-dot" aria-hidden="true" />
                  <span>
                    {item.milestone!.name}
                    <small>{item.milestone!.note}</small>
                  </span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </>
    );
  } else if (found.lines.length === 0) {
    body = (
      <p className="muted">
        The points of interest come from paths in a style that counts as Road or River, and from the
        joins between them. Draw some with the Path tool, or with Find paths › Trace, while editing.
        A click anywhere on the map still explores that place.
      </p>
    );
  } else {
    const spotsOf = (id: string) => x.shown.filter((s) => s.paths.includes(id)).length;
    body = (
      <>
        <p className="muted explore-intro">
          Click a spot to ask about it, or explore along a road or river to choose several. The
          spots cost nothing; asking is one AI call.
        </p>
        <h3>Roads and rivers</h3>
        <ul className="explore-lines">
          {found.lines.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className="explore-row"
                onMouseDown={keepFocus}
                onClick={() => onAlong(l.id)}
              >
                <span className={`explore-swatch is-${l.kind}`} aria-hidden="true" />
                <span>
                  {nameText(l)}
                  <small>
                    {l.kind}
                    {km !== null ? ` · ${kmOf(l.length)}` : ""} · {plural(spotsOf(l.id), "spot")}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {FAMILIES.map((f) => {
          const list = x.shown.filter((s) => s.family === f.id);
          if (list.length === 0) return null;
          return (
            <section key={f.id}>
              <h3>
                {f.name} <span className="muted">{list.length}</span>
              </h3>
              <ul className="explore-spots">
                {list.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="explore-row"
                      aria-pressed={x.isChosen(s)}
                      onMouseDown={keepFocus}
                      onClick={() => onSpot(s)}
                    >
                      <SpotIcon spot={s} />
                      <span>
                        {s.title}
                        <small>{KINDS[s.kind].label}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </>
    );
  }
  return (
    <div className="explore-panel">
      <div className="explore-scroll">
        {body}
        {discoveries.length > 0 && (
          <section>
            <h3>
              Found, waiting <span className="muted">{discoveries.length}</span>
            </h3>
            <ul className="explore-spots">
              {discoveries.map((d) => (
                <li key={d.id}>
                  <button type="button" className="explore-row" onClick={() => onOpenFound(d.id)}>
                    <span className="explore-found" aria-hidden="true">
                      ?
                    </span>
                    <span>
                      {d.name}
                      <small>{[d.role ?? d.kind, d.spot?.title].filter(Boolean).join(" · ")}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <Tray x={x} seeking={seeking} failed={failed} onAsk={onAsk} entryTitle={entryTitle} />
    </div>
  );
}

function SpotIcon({ spot }: { spot: Spot }) {
  const Icon = SPOT_ICONS[spot.kind];
  return (
    <span className={`explore-icon fam-${spot.family}`} aria-hidden="true">
      <Icon size={13} />
    </span>
  );
}

/** The places chosen, what Frontier sends about them, the cost, and Ask. */
function Tray({
  x,
  seeking,
  failed,
  onAsk,
  entryTitle,
}: {
  x: Explore;
  seeking: boolean;
  failed: string | null;
  onAsk: () => void;
  entryTitle: (feature: string) => string | null;
}) {
  if (x.chosen.length === 0) {
    return (
      <div className="explore-tray is-empty">
        <p className="muted">Nothing chosen yet. Click a spot, a road or a river, or any place.</p>
      </div>
    );
  }
  const reason = askReason(x, seeking);
  const e = x.estimate;
  const n = x.chosen.length;
  const calls = Math.ceil(n / 6);
  const entries = new Set<string>();
  for (const a of x.asks)
    for (const f of a.features) {
      const t = entryTitle(f);
      if (t) entries.add(t);
    }
  return (
    <div className="explore-tray" aria-label="Chosen places">
      <p className="explore-tray-head">
        <b>{plural(n, "place")}</b> <span className="muted">chosen</span>
        <button
          type="button"
          className="plain"
          onMouseDown={keepFocus}
          onClick={() => x.setChosen([])}
        >
          Clear
        </button>
      </p>
      <ul className="explore-chips">
        {x.chosen.map((c) => (
          <li key={c.id}>
            <SpotIcon spot={c} />
            <span>{c.kind === "here" ? `This place: ${c.why}` : c.title}</span>
            <button
              type="button"
              className="plain"
              aria-label={`Take out ${c.title}`}
              onMouseDown={keepFocus}
              onClick={() => x.toggle(c)}
            >
              <X size={13} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <details className="explore-sends">
        <summary>What Frontier sends</summary>
        {x.asks.map((a, i) => (
          <div key={a.spot.id} className="explore-send">
            <b>
              {i + 1}. {a.kind === "here" ? "This place" : a.title}
            </b>
            {a.lines.map((l, j) => (
              <p key={j}>{l}</p>
            ))}
          </div>
        ))}
        <p className="muted">
          Entries (may be quoted): {entries.size > 0 ? [...entries].join(", ") : "none on the way"},
          with those nearest each place and what they link to, twelve at most.
        </p>
        <p className="muted">Names on the map near each place go too; they are never quoted.</p>
      </details>
      {failed && !seeking && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
      <div className="explore-ask">
        <Tip
          label={n === 1 ? "Ask the AI what is there" : `Ask the AI about ${n} places`}
          keys={shortcutText("map.spotAsk")}
          {...(reason ? { note: reason } : {})}
        >
          <button
            type="button"
            className="primary"
            aria-disabled={reason !== null || undefined}
            onClick={() => reason === null && onAsk()}
          >
            {x.online ? <Sparkles size={15} aria-hidden /> : <WifiOff size={15} aria-hidden />}
            {seeking ? "Asking…" : n === 1 ? "Ask what is there" : `Ask about ${n} places`}
          </button>
        </Tip>
        <p className="explore-cost" aria-live="polite">
          {!x.online
            ? "Asking needs a connection. The points of interest work offline; choose now and ask when you are back."
            : e
              ? `${e.calls === 1 ? "One call" : `${e.calls} calls`} · ${
                  e.usd === null
                    ? "the cost is not known for this model"
                    : `about ${money(e.usd)}`.replace("about under", "under")
                } · $${e.spentUsd.toFixed(2)} of $${e.capUsd.toFixed(2)} spent this month`
              : `${calls === 1 ? "One call" : `${calls} calls`} · working out the cost…`}
        </p>
        {reason && x.online && reason !== "Asking…" && <p className="explore-why">{reason}</p>}
      </div>
    </div>
  );
}
