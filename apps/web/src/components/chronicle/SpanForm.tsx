import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { entryUrl } from "../../api.ts";
import { EntryPicker } from "../MapPanels.tsx";
import type { ChronicleFile, ChronicleSpan, Rough } from "@frontier/schema";
import {
  type Range,
  KINDS,
  countOfUnit,
  offerMove,
  sentenceFor,
  staleLength,
  statementOf,
} from "@frontier/time";
import {
  type Change,
  type Worked,
  KIND_WORDS,
  applyOffer,
  countFrom,
  laneOf,
  newId,
  num,
  rough,
  spanName,
  typed,
  withSpan,
  withoutSpan,
  yearAt,
  years,
} from "./model.ts";

interface Props {
  chronicle: ChronicleFile;
  worked: Worked;
  span: ChronicleSpan;
  change: Change;
  onSelect: (id: string | null) => void;
  /** The entry this span stands for: linked, being linked, gone, or none. */
  entry: SpanEntry;
  /** True when an earlier span of this chronicle is linked to the same entry. */
  second: boolean;
  onLink: (path: string, title: string) => void;
  onUnlink: () => void;
}

export type SpanEntry =
  | { state: "none" }
  | { state: "gone" }
  | { state: "linked" | "pending"; path: string; title: string };

/** "generations" for more than one "generation". A name that ends in s is left alone. */
const many = (name: string, count: number): string =>
  count === 1 || /s$/i.test(name) ? name : `${name}s`;

const show = (n: number | undefined): string => (n === undefined ? "" : String(n));

/** Two numbers, lowest and highest. Tells its owner each time both read as a valid range. */
function RangeFields(p: {
  id: string;
  low: number | undefined;
  high: number | undefined;
  least?: number;
  unit: string;
  onRange: (low: number, high: number) => void;
}) {
  // An empty "highest" means the same as the lowest.
  const [low, setLow] = useState(show(p.low));
  const [high, setHigh] = useState(p.high === p.low ? "" : show(p.high));
  // What is stored wins when it changes from outside, as after an undo: if the two fields
  // together no longer mean what is stored, both are written afresh.
  useEffect(() => {
    const a = typed(low);
    const b = typed(high) ?? a;
    if (a === (p.low ?? null) && b === (p.high ?? null)) return;
    setLow(show(p.low));
    setHigh(p.high === p.low ? "" : show(p.high));
  }, [p.low, p.high]);

  const tell = (l: string, h: string) => {
    const a = typed(l);
    const b = typed(h) ?? a;
    if (a === null || b === null || b < a) return;
    if (p.least !== undefined && a < p.least) return;
    if (a !== p.low || b !== p.high) p.onRange(a, b);
  };
  const bad = (() => {
    const a = typed(low);
    const b = typed(high);
    return a !== null && b !== null && b < a;
  })();

  return (
    <div className="ch-range">
      <input
        id={p.id}
        type="text"
        inputMode="decimal"
        aria-label="Lowest"
        placeholder="lowest"
        value={low}
        onChange={(e) => {
          setLow(e.target.value);
          tell(e.target.value, high);
        }}
      />
      <span>to</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label="Highest"
        placeholder="highest"
        value={high}
        onChange={(e) => {
          setHigh(e.target.value);
          tell(low, e.target.value);
        }}
      />
      <span>{p.unit}</span>
      {bad && <em className="error">The highest is below the lowest.</em>}
    </div>
  );
}

const TONE: Record<string, string> = {
  holds: "holds",
  does_not_fit: "does not fit",
  may_not_fit: "may not fit",
  cannot_tell: "cannot tell yet",
  contradicts: "in a circle",
  broken: "broken",
  not_checked: "not checked",
};

/** The form for one span: its name, lane, numbers, note and statements. */
export function SpanForm(props: Props) {
  const { chronicle, worked, span, change, onSelect, entry } = props;
  const points = worked.points.get(span.id);
  const lane = laneOf(chronicle, span);
  const origin = chronicle.origin;
  const others = chronicle.spans.filter((s) => s.id !== span.id);
  const [kind, setKind] = useState("after");
  const [other, setOther] = useState("");
  const [relProblem, setRelProblem] = useState<string | null>(null);
  const [rel, setRel] = useState({ low: "", high: "", dir: "after", part: "end", ref: "" });

  const edit = (fn: (s: ChronicleSpan) => ChronicleSpan, tag?: string) =>
    change((c) => withSpan(c, span.id, fn), tag && `${tag}:${span.id}`);

  /** Writes a start or an end. The first start ever given makes its span the one counted from. */
  const place = (part: "start" | "end", value: Rough | "open" | null) =>
    change((c) => ({
      ...withSpan(c, span.id, (s) => ({ ...s, [part]: value })),
      origin: c.origin ?? (part === "start" && value && value !== "open" ? span.id : null),
    }));

  const endField = (part: "start" | "end") => {
    const value = span[part];
    const mode = value === null ? "none" : value === "open" ? "open" : "years";
    const label = part === "start" ? "Start" : "End";
    return (
      <div className="ch-field">
        <label htmlFor={`ch-${part}-mode`}>{label}</label>
        <select
          id={`ch-${part}-mode`}
          value={mode}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "none") place(part, null);
            else if (next === "open") place(part, "open");
            else place(part, rough(0, 0));
          }}
        >
          <option value="none">Not given</option>
          <option value="years" disabled={origin === null && part === "end"}>
            {origin === null ? "Count years from here (year 0)" : "A year, counted from year 0"}
          </option>
          <option value="open">
            {part === "start" ? "Open: older than shown" : "Open: still going on"}
          </option>
        </select>
        {value !== null && value !== "open" && (
          <>
            <RangeFields
              id={`ch-${part}`}
              low={value.low}
              high={value.high}
              unit="(year)"
              onRange={(low, high) => place(part, rough(low, high))}
            />
            {value.words && <p className="muted ch-words">“{value.words}”</p>}
          </>
        )}
      </div>
    );
  };

  const setLength = (unitId: string, low: number, high: number) => {
    const unit = chronicle.units.find((u) => u.id === unitId);
    edit((s) => {
      if (!unit) return { ...s, length: { words: "", low, high, clock: lane.clock } };
      const range = countOfUnit([low, high], unit);
      return {
        ...s,
        length: {
          words: `${low === high ? num(low) : `${num(low)} to ${num(high)}`} ${many(unit.name, high)}`,
          low: range.lo,
          high: range.hi,
          clock: lane.clock,
          unit: unit.id,
          count: [low, high],
        },
      };
    });
  };

  // A length written in a unit that is gone, or without its count, is read as plain years.
  const countedIn =
    span.length?.count !== undefined
      ? chronicle.units.find((u) => u.id === span.length?.unit)
      : undefined;
  const lengthUnit = countedIn?.id ?? "";
  const stale = span.length ? staleLength(span.length, chronicle.units) : null;
  const open = span.start === "open" || span.end === "open";

  const mine = worked.checks.filter((c) => c.relation.a === span.id || c.relation.b === span.id);
  const unplaced = !points?.start && !points?.end;
  const offers = unplaced
    ? mine
        .map((c) => ({
          check: c,
          offer: offerMove(c.relation, c.relation.a === span.id ? "a" : "b", chronicle.spans),
        }))
        .filter((o) => o.offer !== null)
    : [];

  const addRelation = () => {
    if (!other) return;
    change((c) => ({
      ...c,
      relations: [...c.relations, { id: newId(), a: span.id, kind, b: other }],
    }));
    setOther("");
  };

  const refPoint = (): Range | null => {
    const at = worked.points.get(rel.ref)?.[rel.part === "start" ? "start" : "end"] ?? null;
    return at && Number.isFinite(at.lo) && Number.isFinite(at.hi) ? at : null;
  };
  const setRelative = (part: "start" | "end") => {
    const at = refPoint();
    const low = typed(rel.low);
    const high = typed(rel.high) ?? low;
    const ref = chronicle.spans.find((s) => s.id === rel.ref);
    if (!at || low === null || high === null || high < low || low < 0 || !ref) {
      setRelProblem(
        "Give a number of years, lowest first, and choose a span that has a number there.",
      );
      return;
    }
    setRelProblem(null);
    const range =
      rel.dir === "after"
        ? { lo: at.lo + low, hi: at.hi + high }
        : { lo: at.lo - high, hi: at.hi - low };
    const amount = low === high ? num(low) : `${num(low)} to ${num(high)}`;
    place(
      part,
      rough(range.lo, range.hi, `${amount} years ${rel.dir} the ${rel.part} of ${spanName(ref)}`),
    );
  };
  const placedOthers = others.filter((s) => {
    const p = worked.points.get(s.id);
    return p?.start || p?.end;
  });

  return (
    <div className="ch-form">
      <label className="ch-field">
        <span>Name</span>
        <input
          type="text"
          value={span.name}
          onChange={(e) => edit((s) => ({ ...s, name: e.target.value }), "name")}
        />
      </label>
      <div className="ch-row">
        <label className="ch-field">
          <span>Lane</span>
          <select value={span.lane} onChange={(e) => edit((s) => ({ ...s, lane: e.target.value }))}>
            {chronicle.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ch-check">
          <input
            type="checkbox"
            checked={span.point}
            onChange={(e) =>
              edit((s) =>
                e.target.checked
                  ? { ...s, point: true, end: null, length: null }
                  : { ...s, point: false },
              )
            }
          />
          <span>This is a single moment</span>
        </label>
      </div>

      <section className="ch-relations">
        <h3>How it relates</h3>
        {mine.length === 0 && <p className="muted">Nothing stated yet.</p>}
        <ul>
          {mine.map((c) => (
            <li key={c.relation.id} className={`ch-flag is-${c.state}`}>
              <p>
                {statementOf(c.relation, chronicle.spans)}{" "}
                <span className="ch-state">{TONE[c.state]}</span>
              </p>
              {c.state !== "holds" && c.state !== "contradicts" && (
                <p className="muted">{sentenceFor(c, chronicle)}</p>
              )}
              <button
                type="button"
                className="plain danger"
                onClick={() =>
                  change((ch) => ({
                    ...ch,
                    relations: ch.relations.filter((r) => r.id !== c.relation.id),
                  }))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {offers.slice(0, 1).map(({ check, offer }) => (
          <p key={check.relation.id} className="ch-offer">
            From “{statementOf(check.relation, chronicle.spans)}”:{" "}
            {offer!.start && <>start at {yearAt(offer!.start)}</>}
            {offer!.start && offer!.end && <>, </>}
            {offer!.end && <>end at {yearAt(offer!.end)}</>}.{" "}
            <button
              type="button"
              className="quiet"
              onClick={() => edit((s) => applyOffer(s, offer!))}
            >
              Place it there
            </button>
          </p>
        ))}
        {others.length > 0 && (
          <div className="ch-add-relation">
            <span className="ch-this">{spanName(span)}</span>
            <select
              aria-label="How it relates"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_WORDS[k]}
                </option>
              ))}
            </select>
            <select
              aria-label="The other span"
              value={other}
              onChange={(e) => setOther(e.target.value)}
            >
              <option value="">Choose a span…</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {spanName(s)}
                </option>
              ))}
            </select>
            <button type="button" className="primary" disabled={!other} onClick={addRelation}>
              Add
            </button>
          </div>
        )}
      </section>

      {!span.point && (
        <div className="ch-field">
          <label htmlFor="ch-length-unit">Length</label>
          <select
            id="ch-length-unit"
            value={span.length ? lengthUnit : "none"}
            disabled={open}
            onChange={(e) => {
              const next = e.target.value;
              if (next === "none") edit((s) => ({ ...s, length: null }));
              else if (next === "") {
                setLength("", span.length?.low ?? 0, span.length?.high ?? 0);
              } else setLength(next, 1, 1);
            }}
          >
            <option value="none">Not given</option>
            <option value="">In years</option>
            {chronicle.units.map((u) => (
              <option key={u.id} value={u.id}>
                In {u.name} ({num(u.low)} to {num(u.high)} years)
              </option>
            ))}
          </select>
          {open && (
            <p className="muted ch-words">A span with an open start or end has no length.</p>
          )}
          {span.length && !open && (
            <>
              <RangeFields
                key={lengthUnit}
                id="ch-length"
                low={countedIn ? span.length.count?.[0] : span.length.low}
                high={countedIn ? span.length.count?.[1] : span.length.high}
                least={0}
                unit={many(chronicle.units.find((u) => u.id === lengthUnit)?.name ?? "year", 2)}
                onRange={(low, high) => setLength(lengthUnit, low, high)}
              />
              {lengthUnit && (
                <p className="muted ch-words">
                  = {years({ lo: span.length.low, hi: span.length.high })}
                </p>
              )}
              {stale && (
                <p className="ch-stale">
                  Written with {stale.unit.name} as {num(stale.writtenWith.lo)} to{" "}
                  {num(stale.writtenWith.hi)}; now {num(stale.now.lo)} to {num(stale.now.hi)}.{" "}
                  <button
                    type="button"
                    className="quiet"
                    onClick={() =>
                      setLength(lengthUnit, span.length!.count![0], span.length!.count![1])
                    }
                  >
                    Recalculate
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {endField("start")}
      {!span.point && endField("end")}

      {origin !== null && placedOthers.length > 0 && (
        <details className="ch-relative">
          <summary>Work a start or end out from another span</summary>
          <div className="ch-range">
            <input
              type="text"
              inputMode="decimal"
              aria-label="Lowest number of years"
              placeholder="lowest"
              value={rel.low}
              onChange={(e) => setRel({ ...rel, low: e.target.value })}
            />
            <span>to</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Highest number of years"
              placeholder="highest"
              value={rel.high}
              onChange={(e) => setRel({ ...rel, high: e.target.value })}
            />
            <span>years</span>
          </div>
          <div className="ch-triple">
            <select
              aria-label="After or before"
              value={rel.dir}
              onChange={(e) => setRel({ ...rel, dir: e.target.value })}
            >
              <option value="after">after</option>
              <option value="before">before</option>
            </select>
            <select
              aria-label="Start or end of the other span"
              value={rel.part}
              onChange={(e) => setRel({ ...rel, part: e.target.value })}
            >
              <option value="start">the start of</option>
              <option value="end">the end of</option>
            </select>
            <select
              aria-label="The other span"
              value={rel.ref}
              onChange={(e) => setRel({ ...rel, ref: e.target.value })}
            >
              <option value="">Choose…</option>
              {placedOthers.map((s) => (
                <option key={s.id} value={s.id}>
                  {spanName(s)}
                </option>
              ))}
            </select>
          </div>
          {relProblem && <p className="error ch-words">{relProblem}</p>}
          {rel.ref && !refPoint() && (
            <p className="muted ch-words">That span has no number there yet.</p>
          )}
          <p className="change-actions">
            <button type="button" className="quiet" onClick={() => setRelative("start")}>
              Set as the start
            </button>
            {!span.point && (
              <button type="button" className="quiet" onClick={() => setRelative("end")}>
                Set as the end
              </button>
            )}
          </p>
        </details>
      )}

      {points && (points.start || points.end || points.length) && (
        <p className="ch-worked muted">
          {points.start && <>Starts {yearAt(points.start)}. </>}
          {!span.point && points.end && <>Ends {yearAt(points.end)}. </>}
          {!span.point && points.length && <>Lasts {years(points.length)}. </>}
          {origin === span.id && points.start?.lo === 0 && points.start.hi === 0 && (
            <>Years are counted from its start. </>
          )}
          {origin !== null && !chronicle.spans.some((s) => s.id === origin) && (
            <>The span years were counted from was removed; the numbers still stand. </>
          )}
          {points.disagrees && <strong className="error">Its own numbers disagree.</strong>}
        </p>
      )}
      {origin !== null && origin !== span.id && span.start && span.start !== "open" && (
        <p className="change-actions">
          <button
            type="button"
            className="quiet"
            title="Every stored start and end moves by the same number of years; nothing else changes."
            onClick={() => change((c) => countFrom(c, span.id))}
          >
            Count years from this span instead
          </button>
        </p>
      )}

      <section className="ch-relations ch-entry">
        <h3>Entry</h3>
        {entry.state === "none" && (
          <>
            <p className="muted">Link this to the entry it stands for.</p>
            <EntryPicker onPick={props.onLink} />
          </>
        )}
        {entry.state === "gone" && (
          <p>
            Its entry was removed.{" "}
            <button type="button" className="plain danger" onClick={props.onUnlink}>
              Unlink
            </button>
          </p>
        )}
        {(entry.state === "linked" || entry.state === "pending") && (
          <p>
            <Link to={entryUrl(entry.path)}>{entry.title}</Link>
            {entry.state === "pending" && <span className="muted"> (linking…)</span>}{" "}
            <button type="button" className="plain danger" onClick={props.onUnlink}>
              Unlink
            </button>
          </p>
        )}
        {props.second && (
          <p className="muted">
            Another span here is linked to the same entry. Maps that change with time will read the
            first of them in the file.
          </p>
        )}
      </section>

      <label className="ch-field">
        <span>Note</span>
        <textarea
          rows={2}
          value={span.note}
          onChange={(e) => edit((s) => ({ ...s, note: e.target.value }), "note")}
        />
      </label>

      <p className="change-actions">
        <button
          type="button"
          className="plain danger"
          onClick={() => {
            change((c) => withoutSpan(c, span.id));
            onSelect(null);
          }}
        >
          Delete this {span.point ? "event" : "span"}
        </button>
      </p>
    </div>
  );
}
