import { BUILT_IN_KINDS, type RelationsResponse, type TreeLine } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  biggestFamily,
  describe as describePerson,
  familyWord,
  layoutTree,
  makeGraph,
  relate,
  warningsOf,
} from "./model.ts";

const P = (name: string) => `People/${name}.md`;
const person = (name: string, born: number | null = null, died: number | null = null) => ({
  key: P(name),
  title: name,
  path: P(name),
  type: "person",
  born,
  died,
  dates: null,
});
const fact = (
  kind: string,
  a: string,
  b: string,
  extra: Partial<{ with: string; how: string }> = {},
) => ({
  kind,
  a: P(a),
  b: P(b),
  with: extra.with ? P(extra.with) : null,
  how: extra.how ?? null,
  when: null,
  sources: [{ path: P(b), index: 0, word: kind }],
  disagree: null,
});

// Aldric and Sera have Corin and Maren. Corin and Ilsa have Wren. Wren has Pell with Bram and
// Nessa with Garrow (written once, with "with"). Maren and Tobin have Lysa, born when Maren was 13.
const response: RelationsResponse = {
  kinds: BUILT_IN_KINDS,
  people: [
    person("Aldric", 212, 281),
    person("Sera", 218),
    person("Corin", 240),
    person("Ilsa", 244),
    person("Maren", 243),
    person("Tobin", 238),
    person("Wren", 268),
    person("Bram", 258),
    person("Garrow", 262),
    person("Pell", 286),
    person("Nessa", 292),
    person("Lysa", 256),
  ],
  facts: [
    fact("parent", "Aldric", "Corin"),
    fact("parent", "Sera", "Corin"),
    fact("parent", "Aldric", "Maren"),
    fact("parent", "Sera", "Maren"),
    fact("parent", "Corin", "Wren"),
    fact("parent", "Ilsa", "Wren"),
    fact("parent", "Wren", "Pell"),
    fact("parent", "Bram", "Pell", { how: "adopted" }),
    fact("parent", "Wren", "Nessa", { with: "Garrow" }),
    fact("parent", "Maren", "Lysa"),
    fact("parent", "Tobin", "Lysa"),
    fact("partner", "Aldric", "Sera"),
    fact("partner", "Corin", "Ilsa"),
    fact("partner", "Bram", "Wren", { how: "ended" }),
    fact("partner", "Garrow", "Wren"),
    fact("partner", "Maren", "Tobin"),
  ],
  unknown: [],
};
const g = makeGraph(response);
const tree: TreeLine = {
  id: "vane0001",
  name: "House Vane",
  kind: "parent",
  look: "family",
  start: P("Aldric"),
  dir: "down",
};

describe("layout of a family", () => {
  const L = layoutTree(g, tree);

  it("puts partners beside the line, marked as married in, and generations in rows", () => {
    expect(L.nodes.get(P("Sera"))).toMatchObject({ inlaw: true, owner: P("Aldric") });
    expect(L.nodes.get(P("Corin"))!.d).toBe(L.nodes.get(P("Maren"))!.d);
    expect(L.nodes.get(P("Wren"))!.d).toBeGreaterThan(L.nodes.get(P("Corin"))!.d);
    // Two partners sit on either side.
    const [bram, wren, garrow] = ["Bram", "Wren", "Garrow"].map((n) => L.nodes.get(P(n))!.b);
    expect(bram! < wren! && wren! < garrow!).toBe(true);
  });

  it("hangs each child from the couple it belongs to", () => {
    const pell = L.edges.find((e) => e.type === "down" && e.to === P("Pell"))!;
    const nessa = L.edges.find((e) => e.type === "down" && e.to === P("Nessa"))!;
    expect(pell.ab).toBeLessThan(L.nodes.get(P("Wren"))!.b);
    expect(nessa.ab).toBeGreaterThan(L.nodes.get(P("Wren"))!.b);
    expect(pell.dashed).toBe(false);
    expect(L.edges.find((e) => e.type === "couple" && e.to === P("Bram"))!.ended).toBe(true);
  });

  it("folds below the generations asked for and says how many are hidden", () => {
    const short = layoutTree(g, { ...tree, gens: 2 });
    expect(short.nodes.has(P("Wren"))).toBe(false);
    expect(short.nodes.get(P("Corin"))).toMatchObject({ folded: true, hidden: 3 });
    const opened = layoutTree(g, { ...tree, gens: 2, opened: [P("Corin")] });
    expect(opened.nodes.has(P("Wren"))).toBe(true);
  });

  it("draws ancestors upwards from someone", () => {
    const L2 = layoutTree(g, { ...tree, way: "up", from: P("Wren") });
    expect(L2.root).toBe(P("Wren"));
    expect(L2.nodes.get(P("Aldric"))!.d).toBeLessThan(L2.nodes.get(P("Corin"))!.d);
    expect(L2.nodes.has(P("Pell"))).toBe(false);
  });
});

describe("how two are related", () => {
  it("names the family word and the path", () => {
    expect(relate(g, "parent", P("Maren"), P("Pell")).text).toBe(
      "Pell is Maren's sibling's grandchild.",
    );
    expect(relate(g, "parent", P("Pell"), P("Nessa")).text).toBe("Nessa is Pell's half-sibling.");
    expect(relate(g, "parent", P("Lysa"), P("Wren")).text).toBe("Wren is Lysa's first cousin.");
    expect(relate(g, "parent", P("Wren"), P("Tobin")).text).toBe(
      "Tobin is the partner of Wren's parent's sibling.",
    );
    expect(relate(g, "parent", P("Aldric"), P("Nessa")).path).toEqual([
      P("Aldric"),
      P("Corin"),
      P("Wren"),
      P("Nessa"),
    ]);
  });

  it("uses neutral words", () => {
    expect(familyWord(2, 1, false)).toBe("parent's sibling");
    expect(familyWord(3, 2, false)).toBe("first cousin once removed");
    expect(familyWord(0, 4, false)).toBe("great-great-grandchild");
  });
});

describe("checks and words", () => {
  it("warns of a parent too young, unless it was said to be right", () => {
    expect(warningsOf(g, "parent", P("Lysa"))).toEqual([
      { key: `young|${P("Lysa")}|${P("Maren")}`, text: "Born in 256, when Maren was 13." },
    ]);
    expect(warningsOf(g, "parent", P("Lysa"), [`young|${P("Lysa")}|${P("Maren")}`])).toEqual([]);
  });

  it("reads a card out in full", () => {
    expect(describePerson(g, "parent", P("Wren"))).toBe(
      "Wren, born 268, child of Corin and Ilsa, 2 partners, 2 children",
    );
  });

  it("finds the biggest family already written", () => {
    expect(biggestFamily(g)).toEqual({ start: P("Aldric"), size: 7 });
  });
});
