/**
 * The World Wizard's star system part (stage 34, release 2): the system seen from above, with
 * the band where water stays liquid, and the controls for its star, planets and moons.
 */
import { X } from "lucide-react";
import {
  FARTHEST,
  homeOf,
  liquidBand,
  monthDays,
  NEAREST,
  PLANET_KINDS,
  type PlanetKind,
  PLANETS,
  STAR_KINDS,
  STARS,
  sunWarmth,
  type SystemSettings,
  tidy,
  verdictOf,
  withHome,
  yearDays,
} from "../../world/system.ts";

const SIZE = 480;
const MID = SIZE / 2;
/** Where an orbit of `a` AU is drawn: far orbits are drawn closer together, so all of them fit. */
const ring = (a: number) => ((MID - 14) * Math.log(1 + a * 6)) / Math.log(1 + FARTHEST * 6);
/** A slider's place, 0 to 100, for a distance, and back: even steps multiply the distance. */
const toSlider = (a: number) =>
  Math.round((100 * Math.log(a / NEAREST)) / Math.log(FARTHEST / NEAREST));
const fromSlider = (v: number) =>
  Math.round(NEAREST * (FARTHEST / NEAREST) ** (v / 100) * 100) / 100;

export function SystemView({ system }: { system: SystemSettings }) {
  const star = STARS[system.star];
  const [near, far] = liquidBand(system);
  const home = homeOf(system);
  return (
    <svg
      className="ww-system"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="The star system seen from above"
    >
      {system.life && (
        <circle
          cx={MID}
          cy={MID}
          r={(ring(near) + ring(far)) / 2}
          fill="none"
          stroke="#3f8f5f"
          strokeOpacity={0.38}
          strokeWidth={ring(far) - ring(near)}
        />
      )}
      {system.planets.map((p, n) => {
        const r = ring(p.a);
        const angle = n * 2.1 + 0.6;
        const x = MID + r * Math.cos(angle);
        const y = MID + r * Math.sin(angle);
        const isHome = p === home;
        return (
          <g key={n}>
            <circle
              cx={MID}
              cy={MID}
              r={r}
              fill="none"
              stroke="#c9cbd3"
              strokeOpacity={isHome ? 0.7 : 0.25}
            />
            <circle
              cx={x}
              cy={y}
              r={PLANETS[p.kind].radius * (isHome ? 1.25 : 1)}
              fill={isHome ? "#5a90ab" : PLANETS[p.kind].colour}
              stroke={isHome ? "#fff" : "none"}
              strokeWidth={1.5}
            />
            {isHome &&
              Array.from({ length: system.moons }, (_, m) => (
                <circle
                  key={m}
                  cx={x + (12 + m * 6) * Math.cos(m * 2.3 + 1)}
                  cy={y + (12 + m * 6) * Math.sin(m * 2.3 + 1)}
                  r={2}
                  fill="#d9d9d9"
                />
              ))}
            {isHome && (
              <text
                x={x}
                y={y - 16 - system.moons * 4}
                fill="#fff"
                fontSize={12}
                textAnchor="middle"
              >
                the world
              </text>
            )}
          </g>
        );
      })}
      {system.twin ? (
        <>
          <circle cx={MID - 7} cy={MID} r={9} fill={star.colour} />
          <circle cx={MID + 9} cy={MID} r={5.5} fill={STARS.M.colour} />
        </>
      ) : (
        <circle cx={MID} cy={MID} r={10} fill={star.colour} />
      )}
    </svg>
  );
}

const WORDS: Record<string, string> = {
  hot: "Too close: the seas would boil. Move it into the green band, or ignore the rule.",
  cold: "Too far: the seas would freeze. Move it into the green band, or ignore the rule.",
  inside: "The world is in the band where water stays liquid.",
  off: "The rule is off. The climate starts from Earth's own warmth.",
  none: "There is no planet to be the world. Add one.",
};

export function SystemPanel({
  system,
  day,
  size,
  onChange,
  onRoll,
}: {
  system: SystemSettings;
  /** The world's day, in hours, and its size: for the year and the months. */
  day: number;
  size: number;
  onChange: (next: SystemSettings) => void;
  onRoll: () => void;
}) {
  const verdict = verdictOf(system);
  const home = homeOf(system);
  const warmth = sunWarmth(system);
  const months = monthDays(system, day, size);
  const planet = (n: number, change: Partial<SystemSettings["planets"][number]>) =>
    onChange({
      ...system,
      planets: system.planets.map((p, k) => (k === n ? { ...p, ...change } : p)),
    });
  return (
    <>
      <p className="ww-sub">
        The star, what circles it, and which one is the world. This sets the year, the warmth the
        climate starts from, and the sky.
      </p>
      <div className="ww-group" role="group" aria-label="Star">
        <span className="ww-label">Star</span>
        <div className="ww-chips">
          {STAR_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className="ww-chip"
              aria-pressed={system.star === k}
              onClick={() => onChange({ ...system, star: k })}
            >
              {STARS[k].name}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={system.twin}
          onChange={(e) => onChange({ ...system, twin: e.target.checked })}
        />{" "}
        A second, smaller star
      </label>
      <div className="ww-group">
        <span className="ww-label">Planets, from the star outward</span>
        <ol className="ww-planets">
          {system.planets.map((p, n) => (
            <li key={n}>
              <span
                className="ww-dot"
                style={{ background: p === home ? "#5a90ab" : PLANETS[p.kind].colour }}
              />
              <select
                value={p.kind}
                aria-label={`Kind of planet ${n + 1}`}
                onChange={(e) =>
                  onChange(
                    tidy({
                      ...system,
                      planets: system.planets.map((q, k) =>
                        k === n ? { kind: e.target.value as PlanetKind, a: q.a } : q,
                      ),
                    }),
                  )
                }
              >
                {PLANET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PLANETS[k].name}
                  </option>
                ))}
              </select>
              <label className="ww-home">
                <input
                  type="radio"
                  name="ww-home"
                  checked={p === home}
                  disabled={p.kind !== "rocky"}
                  onChange={() => onChange(withHome(system, n))}
                />{" "}
                the world
              </label>
              <button
                type="button"
                className="ww-remove"
                aria-label={`Remove planet ${n + 1}`}
                onClick={() =>
                  onChange(tidy({ ...system, planets: system.planets.filter((_, k) => k !== n) }))
                }
              >
                <X size={16} aria-hidden="true" />
              </button>
              <label className="ww-slider">
                <span>Distance</span>
                <span className="ww-says">{p.a.toFixed(2)} AU</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={toSlider(p.a)}
                  aria-label={`Distance of planet ${n + 1}`}
                  aria-valuetext={`${p.a.toFixed(2)} AU`}
                  onChange={(e) => planet(n, { a: fromSlider(Number(e.target.value)) })}
                />
              </label>
            </li>
          ))}
        </ol>
        <div className="ww-row">
          <button
            type="button"
            className="quiet"
            disabled={system.planets.length >= 10}
            onClick={() => {
              const last = system.planets[system.planets.length - 1];
              onChange(
                tidy({
                  ...system,
                  planets: [
                    ...system.planets,
                    { kind: "rocky", a: Math.min(FARTHEST, last ? last.a * 1.7 : 1) },
                  ],
                }),
              );
            }}
          >
            Add a planet
          </button>
        </div>
      </div>
      <div className="ww-group" role="group" aria-label="Moons of the world">
        <span className="ww-label">Moons of the world</span>
        <div className="ww-chips">
          {["None", "One", "Two", "Three"].map((words, n) => (
            <button
              key={n}
              type="button"
              className="ww-chip"
              aria-pressed={system.moons === n}
              onClick={() => onChange({ ...system, moons: n })}
            >
              {words}
            </button>
          ))}
        </div>
      </div>
      <div className="ww-group" role="group" aria-label="Life">
        <span className="ww-label">Life</span>
        <div className="ww-chips">
          <button
            type="button"
            className="ww-chip"
            aria-pressed={system.life}
            onClick={() => onChange({ ...system, life: true })}
          >
            Keep it able to hold life
          </button>
          <button
            type="button"
            className="ww-chip"
            aria-pressed={!system.life}
            onClick={() => onChange({ ...system, life: false })}
          >
            Ignore that
          </button>
        </div>
      </div>
      <div className="ww-facts" role="status">
        <span className={verdict === "hot" || verdict === "cold" ? "ww-warn" : undefined}>
          {WORDS[verdict]}
        </span>
        {home && (
          <span>
            A year is <b>{yearDays(system, day).toLocaleString()}</b> of its days.{" "}
            {months.length > 0
              ? `A month is ${months[0]} days, by the ${months.length > 1 ? "nearest moon" : "moon"}.`
              : "No moon, so no months, and weak tides."}
          </span>
        )}
        {verdict === "inside" && warmth !== 0 && (
          <span>
            By its place in the band it starts out about{" "}
            <b>
              {Math.abs(warmth)}° {warmth > 0 ? "warmer" : "colder"}
            </b>{" "}
            than Earth.
          </span>
        )}
      </div>
      <div className="ww-row">
        <button type="button" className="quiet" onClick={onRoll}>
          Roll a system
        </button>
      </div>
    </>
  );
}
