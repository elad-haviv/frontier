import { useEffect, useRef, useState } from "react";
import type { ChronicleFile } from "@frontier/schema";
import { api } from "../../api.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { typeWhen } from "./edit.ts";
import { newSpan } from "./model.ts";

export interface Added {
  chronicle: ChronicleFile;
  id: string;
  /** The entry picked by name, to link once it is added. */
  entry: { path: string; title: string } | null;
}

/**
 * The one small form for a new event: a name (or an entry, which links it), when it starts and
 * ends, its group, and whether it is a single moment. Dates are optional.
 */
export function AddEvent(p: {
  chronicle: ChronicleFile;
  lane: string;
  onAdd: (added: Added) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [lane, setLane] = useState(p.lane);
  const [point, setPoint] = useState(false);
  const [entry, setEntry] = useState<{ path: string; title: string } | null>(null);
  const [found, setFound] = useState<{ path: string; title: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Typing suggests entries; picking one links it and names the event after it.
  useEffect(() => {
    const q = name.trim();
    if (q.length < 2 || entry?.title === q) {
      setFound([]);
      return;
    }
    let live = true;
    const wait = window.setTimeout(() => {
      api.names(q).then(
        (r) => {
          if (!live) return;
          const seen = new Set<string>();
          setFound(
            r.results
              .filter((x) => !seen.has(x.path) && seen.add(x.path))
              .slice(0, 5)
              .map((x) => ({ path: x.path, title: x.title })),
          );
        },
        () => undefined,
      );
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [name, entry]);

  function add() {
    if (!name.trim()) {
      setProblem("Give it a name.");
      return;
    }
    const made = newSpan(lane, point, name.trim());
    let next: ChronicleFile = { ...p.chronicle, spans: [...p.chronicle.spans, made] };
    for (const [part, text] of [
      ["start", start],
      ["end", point ? "" : end],
    ] as const) {
      if (!text.trim()) continue;
      const out = typeWhen(next, made.id, part, text);
      if (!out.ok) {
        setProblem(`${part === "start" ? "Starts" : "Ends"}: ${out.message}`);
        return;
      }
      next = out.chronicle;
    }
    p.onAdd({ chronicle: next, id: made.id, entry });
  }

  return (
    <DialogFrame
      title="Add an event"
      onCancel={p.onCancel}
      onSubmit={add}
      initialFocus={nameRef}
      className="ch-add"
    >
      <label className="dialog-field">
        <span>Name or entry</span>
        <input
          ref={nameRef}
          type="text"
          value={name}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            if (entry && e.target.value !== entry.title) setEntry(null);
          }}
        />
      </label>
      {found.length > 0 && (
        <ul className="ch-add-found" aria-label="Entries with this name">
          {found.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="plain"
                onClick={() => {
                  setEntry(f);
                  setName(f.title);
                  setFound([]);
                }}
              >
                📖 {f.title} <span className="muted">· link to this entry</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {entry && <p className="muted ch-add-linked">Linked to the entry {entry.title}.</p>}
      <div className="ch-add-dates">
        <label className="dialog-field">
          <span>{point ? "When" : "Starts"}</span>
          <input
            type="text"
            value={start}
            placeholder="e.g. 270-290"
            autoComplete="off"
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        {!point && (
          <label className="dialog-field">
            <span>Ends</span>
            <input
              type="text"
              value={end}
              placeholder="e.g. 300, or open"
              autoComplete="off"
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        )}
      </div>
      <label className="dialog-field">
        <span>Group</span>
        <select value={lane} onChange={(e) => setLane(e.target.value)}>
          {p.chronicle.lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ch-check">
        <input type="checkbox" checked={point} onChange={(e) => setPoint(e.target.checked)} />
        <span>A single moment</span>
      </label>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Add
        </button>
      </p>
    </DialogFrame>
  );
}
