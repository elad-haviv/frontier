import { describe, expect, it } from "vitest";
import {
  basename,
  dirname,
  entryType,
  extension,
  isEditable,
  isExcluded,
  isFolderNote,
  isImage,
  isInAppendix,
  isNearFolderNote,
  isNote,
  joinPath,
  nextFreeName,
  normalisePath,
  resolveSegmentsStrict,
  stem,
  stripMd,
} from "../src/index.js";

describe("path parts", () => {
  it("splits a path into folder, name, stem and extension", () => {
    expect(dirname("a/b/c.md")).toBe("a/b");
    expect(dirname("c.md")).toBe("");
    expect(basename("a/b/c.md")).toBe("c.md");
    expect(basename("c.md")).toBe("c.md");
    expect(stem("a/b/c.tar.gz")).toBe("c.tar");
    expect(stem("a/.hidden")).toBe(".hidden");
    expect(stem("a/README")).toBe("README");
    expect(extension("a/b/C.PNG")).toBe("png");
    expect(extension("a/.hidden")).toBe("");
    expect(extension("a/README")).toBe("");
  });

  it("normalises separators and leading marks", () => {
    expect(normalisePath("./a\\b/c.md")).toBe("a/b/c.md");
    expect(normalisePath("/a/b")).toBe("a/b");
  });

  it("strips a Markdown extension in any letter case", () => {
    expect(stripMd("a/B.MD")).toBe("a/B");
    expect(stripMd("a/b.png")).toBe("a/b.png");
  });

  it("resolves dot segments and refuses to climb above the root", () => {
    expect(resolveSegmentsStrict("a/./b/../c")).toBe("a/c");
    expect(resolveSegmentsStrict("a//b")).toBe("a/b");
    expect(resolveSegmentsStrict("../a")).toBeNull();
    expect(joinPath("a", "", "b", "../c")).toBe("a/c");
    expect(joinPath("..", "a")).toBe("");
  });
});

describe("what a path is", () => {
  it("treats Markdown outside excluded folders as notes", () => {
    expect(isNote("01 Places/Harbor/Harbor.md")).toBe(true);
    expect(isNote("README.md")).toBe(true);
    expect(isNote(".obsidian/Hidden.md")).toBe(false);
    expect(isNote("notes.json")).toBe(false);
  });

  it("knows the excluded folders", () => {
    for (const f of [".git", ".obsidian", ".claude", ".gemini", ".frontier"]) {
      expect(isExcluded(`${f}/x`)).toBe(true);
    }
    expect(isExcluded("01 Places/.obsidian/x")).toBe(false);
    expect(isExcluded("")).toBe(false);
  });

  it("knows images by extension", () => {
    expect(isImage("a/b.PNG")).toBe(true);
    expect(isImage("a/b.jpeg")).toBe(true);
    expect(isImage("a/b.md")).toBe(false);
  });

  it("makes the appendix folder append-only", () => {
    expect(isInAppendix("99 Appendices")).toBe(true);
    expect(isInAppendix("99 Appendices/Logs/Session.md")).toBe(true);
    expect(isInAppendix("99 Appendices Extra/x.md")).toBe(false);
    expect(isEditable("99 Appendices/Logs/Session.md")).toBe(false);
    expect(isEditable(".obsidian/app.json")).toBe(false);
    expect(isEditable("02 People/Mira.md")).toBe(true);
  });

  it("takes the entry type from the top-level folder", () => {
    expect(entryType("02 People/Mira.md")).toBe("02 People");
    expect(entryType("README.md")).toBe("");
  });
});

describe("folder notes", () => {
  it("is a note named exactly after its folder", () => {
    expect(isFolderNote("01 Places/Harbor/Harbor.md")).toBe(true);
    expect(isFolderNote("01 Places/Harbor/Old Quay.md")).toBe(false);
    expect(isFolderNote("Harbor.md")).toBe(false);
    expect(isFolderNote("Harbor/Harbor.png")).toBe(false);
  });

  it("spots near misses without calling them folder notes", () => {
    expect(isNearFolderNote("01 Places/Marsh/The Marsh.md")).toBe(true);
    expect(isNearFolderNote("x/Ru'una/Ru'una (Moon).md")).toBe(true);
    expect(isNearFolderNote("x/Ataemmia/Ataemia.md")).toBe(true);
    expect(isNearFolderNote("x/Ataemia/Ataemmia.md")).toBe(true);
    expect(isNearFolderNote("x/Marsh/Marsk.md")).toBe(true);
    expect(isNearFolderNote("01 Places/Harbor/Harbor.md")).toBe(false);
    expect(isNearFolderNote("01 Places/Harbor/Old Quay.md")).toBe(false);
    expect(isNearFolderNote("Harbor.md")).toBe(false);
    expect(isNearFolderNote("x/Harbor/Harbor.png")).toBe(false);
    expect(isNearFolderNote("x/Harbor/Harbour Master.md")).toBe(false);
    expect(isNearFolderNote("x/Harbor/(aside).md")).toBe(false);
    expect(isNearFolderNote("x/(aside)/Harbor.md")).toBe(false);
  });
});

describe("free image names", () => {
  it("keeps a name nobody uses", () => {
    expect(nextFreeName("Camp.png", ["a/lamp.png"])).toBe("Camp.png");
  });

  it("adds a number when the name exists anywhere, ignoring case", () => {
    expect(nextFreeName("Lamp.png", ["x/lamp.png"])).toBe("Lamp 2.png");
    expect(nextFreeName("lamp.png", ["x/Lamp.png", "y/LAMP 2.png"])).toBe("lamp 3.png");
  });

  it("handles a name with no extension", () => {
    expect(nextFreeName("notes", ["notes"])).toBe("notes 2");
  });
});
