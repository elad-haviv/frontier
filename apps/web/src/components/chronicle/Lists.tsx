import { useState } from "react";
import type { ChronicleFile } from "@frontier/schema";
import { type Change, newId, typed } from "./model.ts";

interface Props {
  chronicle: ChronicleFile;
  change: Change;
}

/** The author's own units, such as "generation: 20 to 35 years". */
export function UnitList({ chronicle, change }: Props) {
  const [draft, setDraft] = useState({ name: "", low: "", high: "" });
  const [refused, setRefused] = useState<string | null>(null);
  const low = typed(draft.low);
  const high = typed(draft.high) ?? low;
  const ok = draft.name.trim() !== "" && low !== null && high !== null && low >= 0 && high >= low;
  const used = (id: string) => chronicle.spans.filter((s) => s.length?.unit === id).length;

  const setNumber = (id: string, key: "low" | "high", text: string) => {
    const n = typed(text);
    const unit = chronicle.units.find((u) => u.id === id);
    if (!unit || n === unit[key]) return true;
    // A unit whose lowest is above its highest would make every length written in it invalid.
    if (n === null || n < 0 || (key === "low" ? n > unit.high : n < unit.low)) return false;
    change((c) => ({
      ...c,
      units: c.units.map((u) => (u.id === id ? { ...u, [key]: n } : u)),
    }));
    return true;
  };
  /** Puts the stored number back into a field whose typed number was refused. */
  const settle = (input: HTMLInputElement, unit: string, key: "low" | "high") => {
    if (setNumber(unit, key, input.value)) return;
    input.value = String(chronicle.units.find((u) => u.id === unit)?.[key] ?? "");
    setRefused(unit);
  };

  return (
    <section className="ch-list">
      <h2>Units</h2>
      <p className="muted">
        A word of yours with a range in years. A length can then be given as a count of it. Changing
        a unit changes no length by itself: each length that used it offers to recalculate.
      </p>
      <ul>
        {chronicle.units.map((unit) => (
          <li key={unit.id}>
            <input
              type="text"
              aria-label="Unit name"
              value={unit.name}
              onChange={(e) =>
                change(
                  (c) => ({
                    ...c,
                    units: c.units.map((u) =>
                      u.id === unit.id ? { ...u, name: e.target.value } : u,
                    ),
                  }),
                  `unit-name:${unit.id}`,
                )
              }
            />
            <input
              className="ch-short"
              type="text"
              inputMode="decimal"
              aria-label={`Lowest years in one ${unit.name}`}
              defaultValue={unit.low}
              key={`low-${unit.low}`}
              onBlur={(e) => settle(e.target, unit.id, "low")}
            />
            <span>to</span>
            <input
              className="ch-short"
              type="text"
              inputMode="decimal"
              aria-label={`Highest years in one ${unit.name}`}
              defaultValue={unit.high}
              key={`high-${unit.high}`}
              onBlur={(e) => settle(e.target, unit.id, "high")}
            />
            <span>years</span>
            <button
              type="button"
              className="plain danger"
              disabled={used(unit.id) > 0}
              title={used(unit.id) > 0 ? "Some lengths are written in this unit." : undefined}
              onClick={() =>
                change((c) => ({ ...c, units: c.units.filter((u) => u.id !== unit.id) }))
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {refused && (
        <p className="error" role="alert">
          That number was not kept: a unit's lowest cannot be above its highest, and both are 0 or
          more.
        </p>
      )}
      <form
        className="ch-list-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          change((c) => ({
            ...c,
            units: [...c.units, { id: newId(), name: draft.name.trim(), low: low!, high: high! }],
          }));
          setDraft({ name: "", low: "", high: "" });
        }}
      >
        <input
          type="text"
          aria-label="New unit"
          placeholder="New unit, such as generation"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          className="ch-short"
          type="text"
          inputMode="decimal"
          aria-label="Lowest years"
          placeholder="lowest"
          value={draft.low}
          onChange={(e) => setDraft({ ...draft, low: e.target.value })}
        />
        <span>to</span>
        <input
          className="ch-short"
          type="text"
          inputMode="decimal"
          aria-label="Highest years"
          placeholder="highest"
          value={draft.high}
          onChange={(e) => setDraft({ ...draft, high: e.target.value })}
        />
        <span>years</span>
        <button type="submit" className="primary" disabled={!ok}>
          Add the unit
        </button>
      </form>
    </section>
  );
}
