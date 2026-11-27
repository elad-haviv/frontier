import { describe, expect, it } from "vitest";
import { readRelations, setRelations } from "../src/index.js";

const note = `---
type: person
# the author's comment
relations:
  - what: parent
    who: "[[Corin Vane]]"
  - what: partner
    who: "[[Garrow Pike]]"
    when: from 288
    source: chapter 3
  - what: child
    who: [[Nessa Pike]]
    with: "[[Garrow Pike]]"
    how: adopted
time:
  - what: born
    when: "268"
---
# Wren Vane

Body.
`;

describe("readRelations", () => {
  it("reads each item, keeping keys it does not know", () => {
    expect(readRelations(note)).toEqual({
      items: [
        { what: "parent", who: "[[Corin Vane]]" },
        { what: "partner", who: "[[Garrow Pike]]", when: "from 288", extra: { source: "chapter 3" } },
        { what: "child", who: "[[Nessa Pike]]", with: "[[Garrow Pike]]", how: "adopted" },
      ],
      problems: [],
    });
  });

  it("is empty without the key", () => {
    expect(readRelations("# Plain\n")).toEqual({ items: [], problems: [] });
  });

  it("names what cannot be read", () => {
    expect(readRelations("---\nrelations: many\n---\n").problems).toEqual([
      "`relations` is not a list.",
    ]);
    const r = readRelations("---\nrelations:\n  - who: x\n  - what: parent\n  - what: rival\n    who: Odo\n---\n");
    expect(r.problems).toEqual([
      "Item 1 of `relations` has no `what`.",
      "Item 2 of `relations` has no `who`.",
    ]);
    expect(r.items).toEqual([{ what: "rival", who: "Odo" }]);
  });
});

describe("setRelations", () => {
  it("writes the standard form and leaves every other line as it was", () => {
    const items = readRelations(note).items;
    const next = setRelations(note, [...items, { what: "rival", who: "[[Odo Vane]]" }]);
    expect(readRelations(next).items).toEqual([...items, { what: "rival", who: "[[Odo Vane]]" }]);
    expect(next).toContain("# the author's comment");
    expect(next).toContain('    who: "[[Nessa Pike]]"\n    with: "[[Garrow Pike]]"\n    how: adopted');
    expect(next).toContain('time:\n  - what: born\n    when: "268"');
    expect(next.endsWith("# Wren Vane\n\nBody.\n")).toBe(true);
  });

  it("adds the key to a note without frontmatter, and removes it when empty", () => {
    const made = setRelations("# Odo\n", [{ what: "rival", who: "[[Halric Vane]]" }]);
    expect(readRelations(made).items).toEqual([{ what: "rival", who: "[[Halric Vane]]" }]);
    expect(setRelations(made, [])).not.toContain("relations");
  });
});
