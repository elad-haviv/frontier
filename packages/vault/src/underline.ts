/**
 * Underline, written `<u>…</u>` as Obsidian writes it. Markdown has no underline of its own, and
 * Frontier does not render raw HTML, so a remark plugin turns a matched pair of tags into a node
 * of its own, drawn as `<u>`.
 */
import type { Html, Nodes, Parent, PhrasingContent, Root, Text } from "mdast";

/** The node a matched `<u>` and `</u>` become: its children are what stood between them. */
export interface Underline extends Parent {
  type: "underline";
  children: PhrasingContent[];
  data: { hName: "u" };
}

/** The parents whose children are inline text: only there is a `<u>` a tag in running text. */
const INLINE_PARENTS = new Set([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "underline",
]);

const OPEN = /^<u>$/i;
const CLOSE = /^<\/u>$/i;

const isTag = (node: Nodes, tag: RegExp): node is Html =>
  node.type === "html" && tag.test(node.value);

/**
 * Pairs the tags among one parent's children. A tag left without its partner is shown as the
 * text it is, so nothing typed disappears.
 */
function pair(children: Nodes[]): Nodes[] {
  const out: Nodes[] = [];
  const open: number[] = [];
  for (const child of children) {
    if (isTag(child, OPEN)) {
      open.push(out.length);
      out.push(child);
    } else if (isTag(child, CLOSE) && open.length > 0) {
      const inner = out.splice(open.pop()!);
      const start = inner.shift()!;
      const underline: Underline = {
        type: "underline",
        children: inner as PhrasingContent[],
        data: { hName: "u" },
      };
      if (start.position && child.position) {
        underline.position = { start: start.position.start, end: child.position.end };
      }
      out.push(underline as unknown as Nodes);
    } else {
      out.push(child);
    }
  }
  return out.map((node) =>
    isTag(node, OPEN) || isTag(node, CLOSE)
      ? ({
          type: "text",
          value: node.value,
          ...(node.position ? { position: node.position } : {}),
        } as Text)
      : node,
  );
}

function walk(node: Nodes): void {
  if (!("children" in node)) return;
  const parent = node as Parent;
  if (INLINE_PARENTS.has(parent.type)) parent.children = pair(parent.children as Nodes[]) as never;
  for (const child of parent.children) walk(child as Nodes);
}

/**
 * A remark plugin: each inline `<u>` and its matching `</u>` among the same parent's children (a
 * paragraph, a heading, a table cell, or a mark such as bold) become an underline node. A `<u>`
 * alone on a line is an HTML block in Markdown and is left as it is.
 */
export function remarkUnderline() {
  return (tree: Root): void => walk(tree);
}
