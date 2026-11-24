import { useSyncExternalStore } from "react";

/** Where the device keeps the choice of full width for reading and writing. */
const KEY = "frontier:wide";

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let wide = read();

/** Turns full width on or off for every entry and the editor, on this device. */
export function setWide(on: boolean): void {
  wide = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* the choice lasts for this visit only */
  }
  for (const l of [...listeners]) l();
}

/**
 * Whether entries and the editor use the full width of the page, rather than a measure that
 * suits prose: for wide tables and pictures. The pages add the class `is-wide` while it is on.
 */
export function useWide(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (changed) => {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
    () => wide,
  );
  return [on, setWide];
}
