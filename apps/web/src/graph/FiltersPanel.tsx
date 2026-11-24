import { folderColour, type Theme } from "./colours.ts";
import type { GraphModel } from "./model.ts";
import "./FiltersPanel.css";

/** The top-level folders in the tree's order, each with its colour and a tick. */
export function FiltersPanel({
  model,
  ticked,
  theme,
  onTick,
}: {
  model: GraphModel;
  ticked: ReadonlySet<string>;
  theme: Theme;
  onTick: (folder: string, on: boolean) => void;
}) {
  if (model.folders.length === 0) {
    return <p className="muted graph-filters-none">The library has no folders to choose from.</p>;
  }
  return (
    <fieldset className="graph-filters">
      <legend>Folders shown</legend>
      {model.folders.map((f) => {
        const colour = folderColour(f.color, theme);
        return (
          <label key={f.path} className="graph-filter">
            <input
              type="checkbox"
              checked={ticked.has(f.path)}
              onChange={(e) => onTick(f.path, e.target.checked)}
            />
            <span
              className="graph-swatch"
              aria-hidden="true"
              style={colour ? { background: colour } : undefined}
            />
            <span className="graph-filter-name">{f.path}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
