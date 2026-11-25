/**
 * The biome new zones are made in, by the Zone tool and by Find areas alike: one choice, kept
 * while the app is open, so a desert drawn by hand and one found in the picture are the same.
 */
import { useSyncExternalStore } from "react";

let chosen: string | null = null;
const listeners = new Set<() => void>();

export function setZoneBiome(next: string | null): void {
  chosen = next;
  for (const l of [...listeners]) l();
}

export function useZoneBiome(): [string | null, (next: string | null) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => chosen,
  );
  return [value, setZoneBiome];
}
