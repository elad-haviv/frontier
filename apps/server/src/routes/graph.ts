import type { FastifyInstance } from "fastify";
import type { GraphResponse } from "@frontier/schema";
import { isNote } from "@frontier/vault";
import type { Services } from "../app.js";
import { overlay } from "../entries/overlay.js";
import { buildGraph } from "../index/graph.js";

/**
 * The graph of the library: published links, with each draft changing only itself. Built again on
 * every request; at the library's size that takes milliseconds.
 */
export function graphRoutes(app: FastifyInstance, s: Services): void {
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
    });
  });
}
