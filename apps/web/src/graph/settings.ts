/**
 * What the graph keeps on the device: the screen's view for the session (`frontier.graph.view`),
 * and the local graph's depth (`frontier.graph.depth`). Storage may be full or blocked, so every
 * read and write is tried, and a missing or unreadable value gives the default.
 */
import { projectKey } from "../projectStorage.ts";
import type { FlatView } from "./pointer.ts";

const VIEW = "frontier.graph.view";
const viewKey = () => projectKey(VIEW);
const DEPTH = "frontier.graph.depth";

/** The view the screen was left at in this session, or null. */
export function readView(): FlatView | null {
  try {
    const raw = sessionStorage.getItem(viewKey());
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<FlatView>;
    const finite = [v.x, v.y, v.k].every((n) => typeof n === "number" && Number.isFinite(n));
    if (!finite || v.k! <= 0) return null;
    return { kind: "flat", x: v.x!, y: v.y!, k: v.k! };
  } catch {
    return null;
  }
}

export function writeView(view: FlatView): void {
  try {
    sessionStorage.setItem(viewKey(), JSON.stringify({ x: view.x, y: view.y, k: view.k }));
  } catch {
    /* the view lasts only while the page is open */
  }
}

/** The local graph's depth: 1, or 2 when chosen. */
export function readDepth(): 1 | 2 {
  try {
    return localStorage.getItem(DEPTH) === "2" ? 2 : 1;
  } catch {
    return 1;
  }
}

export function writeDepth(depth: 1 | 2): void {
  try {
    localStorage.setItem(DEPTH, String(depth));
  } catch {
    /* the choice lasts only while the page is open */
  }
}
