/**
 * How biome zones are shown on this device: their patterns (on unless turned off), Soft edges
 * (their fills blurred into each other, off until asked for) and the legend card on the map.
 * A view, not part of the map file, remembered on this device. The only reader and writer of
 * `frontier:map-biomes`.
 */
import { useCallback, useState } from "react";

export const BIOME_VIEW_KEY = "frontier:map-biomes";

export interface BiomeView {
  patterns: boolean;
  soft: boolean;
  /** The legend card over the map; on a phone it starts folded. */
  legend: boolean;
}

export const DEFAULT_BIOME_VIEW: BiomeView = { patterns: true, soft: false, legend: true };

export function readBiomeView(): BiomeView {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(BIOME_VIEW_KEY) ?? "{}",
    ) as Partial<BiomeView>;
    return {
      patterns: raw.patterns !== false,
      soft: raw.soft === true,
      legend: raw.legend !== false,
    };
  } catch {
    return DEFAULT_BIOME_VIEW;
  }
}

export function useBiomeView(): [BiomeView, (change: Partial<BiomeView>) => void] {
  const [view, setView] = useState(readBiomeView);
  const set = useCallback((change: Partial<BiomeView>) => {
    setView((now) => {
      const next = { ...now, ...change };
      try {
        window.localStorage.setItem(BIOME_VIEW_KEY, JSON.stringify(next));
      } catch {
        // Storage refused: the choice lasts while the page is open.
      }
      return next;
    });
  }, []);
  return [view, set];
}
