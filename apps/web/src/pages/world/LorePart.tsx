/**
 * The World Wizard's life and lore part (stage 34, release 3): the places found on the world,
 * and, with the person's AI key, names and first entries for them, for the sapient species and
 * for the life. Everything is a suggestion: ticked, renamed, or left out.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure } from "../../api.ts";
import { useProjectWork } from "../../projectWork.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import {
  AGES,
  findPlaces,
  GROUP_NAMES,
  type LoreGroup,
  type LoreItem,
  loreRequest,
  type LoreState,
  MAGIC,
  placeItems,
  SPECIES_CHOICES,
  stampOf,
  withAnswer,
} from "../../world/lore.ts";
import type { World } from "../../world/model.ts";
import type { River } from "../../world/rivers.ts";
import type { SystemSettings } from "../../world/system.ts";

/** The places with a pin on the view: the ticked places, numbered in order. */
export function pinsOf(items: readonly LoreItem[]): { id: string; cell: number; n: number }[] {
  return items
    .filter((i) => i.group === "place" && i.cell !== undefined)
    .map((i, n) => ({ id: i.id, cell: i.cell!, n: n + 1, on: i.on }))
    .filter((p) => p.on)
    .map(({ id, cell, n }) => ({ id, cell, n }));
}

export function LorePanel({
  world,
  version,
  name,
  system,
  rivers,
  lore,
  onChange,
}: {
  world: World;
  version: number;
  name: string;
  system: SystemSettings;
  rivers: readonly River[];
  lore: LoreState;
  onChange: (next: LoreState) => void;
}) {
  const work = useProjectWork();
  const offline = useNeedsConnection();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const asking = useRef<AbortController | null>(null);
  const places = useMemo(() => findPlaces(world, rivers), [world, version, rivers]);
  const stamp = useMemo(() => stampOf(world), [world, version]);
  const written = lore.items.some((i) => i.written);
  const stale = lore.stamp !== stamp;

  // The places are found again whenever the world has changed, unless the AI has written about
  // the ones found before: those are kept until the author says otherwise.
  useEffect(() => {
    if (stale && !written) onChange({ ...lore, items: placeItems(places), stamp });
  }, [stale, written, stamp]);
  useEffect(() => () => asking.current?.abort(), []);

  const suggest = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const stop = new AbortController();
    asking.current = stop;
    try {
      const { lore: answer } = await work.api.worldLore(
        loreRequest(name, world, system, places, lore),
        stop.signal,
      );
      onChange({ ...lore, items: withAnswer(places, stale ? [] : lore.items, answer), stamp });
    } catch (err) {
      if (!stop.signal.aborted) {
        setProblem(err instanceof ApiFailure ? err.message : "The suggestions could not be made.");
      }
    } finally {
      setBusy(false);
      asking.current = null;
    }
  };
  const item = (id: string, change: Partial<LoreItem>) =>
    onChange({ ...lore, items: lore.items.map((i) => (i.id === id ? { ...i, ...change } : i)) });
  const pins = new Map(pinsOf(lore.items.map((i) => ({ ...i, on: true }))).map((p) => [p.id, p.n]));
  const groups = (["place", "species", "life"] as LoreGroup[]).filter((g) =>
    lore.items.some((i) => i.group === g),
  );

  return (
    <>
      <p className="ww-sub">
        Places found on the world you built, each a marker on the map. With your AI key the wizard
        names them and suggests the sapient species and the life. Tick what becomes an entry.
      </p>
      <label className="ww-group">
        <span className="ww-label">Anything you already know about who lives here?</span>
        <textarea
          className="ww-know"
          value={lore.know}
          maxLength={2000}
          placeholder="Salt is money on one coast. Nobody has crossed the great waste."
          onChange={(e) => onChange({ ...lore, know: e.target.value })}
        />
      </label>
      <Chips
        label="Sapient species"
        value={lore.species}
        options={SPECIES_CHOICES}
        onChange={(species) => onChange({ ...lore, species })}
      />
      <Chips
        label="Magic"
        value={lore.magic}
        options={MAGIC.map((m) => [m, m] as const)}
        onChange={(magic) => onChange({ ...lore, magic })}
      />
      <Chips
        label="The present age"
        value={lore.age}
        options={AGES.map((a) => [a, a] as const)}
        onChange={(age) => onChange({ ...lore, age })}
      />
      <div className="ww-row">
        {busy ? (
          <button type="button" className="quiet" onClick={() => asking.current?.abort()}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={offline !== undefined}
            title={offline}
            onClick={() => void suggest()}
          >
            {written ? "Suggest again" : "Suggest names and entries"}
          </button>
        )}
        {busy && (
          <span className="ww-busy" role="status">
            Reading the world and writing…
          </span>
        )}
      </div>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {stale && written && (
        <div className="ww-facts" role="status">
          <span>
            The world has changed since these were suggested. The pins show the old places.
          </span>
          <div className="ww-row">
            <button
              type="button"
              className="quiet"
              onClick={() => onChange({ ...lore, items: placeItems(places), stamp })}
            >
              Find the places again
            </button>
          </div>
        </div>
      )}
      {lore.items.length === 0 && (
        <p className="ww-sub">This world has no land to find a place on.</p>
      )}
      {groups.map((group) => (
        <section key={group} className="ww-lore" aria-label={GROUP_NAMES[group]}>
          <h3>{GROUP_NAMES[group]}</h3>
          {lore.items
            .filter((i) => i.group === group)
            .map((i) => (
              <div key={i.id} className={`ww-lore-item${i.on ? "" : " is-off"}`}>
                <input
                  type="checkbox"
                  checked={i.on}
                  aria-label={`Make an entry of ${i.title}`}
                  onChange={(e) => item(i.id, { on: e.target.checked })}
                />
                <span className={`ww-pin${pins.has(i.id) ? "" : " is-none"}`} aria-hidden="true">
                  {pins.get(i.id) ?? ""}
                </span>
                <input
                  type="text"
                  className="ww-lore-title"
                  value={i.title}
                  maxLength={80}
                  aria-label="Name"
                  onChange={(e) => item(i.id, { title: e.target.value })}
                />
                <p>{i.text}</p>
              </div>
            ))}
        </section>
      ))}
    </>
  );
}

function Chips<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="ww-group" role="group" aria-label={label}>
      <span className="ww-label">{label}</span>
      <div className="ww-chips">
        {options.map(([v, words]) => (
          <button
            key={String(v)}
            type="button"
            className="ww-chip"
            aria-pressed={v === value}
            onClick={() => onChange(v)}
          >
            {words}
          </button>
        ))}
      </div>
    </div>
  );
}
