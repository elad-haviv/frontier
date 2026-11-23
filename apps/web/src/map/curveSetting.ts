/**
 * Whether new paths and zones are drawn curved: the Straight / Curved switch in the drawing hint,
 * remembered on this device. The only reader and writer of `frontier:map-curve`.
 */
import { useCallback, useState } from "react";

export const CURVE_KEY = "frontier:map-curve";

/** The remembered choice; straight when nothing is kept or storage is refused. */
export function readCurve(): boolean {
  try {
    return window.localStorage.getItem(CURVE_KEY) === "smooth";
  } catch {
    return false;
  }
}

/** Keeps the choice, when the browser lets it be kept. */
export function writeCurve(curved: boolean): void {
  try {
    window.localStorage.setItem(CURVE_KEY, curved ? "smooth" : "straight");
  } catch {
    // Storage refused: the choice lasts while the page is open.
  }
}

/** The switch's state, read once and kept as it changes. */
export function useCurveSetting(): [boolean, (curved: boolean) => void] {
  const [curved, setCurved] = useState(readCurve);
  const set = useCallback((next: boolean) => {
    setCurved(next);
    writeCurve(next);
  }, []);
  return [curved, set];
}
