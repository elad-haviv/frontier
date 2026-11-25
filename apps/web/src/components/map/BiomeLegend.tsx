import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { BiomeKey } from "../../map/biomes.ts";
import type { BiomeView } from "../../map/biomeView.ts";
import { BiomeSwatch } from "./BiomePicker.tsx";
import "./Biomes.css";

/** The biomes drawn now, each with its swatch; a suggested one is dashed. */
export function BiomeKeyList({ keys }: { keys: readonly BiomeKey[] }) {
  return (
    <ul className="biome-keys">
      {keys.map((k) => (
        <li key={`${k.biome.id}${k.ghost ? ":ghost" : ""}`}>
          <BiomeSwatch colour={k.colour} pattern={k.biome.pattern} ghost={k.ghost === true} />
          <span>{k.biome.name}</span>
          {k.ghost && <em className="muted">suggested</em>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The legend card over the map: the biomes of the zones drawn now (and, while suggesting, of the
 * suggestions). Bottom left on a computer; top left and folded at first on a phone. Readers see
 * it too. A scale takes its place in Suggest biomes' Temperature and Rainfall views.
 */
export function BiomeLegendCard({
  keys,
  phone,
  scale,
}: {
  keys: readonly BiomeKey[];
  phone: boolean;
  /** The colour scale of a field shown instead of the biomes, with its ends. */
  scale?: { title: string; stops: string[]; low: string; high: string } | null;
}) {
  const [open, setOpen] = useState(!phone);
  if (keys.length === 0 && !scale) return null;
  return (
    <section
      className={`biome-legend-card${phone ? " is-phone" : ""}`}
      aria-label={scale ? scale.title : "Biomes legend"}
    >
      <button
        type="button"
        className="plain biome-legend-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {scale ? scale.title : "Biomes"}
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
      </button>
      {open &&
        (scale ? (
          <div className="biome-scale">
            <span
              className="biome-scale-bar"
              style={{ background: `linear-gradient(to right, ${scale.stops.join(", ")})` }}
            />
            <span className="biome-scale-ends">
              <span>{scale.low}</span>
              <span>{scale.high}</span>
            </span>
          </div>
        ) : (
          <BiomeKeyList keys={keys} />
        ))}
    </section>
  );
}

/** How biomes are shown, in the Layers tab: Patterns, Soft edges and the legend card. */
export function BiomeViewOptions({
  view,
  onView,
}: {
  view: BiomeView;
  onView: (change: Partial<BiomeView>) => void;
}) {
  return (
    <p className="biome-view" role="group" aria-label="How biomes are shown">
      <label>
        <input
          type="checkbox"
          checked={view.patterns}
          onChange={(e) => onView({ patterns: e.target.checked })}
        />{" "}
        Patterns
      </label>
      <label>
        <input
          type="checkbox"
          checked={view.soft}
          onChange={(e) => onView({ soft: e.target.checked })}
        />{" "}
        Soft edges
      </label>
      <label>
        <input
          type="checkbox"
          checked={view.legend}
          onChange={(e) => onView({ legend: e.target.checked })}
        />{" "}
        Legend on the map
      </label>
    </p>
  );
}
