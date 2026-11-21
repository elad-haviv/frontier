import { useState } from "react";
import type { ChronicleFile } from "@frontier/schema";
import { type Change, shiftSpan, spanName, typed } from "./model.ts";

interface Props {
  chronicle: ChronicleFile;
  change: Change;
}

/** Moves the starts and ends of several spans by a number of years: the author moving them himself. */
export function ShiftForm({ chronicle, change }: Props) {
  const [which, setWhich] = useState("all");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [dir, setDir] = useState("later");
  const [said, setSaid] = useState<string | null>(null);

  // Only a stored start or end can be moved: one worked out from the other moves with it.
  const placed = chronicle.spans.filter(
    (s) => (s.start !== null && s.start !== "open") || (s.end !== null && s.end !== "open"),
  );
  if (placed.length === 0) return null;

  const targets = placed.filter((s) =>
    which === "all" ? true : which === "chosen" ? chosen.has(s.id) : s.lane === which,
  );
  const years = typed(amount);

  const shift = () => {
    if (years === null || years <= 0) {
      setSaid("Give a number of years above 0.");
      return;
    }
    if (targets.length === 0) {
      setSaid("Choose at least one span.");
      return;
    }
    const by = dir === "later" ? years : -years;
    const ids = new Set(targets.map((s) => s.id));
    change((c) => ({ ...c, spans: c.spans.map((s) => (ids.has(s.id) ? shiftSpan(s, by) : s)) }));
    setSaid(
      `Moved ${targets.length} ${targets.length === 1 ? "span" : "spans"} ${amount} years ${dir}. The others stayed where they were.`,
    );
  };

  return (
    <details className="ch-shift">
      <summary>Shift several spans</summary>
      <div className="ch-triple">
        <select aria-label="Which spans" value={which} onChange={(e) => setWhich(e.target.value)}>
          <option value="all">Everything placed</option>
          {chronicle.lanes.map((l) => (
            <option key={l.id} value={l.id}>
              The lane {l.name}
            </option>
          ))}
          <option value="chosen">Spans I choose</option>
        </select>
      </div>
      {which === "chosen" && (
        <ul className="ch-shift-list">
          {placed.map((s) => (
            <li key={s.id}>
              <label className="ch-check">
                <input
                  type="checkbox"
                  checked={chosen.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    setChosen(next);
                  }}
                />
                <span>{spanName(s)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="ch-range">
        <input
          type="text"
          inputMode="decimal"
          aria-label="Years to shift by"
          placeholder="years"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span>years</span>
        <select aria-label="Earlier or later" value={dir} onChange={(e) => setDir(e.target.value)}>
          <option value="later">later</option>
          <option value="earlier">earlier</option>
        </select>
        <button type="button" className="primary" onClick={shift}>
          Shift
        </button>
      </div>
      {said && (
        <p className="muted ch-words" role="status">
          {said}
        </p>
      )}
    </details>
  );
}
