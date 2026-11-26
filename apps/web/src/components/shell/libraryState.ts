/**
 * Stage 28: what the shell keeps of the library pane on a desktop: whether it was left open on
 * this device, and from what window width it floats over the page instead of pushing it.
 */
import { useSyncExternalStore } from "react";

/**
 * From this window width (in CSS pixels) the pane is docked beside the page; under it, it floats
 * over the page. The shell takes it from here as a class (`is-floating`), so CSS has no copy of
 * the number to keep in step.
 */
export const LIBRARY_DOCK_MIN = 1100;

/** The media query for a window too narrow to dock the pane. */
export const LIBRARY_FLOAT_QUERY = `(max-width: ${LIBRARY_DOCK_MIN - 0.02}px)`;

/** Whether the window is too narrow to dock the library pane: it floats over the page instead. */
export function useLibraryFloating(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(LIBRARY_FLOAT_QUERY);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(LIBRARY_FLOAT_QUERY).matches,
  );
}

const OPEN = "frontier.shell.library";

/** Whether the pane was left open on this device; open the first time. */
export function readLibraryOpen(): boolean {
  try {
    return localStorage.getItem(OPEN) !== "closed";
  } catch {
    return true;
  }
}

export function writeLibraryOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN, open ? "open" : "closed");
  } catch {
    /* the choice lasts for this visit only */
  }
}
