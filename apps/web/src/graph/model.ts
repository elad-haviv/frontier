/**
 * The graph as the browser uses it: the server's compact answer with each node's folder, top-level
 * folder and neighbours worked out, and the filters that decide what is shown. Pure functions.
 */
import type { GraphNode, GraphResponse } from "@frontier/schema";
import { APPENDIX_ROOT } from "@frontier/vault";

/** The folder the screen hides until it is ticked. */
export const APPENDICES = APPENDIX_ROOT;

/** Notes at the top level that are about the library rather than in it, hidden by default. */
const ABOUT_THE_LIBRARY = new Set(["README.md", "AGENTS.md"]);

export interface ModelNode extends GraphNode {
  /** Its folder, "" at the top level. */
  folder: string;
  /** Its top-level folder, or null at the top level. */
  top: string | null;
  /** The entries it links to, and those linking to it, by index. */
  out: number[];
  in: number[];
}

export interface GraphModel {
  nodes: ModelNode[];
  byPath: Map<string, number>;
  edges: [number, number][];
  folders: GraphResponse["folders"];
  nested: GraphResponse["nested"];
}

/** What is shown: the nodes, the edges among them, and each node's shown neighbours. */
export interface Shown {
  nodes: number[];
  edges: [number, number][];
  /** By node index: whether it is shown. */
  has: boolean[];
  /** By node index: how many distinct shown entries it is linked with, either way. */
  degree: number[];
}

export function makeModel(r: GraphResponse): GraphModel {
  const nodes: ModelNode[] = r.nodes.map((n) => {
    const slash = n.path.lastIndexOf("/");
    const first = n.path.indexOf("/");
    return {
      ...n,
      folder: slash === -1 ? "" : n.path.slice(0, slash),
      top: first === -1 ? null : n.path.slice(0, first),
      out: [],
      in: [],
    };
  });
  for (const [a, b] of r.edges) {
    nodes[a]!.out.push(b);
    nodes[b]!.in.push(a);
  }
  return {
    nodes,
    byPath: new Map(nodes.map((n, i) => [n.path, i])),
    edges: r.edges,
    folders: r.folders,
    nested: r.nested,
  };
}

/** The ticked top-level folders: the author's choices, else every folder but the appendices. */
export function tickedFolders(
  model: GraphModel,
  choices: ReadonlyMap<string, boolean>,
): Set<string> {
  // A folder that no longer exists is ignored; a new one starts ticked.
  return new Set(
    model.folders.map((f) => f.path).filter((p) => choices.get(p) ?? p !== APPENDICES),
  );
}

function shownFrom(model: GraphModel, keep: (i: number) => boolean): Shown {
  const has = model.nodes.map((_, i) => keep(i));
  const nodes = model.nodes.flatMap((_, i) => (has[i] ? [i] : []));
  const edges = model.edges.filter(([a, b]) => has[a] && has[b]);
  const neighbours = model.nodes.map(() => new Set<number>());
  for (const [a, b] of edges) {
    neighbours[a]!.add(b);
    neighbours[b]!.add(a);
  }
  return { nodes, edges, has, degree: neighbours.map((s) => s.size) };
}

/** Whether the screen shows a node by default: not a note about the library at the top level. */
const atTopShown = (node: ModelNode) => node.top !== null || !ABOUT_THE_LIBRARY.has(node.path);

/**
 * The nodes in a ticked top-level folder, and those at the top level but README.md and AGENTS.md;
 * an edge is shown when both its ends are.
 */
export function filterGraph(model: GraphModel, ticked: ReadonlySet<string>): Shown {
  return shownFrom(model, (i) => {
    const node = model.nodes[i]!;
    return node.top === null ? atTopShown(node) : ticked.has(node.top);
  });
}

/**
 * Why nothing is shown: an empty library, or every folder unticked; null when something is.
 */
export function emptyReason(model: GraphModel, shown: Shown): "empty" | "unticked" | null {
  if (shown.nodes.length > 0) return null;
  const all = filterGraph(model, new Set(model.folders.map((f) => f.path)));
  return all.nodes.length === 0 ? "empty" : "unticked";
}

/**
 * The local graph: the centre and the entries within `depth` links of it either way, with every
 * edge among them. What the screen hides by default is left out, but never the centre.
 */
export function neighbourhood(model: GraphModel, path: string, depth: number): Shown | null {
  const centre = model.byPath.get(path);
  if (centre === undefined) return null;
  const allowed = (i: number) => {
    const node = model.nodes[i]!;
    return i === centre || (node.top === null ? atTopShown(node) : node.top !== APPENDICES);
  };
  const reached = new Set([centre]);
  let ring = [centre];
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (const i of ring) {
      for (const j of [...model.nodes[i]!.out, ...model.nodes[i]!.in]) {
        if (!reached.has(j) && allowed(j)) {
          reached.add(j);
          next.push(j);
        }
      }
    }
    ring = next;
  }
  return shownFrom(model, (i) => reached.has(i));
}

/** A node's shown links out and in, for the words that announce it. */
export function shownLinks(
  model: GraphModel,
  shown: Shown,
  i: number,
): { out: number; in: number } {
  const node = model.nodes[i]!;
  return {
    out: node.out.filter((j) => shown.has[j]).length,
    in: node.in.filter((j) => shown.has[j]).length,
  };
}

/** The shown neighbours of a node, either way, without repeats. */
export function shownNeighbours(model: GraphModel, shown: Shown, i: number): number[] {
  const node = model.nodes[i]!;
  return [...new Set([...node.out, ...node.in])].filter((j) => shown.has[j]);
}

/** How the selected entry is announced: "Harbor, 01 Places/Harbor, 2 links out, 5 in". */
export function describeNode(model: GraphModel, shown: Shown, i: number): string {
  const node = model.nodes[i]!;
  const links = shownLinks(model, shown, i);
  const where = node.folder === "" ? "top level" : node.folder;
  const out = `${links.out} ${links.out === 1 ? "link" : "links"} out`;
  return `${node.title}, ${where}, ${out}, ${links.in} in${node.unpublished ? ", unpublished" : ""}`;
}
