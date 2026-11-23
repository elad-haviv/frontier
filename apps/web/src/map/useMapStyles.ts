/**
 * The library's path and zone styles, loaded once and shared by every open map through the
 * library file client, which hears the save queue's key `map-styles`: a copy merged by the sender
 * reaches every map at once.
 */
import { MAP_STYLES, type MapStyle, type MapStylesFile } from "@frontier/schema";
import { useLibraryFile } from "../sync/libraryFile.ts";

const NONE: MapStyle[] = [];

export function useMapStyles(): {
  styles: MapStyle[];
  ready: boolean;
  error: string | null;
  /** Changes the styles file; the change is shown at once and put into the save queue. */
  change: (fn: (file: MapStylesFile) => MapStylesFile) => Promise<void>;
} {
  const file = useLibraryFile(MAP_STYLES);
  return {
    styles: file.value?.styles ?? NONE,
    ready: file.state === "ready",
    error: file.error,
    change: (fn) => file.client.change(fn),
  };
}
