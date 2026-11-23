import type { Length, Position } from "@frontier/geo";
import { shortcutText } from "../../keys.ts";
import { lengthText } from "../../map/lengthText.ts";
import { canFinish, FEWEST_POINTS, type Tool } from "../../map/tools.ts";
import { Tip } from "../ui/Tip.tsx";

/** Whether the pointer can hover, as a mouse can: the hint's words follow it. */
const canHover = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** The line over the map that says how to use the drawing tools while editing. */
export function MapHints({
  tool,
  sketch,
  measured,
  sphere,
  curve,
  layer,
  onCurve,
  onFinish,
  onClear,
  onSize,
}: {
  tool: Tool;
  /** The points placed so far. */
  sketch: Position[];
  measured: Length | null;
  sphere: boolean;
  /** New paths and zones are curved. */
  curve: boolean;
  /** The name of the layer new features go into. */
  layer: string;
  onCurve: (curved: boolean) => void;
  onFinish: () => void;
  onClear: () => void;
  /** Asks for the radius of a world, or the scale from the measured line. */
  onSize: () => void;
}) {
  const hover = canHover();
  const into = layer ? <span className="map-hint-layer"> Drawing into {layer}.</span> : null;
  if (tool === "path" || tool === "zone") {
    const ready = canFinish(tool, sketch);
    const finish = tool === "zone" ? "Finish zone" : "Finish path";
    return (
      <p className="map-hint map-draw-hint">
        <span>
          {hover
            ? "Click to add points · Double-click or Enter to finish · Esc to cancel"
            : "Tap to add points. Tap the last point again to finish."}
          {into}
        </span>{" "}
        <span className="map-curve" role="group" aria-label="Straight or curved">
          {([false, true] as const).map((on) => (
            <Tip
              key={String(on)}
              label={
                on ? "Curved: a smooth line through the points" : "Straight from point to point"
              }
              keys={shortcutText("map.curve")}
            >
              <button
                type="button"
                className={curve === on ? "is-on" : ""}
                aria-pressed={curve === on}
                onClick={() => onCurve(on)}
              >
                {on ? "Curved" : "Straight"}
              </button>
            </Tip>
          ))}
        </span>{" "}
        <Tip
          label={finish}
          keys={shortcutText("map.finish")}
          {...(ready ? {} : { note: `A ${tool} needs at least ${FEWEST_POINTS[tool]} points` })}
        >
          <button
            type="button"
            className="primary"
            aria-disabled={!ready || undefined}
            onClick={() => ready && onFinish()}
          >
            {finish}
          </button>
        </Tip>
      </p>
    );
  }
  if (tool === "marker") {
    return (
      <p className="map-hint">
        {hover ? "Click where each marker goes · Esc to stop" : "Tap where the marker goes."}
        {into}
      </p>
    );
  }
  if (tool === "measure") {
    return (
      <p className="map-hint" role="status">
        {measured ? lengthText(measured, sphere) : "Tap two or more points."}{" "}
        {sketch.length > 0 && (
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
    );
  }
  return null;
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
