import { useState } from "react";
import type { ChronicleFile } from "@frontier/schema";
import { useDialogs } from "../Dialogs.tsx";
import { type Change, LANE_COLORS, newId, typed } from "./model.ts";

interface Props {
  chronicle: ChronicleFile;
  change: Change;
}

function move<T>(items: T[], from: number, by: number): T[] {
  const to = from + by;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** The lanes: add, rename, recolour, reorder, delete. The last lane cannot be deleted. */
export function LaneList({ chronicle, change }: Props) {
  const dialogs = useDialogs();
  const [name, setName] = useState("");

  const remove = async (id: string) => {
    const at = chronicle.lanes.findIndex((l) => l.id === id);
    const lane = chronicle.lanes[at];
    const into = chronicle.lanes[at - 1] ?? chronicle.lanes[at + 1];
    if (!lane || !into) return;
    const count = chronicle.spans.filter((s) => s.lane === id).length;
    if (count > 0) {
      const ok = await dialogs.confirm({
        title: `Delete the lane ${lane.name}?`,
        body: `Its ${count} ${count === 1 ? "span moves" : "spans move"} to ${into.name}.`,
        action: "Delete the lane",
        danger: true,
      });
      if (!ok) return;
    }
    change((c) => ({
      ...c,
      lanes: c.lanes.filter((l) => l.id !== id),
      spans: c.spans.map((s) => (s.lane === id ? { ...s, lane: into.id } : s)),
    }));
  };

  return (
    <section className="ch-list">
      <h2>Lanes</h2>
      <p className="muted">A lane is a row of spans: a people, a place, a thread of the story.</p>
      <ul>
        {chronicle.lanes.map((lane, i) => (
          <li key={lane.id}>
            <input
              type="color"
              aria-label={`Colour of ${lane.name}`}
              value={lane.color}
              onChange={(e) =>
                change((c) => ({
                  ...c,
                  lanes: c.lanes.map((l) =>
                    l.id === lane.id ? { ...l, color: e.target.value } : l,
                  ),
                }))
              }
            />
            <input
              type="text"
              aria-label="Lane name"
              value={lane.name}
              onChange={(e) =>
                change((c) => ({
                  ...c,
                  lanes: c.lanes.map((l) =>
                    l.id === lane.id ? { ...l, name: e.target.value } : l,
                  ),
                }))
              }
            />
            <button
              type="button"
              className="quiet"
              aria-label={`Move ${lane.name} up`}
              disabled={i === 0}
              onClick={() => change((c) => ({ ...c, lanes: move(c.lanes, i, -1) }))}
            >
              ↑
            </button>
            <button
              type="button"
              className="quiet"
              aria-label={`Move ${lane.name} down`}
              disabled={i === chronicle.lanes.length - 1}
              onClick={() => change((c) => ({ ...c, lanes: move(c.lanes, i, 1) }))}
            >
              ↓
            </button>
            <button
              type="button"
              className="plain danger"
              disabled={chronicle.lanes.length === 1}
              onClick={() => void remove(lane.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="ch-list-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          change((c) => ({
            ...c,
            lanes: [
              ...c.lanes,
              {
                id: newId(),
                name: name.trim(),
                color: LANE_COLORS[c.lanes.length % LANE_COLORS.length]!,
                clock: c.clock,
              },
            ],
          }));
          setName("");
        }}
      >
        <input
          type="text"
          aria-label="New lane"
          placeholder="New lane"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="primary" disabled={!name.trim()}>
          Add the lane
        </button>
      </form>
    </section>
  );
}

/** The author's own units, such as "generation: 20 to 35 years". */
export function UnitList({ chronicle, change }: Props) {
  const [draft, setDraft] = useState({ name: "", low: "", high: "" });
  const low = typed(draft.low);
  const high = typed(draft.high) ?? low;
  const ok = draft.name.trim() !== "" && low !== null && high !== null && low >= 0 && high >= low;
  const used = (id: string) => chronicle.spans.filter((s) => s.length?.unit === id).length;

  const setNumber = (id: string, key: "low" | "high", text: string) => {
    const n = typed(text);
    if (n === null || n < 0) return;
    change((c) => ({
      ...c,
      units: c.units.map((u) => (u.id === id ? { ...u, [key]: n } : u)),
    }));
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
                change((c) => ({
                  ...c,
                  units: c.units.map((u) =>
                    u.id === unit.id ? { ...u, name: e.target.value } : u,
                  ),
                }))
              }
            />
            <input
              className="ch-short"
              type="text"
              inputMode="decimal"
              aria-label={`Lowest years in one ${unit.name}`}
              defaultValue={unit.low}
              key={`low-${unit.low}`}
              onBlur={(e) => setNumber(unit.id, "low", e.target.value)}
            />
            <span>to</span>
            <input
              className="ch-short"
              type="text"
              inputMode="decimal"
              aria-label={`Highest years in one ${unit.name}`}
              defaultValue={unit.high}
              key={`high-${unit.high}`}
              onBlur={(e) => setNumber(unit.id, "high", e.target.value)}
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
