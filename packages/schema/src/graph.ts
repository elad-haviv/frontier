/**
 * The graph of the library, `GET /api/graph`: every entry as a node and every link between two
 * entries as an edge, with the top-level folders and their colours. It is compact, since the
 * browser derives the rest (a node's folder, its neighbours) from the paths and the edges.
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
});
export type GraphNode = z.infer<typeof GraphNode>;

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
