/**
 * The owner's own biomes, kept once for the library in `.frontier/biomes.json` and shared by
 * every open map through the library file client, as the map styles are.
 */
import { BIOMES_LIBRARY, type BiomesFile, type CustomBiome } from "@frontier/schema";
import { useLibraryFile } from "../sync/libraryFile.ts";

const NONE: CustomBiome[] = [];

export function useBiomes(): {
  custom: CustomBiome[];
  ready: boolean;
  error: string | null;
  change: (fn: (file: BiomesFile) => BiomesFile) => Promise<void>;
} {
  const file = useLibraryFile(BIOMES_LIBRARY);
  return {
    custom: file.value?.biomes ?? NONE,
    ready: file.state === "ready",
    error: file.error,
    change: (fn) => file.client.change(fn),
  };
}
