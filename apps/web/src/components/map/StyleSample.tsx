import type { MapStyle } from "@frontier/schema";
import { useEffect, useRef } from "react";
import { drawSample } from "../../map/overlay.ts";

/**
 * A small picture of a style, drawn by the overlay's own code: a line for a path style, a patch
 * for a zone style. A style without a colour is drawn in `fallback`, or a neutral grey.
 */
export function StyleSample({
  style,
  width = 44,
  height = 22,
  fallback,
}: {
  style: Pick<MapStyle, "for" | "color" | "width" | "dash" | "fill">;
  width?: number;
  height?: number;
  fallback?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { color, dash, fill } = style;
  const kind = style.for;
  const line = style.width;
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.round(width * ratio);
    c.height = Math.round(height * ratio);
    drawSample(
      ctx,
      { for: kind, color, width: line, dash, ...(fill !== undefined ? { fill } : {}) },
      width,
      height,
      fallback,
    );
  }, [kind, color, line, dash, fill, width, height, fallback]);
  return (
    <canvas
      ref={canvas}
      className="style-sample"
      style={{ width, height }}
      aria-hidden="true"
      data-style-colour={color ?? "layer"}
    />
  );
}
