import {
  COUNTS_FOR,
  type CountsAs,
  countsAs,
  DASH_NAMES,
  type Dash,
  type MapStyle,
  STARTER_STYLES,
  styleNameTaken,
} from "@frontier/schema";
import { useEffect, useId, useState } from "react";
import { Tip } from "../ui/Tip.tsx";
import { StyleSample } from "./StyleSample.tsx";

/** The eight named colours a style can take, beside its layer's and a custom one. */
export const STYLE_SWATCHES = [
  { name: "Blue", value: "#2f6f9f" },
  { name: "Teal", value: "#1d6b63" },
  { name: "Green", value: "#3f6b2a" },
  { name: "Gold", value: "#9a7410" },
  { name: "Brown", value: "#7a5230" },
  { name: "Red", value: "#9a3b1c" },
  { name: "Plum", value: "#6b3a7a" },
  { name: "Slate", value: "#4a5560" },
] as const;

export const DASH_LABELS: Record<Dash, string> = {
  solid: "Solid",
  dashed: "Dashed",
  long: "Long dashes",
  "dash-dot": "Dash and dot",
};

export const COUNTS_LABELS: Record<CountsAs, string> = {
  water: "Water",
  forest: "Forest",
  marsh: "Marsh",
  mountains: "Mountains",
  river: "River",
  road: "Road",
};

/**
 * The style counting as something, or as nothing. Nothing is written by leaving the key out,
 * except on a usual style, which would count by its id: there it is said outright.
 */
export function withCounts(style: MapStyle, counts: CountsAs | null): MapStyle {
  const next = { ...style };
  delete next.counts;
  if (counts) return { ...next, counts };
  return STARTER_STYLES.some((s) => s.id === style.id && s.counts) ? { ...next, counts: "nothing" } : next;
}

/** Why a name cannot be taken, or null when it can. */
export function nameProblem(styles: MapStyle[], style: MapStyle, name: string): string | null {
  if (name.trim() === "") return "A style needs a name.";
  if (name.trim().length > 60) return "A name has at most 60 letters.";
  if (styleNameTaken(styles, name, style.for, style.id)) {
    return `There is already a ${style.for} style named ${name.trim()}.`;
  }
  return null;
}

/**
 * The form for one style. Each change is passed on at once, so the open map shows it; a name is
 * passed on only once it is one no other style of its kind has.
 */
export function StyleForm({
  style,
  styles,
  onChange,
  onDone,
}: {
  style: MapStyle;
  styles: MapStyle[];
  onChange: (next: MapStyle) => void;
  onDone: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState(style.name);
  // Undo in the toast, or a merge from another device, shows in the field.
  useEffect(() => setName(style.name), [style.name]);
  const problem = nameProblem(styles, style, name);
  const set = (change: Partial<MapStyle>) => onChange({ ...style, ...change });
  const custom = style.color !== null && !STYLE_SWATCHES.some((s) => s.value === style.color);

  return (
    <div className="style-form" role="group" aria-label={`The look of ${style.name}`}>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          maxLength={60}
          aria-invalid={problem !== null || undefined}
          aria-describedby={problem ? `${ids}-problem` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            if (nameProblem(styles, style, e.target.value) === null) {
              set({ name: e.target.value.trim() });
            }
          }}
        />
      </label>
      {problem && (
        <p className="error" id={`${ids}-problem`} role="alert">
          {problem}
        </p>
      )}
      <div className="field">
        <span id={`${ids}-colour`}>Colour</span>
        <div className="style-swatches" role="radiogroup" aria-labelledby={`${ids}-colour`}>
          <Tip label="The layer's colour">
            <button
              type="button"
              role="radio"
              aria-label="The layer's colour"
              aria-checked={style.color === null}
              className="style-swatch is-layer"
              onClick={() => set({ color: null })}
            />
          </Tip>
          {STYLE_SWATCHES.map((s) => (
            <Tip key={s.value} label={s.name}>
              <button
                type="button"
                role="radio"
                aria-label={s.name}
                aria-checked={style.color === s.value}
                className="style-swatch"
                style={{ background: s.value }}
                onClick={() => set({ color: s.value })}
              />
            </Tip>
          ))}
          <label className={`style-swatch is-custom${custom ? " is-chosen" : ""}`}>
            <input
              type="color"
              aria-label="A colour of its own"
              value={style.color ?? "#2a2420"}
              onChange={(e) => set({ color: e.target.value.toLowerCase() })}
            />
          </label>
        </div>
      </div>
      <label className="field">
        <span>
          Width <em className="muted">{style.width} px</em>
        </span>
        <input
          type="range"
          min={0.5}
          max={12}
          step={0.5}
          value={style.width}
          onChange={(e) => set({ width: Number(e.target.value) })}
        />
      </label>
      <div className="field">
        <span id={`${ids}-dash`}>Line</span>
        <div className="style-dashes" role="radiogroup" aria-labelledby={`${ids}-dash`}>
          {DASH_NAMES.map((dash) => (
            <Tip key={dash} label={DASH_LABELS[dash]}>
              <button
                type="button"
                role="radio"
                aria-label={DASH_LABELS[dash]}
                aria-checked={style.dash === dash}
                className="style-dash"
                onClick={() => set({ dash })}
              >
                <StyleSample
                  style={{ for: "path", color: style.color, width: Math.min(style.width, 4), dash }}
                  width={52}
                  height={18}
                />
              </button>
            </Tip>
          ))}
        </div>
      </div>
      {style.for === "zone" && (
        <label className="field">
          <span>
            Fill <em className="muted">{Math.round((style.fill ?? 0.2) * 100)}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.05}
            value={style.fill ?? 0.2}
            onChange={(e) => set({ fill: Math.round(Number(e.target.value) * 100) / 100 })}
          />
        </label>
      )}
      <label className="field">
        <span>Counts as</span>
        <select
          value={countsAs(style) ?? ""}
          aria-describedby={`${ids}-counts`}
          onChange={(e) => onChange(withCounts(style, (e.target.value || null) as CountsAs | null))}
        >
          <option value="">Nothing</option>
          {COUNTS_FOR[style.for].map((c) => (
            <option key={c} value={c}>
              {COUNTS_LABELS[c]}
            </option>
          ))}
        </select>
        <small className="muted" id={`${ids}-counts`}>
          {style.for === "path"
            ? "Find paths reads it: a river is in a traveller's way, a road is quicker."
            : "Find paths reads it as this kind of ground."}
        </small>
      </label>
      <p className="change-actions">
        <button type="button" className="quiet" onClick={onDone}>
          Close the form
        </button>
      </p>
    </div>
  );
}
