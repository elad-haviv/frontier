/** The map's keys: its scope in the keys registry, and Esc to stop marking a box to focus on. */
import { useScope, useShortcut } from "../keys.ts";

export function useMapKeys({ focusing, stopFocus }: { focusing: boolean; stopFocus: () => void }) {
  useScope("map");
  useShortcut("map.stopFocus", stopFocus, focusing);
}
