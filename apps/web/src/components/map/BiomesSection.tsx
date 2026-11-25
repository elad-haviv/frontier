import {
  allBiomes,
  BIOME_KINDS,
  BIOME_MODES,
  BIOMES,
  type BiomeKind,
  type CustomBiome,
  type MapStyle,
  type Pattern,
  PATTERNS,
  RIVER_RULES,
  RIVER_WORDS,
  speedWords,
  STARTER_BIOME_STYLES,
} from "@frontier/schema";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useBiomes } from "../../map/useBiomes.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { useToast } from "../ui/Toast.tsx";
import { BiomeSwatch } from "./BiomePicker.tsx";

const MODE_NAMES = { foot: "On foot", horse: "Horse", cart: "Cart" } as const;

/** A name for a new biome that no biome has yet: "New biome", then "New biome 2". */
function freshBiomeName(custom: readonly CustomBiome[]): string {
  const taken = new Set(allBiomes(custom).map((b) => b.name.toLocaleLowerCase()));
  let n = 1;
  while (taken.has((n === 1 ? "new biome" : `new biome ${n}`).toLocaleLowerCase())) n++;
  return n === 1 ? "New biome" : `New biome ${n}`;
}

/**
 * The Styles tab's biomes: "Add the usual biomes" (a zone style for each), the built-in biomes
 * with what they do, and the owner's own, each with its editor (+ New biome). The owner's are
 * kept for the whole library in the biomes file, as styles are.
 */
export function BiomesSection({
  styles,
  onAddStyles,
}: {
  styles: readonly MapStyle[];
  onAddStyles: (add: MapStyle[]) => void;
}) {
  const { custom, ready, error, change } = useBiomes();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const missing = STARTER_BIOME_STYLES.filter((s) => !styles.some((x) => x.id === s.id));
  const replace = (next: CustomBiome) =>
    void change((f) => ({ ...f, biomes: f.biomes.map((b) => (b.id === next.id ? next : b)) }));
  const add = () => {
    const made: CustomBiome = { id: newItemId(), name: freshBiomeName(custom), like: "wasteland" };
    void change((f) => ({ ...f, biomes: [...f.biomes, made] }));
    setOpen(made.id);
  };
  const remove = (b: CustomBiome) => {
    void change((f) => ({ ...f, biomes: f.biomes.filter((x) => x.id !== b.id) }));
    toast({
      message: `Deleted the biome ${b.name}. Its zones keep their colour and lose its meaning.`,
      action: {
        label: "Undo",
        run: () =>
          void change((f) =>
            f.biomes.some((x) => x.id === b.id) ? f : { ...f, biomes: [...f.biomes, b] },
          ),
      },
    });
  };
  const own = allBiomes(custom).filter((b) => b.custom);
  return (
    <section aria-label="Biomes" className="biomes-section">
      <h3>Biomes</h3>
      <p className="muted styles-intro">
        A zone's biome gives it meaning (route speeds, rivers, Explore's words) and draws its
        pattern over the zone's own colour.
      </p>
      {missing.length > 0 && (
        <p className="change-actions">
          <button type="button" className="quiet" onClick={() => onAddStyles(missing)}>
            Add the usual biomes
          </button>
          <span className="muted">
            {" "}
            A zone style for each biome, so new biome zones look right.
          </span>
        </p>
      )}
      <details className="biome-kinds">
        <summary>Built-in biomes ({BIOME_KINDS.length})</summary>
        <ul>
          {BIOME_KINDS.map((k) => {
            const b = BIOMES[k];
            return (
              <li key={k} className="style-row">
                <BiomeSwatch colour={b.style.color} pattern={b.pattern} />
                <span className="style-name">{b.name}</span>
                <em className="muted">cart {speedWords(b.speed.cart)}</em>
              </li>
            );
          })}
        </ul>
      </details>
      <h4>Made by you</h4>
      {!ready && <p className={error ? "error" : "muted"}>{error ?? "Reading the biomes…"}</p>}
      {ready && own.length === 0 && <p className="muted">None yet.</p>}
      <ul>
        {own.map((b) => {
          const raw = custom.find((c) => c.id === b.id)!;
          return (
            <li key={b.id} className={open === b.id ? "is-open" : ""}>
              <span className="style-row">
                <BiomeSwatch colour={b.color} pattern={b.pattern} />
                <span className="style-name">{b.name}</span>
                <em className="muted">like {BIOMES[b.like].name}</em>
                <Menu label={`More for ${b.name}`} className="plain row-more">
                  <MenuItem icon={Pencil} onSelect={() => setOpen(open === b.id ? null : b.id)}>
                    Edit
                  </MenuItem>
                  <MenuItem icon={Trash2} danger onSelect={() => remove(raw)}>
                    Delete
                  </MenuItem>
                </Menu>
              </span>
              {open === b.id && (
                <BiomeForm
                  biome={raw}
                  custom={custom}
                  onChange={replace}
                  onDone={() => setOpen(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {ready && (
        <button type="button" className="quiet" onClick={add}>
          <Icon icon={Plus} size="sm" /> New biome
        </button>
      )}
    </section>
  );
}

/** Whether a speed typed is one: 0 (no way) to 3 times open ground. */
const speedOk = (v: number) => Number.isFinite(v) && v >= 0 && v <= 3;

/**
 * The editor of one of the owner's biomes: its name, the built-in biome it behaves like (whose
 * numbers it starts from), its pattern and colour, its speeds, what rivers do in it and
 * Explore's words. Each number left as the kind's follows the kind; Reset puts them all back.
 */
export function BiomeForm({
  biome,
  custom,
  onChange,
  onDone,
}: {
  biome: CustomBiome;
  custom: readonly CustomBiome[];
  onChange: (next: CustomBiome) => void;
  onDone: () => void;
}) {
  const id = useId();
  const kind = BIOMES[biome.like];
  const [name, setName] = useState(biome.name);
  const taken = allBiomes(custom).some(
    (b) => b.id !== biome.id && b.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  const nameWrong =
    name.trim() === "" ? "A biome needs a name." : taken ? "A biome has that name." : null;
  const set = (change: Partial<CustomBiome>) => {
    const next = { ...biome, ...change } as CustomBiome & Record<string, unknown>;
    for (const k of Object.keys(change))
      if (change[k as keyof CustomBiome] === undefined) delete next[k];
    onChange(next);
  };
  const setSpeed = (mode: (typeof BIOME_MODES)[number], v: number | null) => {
    const speed = { ...(biome.speed ?? {}) } as Record<string, number>;
    if (v === null) delete speed[mode];
    else speed[mode] = v;
    set({ speed: Object.keys(speed).length > 0 ? speed : undefined });
  };
  const pattern: Pattern | "none" = biome.pattern ?? kind.pattern;
  return (
    <form
      className="style-form biome-form"
      aria-label={`Edit ${biome.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        onDone();
      }}
    >
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          maxLength={60}
          aria-invalid={nameWrong !== null || undefined}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !nameWrong && name.trim() !== biome.name && set({ name: name.trim() })}
        />
        {nameWrong && <span className="error">{nameWrong}</span>}
      </label>
      <label className="field">
        <span>Behaves like</span>
        <select value={biome.like} onChange={(e) => set({ like: e.target.value as BiomeKind })}>
          {BIOME_KINDS.map((k) => (
            <option key={k} value={k}>
              {BIOMES[k].name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span id={`${id}-pattern`}>Pattern</span>
        <div className="biome-patterns" role="radiogroup" aria-labelledby={`${id}-pattern`}>
          {(["none", ...PATTERNS] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={pattern === p}
              aria-label={p === "none" ? "No pattern" : p}
              className="biome-pattern"
              onClick={() => set({ pattern: p === kind.pattern ? undefined : p })}
            >
              {p === "none" ? (
                <span className="biome-swatch biome-swatch-none" aria-hidden="true" />
              ) : (
                <BiomeSwatch
                  colour={biome.color ?? kind.style.color}
                  pattern={p}
                  width={28}
                  height={20}
                />
              )}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Colour of new zones</span>
        <input
          type="color"
          value={biome.color ?? kind.style.color}
          onChange={(e) => set({ color: e.target.value.toLowerCase() })}
        />
      </label>
      <fieldset className="field biome-speeds">
        <legend>Speed, times open ground (0: no way)</legend>
        {BIOME_MODES.map((m) => (
          <label key={m}>
            <span>{MODE_NAMES[m]}</span>
            <input
              type="number"
              min={0}
              max={3}
              step={0.05}
              value={biome.speed?.[m] ?? kind.speed[m]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (speedOk(v)) setSpeed(m, v === kind.speed[m] ? null : v);
              }}
            />
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Rivers</span>
        <select
          value={biome.rivers ?? kind.rivers}
          onChange={(e) =>
            set({
              rivers:
                e.target.value === kind.rivers
                  ? undefined
                  : (e.target.value as CustomBiome["rivers"]),
            })
          }
        >
          {RIVER_RULES.map((r) => (
            <option key={r} value={r}>
              {RIVER_WORDS[r][0]!.toUpperCase() + RIVER_WORDS[r].slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Explore reads</span>
        <input
          type="text"
          maxLength={120}
          placeholder={`in the ${biome.name}`}
          defaultValue={biome.explore ?? ""}
          onBlur={(e) => set({ explore: e.target.value.trim() || undefined })}
        />
      </label>
      <p className="change-actions">
        <button
          type="button"
          className="quiet"
          onClick={() =>
            onChange({ id: biome.id, name: biome.name, like: biome.like } as CustomBiome)
          }
        >
          Reset to {kind.name}
        </button>
        <button type="submit" className="primary">
          Done
        </button>
      </p>
    </form>
  );
}
