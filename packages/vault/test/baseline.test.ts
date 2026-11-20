import { describe, expect, it } from "vitest";
import { buildLinkBaseline, diffBaselines } from "../src/index.js";
import { fixture, fixtureFiles } from "./helpers.js";

describe("link baseline", () => {
  const base = buildLinkBaseline("abc123", fixtureFiles(), fixture);

  it("sorts every link of the fixture into one of four lists", () => {
    expect(base.vaultCommit).toBe("abc123");
    expect(base.unresolved.map((u) => u.link)).toEqual([
      "[[The Drowned Bell]]",
      "[[The Drowned Bell|the bell]]",
      "[[Saltmother]]",
      "[[01 Places/Nowhere/Gone]]",
      "![missing](<../99 Appendices/Images/none.png>)",
      "![[nothing.png]]",
    ]);
    expect(base.ambiguous.map((a) => `${a.note} :: ${a.link}`)).toEqual([
      "03 Things/Gallery.md :: ![[lamp.png]]",
      "03 Things/Lantern.md :: [[Twin]]",
      "03 Things/Twin.md :: [[Twin]]",
    ]);
    expect(base.outside).toEqual([{ note: "02 People/Mira.md", link: "[[.obsidian/app.json]]" }]);
    expect(base.resolved.length).toBeGreaterThan(30);
    expect(base.resolved).toContainEqual({
      note: "02 People/Mira.md",
      link: "[[Harbor/Old Quay]]",
      target: "01 Places/Harbor/Old Quay.md",
    });
  });

  it("reports no difference against itself", () => {
    expect(diffBaselines(base, base)).toEqual({ removed: [], added: [] });
  });

  it("reports what changed, counting repeated lines", () => {
    const after = buildLinkBaseline(
      "def456",
      [...fixtureFiles(), "01 Places/Saltmother.md"],
      (p) =>
        p === "01 Places/Saltmother.md" ? "# Saltmother\n\n[[Harbor]] [[Harbor]]\n" : fixture(p),
    );
    const d = diffBaselines(base, after);
    expect(d.removed).toEqual(["unresolved  01 Places/Unwritten.md :: [[Saltmother]]"]);
    expect(d.added).toEqual([
      "resolved    01 Places/Saltmother.md :: [[Harbor]] -> 01 Places/Harbor/Harbor.md",
      "resolved    01 Places/Saltmother.md :: [[Harbor]] -> 01 Places/Harbor/Harbor.md",
      "resolved    01 Places/Unwritten.md :: [[Saltmother]] -> 01 Places/Saltmother.md",
    ]);
    const back = diffBaselines(after, base);
    expect(back.removed).toHaveLength(3);
    expect(back.added).toHaveLength(1);
  });
});
