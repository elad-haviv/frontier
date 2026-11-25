/**
 * Whether the map's terrain is drawn over it as relief: a view anyone can turn on, editing or
 * viewing, off until it is asked for, and remembered on this device. The only reader and writer
 * of `frontier:map-relief`.
 */
import { useCallback, useState } from "react";

export const RELIEF_KEY = "frontier:map-relief";

export function readRelief(): boolean {
  try {
    return window.localStorage.getItem(RELIEF_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeRelief(on: boolean): void {
  try {
    window.localStorage.setItem(RELIEF_KEY, on ? "on" : "off");
  } catch {
    // Storage refused: the choice lasts while the page is open.
  }
}

export function useReliefSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readRelief);
  const set = useCallback((next: boolean) => {
    setOn(next);
    writeRelief(next);
  }, []);
  return [on, set];
}
