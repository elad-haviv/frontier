import { useEffect, useState } from "react";

const AXES = [
  { label: "Turn about the poles", hint: "λ", min: -180, max: 180 },
  { label: "Tilt", hint: "φ", min: -90, max: 90 },
  { label: "Turn about the middle", hint: "γ", min: -180, max: 180 },
] as const;

/** One angle: a slider and its number, which can be typed. */
function Angle(p: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(p.value.toFixed(1));
  useEffect(() => setText(p.value.toFixed(1)), [p.value]);
  const take = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) p.onChange(Math.max(p.min, Math.min(p.max, n)));
  };
  return (
    <label className="turn-angle">
      <span>
        {p.label} <i>{p.hint}</i>
      </span>
      <input
        type="range"
        aria-label={p.label}
        min={p.min}
        max={p.max}
        step={0.5}
        value={p.value}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
      <input
        type="number"
        aria-label={`${p.label}, in degrees`}
        min={p.min}
        max={p.max}
        step={0.1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => take(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && take((e.target as HTMLInputElement).value)}
      />
    </label>
  );
}

/** The turn of a globe laid flat, as in map-reprojector: three angles, a reset, and focus. */
export function TurnPanel(p: {
  rotate: [number, number, number];
  onTurn: (rotate: [number, number, number]) => void;
  focusing: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="layer-panel turn-panel" aria-label="Turn the globe">
      <button type="button" className="plain card-close" aria-label="Close" onClick={p.onClose}>
        ✕
      </button>
      <h2>Turn the globe</h2>
      {AXES.map((axis, i) => (
        <Angle
          key={axis.hint}
          {...axis}
          value={p.rotate[i]!}
          onChange={(value) => {
            const next = [...p.rotate] as [number, number, number];
            next[i] = value;
            p.onTurn(next);
          }}
        />
      ))}
      <p className="change-actions">
        <button
          type="button"
          className="quiet"
          onClick={() => p.onTurn([p.rotate[0], 0, 0])}
          disabled={p.rotate[1] === 0 && p.rotate[2] === 0}
        >
          Upright
        </button>
        <button type="button" className={p.focusing ? "primary" : "quiet"} onClick={p.onFocus}>
          {p.focusing ? "Marking a box…" : "Focus on a region"}
        </button>
      </p>
    </aside>
  );
}
