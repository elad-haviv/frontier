/**
 * The colour of each node: its nearest folder's own colour, else its top-level folder's (its own
 * or the one the server gave it), as the light or the dark value for the page's theme. A node at
 * the top level, or whose folder has none, is drawn in the faint ink, given here as null.
 */
import { FOLDER_COLORS, type FolderColor } from "@frontier/schema";
import { useSyncExternalStore } from "react";
import type { GraphModel, ModelNode } from "./model.ts";

export type Theme = "light" | "dark";

const DARK = "(prefers-color-scheme: dark)";

/** The theme the page is drawn in now. */
export function currentTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.(DARK).matches ? "dark" : "light";
}

/** The page's theme, kept up to date when the colour scheme changes. */
export function useTheme(): Theme {
  return useSyncExternalStore((changed) => {
    const query = window.matchMedia?.(DARK);
    query?.addEventListener("change", changed);
    return () => query?.removeEventListener("change", changed);
  }, currentTheme);
}

/** A named folder colour for the theme; null stays null, the neutral colour. */
export function folderColour(color: FolderColor | null | undefined, theme: Theme): string | null {
  return color ? FOLDER_COLORS[color][theme] : null;
}

/** The colour name a node takes: nearest coloured folder first, then its top-level folder's. */
export function colourNameOf(model: GraphModel, node: ModelNode): FolderColor | null {
  if (node.top === null) return null;
  let best: { path: string; color: FolderColor } | null = null;
  for (const n of model.nested) {
    if (node.folder !== n.path && !node.folder.startsWith(n.path + "/")) continue;
    if (!best || n.path.length > best.path.length) best = n;
  }
  if (best) return best.color;
  return model.folders.find((f) => f.path === node.top)?.color ?? null;
}

/** Every node's colour by index, for drawing. */
export function nodeColours(model: GraphModel, theme: Theme): (string | null)[] {
  return model.nodes.map((n) => folderColour(colourNameOf(model, n), theme));
}
