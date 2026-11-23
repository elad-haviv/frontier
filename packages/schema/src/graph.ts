/**
 * The graph of the library, `GET /api/graph`: every entry as a node and every link between two
 * entries as an edge, with the top-level folders and their colours. It is compact, since the
 * browser derives the rest (a node's folder, its neighbours) from the paths and the edges.
 *
 * It is also the compact index a device keeps for reading offline (stage 15b): with each node's id
 * and version mark and the paths of the other files, links resolve and names are found there.
 */
import { z } from "zod";
import { FOLDER_COLOR_NAMES, type FolderColor } from "./folders.js";

const Color = z.enum(FOLDER_COLOR_NAMES as [FolderColor, ...FolderColor[]]);

export const GraphNode = z.object({
  /** The published path; the entry opens at /e/<path>. */
  path: z.string().min(1),
  /** The file name without ".md". */
  title: z.string(),
  /** The field `type`, else the folder's type, as the entry page decides. */
  type: z.string().nullable(),
  /** Only when there are some; the find field searches them. */
  aliases: z.array(z.string()).optional(),
  /** An edit or create draft. */
  unpublished: z.literal(true).optional(),
  /** The entry's `id` field, when it has one, so a map feature's linked entry can be named. */
  id: z.string().optional(),
  /**
   * A version mark: the first 12 characters of the library file's blob, then "." and the draft's
   * revision when there is a draft ("3f9a0c21be77.4"). The device compares it with what it holds.
   * The server always sends it (stage 15b); optional so a graph made by hand needs none.
   */
  v: z.string().optional(),
});
export type GraphNode = z.infer<typeof GraphNode>;

/**
 * A version mark: the first 12 characters of the library file's blob ("" for none), then "." and
 * the draft's revision when there is a draft. Entries, maps and chronicles all carry one.
 */
export function versionMark(blob: string | undefined, revision: number | undefined): string {
  return `${(blob ?? "").slice(0, 12)}${revision === undefined || revision === 0 ? "" : `.${revision}`}`;
}

const Index = z.number().int().min(0);

export const GraphResponse = z
  .object({
    nodes: z.array(GraphNode),
    /** Indexes into `nodes`; one per linking pair and direction. */
    edges: z.array(z.tuple([Index, Index])),
    /** The top-level folders holding a node, in the tree's order; null is the neutral colour. */
    folders: z.array(z.object({ path: z.string().min(1), color: Color.nullable() })),
    /** Deeper folders with a colour of their own. */
    nested: z.array(z.object({ path: z.string().min(1), color: Color })),
    /**
     * Every library file that is not a note (images and other files) outside the excluded folders,
     * and unpublished uploads: with the nodes, enough to resolve links and embeds on the device.
     * The server always sends it (stage 15b).
     */
    files: z.array(z.string()).optional(),
  })
  .superRefine((graph, ctx) => {
    const n = graph.nodes.length;
    for (const [from, to] of graph.edges) {
      if (from >= n || to >= n) {
        ctx.addIssue({ code: "custom", message: `The edge ${from} → ${to} has no node.` });
        return;
      }
    }
  });
export type GraphResponse = z.infer<typeof GraphResponse>;
