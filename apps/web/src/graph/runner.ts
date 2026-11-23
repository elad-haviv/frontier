/**
 * Runs a layout on the main thread in slices: each animation frame ticks until about 8 ms have
 * passed, then draws, so pointer and key input are handled between frames and the settle shows as
 * an animation. With reduced motion the slices run without drawing, and the end is drawn once.
 */
import type { Layout } from "./layout.ts";

/** How long a frame's slice of ticks may take, in milliseconds. */
export const SLICE_MS = 8;

export interface RunnerDeps {
  frame: (run: () => void) => number;
  cancel: (id: number) => void;
  now: () => number;
}

const browser: RunnerDeps = {
  frame: (run) => requestAnimationFrame(run),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** Whether the author asked for less motion. */
export const reducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Ticks the layout until it rests. `onSlice` runs after each slice that should be drawn, and
 * `onDone` once at the end. Returns the function that stops it.
 */
export function runLayout(
  layout: Layout,
  on: { onSlice: () => void; onDone: () => void; reduced?: boolean },
  d: RunnerDeps = browser,
): () => void {
  let id: number | null = null;
  const slice = () => {
    id = null;
    const start = d.now();
    do layout.tick();
    while (!layout.done && d.now() - start < SLICE_MS);
    if (layout.done) {
      on.onDone();
      return;
    }
    if (!on.reduced) on.onSlice();
    id = d.frame(slice);
  };
  if (layout.done) on.onDone();
  else id = d.frame(slice);
  return () => {
    if (id !== null) d.cancel(id);
    id = null;
  };
}
