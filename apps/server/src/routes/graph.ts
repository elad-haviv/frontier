import type { RouteApp } from "../projects/facade.js";
import type { GraphResponse } from "@frontier/schema";
import { isNote } from "@frontier/vault";
import type { Services } from "../app.js";
import { overlay } from "../entries/overlay.js";
import { buildGraph } from "../index/graph.js";
import { perProject } from "../projects/context.js";

/**
 * The graph of the library: published links, with each draft changing only itself. Built again on
 * every request; at the library's size that takes milliseconds. It is also the device's compact
 * index (stage 15b), with version marks from the library files' blobs, read once per commit.
 */
export function graphRoutes(app: RouteApp, s: Services): void {
  const held = perProject(() => ({
    blobs: null as { commit: string | null; read: Promise<Map<string, string>> } | null,
  }));
  const blobsNow = () => {
    const mine = held();
    if (!mine.blobs || mine.blobs.commit !== s.index.commit) {
      const read = s.git.blobs().catch(() => new Map<string, string>());
      mine.blobs = { commit: s.index.commit, read };
    }
    return mine.blobs.read;
  };

  app.get("/api/graph", async (): Promise<GraphResponse> => {
    const drafts = s.drafts.list();
    const texts = new Map<string, string>();
    for (const d of drafts) {
      if (d.kind !== "delete" && !d.binary && isNote(d.path)) {
        texts.set(d.path, await s.drafts.text(d.id));
      }
    }
    const { added, removed } = overlay(s);
    return buildGraph({
      index: s.index,
      drafts,
      texts,
      added,
      removed,
      folders: s.folders.file(),
      blobs: await blobsNow(),
    });
  });
}
