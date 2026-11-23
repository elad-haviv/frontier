import { isNote } from "@frontier/vault";
import type { Services } from "../app.js";

/**
 * Paths that drafts add to, or take away from, what is published. A draft's links are resolved
 * against the published files with these laid over them, by the entry page and the graph alike.
 */
export function overlay(s: Pick<Services, "drafts" | "index">): {
  added: string[];
  removed: string[];
} {
  const drafts = s.drafts.list();
  return {
    added: drafts
      // Notes and uploaded images, so links and embeds resolve; a map is neither.
      .filter((d) => d.kind === "create" && (d.binary || isNote(d.path)) && !s.index.note(d.path))
      .map((d) => d.path),
    removed: drafts.filter((d) => d.kind === "delete").map((d) => d.path),
  };
}
