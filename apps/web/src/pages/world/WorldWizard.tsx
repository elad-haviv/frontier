/**
 * The World Wizard (stage 34, release 1): a world built in parts, each reading the one before:
 * how it sits and spins, its land and sea, its plates and their drift, its heights, its climate
 * and its biomes. The last part makes a globe map of it in the project, with its height map and
 * biome zones, as unsaved changes. What is built so far waits on this device, so leaving loses
 * nothing. See docs/designs/stage-34-world-wizard.md.
 */
import { BIOME_KINDS, BIOMES } from "@frontier/schema";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, mapUrl } from "../../api.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { useProject } from "../../components/projectContext.ts";
import { useRefresh } from "../../components/Shell.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { useToast } from "../../components/ui/Toast.tsx";
import { shortcutText, useScope, useShortcut } from "../../keys.ts";
import { useMapStyles } from "../../map/useMapStyles.ts";
import { Link, useNavigate } from "../../nav.tsx";
import { useProjectWork } from "../../projectWork.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { makeWorld } from "../../world/make.ts";
import {
  brushCells,
  DEFAULT_SETTINGS,
  DIRECTION_NAMES,
  dirty,
  driftStep,
  ensure,
  factsOf,
  newWorld,
  type Stage,
  UNPAINTED,
  type World,
  type WorldSettings,
} from "../../world/model.ts";
import {
  BIOME_PAINT,
  type Layer,
  PLATE_PAINT,
  RAIN_RAMP,
  rampCss,
  TEMP_RAMP,
} from "../../world/picture.ts";
import {
  forgetWorld,
  keep,
  loadWorld,
  type Part,
  PART_NAMES,
  PARTS,
  restore,
  saveWorld,
} from "../../world/store.ts";
import { drainageOf, lakeMask, lakesOf, riversOf } from "../../world/rivers.ts";
import {
  DEFAULT_SYSTEM,
  rollSystem,
  sunWarmth,
  STARS,
  type SystemSettings,
  tidy,
  yearDays,
} from "../../world/system.ts";
import { worldZones, zoneCounts } from "../../world/zones.ts";
import { type LoreState, NO_LORE } from "../../world/lore.ts";
import { LorePanel, pinsOf } from "./LorePart.tsx";
import { SystemPanel, SystemView } from "./SystemPart.tsx";
import { type Turn, WorldCanvas } from "./WorldCanvas.tsx";
import "./WorldWizard.css";

/** What a part needs built before it can be shown. */
const NEEDS: Record<Part, Stage> = {
  system: "land",
  basics: "land",
  land: "land",
  plates: "sim",
  heights: "height",
  climate: "climate",
  biomes: "biome",
  lore: "biome",
  make: "biome",
};
/** Which stage a setting is read by first: changing it builds from there again. */
const READ_BY: Partial<Record<keyof WorldSettings, Stage>> = {
  tilt: "climate",
  spin: "climate",
  sea: "height",
  mountains: "height",
  rough: "height",
  warm: "climate",
  wet: "climate",
};
const ARROWS = "↑↗→↘↓↙←↖";
/** The compass, row by row: an index into the directions, or -1 for the middle. */
const COMPASS = [7, 0, 1, 6, -1, 2, 5, 4, 3];

function Slider({
  label,
  value,
  says,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  says: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="ww-slider">
      <span>{label}</span>
      <span className="ww-says">{says}</span>
      <input
        type="range"
        aria-valuetext={says}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Choice<T extends string | number | boolean>({
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

const seasons = (tilt: number) =>
  tilt < 8 ? "no seasons" : tilt < 30 ? "mild seasons" : "hard seasons";
const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${v}${unit}`;
const times = (v: number) => `${v.toFixed(1)}×`;

export function WorldWizardPage() {
  const project = useProject();
  const work = useProjectWork();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const dialogs = useDialogs();
  const toast = useToast();
  const offline = useNeedsConnection();
  const { styles, change: changeStyles } = useMapStyles();

  const [world, setWorld] = useState<World | null>(null);
  const [version, setVersion] = useState(0);
  const [title, setTitle] = useState("");
  const [part, setPart] = useState<Part>("basics");
  const [made, setMade] = useState<string | undefined>(undefined);
  const [system, setSystem] = useState<SystemSettings>(DEFAULT_SYSTEM);
  const [lore, setLore] = useState<LoreState>(NO_LORE);
  const [globe, setGlobe] = useState(true);
  const [dragTurns, setDragTurns] = useState(false);
  const [brush, setBrush] = useState(4);
  const [ink, setInk] = useState<0 | 1>(1);
  const [plate, setPlate] = useState(0);
  const [biomeInk, setBiomeInk] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [climateView, setClimateView] = useState<"rain" | "temp">("rain");
  const [winds, setWinds] = useState(true);
  const [grey, setGrey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const turn = useRef<Turn>({ lon: 0.4, lat: 0.3 });
  /** The land was drawn by hand since it was last rolled. */
  const drawn = useRef(false);
  /** Asked once and agreed: changing the land or the plates starts the drift again. */
  const agreed = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const projectId = work.ref.id;

  // The world waiting on this device, or a new one named after the project.
  useEffect(() => {
    let gone = false;
    void loadWorld(projectId).then((kept) => {
      if (gone) return;
      const back = kept ? restore(kept) : null;
      if (kept && back) {
        const sys = tidy(kept.system ?? DEFAULT_SYSTEM);
        back.s.sun = sunWarmth(sys);
        setSystem(sys);
        setLore({ ...NO_LORE, ...kept.lore });
        setTitle(kept.title);
        setPart(PARTS.includes(kept.part) ? kept.part : "basics");
        setMade(kept.made);
        setWorld(back);
      } else {
        setTitle(project.name);
        setSystem(DEFAULT_SYSTEM);
        setLore(NO_LORE);
        setPart("system");
        setWorld(fresh(DEFAULT_SYSTEM));
      }
    });
    return () => {
      gone = true;
    };
  }, [projectId, project.name]);

  // Kept a moment after each change, and when the page is left.
  const latest = useRef({ world, title, part, made, system, lore });
  latest.current = { world, title, part, made, system, lore };
  useEffect(() => {
    if (!world) return;
    const timer = window.setTimeout(
      () => void saveWorld(projectId, keep(world, title, part, { made, system, lore })),
      700,
    );
    return () => window.clearTimeout(timer);
  }, [world, version, title, part, made, system, lore, projectId]);
  useEffect(
    () => () => {
      const now = latest.current;
      if (now.world) {
        void saveWorld(
          projectId,
          keep(now.world, now.title, now.part, {
            made: now.made,
            system: now.system,
            lore: now.lore,
          }),
        );
      }
    },
    [projectId],
  );

  // The drift plays while the Plates part is open.
  useEffect(() => {
    if (!playing || !world || part !== "plates") return;
    const timer = window.setInterval(() => {
      driftStep(world);
      dirty(world, "height");
      bump();
    }, 110);
    return () => window.clearInterval(timer);
  }, [playing, world, part, bump]);
  useEffect(() => {
    if (part !== "plates") setPlaying(false);
  }, [part]);

  const go = useCallback((next: Part) => {
    setPart(next);
    setProblem(null);
    // The part's heading is read out, and the keyboard starts from it.
    window.setTimeout(() => heading.current?.focus({ preventScroll: true }), 0);
  }, []);

  /** Whether a drag on the view paints, in this part. */
  const paints = part === "land" || part === "plates" || (part === "biomes" && biomeInk !== null);
  const painting = paints && !(globe && dragTurns);

  useScope("world");
  useShortcut("world.view", () => setGlobe((g) => !g));
  useShortcut("world.play", () => (part === "plates" ? setPlaying((p) => !p) : false));
  useShortcut("world.smaller", () => (paints ? setBrush((b) => Math.max(1, b - 1)) : false));
  useShortcut("world.larger", () => (paints ? setBrush((b) => Math.min(12, b + 1)) : false));

  // The rivers follow the heights and the rain: drawn once there is a climate to read.
  const showsRivers = part === "climate" || part === "biomes" || part === "lore" || part === "make";
  const water = useMemo(() => {
    if (!world || !showsRivers) return { rivers: [], lakes: [], mask: null };
    const drainage = drainageOf(world);
    const lakes = lakesOf(world, 2, 40, drainage);
    return { rivers: riversOf(world, 6, 60, drainage), lakes, mask: lakeMask(lakes) };
  }, [world, version, showsRivers]);
  const rivers = water.rivers;

  if (!world) return <Progress label="Opening the wizard" />;
  ensure(world, NEEDS[part]);
  const s = world.s;

  /** Asks before the drift so far is lost, once: true to go on. */
  const mayRestartDrift = async (): Promise<boolean> => {
    if (world.my === 0 || agreed.current) return true;
    const ok = await dialogs.confirm({
      title: "Start the drift again?",
      body: `The plates have drifted for ${world.my} million years. Changing this puts them back to the start. Biomes you painted are kept where they still fit.`,
      action: "Change it",
    });
    agreed.current = ok;
    return ok;
  };
  const set = (key: keyof WorldSettings, value: number | boolean) => {
    (world.s as unknown as Record<string, number | boolean>)[key] = value;
    const from = READ_BY[key];
    if (from) dirty(world, from);
    bump();
  };
  /** The star system changed: the world's warmth follows its place by the star. */
  const changeSystem = (next: SystemSettings) => {
    setSystem(next);
    const sun = sunWarmth(next);
    if (sun !== world.s.sun) {
      world.s.sun = sun;
      dirty(world, "climate");
    }
    bump();
  };
  /** Rolls the land again from the settings: asks first when that loses drawing or drift. */
  const reroll = async (change: Partial<WorldSettings>) => {
    if (drawn.current) {
      const ok = await dialogs.confirm({
        title: "Replace the land you drew?",
        body: "Rolling the land again draws over what you painted.",
        action: "Roll it",
      });
      if (!ok) return;
    }
    if (!(await mayRestartDrift())) return;
    Object.assign(world.s, change);
    drawn.current = false;
    setPlaying(false);
    // A new seed rolls the plates too; the land's own settings leave them be.
    dirty(world, "seed" in change ? "land" : "sim");
    world.ok.land = false;
    bump();
  };
  const rollPlates = async (change: Partial<WorldSettings>) => {
    if (!(await mayRestartDrift())) return;
    Object.assign(world.s, change);
    setPlaying(false);
    setPlate(0);
    dirty(world, "plates");
    bump();
  };

  const stroke = (cell: number, first: boolean): boolean => {
    if (part === "land") {
      if (first && world.my > 0 && !agreed.current) {
        void mayRestartDrift();
        return false;
      }
      for (const j of brushCells(cell, brush)) world.land[j] = ink;
      drawn.current = true;
      dirty(world, "sim");
    } else if (part === "plates") {
      // Plates are drawn as they lie at the start: after a drift, that is asked first.
      if (first && world.my > 0) {
        if (!agreed.current) {
          void mayRestartDrift();
          return false;
        }
        setPlaying(false);
        dirty(world, "sim");
        ensure(world, "sim");
      }
      for (const j of brushCells(cell, brush)) world.plate[j] = plate;
      dirty(world, "height");
    } else if (part === "biomes" && biomeInk !== null) {
      for (const j of brushCells(cell, brush)) world.painted[j] = biomeInk;
      dirty(world, "biome");
    } else return false;
    bump();
    return true;
  };

  const surprise = async () => {
    const touched = drawn.current || world.my > 0 || world.painted.some((p) => p !== UNPAINTED);
    if (touched) {
      const ok = await dialogs.confirm({
        title: "Roll a whole new world?",
        body: "This replaces the world you have built so far.",
        action: "Roll it",
      });
      if (!ok) return;
    }
    const r = Math.random;
    const seed = 1000 + Math.floor(r() * 9000);
    const rolled = rollSystem(seed);
    setSystem(rolled);
    setLore((l) => ({ ...NO_LORE, know: l.know, species: l.species, magic: l.magic, age: l.age }));
    const next = newWorld({
      ...DEFAULT_SETTINGS,
      seed,
      sun: sunWarmth(rolled),
      landPct: 22 + Math.floor(r() * 30),
      few: r() < 0.6,
      plates: 6 + Math.floor(r() * 7),
      tilt: Math.floor(r() * 40),
      spin: r() < 0.8 ? 1 : -1,
    });
    ensure(next, "sim");
    for (let n = 0; n < 40; n++) driftStep(next);
    drawn.current = false;
    agreed.current = false;
    setPlaying(false);
    setMade(undefined);
    setWorld(next);
    setBiomeInk(null);
    go("biomes");
  };

  const make = async () => {
    if (busy) return;
    setProblem(null);
    try {
      const { map: id, skipped } = await makeWorld(work, world, title.trim() || project.name, {
        say: setBusy,
        system,
        lore,
        styles,
        addStyles: (add) =>
          void changeStyles((f) => ({
            ...f,
            styles: [...f.styles, ...add.filter((a) => !f.styles.some((x) => x.id === a.id))],
          })),
      });
      await saveWorld(projectId, keep(world, title, part, { made: id, system, lore }));
      setMade(id);
      if (!work.open()) return;
      refresh();
      navigate(mapUrl(id));
      // An entry the library already had under that name was left as it is, and said so.
      if (skipped.length > 0) {
        toast({
          message:
            skipped.length === 1
              ? `"${skipped[0]}" was already in the library and was left as it is.`
              : `${skipped.length} entries were already in the library and were left as they are: ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? "…" : ""}.`,
        });
      }
    } catch (err) {
      setProblem(
        err instanceof ApiFailure || err instanceof Error
          ? err.message
          : "The world could not be made.",
      );
    } finally {
      setBusy(null);
    }
  };

  const startOver = async () => {
    const ok = await dialogs.confirm({
      title: "Start a new world?",
      body: made
        ? "The map already made stays in the project. The wizard starts again from nothing."
        : "What you have built in the wizard is thrown away.",
      action: "Start again",
      danger: !made,
    });
    if (!ok) return;
    await forgetWorld(projectId);
    drawn.current = false;
    agreed.current = false;
    setMade(undefined);
    setPlaying(false);
    setBiomeInk(null);
    setSystem(DEFAULT_SYSTEM);
    setLore(NO_LORE);
    setWorld(fresh(DEFAULT_SYSTEM));
    go("system");
  };

  const layer: Layer =
    part === "basics"
      ? "natural"
      : part === "land"
        ? "mask"
        : part === "plates"
          ? "plates"
          : part === "heights"
            ? grey
              ? "grey"
              : "height"
            : part === "climate"
              ? climateView
              : "biome";
  const at = PARTS.indexOf(part);
  const foot = (
    <div className="ww-foot">
      {at > 0 ? (
        <button type="button" className="quiet" onClick={() => go(PARTS[at - 1]!)}>
          Back
        </button>
      ) : (
        <span />
      )}
      {at < PARTS.length - 1 && (
        <button type="button" className="primary" onClick={() => go(PARTS[at + 1]!)}>
          {PART_NAMES[PARTS[at + 1]!]}
        </button>
      )}
    </div>
  );
  const brushSlider = (
    <Slider
      label="Brush size"
      value={brush}
      says={String(brush)}
      min={1}
      max={12}
      step={1}
      onChange={setBrush}
    />
  );

  let panel: ReactNode = null;
  if (part === "system") {
    panel = (
      <SystemPanel
        system={system}
        day={s.day}
        size={s.size}
        onChange={changeSystem}
        onRoll={() => changeSystem(rollSystem(Math.floor(Math.random() * 1e6)))}
      />
    );
  } else if (part === "basics") {
    panel = (
      <>
        <p className="ww-sub">
          How the world sits and spins. The tilt gives seasons; the spin decides which way the winds
          and the sun go.
        </p>
        <Slider
          label="Tilt of the axis"
          value={s.tilt}
          says={`${s.tilt}° · ${seasons(s.tilt)}`}
          min={0}
          max={60}
          step={1}
          onChange={(v) => set("tilt", v)}
        />
        <Slider
          label="Length of a day"
          value={s.day}
          says={`${s.day} hours`}
          min={8}
          max={60}
          step={1}
          onChange={(v) => set("day", v)}
        />
        <Slider
          label="Size"
          value={s.size}
          says={`${s.size.toFixed(1)} × Earth`}
          min={0.5}
          max={1.8}
          step={0.1}
          onChange={(v) => set("size", v)}
        />
        <Choice
          label="It spins"
          value={s.spin}
          options={[
            [1, "West to east, like Earth"],
            [-1, "East to west"],
          ]}
          onChange={(v) => set("spin", v)}
        />
        <div className="ww-facts">
          <span>
            The sun rises in the <b>{s.spin > 0 ? "east" : "west"}</b>. Gravity is about{" "}
            <b>{times(s.size)}</b> Earth&apos;s, if it is made of the same stuff.
          </span>
          <span>
            It is <b>{Math.round(40030 * s.size).toLocaleString()} km</b> round. A year is{" "}
            <b>{yearDays(system, s.day).toLocaleString()}</b> days.
          </span>
        </div>
      </>
    );
  } else if (part === "land") {
    panel = (
      <>
        <p className="ww-sub">
          Roll a start, draw it yourself, or both. White is land, black is sea.
        </p>
        <Slider
          label="How much land"
          value={s.landPct}
          says={`${s.landPct}%`}
          min={8}
          max={70}
          step={1}
          onChange={(v) => void reroll({ landPct: v })}
        />
        <Choice
          label="Shape"
          value={s.few}
          options={[
            [true, "A few large lands"],
            [false, "Many small ones"],
          ]}
          onChange={(v) => void reroll({ few: v })}
        />
        <div className="ww-row">
          <button
            type="button"
            className="quiet"
            onClick={() => void reroll({ seed: 1000 + Math.floor(Math.random() * 9000) })}
          >
            Roll again
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() =>
              void mayRestartDrift().then((ok) => {
                if (!ok) return;
                world.land.fill(0);
                drawn.current = true;
                dirty(world, "sim");
                bump();
              })
            }
          >
            Start from all sea
          </button>
        </div>
        <Choice
          label="Brush"
          value={ink}
          options={[
            [1, "Land (white)"],
            [0, "Sea (black)"],
          ]}
          onChange={setInk}
        />
        {brushSlider}
      </>
    );
  } else if (part === "plates") {
    const d = world.drift[plate] ?? { dir: 0, speed: 0 };
    panel = (
      <>
        <p className="ww-sub">
          The crust in pieces, each drifting its own way. Where two meet, mountains rise; where they
          part, new sea floor opens. Play it for as long as you like.
        </p>
        <Slider
          label="Number of plates"
          value={s.plates}
          says={String(s.plates)}
          min={3}
          max={14}
          step={1}
          onChange={(v) => void rollPlates({ plates: v })}
        />
        <div className="ww-row">
          <button
            type="button"
            className="quiet"
            onClick={() => void rollPlates({ seed: s.seed + 7 })}
          >
            Roll the plates
          </button>
        </div>
        <div className="ww-group">
          <span className="ww-label">
            Pick a plate, then paint its area on the map or set its drift
          </span>
          <div className="ww-chips">
            {world.drift.map((_, p) => (
              <button
                key={p}
                type="button"
                className="ww-swatch"
                style={{ background: PLATE_PAINT[p % PLATE_PAINT.length] }}
                aria-pressed={p === plate}
                aria-label={`Plate ${p + 1}`}
                onClick={() => setPlate(p)}
              />
            ))}
          </div>
        </div>
        <div className="ww-drift">
          <div className="ww-compass" role="group" aria-label="Direction of drift">
            {COMPASS.map((dir, n) =>
              dir < 0 ? (
                <span key={n} />
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-pressed={d.dir === dir}
                  aria-label={`Drift ${DIRECTION_NAMES[dir]}`}
                  onClick={() => {
                    d.dir = dir;
                    // It heads that way from where it is now: the point it turns about is found again.
                    delete d.axis;
                    dirty(world, "height");
                    bump();
                  }}
                >
                  {ARROWS[dir]}
                </button>
              ),
            )}
          </div>
          <div className="ww-drift-sliders">
            <Slider
              label="Speed"
              value={d.speed}
              says={`${d.speed} cm a year`}
              min={0}
              max={12}
              step={1}
              onChange={(v) => {
                d.speed = v;
                dirty(world, "height");
                bump();
              }}
            />
            {brushSlider}
          </div>
        </div>
        <div className="ww-facts">
          <div className="ww-row">
            <button
              type="button"
              className="primary"
              title={shortcutText("world.play")}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setPlaying(false);
                driftStep(world);
                dirty(world, "height");
                agreed.current = false;
                bump();
              }}
            >
              Step
            </button>
            <button
              type="button"
              className="quiet"
              disabled={world.my === 0}
              onClick={() => {
                setPlaying(false);
                dirty(world, "sim");
                bump();
              }}
            >
              Back to the start
            </button>
          </div>
          <span aria-live="off">
            <b>{world.my}</b> million years have passed
          </span>
        </div>
      </>
    );
  } else if (part === "heights") {
    const facts = factsOf(world);
    panel = (
      <>
        <p className="ww-sub">
          From the plates: ranges where they met, shelves along the coasts, deep sea floor between.
          This becomes the map&apos;s height map.
        </p>
        <Slider
          label="Sea level"
          value={s.sea}
          says={signed(Math.round(s.sea * 9000), " m")}
          min={-0.15}
          max={0.15}
          step={0.01}
          onChange={(v) => set("sea", v)}
        />
        <Slider
          label="Mountain height"
          value={s.mountains}
          says={times(s.mountains)}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => set("mountains", v)}
        />
        <Slider
          label="Roughness"
          value={s.rough}
          says={times(s.rough)}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => set("rough", v)}
        />
        <Choice
          label="Show as"
          value={grey}
          options={[
            [false, "Colours"],
            [true, "Height map (grey)"],
          ]}
          onChange={setGrey}
        />
        <div className="ww-facts">
          <span>
            <b>{facts.land}%</b> of the surface is land
          </span>
          <span>
            The highest ground is about <b>{facts.peak.toLocaleString()} m</b>
          </span>
        </div>
      </>
    );
  } else if (part === "climate") {
    panel = (
      <>
        <p className="ww-sub">
          Warmth from the tilt and the height, wind from the spin, rain where wet wind meets land
          and rises. Dry land lies behind mountains.
        </p>
        <Choice
          label="Show"
          value={climateView}
          options={[
            ["rain", "Rain"],
            ["temp", "Temperature"],
          ]}
          onChange={setClimateView}
        />
        <div className="ww-key" aria-hidden="true">
          <span>{climateView === "rain" ? "dry" : "cold"}</span>
          <i style={{ background: rampCss(climateView === "rain" ? RAIN_RAMP : TEMP_RAMP) }} />
          <span>{climateView === "rain" ? "wet" : "hot"}</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={winds} onChange={(e) => setWinds(e.target.checked)} />{" "}
          Wind arrows
        </label>
        <Slider
          label="Warmer or colder"
          value={s.warm}
          says={signed(s.warm, "°")}
          min={-20}
          max={20}
          step={1}
          onChange={(v) => set("warm", v)}
        />
        <Slider
          label="Wetter or drier"
          value={s.wet}
          says={times(s.wet)}
          min={0.4}
          max={1.8}
          step={0.1}
          onChange={(v) => set("wet", v)}
        />
        <div className="ww-facts">
          <span>
            From Basics: a tilt of {s.tilt}°, spinning{" "}
            {s.spin > 0 ? "west to east" : "east to west"}.
          </span>
          {s.sun !== 0 && (
            <span>
              From the star: about {Math.abs(s.sun)}° {s.sun > 0 ? "warmer" : "colder"} than Earth.
            </span>
          )}
        </div>
      </>
    );
  } else if (part === "biomes") {
    const facts = factsOf(world);
    const anyPainted = world.painted.some((p) => p !== UNPAINTED);
    panel = (
      <>
        <p className="ww-sub">
          What grows where, from the warmth and the rain. Pick one and paint to overrule; these
          become biome zones on the map.
        </p>
        <div className="ww-legend">
          {BIOME_KINDS.map((kind, n) => {
            const share = facts.shares[n] ?? 0;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={biomeInk === n}
                onClick={() => setBiomeInk(biomeInk === n ? null : n)}
              >
                <i style={{ background: BIOME_PAINT[n] }} />
                <span>{BIOMES[kind].name}</span>
                <span className="ww-share">
                  {share === 0 ? "–" : share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`}
                </span>
              </button>
            );
          })}
        </div>
        {biomeInk !== null && brushSlider}
        <div className="ww-row">
          <button
            type="button"
            className="quiet"
            disabled={!anyPainted}
            onClick={() => {
              world.painted.fill(UNPAINTED);
              dirty(world, "biome");
              bump();
            }}
          >
            Clear what I painted
          </button>
        </div>
      </>
    );
  } else if (part === "lore") {
    panel = (
      <LorePanel
        world={world}
        version={version}
        name={title.trim() || project.name}
        system={system}
        rivers={rivers}
        lore={lore}
        onChange={setLore}
      />
    );
  } else {
    panel = (
      <MakePanel
        world={world}
        version={version}
        title={title}
        setTitle={setTitle}
        system={system}
        rivers={rivers.length}
        lakes={water.lakes.length}
        entries={lore.items.filter((i) => i.on && i.title.trim() !== "").length}
      />
    );
  }

  return (
    <article className="entry wide ww">
      <header className="ww-head">
        <h1>World Wizard</h1>
        <span className="ww-seed">
          Seed <b>{s.seed}</b>
        </span>
        <span className="ww-grow" />
        <button type="button" className="quiet" onClick={() => void surprise()}>
          Surprise me
        </button>
        <button type="button" className="quiet" onClick={() => void startOver()}>
          Start over
        </button>
      </header>
      <nav className="ww-parts" aria-label="Parts of the wizard">
        {PARTS.map((p, n) => (
          <button
            key={p}
            type="button"
            className={n < at ? "is-done" : undefined}
            aria-current={p === part ? "step" : undefined}
            onClick={() => go(p)}
          >
            {n + 1} {PART_NAMES[p]}
          </button>
        ))}
      </nav>
      <div className="ww-body">
        <div className="ww-view">
          {part === "system" && <SystemView system={system} />}
          <WorldCanvas
            hidden={part === "system"}
            rivers={rivers}
            lakes={water.mask}
            pins={part === "lore" || part === "make" ? pinsOf(lore.items) : undefined}
            world={world}
            layer={layer}
            globe={globe}
            version={version}
            turn={turn}
            painting={painting}
            onStroke={stroke}
            onStrokeEnd={bump}
            selectedPlate={plate}
            winds={winds}
            tilt={part === "basics" ? s.tilt : 0}
            spinning={part === "basics" ? (s.spin * 24) / s.day : 0}
          />
          <div className="ww-corner" hidden={part === "system"}>
            <div className="ww-seg" role="group" aria-label="View">
              <button
                type="button"
                aria-pressed={globe}
                title={shortcutText("world.view")}
                onClick={() => setGlobe(true)}
              >
                Globe
              </button>
              <button type="button" aria-pressed={!globe} onClick={() => setGlobe(false)}>
                Flat
              </button>
            </div>
            {globe && paints && (
              <div className="ww-seg" role="group" aria-label="What a drag does">
                <button type="button" aria-pressed={!dragTurns} onClick={() => setDragTurns(false)}>
                  Paint
                </button>
                <button type="button" aria-pressed={dragTurns} onClick={() => setDragTurns(true)}>
                  Turn
                </button>
              </div>
            )}
          </div>
        </div>
        <section className="ww-panel" aria-labelledby="ww-part">
          <h2 id="ww-part" ref={heading} tabIndex={-1}>
            {part === "make" ? "Make the world" : PART_NAMES[part]}
          </h2>
          {panel}
          {part === "make" && (
            <>
              {made && (
                <p className="ww-made" role="status">
                  A map was made from this world. <Link to={mapUrl(made)}>Open the map</Link>
                </p>
              )}
              {problem && (
                <p className="error" role="alert">
                  {problem}
                </p>
              )}
              {busy && (
                <p className="ww-busy" role="status">
                  {busy}
                </p>
              )}
            </>
          )}
          {part === "make" ? (
            <div className="ww-foot">
              <button type="button" className="quiet" onClick={() => go("biomes")}>
                Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy !== null || offline !== undefined || title.trim() === ""}
                title={offline}
                onClick={() => void make()}
              >
                {busy ? "Making it…" : made ? "Make it again, as another map" : "Make the world"}
              </button>
            </div>
          ) : (
            foot
          )}
        </section>
      </div>
    </article>
  );
}

/** A new world, warmed by its place in the system. */
function fresh(system: SystemSettings): World {
  return newWorld({
    ...DEFAULT_SETTINGS,
    seed: 1000 + Math.floor(Math.random() * 9000),
    sun: sunWarmth(system),
  });
}

function MakePanel({
  world,
  version,
  title,
  setTitle,
  system,
  rivers,
  lakes,
  entries,
}: {
  world: World;
  version: number;
  title: string;
  setTitle: (t: string) => void;
  system: SystemSettings;
  rivers: number;
  lakes: number;
  /** How many of the life and lore's items are ticked. */
  entries: number;
}) {
  // Outlining the zones takes a moment, so only when the world has changed.
  const zones = useMemo(() => worldZones(world), [world, version]);
  const kinds = zoneCounts(zones);
  const facts = factsOf(world);
  return (
    <>
      <p className="ww-sub">
        The world becomes a map in this project, as unsaved changes: look at it, change what you
        like, then save a version.
      </p>
      <label className="field">
        <span>Name of the world</span>
        <input
          type="text"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <ul className="ww-makes">
        <li>
          <b>A globe map</b>
          <span>
            A painted picture of the whole world,{" "}
            {Math.round(40030 * world.s.size).toLocaleString()} km round, {facts.land}% land.
          </span>
        </li>
        <li>
          <b>Its height map</b>
          <span>
            Set as the map&apos;s terrain, with the sea level marked and the highest ground at about{" "}
            {facts.peak.toLocaleString()} m.
          </span>
        </li>
        <li>
          <b>
            {zones.length} biome {zones.length === 1 ? "zone" : "zones"}
          </b>
          <span>
            {kinds.length === 0
              ? "This world is all sea."
              : kinds.map((k) => `${BIOMES[k.kind].name} (${k.count})`).join(", ")}
          </span>
        </li>
        <li>
          <b>
            {rivers} {rivers === 1 ? "river" : "rivers"}
            {lakes > 0 ? ` and ${lakes} ${lakes === 1 ? "lake" : "lakes"}` : ""}
          </b>
          <span>
            {rivers === 0
              ? "Too little rain gathers on this world for one."
              : "Where the rain runs to the sea and where it gathers, in a layer of their own."}
          </span>
        </li>
        <li>
          <b>A system model</b>
          <span>
            {STARS[system.star].name} star{system.twin ? " and its companion" : ""},{" "}
            {system.planets.length} {system.planets.length === 1 ? "planet" : "planets"},{" "}
            {system.moons === 0
              ? "no moon"
              : system.moons === 1
                ? "one moon"
                : `${system.moons} moons`}
            . The world on it opens this map.
          </span>
        </li>
        <li>
          <b>An entry: the sky and the calendar</b>
          <span>
            A year of {yearDays(system, world.s.day).toLocaleString()} days, the months and the
            seasons, for you to name.
          </span>
        </li>
        <li>
          <b>
            {entries + 1} more {entries + 1 === 1 ? "entry" : "entries"}
          </b>
          <span>
            The World brief (the numbers and choices the world was built from)
            {entries > 0
              ? `, and the ${entries} you ticked in Life and lore: places with a marker on the map, species with a homeland.`
              : ". Nothing is ticked in Life and lore."}
          </span>
        </li>
      </ul>
      <div className="ww-facts">
        <span>
          Seed <b>{world.s.seed}</b>, {world.my} million years of drift.
        </span>
      </div>
    </>
  );
}
