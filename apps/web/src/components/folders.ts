import type { TreeFolder, TreeResponse } from "@frontier/schema";
import type { ComboboxOption } from "./ui/Combobox.tsx";

/** What the folder list calls the folder above all others. */
export const TOP = "Top of the library";

/** Every folder in the tree, in the tree's order, by its full path. */
export function foldersOf(tree: TreeResponse): string[] {
  const out: string[] = [];
  const walk = (folders: TreeFolder[]) => {
    for (const f of [...folders].sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }),
    )) {
      out.push(f.path);
      walk(f.folders);
    }
  };
  walk(tree.folders);
  return out;
}

/**
 * The choices of a folder list: the top of the library, then each folder by its full path, as
 * New entry and Move to… offer them. `also` adds folders the tree does not hold yet.
 */
export function folderOptions(tree: TreeResponse | null, also: string[] = []): ComboboxOption[] {
  const paths = tree ? foldersOf(tree) : [];
  for (const p of also) if (p && !paths.includes(p)) paths.push(p);
  return [{ value: "", label: TOP }, ...paths.map((p) => ({ value: p, label: p }))];
}
