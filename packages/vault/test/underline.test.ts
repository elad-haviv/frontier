import type { Nodes, PhrasingContent, Root } from "mdast";
import { describe, expect, it } from "vitest";
import { remarkUnderline } from "../src/index.js";

// Trees are written by hand, in the shape remark-parse gives: an inline `<u>` is an `html` node
// among its paragraph's children, and a `<u>` alone on a line is an `html` node of the root.
const text = (value: string) => ({ type: "text", value }) as const;
const html = (value: string) => ({ type: "html", value }) as const;
const at = (offset: number) => ({ line: 1, column: offset + 1, offset });
const placed = <T extends object>(node: T, from: number, to: number) => ({
  ...node,
  position: { start: at(from), end: at(to) },
});
const paragraph = (...children: object[]) =>
  ({ type: "root", children: [{ type: "paragraph", children }] }) as unknown as Root;

function run(tree: Root): Root {
  remarkUnderline()(tree);
  return tree;
}

/** The tree written back as text, with each underline as `_(…)_`, so tests read at a glance. */
function show(node: Nodes): string {
  if ("value" in node) return node.value;
  const inner = "children" in node ? (node.children as Nodes[]).map(show).join("") : "";
  if ((node.type as string) === "underline") return `_(${inner})_`;
  if (node.type === "strong") return `**${inner}**`;
  if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") {
    return `${inner}\n`;
  }
  return inner;
}

describe("remarkUnderline", () => {
  it("turns a matched pair of tags into an underline drawn as <u>", () => {
    const tree = run(paragraph(text("a "), html("<u>"), text("word"), html("</u>"), text(" b")));
    expect(show(tree)).toBe("a _(word)_ b\n");
    const underline = (tree.children[0] as { children: PhrasingContent[] }).children[1]!;
    expect(underline).toMatchObject({ type: "underline", data: { hName: "u" } });
    expect(underline.position).toBeUndefined();
  });

  it("spans from the opening tag to the closing one when both are placed", () => {
    const tree = run(paragraph(placed(html("<u>"), 0, 3), text("x"), placed(html("</u>"), 4, 8)));
    const underline = (tree.children[0] as { children: PhrasingContent[] }).children[0]!;
    expect(underline.position).toEqual({ start: at(0), end: at(8) });
  });

  it("leaves a tag without its partner as text", () => {
    const tree = run(paragraph(placed(html("<u>"), 0, 3), text("open only")));
    expect(show(tree)).toBe("<u>open only\n");
    const first = (tree.children[0] as { children: PhrasingContent[] }).children[0]!;
    expect(first).toEqual({ type: "text", value: "<u>", position: { start: at(0), end: at(3) } });
    expect(show(run(paragraph(text("close only"), html("</u>"))))).toBe("close only</u>\n");
    expect(
      (run(paragraph(html("</u>"))).children[0] as { children: PhrasingContent[] }).children[0],
    ).toEqual({ type: "text", value: "</u>" });
  });

  it("pairs nested tags from the inside out, and ignores letter case", () => {
    const tree = run(
      paragraph(html("<U>"), text("a"), html("<u>"), text("b"), html("</u>"), html("</U>")),
    );
    expect(show(tree)).toBe("_(a_(b)_)_\n");
    expect(show(run(paragraph(html("<u>"), html("<u>"), text("b"), html("</u>"))))).toBe(
      "<u>_(b)_\n",
    );
  });

  it("works inside bold, and around it", () => {
    const inside = run(
      paragraph({ type: "strong", children: [html("<u>"), text("deep"), html("</u>")] }),
    );
    expect(show(inside)).toBe("**_(deep)_**\n");
    const around = run(
      paragraph(html("<u>"), { type: "strong", children: [text("bold")] }, html("</u>")),
    );
    expect(show(around)).toBe("_(**bold**)_\n");
  });

  it("works in a heading and in a table cell", () => {
    const heading = {
      type: "root",
      children: [
        { type: "heading", depth: 2, children: [html("<u>"), text("Tides"), html("</u>")] },
      ],
    } as unknown as Root;
    expect(show(run(heading))).toBe("_(Tides)_\n");
    const table = {
      type: "root",
      children: [
        {
          type: "table",
          children: [
            {
              type: "tableRow",
              children: [
                { type: "tableCell", children: [html("<u>"), text("cell"), html("</u>")] },
              ],
            },
          ],
        },
      ],
    } as unknown as Root;
    expect(show(run(table))).toBe("_(cell)_\n");
  });

  it("leaves a <u> alone on a line, an HTML block, as it is", () => {
    const tree = {
      type: "root",
      children: [html("<u>"), { type: "paragraph", children: [text("between")] }, html("</u>")],
    } as unknown as Root;
    run(tree);
    expect(tree.children.map((n) => n.type)).toEqual(["html", "paragraph", "html"]);
  });

  it("does not pair tags across paragraphs, which stay as text", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [html("<u>"), text("first")] },
        { type: "paragraph", children: [text("second"), html("</u>")] },
      ],
    } as unknown as Root;
    expect(show(run(tree))).toBe("<u>first\nsecond</u>\n");
  });

  it("pairs tags across the lines of one paragraph", () => {
    const tree = run(paragraph(html("<u>"), text("one\ntwo"), html("</u>")));
    expect(show(tree)).toBe("_(one\ntwo)_\n");
  });

  it("leaves other HTML and nodes without children alone", () => {
    const tree = run(
      paragraph(html("<b>"), text("x"), html("</b>"), { type: "inlineCode", value: "<u>" }),
    );
    expect(show(tree)).toBe("<b>x</b><u>\n");
    expect((tree.children[0] as { children: PhrasingContent[] }).children[3]!.type).toBe(
      "inlineCode",
    );
  });
});
