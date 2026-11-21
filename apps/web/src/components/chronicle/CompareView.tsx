import { type CSSProperties, type FormEvent, useState } from "react";
import type { ChronicleCase, ChronicleFile } from "@frontier/schema";
import { type Range, SHIPPED_CASES } from "@frontier/time";
import { type Change, type Worked, laneOf, newId, spanName, typed, years } from "./model.ts";

interface Props {
  chronicle: ChronicleFile;
  worked: Worked;
  change: Change;
  onSelect: (id: string) => void;
}

const MOST = 4;

function Bar({ range, max, color }: { range: Range; max: number; color: string }) {
  const low = max > 0 ? (range.lo / max) * 100 : 0;
  const high = max > 0 ? (range.hi / max) * 100 : 0;
  return (
    <div className="ch-ruler" aria-hidden="true">
      <i style={{ width: `${low}%`, "--lane": color } as CSSProperties} />
      <i
        className="is-fade"
        style={{ left: `${low}%`, width: `${high - low}%`, "--lane": color } as CSSProperties}
      />
    </div>
  );
}

/** A few spans and real-world cases as bars from a common start, on one straight scale. */
export function CompareView({ chronicle, worked, change, onSelect }: Props) {
  const [adding, setAdding] = useState(false);
  const [own, setOwn] = useState({ name: "", low: "", high: "", from: "", to: "", source: "" });
  const { compare } = chronicle;

  const lengthOf = (id: string): Range | null => {
    const length = worked.points.get(id)?.length ?? null;
    return length && Number.isFinite(length.hi) ? length : null;
  };
  const shown = compare.spans
    .map((id) => chronicle.spans.find((s) => s.id === id))
    .filter((s) => s !== undefined);
  const canAdd = chronicle.spans.filter(
    (s) => !s.point && lengthOf(s.id) && !compare.spans.includes(s.id),
  );
  const shipped = SHIPPED_CASES.filter((k) => !compare.cases.some((c) => c.shipped === k.id));
  const max = Math.max(
    0,
    ...shown.map((s) => lengthOf(s.id)?.hi ?? 0),
    ...compare.cases.map((c) => c.high),
  );

  const set = (next: Partial<ChronicleFile["compare"]>) =>
    change((c) => ({ ...c, compare: { ...c.compare, ...next } }));
  const addCase = (k: ChronicleCase) => set({ cases: [...compare.cases, k] });

  function addOwn(e: FormEvent) {
    e.preventDefault();
    const low = typed(own.low);
    const high = typed(own.high) ?? low;
    if (!own.name.trim() || low === null || high === null || low < 0 || high < low) return;
    addCase({
      id: newId(),
      name: own.name.trim(),
      low,
      high,
      from: own.from.trim(),
      to: own.to.trim(),
      source: own.source.trim(),
      caveat: "",
    });
    setOwn({ name: "", low: "", high: "", from: "", to: "", source: "" });
    setAdding(false);
  }

  return (
    <div className="ch-compare">
      <p className="ch-note muted">
        Lengths side by side, from a common start. Each bar is solid up to its lowest value and
        fades to its highest. Cases are in Earth years and about humans; an Ezob year of about 360
        days is close enough at this precision. Cases are rulers only: they never flag anything.
      </p>

      {shown.length + compare.cases.length === 0 && (
        <p className="empty">Nothing laid out yet. Pick a span that has a length, and a case.</p>
      )}

      <ul className="ch-bars">
        {shown.map((s) => {
          const range = lengthOf(s.id);
          return (
            <li key={s.id}>
              <p className="ch-bar-head">
                <button type="button" className="plain" onClick={() => onSelect(s.id)}>
                  {spanName(s)}
                </button>
                <span>{range ? years(range) : "no length yet"}</span>
              </p>
              {range && <Bar range={range} max={max} color={laneOf(chronicle, s).color} />}
              <p className="ch-bar-foot muted">
                {s.length?.words ? `“${s.length.words}” · ` : ""}
                <button
                  type="button"
                  className="plain"
                  onClick={() => set({ spans: compare.spans.filter((id) => id !== s.id) })}
                >
                  Take away
                </button>
              </p>
            </li>
          );
        })}
        {compare.cases.map((k) => (
          <li key={k.id} className="ch-case">
            <p className="ch-bar-head">
              <strong>{k.name}</strong>
              <span>{years({ lo: k.low, hi: k.high })}</span>
            </p>
            <Bar range={{ lo: k.low, hi: k.high }} max={max} color="var(--ink-soft)" />
            <p className="ch-bar-foot muted">
              {k.from && <>Counted from {k.from}</>}
              {k.to && <> to {k.to}. </>}
              {k.source && <>Source: {k.source}. </>}
              {k.caveat && <>{k.caveat} </>}
              {!k.shipped && <>Your own case. </>}
              <button
                type="button"
                className="plain"
                onClick={() => set({ cases: compare.cases.filter((c) => c.id !== k.id) })}
              >
                Take away
              </button>
            </p>
          </li>
        ))}
      </ul>

      <div className="ch-compare-add">
        {shown.length < MOST && canAdd.length > 0 && (
          <label>
            <span>Add a span</span>
            <select
              value=""
              onChange={(e) => e.target.value && set({ spans: [...compare.spans, e.target.value] })}
            >
              <option value="">Choose…</option>
              {canAdd.map((s) => (
                <option key={s.id} value={s.id}>
                  {spanName(s)}
                </option>
              ))}
            </select>
          </label>
        )}
        {shown.length < MOST && canAdd.length === 0 && shown.length === 0 && (
          <p className="muted">No span has a length yet. Give one a length in its form.</p>
        )}
        {compare.cases.length < MOST && shipped.length > 0 && (
          <label>
            <span>Add a real-world case</span>
            <select
              value=""
              onChange={(e) => {
                const k = shipped.find((c) => c.id === e.target.value);
                if (k) {
                  addCase({
                    id: newId(),
                    name: k.name,
                    low: k.low,
                    high: k.high,
                    from: k.from,
                    to: k.to,
                    source: k.source,
                    caveat: k.caveat,
                    shipped: k.id,
                  });
                }
              }}
            >
              <option value="">Choose…</option>
              {shipped.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {compare.cases.length < MOST && !adding && (
          <button type="button" className="quiet" onClick={() => setAdding(true)}>
            Add a case of your own
          </button>
        )}
      </div>

      {adding && (
        <form className="ch-own-case" onSubmit={addOwn}>
          <label className="ch-field">
            <span>Name</span>
            <input
              type="text"
              value={own.name}
              onChange={(e) => setOwn({ ...own, name: e.target.value })}
            />
          </label>
          <div className="ch-pair">
            <label className="ch-field">
              <span>Lowest, years</span>
              <input
                type="text"
                inputMode="decimal"
                value={own.low}
                onChange={(e) => setOwn({ ...own, low: e.target.value })}
              />
            </label>
            <label className="ch-field">
              <span>Highest, years</span>
              <input
                type="text"
                inputMode="decimal"
                value={own.high}
                onChange={(e) => setOwn({ ...own, high: e.target.value })}
              />
            </label>
          </div>
          <label className="ch-field">
            <span>Counted from</span>
            <input
              type="text"
              value={own.from}
              onChange={(e) => setOwn({ ...own, from: e.target.value })}
            />
          </label>
          <label className="ch-field">
            <span>Counted to</span>
            <input
              type="text"
              value={own.to}
              onChange={(e) => setOwn({ ...own, to: e.target.value })}
            />
          </label>
          <label className="ch-field">
            <span>Source</span>
            <input
              type="text"
              value={own.source}
              onChange={(e) => setOwn({ ...own, source: e.target.value })}
            />
          </label>
          <p className="change-actions">
            <button type="submit" className="primary">
              Add the case
            </button>
            <button type="button" className="quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
