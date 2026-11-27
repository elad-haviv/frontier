/**
 * Stage 28: what the shell keeps of the library pane on a desktop: whether it was left open on
 * this device (per kind of screen, in `panels.tsx`), and when it floats over the page instead of
 * pushing it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

/** The pane's width in rem; `LibraryPane.css` draws it at the same width. */
export const LIBRARY_PANE_REM = 17;

/** The least width in pixels the page keeps beside a docked pane; under it the pane floats. */
export const LIBRARY_PAGE_MIN = 560;

/**
 * Before the shell has measured its main panel, the window's width stands in for it: from this
 * width (in CSS pixels) the pane is docked, under it, it floats. This avoids a flicker at the first
 * paint; the measured room (`libraryFloats`) decides from then on.
 */
export const LIBRARY_DOCK_MIN = 1100;

/** The media query for a window too narrow to dock the pane, before the room is measured. */
export const LIBRARY_FLOAT_QUERY = `(max-width: ${LIBRARY_DOCK_MIN - 0.02}px)`;

/**
 * Whether the pane floats, given the width in pixels of the main panel (the room right of the side
 * bar, the pane's included) and the root font size in pixels: the page must keep `LIBRARY_PAGE_MIN`
 * beside the docked pane.
 */
export function libraryFloats(mainWidth: number, rootFontPx = 16): boolean {
  return mainWidth < LIBRARY_PANE_REM * rootFontPx + LIBRARY_PAGE_MIN;
}

/**
 * Whether the library pane floats over the page instead of pushing it: by the measured width of
 * the main panel `main` (it changes with the window and with the side bars), and by the window's
 * width until it has been measured. `measured` tells which of the two this is.
 */
export function useLibraryFloating(main: HTMLElement | null): {
  floating: boolean;
  measured: boolean;
} {
  const narrow = useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(LIBRARY_FLOAT_QUERY);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(LIBRARY_FLOAT_QUERY).matches,
  );
  const [floats, setFloats] = useState<boolean | null>(null);
  useEffect(() => {
    if (!main) return;
    const read = (width: number) => {
      // A panel not laid out yet reads as nothing; the window's width stands in until it has.
      if (width <= 0) return;
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setFloats(libraryFloats(width, root));
    };
    read(main.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const e of entries) read(e.contentRect.width);
    });
    observer.observe(main);
    return () => {
      observer.disconnect();
      setFloats(null);
    };
  }, [main]);
  return { floating: floats ?? narrow, measured: floats !== null };
}

const LEGACY_OPEN = "frontier.shell.library";

/**
 * The pane's open state from before it was kept per kind of screen: one value for the device, open
 * the first time. It is the default for the screens that show entries, so nobody loses a choice.
 */
export function readLegacyLibraryOpen(): boolean {
  try {
    return localStorage.getItem(LEGACY_OPEN) !== "closed";
  } catch {
    return true;
  }
}
