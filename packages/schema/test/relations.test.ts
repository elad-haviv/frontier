import { describe, expect, it } from "vitest";
import {
  BUILT_IN_KINDS,
  findKind,
  kindsOf,
  libraryFileNamed,
  parseTrees,
  renameInTrees,
  serialiseTrees,
  TREES,
  type TreesFile,
} from "../src/index.js";

describe("kinds of relation", () => {
  it("finds a word, its other words and its reverse, in any case", () => {
    expect(findKind(BUILT_IN_KINDS, "Mother")).toMatchObject({
      kind: { name: "parent" },
      reversed: false,
    });
    expect(findKind(BUILT_IN_KINDS, "daughter")).toMatchObject({
      kind: { name: "parent" },
      reversed: true,
    });
    expect(findKind(BUILT_IN_KINDS, "wife")).toMatchObject({ kind: { name: "partner" } });
    expect(findKind(BUILT_IN_KINDS, "friend")).toBeNull();
  });

  it("adds the author's kinds after the built-in ones, never one that is taken", () => {
    const kinds = kindsOf([{ name: "apprentice of", reverse: "master of" }, { name: "son" }]);
    expect(kinds.map((k) => k.name).slice(-1)).toEqual(["apprentice of"]);
  });
});

describe("the trees file", () => {
  const file: TreesFile = {
    version: 1,
    trees: [
      {
        id: "vane0001",
        name: "House Vane",
        kind: "parent",
        look: "family",
        start: "02 People/Aldric.md",
        dir: "down",
        folded: ["02 People/Corin.md"],
      },
    ],
    fine: ["young|02 People/Lysa.md|02 People/Maren.md"],
  };

  it("is a library item file with one tree per line", () => {
    expect(libraryFileNamed("trees")).toBe(TREES);
    const text = serialiseTrees(file);
    expect(text).toContain('{"id":"vane0001","name":"House Vane"');
    expect(parseTrees(text)).toEqual({ ok: true, file });
    expect(parseTrees('{"version":1,"trees":[{"id":"x"}]}').ok).toBe(false);
  });

  it("follows a renamed folder in starts, folds and checks", () => {
    const moved = renameInTrees(file, "02 People", "04 Inhabitants");
    expect(moved.trees[0]).toMatchObject({
      start: "04 Inhabitants/Aldric.md",
      folded: ["04 Inhabitants/Corin.md"],
    });
    expect(moved.fine).toEqual(["young|04 Inhabitants/Lysa.md|04 Inhabitants/Maren.md"]);
  });
});
