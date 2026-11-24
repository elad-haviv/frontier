import { makeView, type Position, type ViewState } from "@frontier/geo";
import { useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { choiceName, type Ghost, placeSpots } from "../../map/place.ts";
import { newItemId } from "../../map/viewUrl.ts";

/** The proposals of Place with AI, and asking for them. Kept by the map page while the tool is on. */
export function usePlace(mapId: string) {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function propose(
    view: ViewState,
    size: { width: number; height: number },
    marked: Position[],
    ask: { count: number; prompt: string | null; choices: { id: string; name: string }[] },
    moment: { chronicle: string | null; year: number | null },
  ) {
    const spots = placeSpots(makeView(view, size.width, size.height), marked, ask.count);
    if (spots.length === 0) return;
    // The place asked about: the spot, or the middle of the area.
    const n = marked.length;
    const at: [number, number] =
      n < 3
        ? marked[0]!
        : [marked.reduce((s, p) => s + p[0], 0) / n, marked.reduce((s, p) => s + p[1], 0) / n];
    setBusy(true);
    setProblem(null);
    api
      .generateFeatures(mapId, { kind: "marker", at, exclude: null, ...ask, ...moment })
      .then(
        (r) => {
          setGhosts((g) => [
            ...g,
            ...r.items.map((item, i) => ({ ...item, key: newItemId(), at: spots[i] ?? spots[0]! })),
          ]);
          if (r.items.length === 0) setProblem("Nothing was proposed. Try again.");
        },
        (err: unknown) =>
          setProblem(err instanceof ApiFailure ? err.message : "Nothing could be proposed."),
      )
      .finally(() => setBusy(false));
  }

  return { ghosts, setGhosts, busy, problem, propose };
}

/** The proposals on the map, as dashed markers with their names, until each is placed or not. */
export function GhostPins({
  ghosts,
  view,
  size,
  picked,
  onPick,
}: {
  ghosts: Ghost[];
  view: ViewState;
  size: { width: number; height: number };
  picked: string | null;
  onPick: (key: string) => void;
}) {
  const v = makeView(view, size.width, size.height);
  return ghosts.map((g) => {
    const at = v.project(g.at);
    if (!at || at[0] < -20 || at[1] < -20 || at[0] > size.width + 20 || at[1] > size.height + 20) {
      return null;
    }
    return (
      <button
        key={g.key}
        type="button"
        className={"ghost-pin" + (picked === g.key ? " is-open" : "")}
        style={{ left: at[0], top: at[1] }}
        aria-label={`Proposed: ${g.name}`}
        onClick={() => onPick(g.key)}
      >
        <span className="ghost-name">{g.name}</span>
      </button>
    );
  });
}

/** The Place with AI tab: what to ask for, and the proposals to place one by one. */
export function PlacePanel({
  marked,
  place,
  choices,
  picked,
  onPick,
  onPropose,
  onAccept,
  onClear,
}: {
  /** The spot or the corners of the area tapped on the map. */
  marked: Position[];
  place: ReturnType<typeof usePlace>;
  choices: { id: string; name: string }[];
  picked: string | null;
  onPick: (key: string | null) => void;
  onPropose: (ask: { count: number; prompt: string | null }) => void;
  onAccept: (ghost: Ghost) => void;
  onClear: () => void;
}) {
  const [wish, setWish] = useState("");
  const [count, setCount] = useState(3);
  const { ghosts, setGhosts, busy, problem } = place;
  const drop = (key: string) => {
    setGhosts((g) => g.filter((x) => x.key !== key));
    if (picked === key) onPick(null);
  };
  return (
    <section className="place-panel" aria-label="Place with AI">
      <p className="muted">
        {marked.length === 0
          ? "Tap a spot on the map, or tap around an area, to place features there."
          : marked.length < 3
            ? "Around the spot tapped. Tap twice more to mark an area instead."
            : `In the area of ${marked.length} points tapped.`}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (marked.length > 0 && !busy) onPropose({ count, prompt: wish.trim() || null });
        }}
      >
        <label className="field">
          <span>
            What to place <em className="muted">optional</em>
          </span>
          <input
            type="text"
            value={wish}
            maxLength={500}
            placeholder="Fishing villages along the coast"
            onChange={(e) => setWish(e.target.value)}
          />
        </label>
        <label className="field">
          <span>How many</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="order-buttons">
          <button type="submit" className="primary" disabled={marked.length === 0 || busy}>
            Propose
          </button>
          {marked.length > 0 && (
            <button type="button" className="quiet" onClick={onClear}>
              Clear the spot
            </button>
          )}
        </p>
      </form>
      {busy && (
        <p className="muted" role="status">
          Thinking of what could be there…
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {ghosts.length > 0 && (
        <ul className="place-list" aria-label="Proposed features">
          {ghosts.map((g) => {
            const look = choiceName(g.choice, choices);
            return (
              <li key={g.key} className={picked === g.key ? "is-picked" : ""}>
                <button type="button" className="plain place-name" onClick={() => onPick(g.key)}>
                  <strong>{g.name}</strong>
                  {look && <em className="muted"> · {look}</em>}
                </button>
                <p>{g.description}</p>
                <span className="order-buttons">
                  <button
                    type="button"
                    className="primary"
                    aria-label={`Place ${g.name}`}
                    onClick={() => {
                      onAccept(g);
                      drop(g.key);
                    }}
                  >
                    Place
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Discard ${g.name}`}
                    onClick={() => drop(g.key)}
                  >
                    Discard
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
