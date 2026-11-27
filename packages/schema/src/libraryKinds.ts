/** The table of library item files: the folder file, the map styles file, the biomes file, the pins file and the trees file. */
import { BIOMES_LIBRARY } from "./biomes.js";
import { FOLDERS } from "./folders.js";
import { PINS } from "./keepGoing.js";
import type { AnyLibraryFile } from "./libraryFiles.js";
import { MAP_STYLES } from "./mapStyles.js";
import { TREES } from "./relations.js";

/** Every library item file, in a fixed order. */
export const LIBRARY_FILES: AnyLibraryFile[] = [
  FOLDERS as unknown as AnyLibraryFile,
  MAP_STYLES as unknown as AnyLibraryFile,
  BIOMES_LIBRARY as unknown as AnyLibraryFile,
  PINS as unknown as AnyLibraryFile,
  TREES as unknown as AnyLibraryFile,
];

/** The kind a library path belongs to, if any. */
export function libraryFileOf(path: string): AnyLibraryFile | undefined {
  return LIBRARY_FILES.find((k) => k.path === path);
}

/** The kind with this name, if any. */
export function libraryFileNamed(name: string): AnyLibraryFile | undefined {
  return LIBRARY_FILES.find((k) => k.name === name);
}
