import { LABEL_LOOK, type MapLabel, orderFeature } from "@frontier/schema";
import { useState } from "react";

/** A label's look with one part set; the default value is written by leaving the key out. */
export function withLook(
  label: MapLabel,
  key: "size" | "color" | "rotate" | "spacing",
  value: number | string,
): MapLabel {
  const next = { ...label } as Record<string, unknown>;
  delete next[key];
  if (value !== LABEL_LOOK[key]) next[key] = value;
  return orderFeature(next as MapLabel) as MapLabel;
}

/** The words of a label and how they look: size, colour, turn and the room between letters. */
export function LabelFields({
  label,
  onChange,
}: {
  label: MapLabel;
  onChange: (next: MapLabel) => void;
}) {
  // Empty words are kept here only: a label always has some.
  const [words, setWords] = useState(label.label);
  const size = label.size ?? LABEL_LOOK.size;
  const rotate = label.rotate ?? LABEL_LOOK.rotate;
  const spacing = label.spacing ?? LABEL_LOOK.spacing;
  return (
    <>
      <label className="field">
        <span>Words</span>
        <input
          type="text"
          value={words}
          maxLength={200}
          // A new label opens with its words ready to type over.
          autoFocus={label.label === "Label"}
          onFocus={(e) => label.label === "Label" && e.currentTarget.select()}
          onChange={(e) => {
            setWords(e.target.value);
            if (e.target.value.trim()) onChange({ ...label, label: e.target.value });
          }}
        />
      </label>
      <div className="label-look">
        <label className="field">
          <span>Size</span>
          <input
            type="number"
            min={6}
            max={160}
            value={size}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 6 && n <= 160) onChange(withLook(label, "size", n));
            }}
          />
        </label>
        <label className="field">
          <span>Colour</span>
          <input
            type="color"
            value={label.color ?? LABEL_LOOK.color}
            onChange={(e) => onChange(withLook(label, "color", e.target.value))}
          />
        </label>
      </div>
      <label className="field">
        <span>
          Turn <em className="muted">{rotate}°</em>
        </span>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={rotate}
          onChange={(e) => onChange(withLook(label, "rotate", Number(e.target.value)))}
        />
      </label>
      <label className="field">
        <span>
          Letter spacing <em className="muted">{spacing.toFixed(2)} em</em>
        </span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={spacing}
          onChange={(e) => onChange(withLook(label, "spacing", Number(e.target.value)))}
        />
      </label>
    </>
  );
}
