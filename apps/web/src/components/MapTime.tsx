import type { ChronicleSpan, MapFeature } from "@frontier/schema";
import { useState } from "react";
import { Link } from "react-router-dom";
import { chronicleUrl } from "../api.ts";
import { type MapTime, changeYears, shapeStart, spanFor } from "../map/time.ts";
import { useDialogs } from "./Dialogs.tsx";

export interface ChronicleChoice {
  id: string;
  title: string;
  main: boolean;
}

/** The row under a map that moves it through the years of a chronicle. */
export function TimeBar(p: {
  chronicles: readonly ChronicleChoice[];
  chosen: string;
  onChoose: (id: string) => void;
  time: MapTime | null;
  year: number;
  onYear: (year: number) => void;
  /** The years at which something on this map changes. */
  stops: ReturnType<typeof changeYears>;
  editing: boolean;
  showAll: boolean;
  onShowAll: (on: boolean) => void;
  onClose: () => void;
}) {
  const range = p.time?.range ?? null;
  const earlier = [...p.stops].reverse().find((y) => y < p.year);
  const later = p.stops.find((y) => y > p.year);
  const noMain = !p.chronicles.some((c) => c.main);

  return (
    <div className="time-bar" role="group" aria-label="Time">
      <div className="time-row">
        <select
          aria-label="Chronicle"
          value={p.chosen}
          onChange={(e) => p.onChoose(e.target.value)}
        >
          {p.chronicles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.main ? " (main)" : ""}
            </option>
          ))}
        </select>
        {range && (
          <label className="time-year">
            <span>Year</span>
            <input
              type="number"
              aria-label="Year"
              value={p.year}
              min={range.from}
              max={range.to}
              step={1}
              onChange={(e) => e.target.value !== "" && p.onYear(Number(e.target.value))}
            />
          </label>
        )}
        <button type="button" className="quiet" onClick={p.onClose}>
          Time off
        </button>
      </div>
      {!p.time && <p className="muted">Reading the chronicle…</p>}
      {p.time && !range && (
        <p className="muted">Nothing in this chronicle is placed in years yet.</p>
      )}
      {range && (
        <div className="time-row">
          <button
            type="button"
            className="quiet"
            aria-label="Earlier: to the change before"
            disabled={earlier === undefined}
            onClick={() => earlier !== undefined && p.onYear(earlier)}
          >
            ◂ Earlier
          </button>
          <input
            className="time-range"
            type="range"
            aria-label="Year, by sweeping"
            min={range.from}
            max={range.to}
            step={range.step}
            value={p.year}
            onChange={(e) => p.onYear(Number(e.target.value))}
          />
          <button
            type="button"
            className="quiet"
            aria-label="Later: to the next change"
            disabled={later === undefined}
            onClick={() => later !== undefined && p.onYear(later)}
          >
            Later ▸
          </button>
        </div>
      )}
      <p className="time-key muted">
        <i className="key-there" /> there <i className="key-perhaps" /> perhaps{" "}
        <i className="key-undated" /> undated
        {p.editing && (
          <label>
            <input
              type="checkbox"
              checked={p.showAll}
              onChange={(e) => p.onShowAll(e.target.checked)}
            />{" "}
            Show everything
          </label>
        )}
        {noMain && <span> No chronicle is marked as the main one.</span>}
      </p>
    </div>
  );
}

/** The part of the feature editor that says when the feature exists and lists its shapes. */
export function FeatureTime(p: {
  feature: MapFeature;
  time: MapTime;
  /** The id of the later shape on screen, or null for the first shape. */
  onScreen: string | null;
  /** The shape pinned for editing: a later shape's id, null for the first shape, undefined for none. */
  pinned: string | null | undefined;
  nameOf: (span: ChronicleSpan) => string;
  onTie: (span: string | null) => void;
  onPin: (shape: string | null) => void;
  onAddShape: (from: string) => void;
  onRemoveShape: (id: string) => void;
}) {
  const dialogs = useDialogs();
  const { feature, time } = p;
  const found = spanFor(feature, time);
  const chronicle = time.chronicle;
  const spanLink = (span: ChronicleSpan) => (
    <Link to={`${chronicleUrl(chronicle.id)}?span=${encodeURIComponent(span.id)}`}>
      {p.nameOf(span)}
    </Link>
  );
  const shapes = feature.shapes ?? [];
  const started = new Set(shapes.map((h) => h.from));
  // A later shape needs a span with a start that is a number, and one it does not start from yet.
  const canStart = chronicle.spans.filter((s) => {
    const start = time.points.get(s.id)?.start;
    return start && Number.isFinite(start.lo) && !started.has(s.id);
  });
  const byLane = (spans: readonly ChronicleSpan[]) =>
    chronicle.lanes
      .map((lane) => ({ lane, spans: spans.filter((s) => s.lane === lane.id) }))
      .filter((g) => g.spans.length > 0);

  async function tie(span: string) {
    if (found.how === "tie_missing") {
      const ok = await dialogs.confirm({
        title: "Replace the tie?",
        body: `This is tied to a span that is not in "${chronicle.title}". The tie was made through another chronicle, and this replaces it.`,
        action: "Replace the tie",
      });
      if (!ok) return;
    }
    p.onTie(span);
  }

  const editingName =
    p.pinned === undefined
      ? null
      : p.pinned === null
        ? "the first shape"
        : `the shape from ${p.nameOf(time.spans.get(shapes.find((h) => h.id === p.pinned)?.from ?? "") ?? ({ name: "a span" } as ChronicleSpan))}`;

  return (
    <section className="feature-time" aria-label="Time">
      <h3>Time</h3>
      <p>
        {found.how === "tied" && <>Tied to {spanLink(found.span)}. </>}
        {found.how === "tie_missing" && <>Tied to a span that is not in “{chronicle.title}”. </>}
        {found.how === "entry" && <>Follows {spanLink(found.span)}, the span of its entry. </>}
        {found.how === "no_span" && (
          <>
            Its entry has no span in <Link to={chronicleUrl(chronicle.id)}>{chronicle.title}</Link>
            .{" "}
          </>
        )}
        {found.how === "timeless" && <>Timeless: nothing says when this exists. </>}
        {feature.span != null && feature.entry && found.how === "tied" && (
          <>The tie wins over its entry's span. </>
        )}
        {feature.span != null && (
          <button type="button" className="plain danger" onClick={() => p.onTie(null)}>
            Untie
          </button>
        )}
      </p>
      <label className="field">
        <span>Tie to a span</span>
        <select
          aria-label="Tie to a span"
          value=""
          onChange={(e) => e.target.value && void tie(e.target.value)}
        >
          <option value="">Choose a span…</option>
          {byLane(chronicle.spans).map((g) => (
            <optgroup key={g.lane.id} label={g.lane.name}>
              {g.spans.map((s) => (
                <option key={s.id} value={s.id}>
                  {p.nameOf(s)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <h3>Shapes</h3>
      {editingName && (
        <p className="shape-editing" role="status">
          Editing {editingName}.
        </p>
      )}
      <ul className="shape-list">
        <li>
          <button
            type="button"
            className="plain"
            aria-pressed={p.pinned === null}
            onClick={() => p.onPin(null)}
          >
            First shape
          </button>
          {p.onScreen === null && <span className="muted"> on screen</span>}
        </li>
        {shapes.map((h) => {
          const at = shapeStart(feature, h, time);
          const span = time.spans.get(h.from);
          return (
            <li key={h.id}>
              {typeof at === "number" ? (
                <button
                  type="button"
                  className="plain"
                  aria-pressed={p.pinned === h.id}
                  onClick={() => p.onPin(h.id)}
                >
                  From {span ? p.nameOf(span) : "a span"}, year {Math.round(at)}
                </button>
              ) : (
                <span className="muted">
                  {at === "broken"
                    ? "A broken shape"
                    : `From ${span ? p.nameOf(span) : "a span of another chronicle"}: not placed in time`}
                </span>
              )}
              {p.onScreen === h.id && <span className="muted"> on screen</span>}{" "}
              <button
                type="button"
                className="plain danger"
                aria-label="Remove this shape"
                onClick={() => p.onRemoveShape(h.id)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {canStart.length > 0 && (
        <label className="field">
          <span>Add a shape from…</span>
          <select
            aria-label="Add a shape from"
            value=""
            onChange={(e) => e.target.value && p.onAddShape(e.target.value)}
          >
            <option value="">Choose a span…</option>
            {byLane(canStart).map((g) => (
              <optgroup key={g.lane.id} label={g.lane.name}>
                {g.spans.map((s) => (
                  <option key={s.id} value={s.id}>
                    {p.nameOf(s)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}

/** How a marker on a flat map revolves around another as the years move. */
export function OrbitEditor(p: {
  feature: MapFeature;
  markers: readonly { id: string; title: string }[];
  onChange: (orbit: { around: string; period: number } | null) => void;
}) {
  const orbit = p.feature.orbit ?? null;
  const [period, setPeriod] = useState(String(orbit?.period ?? 1000));
  const others = p.markers.filter((m) => m.id !== p.feature.id);
  if (p.feature.kind !== "marker" || others.length === 0) return null;
  const years = Number(period);
  return (
    <section className="feature-time" aria-label="Revolving">
      <h3>Revolves</h3>
      <label className="field">
        <span>Revolves around</span>
        <select
          aria-label="Revolves around"
          value={orbit?.around ?? ""}
          onChange={(e) =>
            p.onChange(
              e.target.value ? { around: e.target.value, period: years > 0 ? years : 1000 } : null,
            )
          }
        >
          <option value="">Nothing: it stays where it is</option>
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title || "Unnamed marker"}
            </option>
          ))}
        </select>
      </label>
      {orbit && (
        <label className="field">
          <span>Once every … years</span>
          <input
            type="number"
            inputMode="decimal"
            aria-label="Years for one turn"
            min={1}
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              const n = Number(e.target.value);
              if (n > 0) p.onChange({ around: orbit.around, period: n });
            }}
          />
        </label>
      )}
      {orbit && <p className="muted">It turns while the map is seen in time.</p>}
    </section>
  );
}
