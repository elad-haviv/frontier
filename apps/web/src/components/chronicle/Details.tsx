import { useEffect, useRef, useState } from "react";
import { Link } from "../../nav.tsx";
import { entryUrl, mapUrl } from "../../api.ts";
import { EntryPicker } from "../EntryPicker.tsx";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import {
  KINDS,
  type Range,
  formatEnd,
  formatLength,
  formatRange,
  formatTie,
  offerMove,
  sentenceFor,
  staleLength,
  statementOf,
} from "@frontier/time";
import { typeWhen } from "./edit.ts";
import {
  type Change,
  type Worked,
  KIND_WORDS,
  applyOffer,
  countFrom,
  newId,
  setTie,
  spanName,
  withSpan,
  withoutSpan,
  yearAt,
} from "./model.ts";

export type SpanEntry =
  | { state: "none" }
  | { state: "gone" }
  | { state: "linked" | "pending"; path: string; title: string };

export interface OnMap {
  map: string;
  title: string;
  features: number;
}

interface Props {
  chronicle: ChronicleFile;
  worked: Worked;
  span: ChronicleSpan;
  change: Change;
  onSelect: (id: string | null) => void;
  entry: SpanEntry;
  /** True when an earlier event of this chronicle is linked to the same entry. */
  second: boolean;
  onLink: (path: string, title: string) => void;
  onUnlink: () => void;
  onMaps: readonly OnMap[];
  /** Asked for from outside: the name (Enter) or the start (D) gets the focus. */
  focus: { what: "name" | "dates"; at: number } | null;
}

const RULE_MARK: Record<string, { mark: string; tone: string; words: string }> = {
  holds: { mark: "✓", tone: "ok", words: "fits" },
  does_not_fit: { mark: "⚠", tone: "red", words: "doesn't fit" },
  contradicts: { mark: "⚠", tone: "red", words: "goes in a circle" },
  broken: { mark: "⚠", tone: "red", words: "names an event that was removed" },
  may_not_fit: { mark: "?", tone: "amber", words: "may not fit" },
  cannot_tell: { mark: "?", tone: "grey", words: "can't tell yet" },
  not_checked: { mark: "?", tone: "grey", words: "not checked" },
};

/** One box of Starts, Ends or Lasts: what is stored, or what is worked out in grey. */
function WhenField(p: {
  label: string;
  id: string;
  value: string;
  worked: string | null;
  tied: boolean;
  disabled?: string;
  onType: (text: string) => string | null;
  onUntie?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [text, setText] = useState(p.value);
  const [error, setError] = useState<string | null>(null);
  // What is stored wins when it changes from outside, as after a drag or an undo.
  useEffect(() => {
    setText(p.value);
    setError(null);
  }, [p.value]);
  const commit = () => {
    if (text.trim() === p.value.trim()) return;
    setError(p.onType(text));
  };
  return (
    <div className="dt-when">
      <label htmlFor={p.id}>{p.label}</label>
      <div className="dt-when-row">
        <input
          ref={p.inputRef}
          id={p.id}
          type="text"
          autoComplete="off"
          value={text}
          disabled={p.disabled !== undefined}
          placeholder={p.disabled ?? (p.worked ? `${p.worked} (worked out)` : "Not given")}
          className={p.worked && !p.value ? "is-worked" : undefined}
          aria-invalid={error !== null}
          aria-describedby={error ? `${p.id}-error` : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setText(p.value);
              setError(null);
            }
          }}
        />
        {p.tied && p.onUntie && (
          <button
            type="button"
            className="quiet dt-untie"
            title="Keep the number it has now, without the tie"
            onClick={p.onUntie}
          >
            ⛓ Untie
          </button>
        )}
      </div>
      {error && (
        <p className="error dt-error" id={`${p.id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const worked = (r: Range | null | undefined): string | null => (r ? formatRange(r) : null);

/** The details of the selected event: when it is, the rules it must fit, its entry and maps. */
export function Details(props: Props) {
  const { chronicle, worked: w, span, change, onSelect, entry } = props;
  const points = w.points.get(span.id);
  const nameRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("after");
  const [other, setOther] = useState("");

  useEffect(() => {
    if (!props.focus) return;
    const el = props.focus.what === "name" ? nameRef.current : startRef.current;
    el?.focus();
    el?.select();
  }, [props.focus?.at]);

  const edit = (fn: (s: ChronicleSpan) => ChronicleSpan, tag?: string) =>
    change((c) => withSpan(c, span.id, fn), tag && `${tag}:${span.id}`);
  const type = (part: "start" | "end" | "length") => (text: string) => {
    const out = typeWhen(chronicle, span.id, part, text);
    if (!out.ok) return out.message;
    change(() => out.chronicle);
    return null;
  };
  const nameOf = (id: string) => {
    const s = chronicle.spans.find((x) => x.id === id);
    return s ? spanName(s) : "a removed event";
  };
  const shown = (part: "start" | "end") => {
    const tie = part === "start" ? span.startFrom : span.endFrom;
    return tie ? formatTie(tie, part, nameOf(tie.span)) : formatEnd(span[part]);
  };
  const open = span.start === "open" || span.end === "open";
  const stale = span.length ? staleLength(span.length, chronicle.units) : null;
  const mine = w.checks.filter((c) => c.relation.a === span.id || c.relation.b === span.id);
  const others = chronicle.spans.filter((s) => s.id !== span.id);
  const origin = chronicle.origin;

  return (
    <div className="dt">
      <label className="dt-name">
        <span className="sr-only">Name</span>
        <input
          ref={nameRef}
          type="text"
          value={span.name}
          placeholder="Name"
          aria-label="Name"
          onChange={(e) => edit((s) => ({ ...s, name: e.target.value }), "name")}
        />
      </label>
      <div className="dt-row">
        <label className="dt-group">
          <span>Group</span>
          <select value={span.lane} onChange={(e) => edit((s) => ({ ...s, lane: e.target.value }))}>
            {chronicle.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dt-seg" role="radiogroup" aria-label="Kind of event">
          <button
            type="button"
            role="radio"
            aria-checked={!span.point}
            onClick={() => edit((s) => ({ ...s, point: false }))}
          >
            Lasts a while
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={span.point}
            onClick={() =>
              edit((s) => setTie({ ...s, point: true, end: null, length: null }, "end", null))
            }
          >
            A single moment
          </button>
        </div>
      </div>

      <section className="dt-dates" aria-label="Dates">
        <WhenField
          label={span.point ? "When" : "Starts"}
          id="dt-start"
          inputRef={startRef}
          value={shown("start")}
          worked={span.start === null ? worked(points?.start) : null}
          tied={!!span.startFrom}
          onType={type("start")}
          onUntie={() => edit((s) => setTie(s, "start", null))}
        />
        {!span.point && (
          <>
            <WhenField
              label="Ends"
              id="dt-end"
              value={shown("end")}
              worked={span.end === null ? worked(points?.end) : null}
              tied={!!span.endFrom}
              onType={type("end")}
              onUntie={() => edit((s) => setTie(s, "end", null))}
            />
            <WhenField
              label="Lasts"
              id="dt-length"
              value={formatLength(span.length, chronicle.units)}
              worked={
                span.length === null && points?.length && Number.isFinite(points.length.hi)
                  ? `${formatRange(points.length)} years`
                  : null
              }
              tied={false}
              {...(open ? { disabled: "Open: no length" } : {})}
              onType={type("length")}
            />
          </>
        )}
        {points?.disagrees && (
          <p className="error dt-error" role="alert">
            These three don’t agree: its length does not fit between its start and end.
          </p>
        )}
        {stale && (
          <p className="dt-stale">
            Written with {stale.unit.name} as {stale.writtenWith.lo} to {stale.writtenWith.hi}; now{" "}
            {stale.now.lo} to {stale.now.hi}.{" "}
            <button
              type="button"
              className="quiet"
              onClick={() =>
                edit((s) =>
                  s.length
                    ? {
                        ...s,
                        length: {
                          ...s.length,
                          low: stale.recalculated.lo,
                          high: stale.recalculated.hi,
                        },
                      }
                    : s,
                )
              }
            >
              Recalculate
            </button>
          </p>
        )}
        <p className="dt-hint muted">
          Type 300, 270-290, about 280, -50, open, 3-5 generations, “with First Landing” or “10
          after The war”.
        </p>
        {origin === span.id && points?.start?.lo === 0 && points.start.hi === 0 ? (
          <p className="muted dt-hint">Year 0 is its start.</p>
        ) : (
          span.start &&
          span.start !== "open" && (
            <button
              type="button"
              className="plain dt-origin"
              title="Every number moves by the same amount; nothing else changes."
              onClick={() => change((c) => countFrom(c, span.id))}
            >
              Count years from its start (make it year 0)
            </button>
          )
        )}
      </section>

      <section className="dt-rules" aria-label="Must fit">
        <h3>Must fit</h3>
        {mine.length === 0 && <p className="muted">No rules yet.</p>}
        <ul>
          {mine.map((c) => {
            const m = RULE_MARK[c.state] ?? RULE_MARK["not_checked"]!;
            const sentence = c.state === "holds" ? null : sentenceFor(c, chronicle);
            return (
              <li key={c.relation.id} className={`dt-rule is-${m.tone}`}>
                <p>
                  <span className="dt-mark" aria-hidden="true">
                    {m.mark}
                  </span>{" "}
                  {statementOf(c.relation, chronicle.spans)}{" "}
                  <span className="sr-only">({m.words})</span>
                </p>
                {sentence && <p className="dt-why">{sentence}</p>}
                <p className="dt-fixes">
                  {c.state === "does_not_fit" &&
                    (["a", "b"] as const).map((side) => {
                      const offer = offerMove(c.relation, side, chronicle.spans);
                      const mover = chronicle.spans.find((x) => x.id === c.relation[side]);
                      if (!offer || !mover) return null;
                      const to = offer.start
                        ? `start ${yearAt(offer.start)}`
                        : `end ${yearAt(offer.end!)}`;
                      return (
                        <button
                          key={side}
                          type="button"
                          className="quiet"
                          onClick={() =>
                            change((ch) => withSpan(ch, mover.id, (x) => applyOffer(x, offer)))
                          }
                        >
                          Move {spanName(mover)} ({to})
                        </button>
                      );
                    })}
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
                    Remove the rule
                  </button>
                </p>
              </li>
            );
          })}
        </ul>
        {others.length > 0 && (
          <div className="dt-add-rule">
            <span className="dt-this">{spanName(span)}</span>
            <select aria-label="Rule" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_WORDS[k]}
                </option>
              ))}
            </select>
            <select
              aria-label="The other event"
              value={other}
              onChange={(e) => setOther(e.target.value)}
            >
              <option value="">Choose an event…</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {spanName(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="quiet"
              disabled={!other}
              onClick={() => {
                change((c) => ({
                  ...c,
                  relations: [...c.relations, { id: newId(), a: span.id, kind, b: other }],
                }));
                setOther("");
              }}
            >
              Add the rule
            </button>
          </div>
        )}
      </section>

      <section className="dt-entry" aria-label="Entry">
        <h3>Entry</h3>
        {entry.state === "none" && (
          <>
            <p className="muted">Link it to the entry it stands for.</p>
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
            📖 <Link to={entryUrl(entry.path)}>{entry.title}</Link>
            {entry.state === "pending" && <span className="muted"> (linking…)</span>}{" "}
            <button type="button" className="plain danger" onClick={props.onUnlink}>
              Unlink
            </button>
          </p>
        )}
        {props.second && (
          <p className="muted">
            Another event here is linked to the same entry. Maps follow the first of them.
          </p>
        )}
      </section>

      {props.onMaps.length > 0 && (
        <section className="dt-maps" aria-label="On maps">
          <h3>On maps</h3>
          <ul>
            {props.onMaps.map((m) => {
              const at = points?.start && Number.isFinite(points.start.lo) ? points.start.lo : null;
              const params = new URLSearchParams({ c: chronicle.id });
              if (at !== null) params.set("t", String(Math.round(at)));
              return (
                <li key={m.map}>
                  🗺{" "}
                  <Link to={`${mapUrl(m.map)}?${params.toString()}`}>
                    {m.title} · {m.features}{" "}
                    {m.features === 1 ? "feature follows" : "features follow"} this
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <label className="dt-note">
        <span>Note</span>
        <textarea
          rows={2}
          value={span.note}
          onChange={(e) => edit((s) => ({ ...s, note: e.target.value }), "note")}
        />
      </label>

      <p className="dt-actions">
        <button
          type="button"
          className="quiet"
          onClick={() => {
            const copy = { ...span, id: newId(), name: `${span.name} (copy)`, entry: null };
            change((c) => {
              const at = c.spans.findIndex((s) => s.id === span.id);
              return { ...c, spans: [...c.spans.slice(0, at + 1), copy, ...c.spans.slice(at + 1)] };
            });
            onSelect(copy.id);
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="plain danger"
          onClick={() => {
            change((c) => withoutSpan(c, span.id));
            onSelect(null);
          }}
        >
          Delete
        </button>
      </p>
    </div>
  );
}

/**
 * The same event as `Details`, to read: what a reader sees (stage 31c). No field, rule or button
 * changes anything; the entry and the maps are links.
 */
export function ReadDetails(props: Omit<Props, "change" | "onLink" | "onUnlink" | "focus">) {
  const { chronicle, worked: w, span, entry } = props;
  const points = w.points.get(span.id);
  const nameOf = (id: string) => {
    const s = chronicle.spans.find((x) => x.id === id);
    return s ? spanName(s) : "a removed event";
  };
  const shown = (part: "start" | "end") => {
    const tie = part === "start" ? span.startFrom : span.endFrom;
    return tie ? formatTie(tie, part, nameOf(tie.span)) : formatEnd(span[part]);
  };
  const lane = chronicle.lanes.find((l) => l.id === span.lane);
  const mine = w.checks.filter((c) => c.relation.a === span.id || c.relation.b === span.id);
  return (
    <div className="dt is-read">
      <dl className="facts">
        <dt>Group</dt>
        <dd>{lane?.name ?? ""}</dd>
        <dt>{span.point ? "When" : "Starts"}</dt>
        <dd>{shown("start") || (worked(points?.start) ?? "not placed")}</dd>
        {!span.point && (
          <>
            <dt>Ends</dt>
            <dd>{shown("end") || (worked(points?.end) ?? "not placed")}</dd>
            <dt>Lasts</dt>
            <dd>{formatLength(span.length, chronicle.units) || "not set"}</dd>
          </>
        )}
      </dl>
      {mine.length > 0 && (
        <section className="dt-rules" aria-label="Must fit">
          <h3>Must fit</h3>
          <ul>
            {mine.map((c) => {
              const m = RULE_MARK[c.state] ?? RULE_MARK["not_checked"]!;
              return (
                <li key={c.relation.id} className={`dt-rule is-${m.tone}`}>
                  <p>
                    <span className="dt-mark" aria-hidden="true">
                      {m.mark}
                    </span>{" "}
                    {statementOf(c.relation, chronicle.spans)}{" "}
                    <span className="sr-only">({m.words})</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {(entry.state === "linked" || entry.state === "pending") && (
        <section className="dt-entry" aria-label="Entry">
          <h3>Entry</h3>
          <p>
            📖 <Link to={entryUrl(entry.path)}>{entry.title}</Link>
          </p>
        </section>
      )}
      {props.onMaps.length > 0 && (
        <section className="dt-maps" aria-label="On maps">
          <h3>On maps</h3>
          <ul>
            {props.onMaps.map((m) => {
              const at = points?.start && Number.isFinite(points.start.lo) ? points.start.lo : null;
              const params = new URLSearchParams({ c: chronicle.id });
              if (at !== null) params.set("t", String(Math.round(at)));
              return (
                <li key={m.map}>
                  🗺 <Link to={`${mapUrl(m.map)}?${params.toString()}`}>{m.title}</Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {span.note && <p className="dt-note-read">{span.note}</p>}
    </div>
  );
}
