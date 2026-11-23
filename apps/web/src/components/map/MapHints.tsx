import type { Length } from "@frontier/geo";
import { lengthText } from "../../map/lengthText.ts";
import type { Tool } from "../../map/tools.ts";

/** The line over the map that says how to use the drawing tools while editing. */
export function MapHints({
  tool,
  sketchLength,
  measured,
  sphere,
  onFinish,
  onClear,
  onSize,
}: {
  tool: Tool;
  /** How many points have been placed so far. */
  sketchLength: number;
  measured: Length | null;
  sphere: boolean;
  onFinish: () => void;
  onClear: () => void;
  /** Asks for the radius of a world, or the scale from the measured line. */
  onSize: () => void;
}) {
  return (
    <>
      {(tool === "path" || tool === "zone") && (
        <p className="map-hint">
          Tap to add points.{" "}
          <button
            type="button"
            className="primary"
            disabled={sketchLength < (tool === "zone" ? 3 : 2)}
            onClick={onFinish}
          >
            Done
          </button>
        </p>
      )}
      {tool === "marker" && <p className="map-hint">Tap where the marker goes.</p>}
      {tool === "measure" && (
        <p className="map-hint" role="status">
          {measured ? lengthText(measured, sphere) : "Tap two or more points."}{" "}
          {sketchLength > 0 && (
            <button type="button" className="plain" onClick={onClear}>
              Clear
            </button>
          )}{" "}
          {(sphere || measured) && (
            <button type="button" className="plain" onClick={onSize}>
              {sphere ? "Set the radius" : "Set the scale from this line"}
            </button>
          )}
        </p>
      )}
    </>
  );
}

/** The box being marked to focus on, or the hint that says how to mark it. */
export function FocusBox({
  box,
  focusing,
  onCancel,
}: {
  box: [number, number, number, number] | null;
  focusing: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      {box && (
        <div
          className="focus-box"
          style={{
            left: Math.min(box[0], box[2]),
            top: Math.min(box[1], box[3]),
            width: Math.abs(box[2] - box[0]),
            height: Math.abs(box[3] - box[1]),
          }}
        />
      )}
      {focusing && !box && (
        <p className="map-hint" role="status">
          Drag a box around the place to focus on.{" "}
          <button type="button" className="plain" onClick={onCancel}>
            Cancel
          </button>
        </p>
      )}
    </>
  );
}
