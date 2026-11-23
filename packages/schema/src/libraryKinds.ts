/** The table of library item files: the folder file and the map styles file. */
import { FOLDERS } from "./folders.js";
import type { AnyLibraryFile } from "./libraryFiles.js";
import { MAP_STYLES } from "./mapStyles.js";

/** Every library item file, in a fixed order. */
export const LIBRARY_FILES: AnyLibraryFile[] = [
  FOLDERS as unknown as AnyLibraryFile,
  MAP_STYLES as unknown as AnyLibraryFile,
];

/** The kind a library path belongs to, if any. */
export function libraryFileOf(path: string): AnyLibraryFile | undefined {
  return LIBRARY_FILES.find((k) => k.path === path);
}

/** The kind with this name, if any. */
export function libraryFileNamed(name: string): AnyLibraryFile | undefined {
  return LIBRARY_FILES.find((k) => k.name === name);
}
