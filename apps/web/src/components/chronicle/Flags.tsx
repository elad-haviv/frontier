import type { ChronicleFile } from "@frontier/schema";
import { type Check, offerMove, sentenceFor, statementOf } from "@frontier/time";
import { type Change, type Worked, applyOffer, spanName, withSpan, yearAt } from "./model.ts";

interface Props {
  chronicle: ChronicleFile;
  worked: Worked;
  change: Change;
  onSelect: (id: string) => void;
  /** Selects the two events a rule names, so both are in sight. */
  onSelectBoth?: (ids: string[]) => void;
}

/** How many statements are red: the count on the tab. */
export function redCount(worked: Worked): number {
  const relations = worked.checks.filter((c) =>
    ["does_not_fit", "contradicts", "broken"].includes(c.state),
  ).length;
  return relations + [...worked.points.values()].filter((p) => p.disagrees).length;
}

/** What does not fit: red first, then circles and broken statements, then amber, then grey. */
export function Flags({ chronicle, worked, change, onSelect, onSelectBoth }: Props) {
  const of = (...states: string[]) => worked.checks.filter((c) => states.includes(c.state));
  const red = of("does_not_fit");
  const stuck = of("contradicts", "broken");
  const amber = of("may_not_fit");
  const grey = of("cannot_tell", "not_checked");
  const holds = of("holds");
  const disagree = chronicle.spans.filter((s) => worked.points.get(s.id)?.disagrees);
  const has = (id: string) => chronicle.spans.some((s) => s.id === id);

  const remove = (id: string) =>
    change((c) => ({ ...c, relations: c.relations.filter((r) => r.id !== id) }));

  const row = (check: Check, tone: string) => {
    const { relation } = check;
    const sentence =
      check.state === "contradicts"
        ? "These statements go in a circle: " +
          check.circle
            .map((id) => chronicle.relations.find((r) => r.id === id))
            .filter((r) => r !== undefined)
            .map((r) => statementOf(r, chronicle.spans))
            .join("; ") +
          "."
        : sentenceFor(check, chronicle);
    return (
      <li key={relation.id} className={`ch-flag is-${tone}`}>
        <p>{sentence ?? statementOf(relation, chronicle.spans) + "."}</p>
        <p className="change-actions">
          {has(relation.a) && has(relation.b) && onSelectBoth ? (
            <button
              type="button"
              className="quiet"
              onClick={() => onSelectBoth([relation.a, relation.b])}
            >
              Show both
            </button>
          ) : (
            [relation.a, relation.b].filter(has).map((id) => (
              <button key={id} type="button" className="quiet" onClick={() => onSelect(id)}>
                Show {spanName(chronicle.spans.find((s) => s.id === id)!)}
              </button>
            ))
          )}
          {check.state === "does_not_fit" &&
            (["a", "b"] as const).map((side) => {
              const offer = offerMove(relation, side, chronicle.spans);
              const mover = chronicle.spans.find((x) => x.id === relation[side]);
              if (!offer || !mover) return null;
              const to = offer.start ? `start ${yearAt(offer.start)}` : `end ${yearAt(offer.end!)}`;
              return (
                <button
                  key={side}
                  type="button"
                  className="quiet"
                  title={`To ${to}`}
                  onClick={() => change((c) => withSpan(c, mover.id, (x) => applyOffer(x, offer)))}
                >
                  Move {spanName(mover)} ({to})
                </button>
              );
            })}
          <button type="button" className="plain danger" onClick={() => remove(relation.id)}>
            Remove the rule
          </button>
        </p>
      </li>
    );
  };

  const nothing = worked.checks.length === 0 && disagree.length === 0;

  return (
    <div className="ch-flags">
      {nothing && (
        <p className="empty">No rules yet. Select an event and add one under Must fit.</p>
      )}
      {!nothing && red.length + stuck.length + disagree.length === 0 && (
        <p className="banner banner-ok">Everything fits.</p>
      )}
      <ul>
        {disagree.map((s) => (
          <li key={s.id} className="ch-flag is-red">
            <p>{spanName(s)}: its start, end and length don’t agree.</p>
            <p className="change-actions">
              <button type="button" className="quiet" onClick={() => onSelect(s.id)}>
                Show {spanName(s)}
              </button>
            </p>
          </li>
        ))}
        {red.map((c) => row(c, "red"))}
        {stuck.map((c) => row(c, "red"))}
      </ul>
      {amber.length > 0 && (
        <details open={amber.length <= 3}>
          <summary>{amber.length} may not fit</summary>
          <ul>{amber.map((c) => row(c, "amber"))}</ul>
        </details>
      )}
      {grey.length > 0 && (
        <details>
          <summary>{grey.length} cannot be told yet</summary>
          <ul>{grey.map((c) => row(c, "grey"))}</ul>
        </details>
      )}
      {holds.length > 0 && (
        <details>
          <summary>
            {holds.length} {holds.length === 1 ? "holds" : "hold"}
          </summary>
          <ul>
            {holds.map((c) => (
              <li key={c.relation.id} className="ch-flag is-ok">
                <p>{statementOf(c.relation, chronicle.spans)}.</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
