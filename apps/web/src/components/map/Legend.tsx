import type { MapStyle } from "@frontier/schema";
import { StyleSample } from "./StyleSample.tsx";
import "./StylesPanel.css";

/**
 * The legend at the top of the Layers tab: each style used by a feature drawn now, with a sample
 * drawn by the overlay's code and its name. Saved pictures have none: they show the map as it is.
 */
export function Legend({ styles }: { styles: MapStyle[] }) {
  if (styles.length === 0) return null;
  return (
    <section className="map-legend" aria-label="Legend">
      <h3>Legend</h3>
      <ul>
        {styles.map((style) => (
          <li key={style.id}>
            <StyleSample style={style} />
            <span className="style-name">{style.name}</span>
            {style.color === null && <em className="muted">in its layer's colour</em>}
          </li>
        ))}
      </ul>
    </section>
  );
}
